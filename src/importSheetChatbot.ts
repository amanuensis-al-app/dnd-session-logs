import type {
  Character,
  GainedItem,
  ItemCategory,
  LogEntry,
  LogType,
  LossReason,
  LostItem,
  Rarity,
} from './types';
import {
  ITEM_CATEGORIES,
  LOG_TYPES,
  MINOR_PROPERTIES,
  RARITIES,
  newId,
  stackedItemId,
} from './types';
import { lookupCatalog, normalizeKey, type AlImportResult } from './importAlLog';
import { baseNameKey, canonicalConsumable, characterNameFromFile } from './importSheetLog';
import { canonicalizeSpellScrollForImport } from './spells';
import { parseLooseDate } from './importText';

/**
 * The AI-chatbot bridge for the (private) log-sheet import — same zero-key pattern as
 * Add Log from Text: the app writes self-contained instructions with the raw CSV
 * embedded, the owner pastes them into any chatbot, and the JSON reply is pasted back
 * and validated here into the same {character, logs, warnings} shape the offline
 * importer produces. Unlike Add Log from Text this covers ALL log types, so the
 * chatbot can classify the sheet's odd rows (Mythal Body Reform, Service Award,
 * undated Catch Ups…) better than the offline heuristics can.
 *
 * The reply references lost items by NAME; matching them to the ids of earlier gains
 * happens here, chronologically, with the same canonicalizations the offline importer
 * uses (spell scrolls, catalog consumable names, base-name fallback for magic items).
 */

// ---- Prompt --------------------------------------------------------------------

export function buildSheetChatbotPrompt(csvText: string, fileName?: string): string {
  return `You are converting a private D&D Adventurers League log spreadsheet (CSV) into JSON for a play tracker. Read the CSV between the <sheet> tags below and answer with ONE JSON object only — no explanation, no markdown code fences.

The CSV format (one character's whole history, roughly NEWEST FIRST):
- Columns: Adventure / Trade / Purchase, Date, Total Level at End, Downtime, Gold, DM, Location, Magic Items (+ Rarity + Rarity Value + Count), Consumables (+ Rarity + Rarity Value + Count), Magic Learnt Spell Slot (+ Count), Story Awards, Notes.
- A row with a non-empty first column starts a log entry; rows below it with an empty first column are continuations carrying more items/notes for the SAME entry.
- Item Count: positive = gained, negative = lost (traded away / consumed).
- Downtime and Gold are signed deltas (positive = gained, negative = spent).
- "Total Level at End" is the CUMULATIVE level after that entry (often blank).

Use exactly this shape:
{
  "character": { "name": "...", "species": "... or null", "class": "... or null" },
  "logs": [
    {
      "type": one of "session", "catchup", "transaction", "purchase", "sell", "creation", "free",
      "date": "YYYY-MM-DD",
      "title": "the entry's first-column text",
      "dm": "... or null (sessions only)",
      "location": "... or null (sessions only)",
      "tradePartner": "... or null (transactions only)",
      "gpGained": number >= 0,
      "gpLost": number >= 0,
      "downtimeGained": number >= 0,
      "downtimeSpent": number >= 0,
      "levelGained": number (negative allowed only in "free" logs),
      "itemsGained": [
        {
          "name": "item name",
          "category": one of "magic_item", "consumable", "equipment", "story_award", "blessing", "charm", "boon",
          "rarity": one of "common", "uncommon", "rare", "very rare", "legendary", "artifact" — or null,
          "quantity": number >= 1,
          "cost": per-unit GP paid — or null (purchases only),
          "description": "short, or null",
          "minorProperty": one of ${MINOR_PROPERTIES.map((p) => `"${p}"`).join(', ')} — or null
        }
      ],
      "itemsLost": [
        {
          "name": "EXACTLY the name the item was gained under in an earlier log",
          "quantity": number >= 1,
          "reason": one of "traded", "used", "sold", "lost", "other",
          "salePrice": per-unit GP received — or null (sells only)
        }
      ],
      "notes": "the entry's Notes text, or null"
    }
  ]
}

Rules:
- Output logs OLDEST FIRST (chronological), even though the sheet is newest-first. An undated row happened between its neighbors — give it the date of the next older entry.
- Log types:
  - "session": a DM'd game (has a DM and/or location). Rewards gold, +10 downtime, items; levelGained is the level delta.
  - "catchup": downtime spent to level up — exactly 10 downtime days per level gained ("Catch Up" rows; downtime −30 means +3 levels).
  - "transaction": trading a magic item for another of the SAME rarity; spends 5 downtime. The partner is in the title ("Trade with X", "Trade (* Boss Chen)") or the notes.
  - "purchase": gold spent on equipment/consumables; give every bought item its per-unit "cost". A "Purchase" row that GAINS gold is a sale instead → type "sell": the sold items go in itemsLost with reason "sold" and a per-unit "salePrice", gpGained = the gold received.
  - "creation": character creation — starting gold and equipment; levelGained = starting level − 1.
  - "free": everything else (service awards, level rewards, downtime activities like body reforms, corrections). This is the only type where levelGained may be negative.
- Levels: convert "Total Level at End" into per-log levelGained DELTAS along the chronological order, starting from level 1. Only session, catchup and creation entries level up; a level printed on a trade/purchase row is stale bookkeeping — ignore it. A blank level means "no change recorded"; the next filled-in value absorbs the difference.
- Spell scrolls: name them "Spell Scroll of <Spell>" (never "Spell Scroll (<Spell>)").
- itemsLost must reuse the EXACT name an earlier log gained the item under, so it can be matched back.
- Categories: potions/oils/elixirs/scrolls are "consumable"; magical gear is "magic_item"; mundane gear is "equipment"; names starting "[Boon]" are "boon" (drop the prefix); names starting "Blessing" are "blessing"; the Story Awards column's values are "story_award" items.
- Keep each entry's original Notes text in "notes". "Magic Learnt Spell Slot" values have no field — append them as a notes line.
- If something is unclear, make your best guess: a person reviews everything in a preview before importing.

File name: ${fileName ? `"${fileName}"` : '(unknown)'} — the character's name is usually the middle " - " segment of it.

<sheet>
${csvText.trim()}
</sheet>`;
}

// ---- Reply parsing -------------------------------------------------------------

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : undefined;

const numeric = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const pos = (v: unknown): number => Math.max(0, numeric(v) ?? 0);

const LOSS_REASONS: readonly LossReason[] = ['used', 'traded', 'sold', 'lost', 'other'];

export function parseSheetChatbotReply(reply: string, fileName?: string): AlImportResult {
  const warnings: string[] = [];
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(
      "That doesn't look like the chatbot's answer — make sure you copied its whole reply (it should contain a {...} block).",
    );
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new Error(
      "Couldn't read the chatbot's reply. Copy its whole answer and try again, or ask it to \"answer with only the JSON\".",
    );
  }

  const rawCharacter = (data.character ?? {}) as Record<string, unknown>;
  const character: Character = {
    id: newId(),
    name: str(rawCharacter.name) ?? characterNameFromFile(fileName, warnings),
    species: str(rawCharacter.species) ?? '',
    class: str(rawCharacter.class) ?? '',
    notes: `Imported from a personal log-sheet CSV via an AI chatbot on ${new Date().toISOString().slice(0, 10)}.`,
    createdAt: Date.now(),
  };

  const rawLogs = Array.isArray(data.logs) ? data.logs : [];
  if (rawLogs.length === 0) warnings.push('The reply contained no logs — only the character was imported.');

  // ---- First pass: validate every log's own fields --------------------------------
  interface DraftLog {
    type: LogType;
    date: string;
    log: Record<string, unknown>;
    index: number;
  }
  const drafts: DraftLog[] = [];
  let lastDate: string | undefined;
  rawLogs.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      warnings.push(`Log ${index + 1} was not an object — skipped.`);
      return;
    }
    const log = raw as Record<string, unknown>;
    let type = str(log.type)?.toLowerCase() as LogType | undefined;
    if (!type || !(LOG_TYPES as readonly string[]).includes(type)) {
      warnings.push(
        `"${str(log.title) ?? `Log ${index + 1}`}" had an unknown type "${str(log.type) ?? ''}" — imported as a Free Log.`,
      );
      type = 'free';
    }
    let date = str(log.date);
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = parseLooseDate(date) ?? undefined;
    if (!date) {
      date = lastDate ?? new Date().toISOString().slice(0, 10);
      warnings.push(`"${str(log.title) ?? `Log ${index + 1}`}" has no readable date — used ${date}.`);
    }
    lastDate = date;
    drafts.push({ type, date, log, index });
  });

  // Chronological order for loss-matching and replay ties; the prompt asks for
  // oldest-first already, so a stable sort keeps the chatbot's same-date ordering.
  drafts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index));

  // ---- Registries for matching losses against earlier gains -----------------------
  const stacks: { id: string; key: string; category: ItemCategory; remaining: number }[] = [];
  const gainedMagic: { keys: string[]; baseKey: string; id: string; remaining: number }[] = [];

  /** Chatbot item → GainedItem with the import-path canonicalizations applied. */
  function buildGain(item: Record<string, unknown>, logType: LogType, label: string): GainedItem | null {
    let name = str(item.name);
    if (!name) {
      warnings.push(`"${label}": skipped a gained item without a name.`);
      return null;
    }
    let category = str(item.category)?.toLowerCase().replace(/[\s-]+/g, '_') as ItemCategory | undefined;
    if (!category || !ITEM_CATEGORIES.includes(category)) {
      const match = lookupCatalog(name);
      category = match?.category ?? 'magic_item';
      warnings.push(`"${label}": "${name}" had an unknown category — recorded as ${category.replace('_', ' ')}.`);
    }
    const rawRarity = str(item.rarity)?.toLowerCase();
    let rarity =
      rawRarity && (RARITIES as readonly string[]).includes(rawRarity) ? (rawRarity as Rarity) : undefined;
    if (rawRarity && !rarity) warnings.push(`"${label}": "${name}" had an unknown rarity "${rawRarity}" — left blank.`);

    // Spell scrolls unify + take their level-derived rarity (import priority).
    const scroll = canonicalizeSpellScrollForImport(name, rarity);
    if (scroll.isSpellScroll) {
      name = scroll.name;
      rarity = scroll.rarity;
      category = 'consumable';
    }
    if (category === 'consumable') {
      const c = canonicalConsumable(name, rarity);
      name = c.name;
      rarity = c.rarity;
    }
    if (category !== 'magic_item' && category !== 'consumable') rarity = undefined;

    const stacked = category === 'consumable' || category === 'equipment';
    const quantity = Math.max(1, Math.round(numeric(item.quantity) ?? 1));
    const cost = logType === 'purchase' ? numeric(item.cost) : undefined;
    const rawProperty = str(item.minorProperty);
    const minorProperty = MINOR_PROPERTIES.find((p) => p.toLowerCase() === rawProperty?.toLowerCase());

    const gain: GainedItem = {
      id: stacked ? stackedItemId({ category, name, rarity: category === 'consumable' ? rarity : undefined }) : newId(),
      name,
      category,
      rarity,
      quantity,
      description: stacked ? undefined : str(item.description),
      minorProperty: category === 'magic_item' ? minorProperty : undefined,
      cost: cost !== undefined ? Math.max(0, cost) : undefined,
    };
    if (stacked) {
      const existing = stacks.find((s) => s.id === gain.id);
      if (existing) existing.remaining += quantity;
      else stacks.push({ id: gain.id, key: normalizeKey(name), category, remaining: quantity });
    } else {
      gainedMagic.push({
        keys: [normalizeKey(name)],
        baseKey: baseNameKey(name),
        id: gain.id,
        remaining: quantity,
      });
    }
    return gain;
  }

  /** Match a lost item by name against earlier gains: canonical stacks first
   * (consumable before equipment), then magic items newest-first with the same
   * base-name fallback the offline importer uses. */
  function buildLoss(item: Record<string, unknown>, logType: LogType, label: string): LostItem | null {
    const rawName = str(item.name);
    if (!rawName) {
      warnings.push(`"${label}": skipped a lost item without a name.`);
      return null;
    }
    const quantity = Math.max(1, Math.round(numeric(item.quantity) ?? 1));
    const rawReason = str(item.reason)?.toLowerCase();
    const reason: LossReason =
      rawReason && (LOSS_REASONS as readonly string[]).includes(rawReason)
        ? (rawReason as LossReason)
        : logType === 'sell'
          ? 'sold'
          : logType === 'transaction'
            ? 'traded'
            : 'used';
    const salePrice = logType === 'sell' ? numeric(item.salePrice) : undefined;

    // Canonicalize the same way gains were, so the keys line up.
    let name = rawName;
    const scroll = canonicalizeSpellScrollForImport(name);
    if (scroll.isSpellScroll) name = scroll.name;
    else name = canonicalConsumable(name).name;
    const key = normalizeKey(name);

    for (const category of ['consumable', 'equipment'] as const) {
      const stack = stacks.find((s) => s.category === category && s.key === key && s.remaining > 0);
      if (stack) {
        stack.remaining -= quantity;
        if (stack.remaining < 0) {
          warnings.push(
            `"${label}": removed more "${rawName}" than earlier logs gained — the inventory will flag it.`,
          );
        }
        return { itemId: stack.id, quantity, reason, salePrice: salePrice !== undefined ? Math.max(0, salePrice) : undefined };
      }
    }
    for (const pass of [0, 1] as const) {
      const needle = pass === 0 ? normalizeKey(rawName) : baseNameKey(rawName);
      for (let i = gainedMagic.length - 1; i >= 0; i--) {
        const g = gainedMagic[i];
        const match = pass === 0 ? g.keys.includes(needle) : g.baseKey === needle;
        if (match && g.remaining > 0) {
          g.remaining -= quantity;
          return { itemId: g.id, quantity, reason, salePrice: salePrice !== undefined ? Math.max(0, salePrice) : undefined };
        }
      }
    }
    warnings.push(
      `"${label}": lost "${rawName}", but no earlier log gained that item — the loss was skipped. Ask the chatbot to reuse the exact gained name, or record it manually.`,
    );
    return null;
  }

  // ---- Second pass: build the LogEntry list ---------------------------------------
  const logs: LogEntry[] = [];
  const createdAtBase = Date.now();
  drafts.forEach(({ type, date, log }, chronoIndex) => {
    const title = str(log.title) ?? '';
    const label = title || `Log ${chronoIndex + 1}`;
    const rawGains = Array.isArray(log.itemsGained) ? log.itemsGained : [];
    const gains = rawGains
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => buildGain(i, type, label))
      .filter((g): g is GainedItem => g !== null);
    const rawLosses = Array.isArray(log.itemsLost) ? log.itemsLost : [];
    const losses = rawLosses
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => buildLoss(i, type, label))
      .filter((l): l is LostItem => l !== null);

    const levelRaw = Math.round(numeric(log.levelGained) ?? 0);
    const levelGained = type === 'free' ? levelRaw : Math.max(0, levelRaw);
    const downtimeSpent = pos(log.downtimeSpent);
    if (type === 'catchup' && downtimeSpent !== levelGained * 10) {
      warnings.push(
        `"${label}": a Catch Up should spend exactly 10 downtime per level (+${levelGained} level(s) vs ${downtimeSpent} downtime) — check it after importing.`,
      );
    }

    logs.push({
      id: newId(),
      characterId: character.id,
      type,
      date,
      title,
      notes: str(log.notes),
      dm: type === 'session' ? str(log.dm) : undefined,
      location: type === 'session' ? str(log.location) : undefined,
      tradePartner: type === 'transaction' ? str(log.tradePartner) : undefined,
      gpGained: pos(log.gpGained),
      gpLost: pos(log.gpLost),
      downtimeGained: pos(log.downtimeGained),
      downtimeSpent,
      levelGained,
      itemsGained: gains,
      itemsLost: losses,
      createdAt: createdAtBase + chronoIndex,
    });
  });

  warnings.push('An AI converted this file — double-check the totals in the preview and spot-check the logs after importing.');
  return { character, logs, warnings };
}
