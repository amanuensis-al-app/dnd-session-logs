import type { GainedItem, ItemCategory, LogEntry, MinorProperty, Rarity } from './types';
import {
  ITEM_CATEGORIES,
  MINOR_PROPERTIES,
  RARITIES,
  STACKED_CATEGORIES,
  newId,
  stackedItemId,
} from './types';
import { CONSUMABLE_NAME_RE, lookupCatalog } from './importAlLog';
import { lookupKnownMagicItem } from './magicItemLookup';
import { expandPacks } from './packs';
import { canonicalizeSpellScrollForText } from './spells';

/**
 * "Add Log from Text": turn a pasted session recap (typically the DM's Discord post)
 * into a session-log draft. Two engines share this module:
 *
 *  - parseLogText — offline best-effort parser. Recap formats vary wildly per DM, so it
 *    keys on the recurring skeleton rather than exact markup: labelled lines
 *    (`Date:`/`When:`/`DM:`/`Gold:`), a per-player gold amount, and item sections that
 *    come as markdown headings (`## Magic items:`), bare labels (`Magic Items:`),
 *    or label+inline list (`Magic Items: A, B, C`) — with items as `**bold**` blocks,
 *    bullets, or bare short lines (prose paragraphs are filtered out).
 *  - buildChatbotPrompt + parseChatbotReply — the zero-setup AI path: the app writes
 *    instructions the user pastes into any chatbot (with the recap embedded), then the
 *    chatbot's JSON reply is pasted back and validated here.
 *
 * Neither engine saves anything: the result always prefills the LogForm for review,
 * and every assumption made is surfaced in `warnings`.
 */

export interface TextImportResult {
  log: LogEntry;
  warnings: string[];
}

// ---- Shared draft assembly -------------------------------------------------------

interface DraftFields {
  date?: string;
  title?: string;
  dm?: string;
  location?: string;
  gpGained?: number;
  downtimeGained?: number;
  levelsGained?: number;
  notes?: string;
  items: GainedItem[];
}

function makeGain(input: {
  name: string;
  category: ItemCategory;
  rarity?: Rarity;
  quantity: number;
  description?: string;
  minorProperty?: MinorProperty;
  /** Attunement as stated in the text (DM's recap) — wins over the items-list lookup. */
  requiresAttunement?: boolean;
}): GainedItem {
  let name = input.name.trim();
  let category = input.category;
  let rarity = input.rarity;
  // Unify "Spell Scroll (X)" / "Spell Scroll of X" and fill in the spell-level rarity
  // when the recap/chatbot didn't already give one.
  const scroll = canonicalizeSpellScrollForText(name, rarity);
  if (scroll.isSpellScroll) {
    name = scroll.name;
    rarity = scroll.rarity;
    category = 'consumable';
  }
  // Magic items: the 5e.tools list supplies attunement (and a missing rarity) when
  // the text itself didn't say.
  let requiresAttunement = input.requiresAttunement;
  if (category === 'magic_item') {
    const known = lookupKnownMagicItem(name);
    if (known) {
      requiresAttunement ??= known.requiresAttunement;
      rarity ??= known.rarity;
    }
  }
  const stacked = STACKED_CATEGORIES.includes(category);
  let description = input.description?.trim() || undefined;
  if (description && description.length > 400) description = `${description.slice(0, 400)}…`;
  return {
    id: stacked ? stackedItemId({ category, name, rarity }) : newId(),
    name,
    category,
    rarity,
    quantity: Math.max(1, Math.round(input.quantity)),
    description: stacked ? undefined : description,
    minorProperty: category === 'magic_item' ? input.minorProperty : undefined,
    requiresAttunement: category === 'magic_item' ? requiresAttunement : undefined,
  };
}

function buildSessionLog(characterId: string, f: DraftFields): LogEntry {
  return {
    id: newId(),
    characterId,
    type: 'session',
    date: f.date ?? new Date().toISOString().slice(0, 10),
    title: (f.title ?? '').trim(),
    notes: f.notes?.trim() || undefined,
    dm: f.dm?.trim() || undefined,
    location: f.location?.trim() || undefined,
    gpGained: Math.max(0, f.gpGained ?? 0),
    gpLost: 0,
    downtimeGained: Math.max(0, f.downtimeGained ?? 10),
    downtimeSpent: 0,
    levelGained: Math.max(0, Math.round(f.levelsGained ?? 1)),
    itemsGained: expandPacks(f.items),
    itemsLost: [],
    createdAt: Date.now(),
  };
}

// ---- Loose date parsing ------------------------------------------------------------

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function monthNumber(name: string): number | null {
  const key = name.toLowerCase().replace(/\.$/, '');
  if (key.length < 3) return null;
  const index = MONTHS.findIndex((m) => m.startsWith(key));
  return index === -1 ? null : index + 1;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "2026-07-04", "4 July 2026", "10 Jun 2026", "July 4th, 2026" → yyyy-mm-dd. */
export function parseLooseDate(text: string): string | null {
  const s = text.trim();
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dmy = s.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]+)\.?,?\s+(\d{4})/i);
  if (dmy) {
    const m = monthNumber(dmy[2]);
    if (m) return isoDate(Number(dmy[3]), m, Number(dmy[1]));
  }
  const mdy = s.match(/([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (mdy) {
    const m = monthNumber(mdy[1]);
    if (m) return isoDate(Number(mdy[3]), m, Number(mdy[2]));
  }
  return null;
}

// ---- Best-effort recap parser ------------------------------------------------------

/** Heading/label text → the item category its section lists, null for non-item sections. */
function sectionCategory(heading: string): ItemCategory | null {
  const h = heading.toLowerCase();
  if (/magic\s*item/.test(h)) return 'magic_item';
  if (/consumable|potion|scroll/.test(h)) return 'consumable';
  if (/story\s*award/.test(h)) return 'story_award';
  if (/blessing/.test(h)) return 'blessing';
  if (/charm/.test(h)) return 'charm';
  if (/boon/.test(h)) return 'boon';
  if (/loot|treasure|gear|mundane|equipment|\bitems?\b/.test(h)) return 'equipment';
  return null;
}

/** Headings that are structure, not the adventure's name ("Rewards", "Milestone Rewards"). */
const GENERIC_HEADING_RE = /^(rewards?|milestones?|summary|session|service|records?|awards?|epilogue)\b/i;

/**
 * Is this bare line an item name? Recaps often list items as plain lines under a
 * "Magic Items:" header ("+1 Chain Mail", "Ring of Protection") with prose paragraphs
 * around them ("Each character may choose…") — accept short noun-ish lines, reject
 * anything that reads like a sentence.
 */
function isPlainItemName(s: string): boolean {
  if (s.length < 2 || s.length > 60) return false;
  if (/[.!?]$/.test(s) || s.includes('. ')) return false;
  if (s.split(/\s+/).length > 8) return false;
  if ((s.match(/,/g) ?? []).length >= 3) return false; // "firebolt, light, mage hand, …"
  if (/\b(gp|gold|xp|downtime)\b/i.test(s)) return false;
  if (/^(please|each|the|a|an|all|if|you|your|we|note|reminder|everyone|choose|dm|gm|thanks?|total)\b/i.test(s)) return false;
  return /[a-z]/i.test(s);
}

function stripMd(s: string): string {
  return s.replace(/\*\*|__|~~/g, '').trim();
}

/** Pull a trailing/leading "x3" quantity out of an item name. */
function splitQuantity(name: string): { name: string; quantity: number } {
  let s = name.trim();
  let quantity = 1;
  const tail = s.match(/\s[x×]\s?(\d+)$/i) ?? s.match(/\s\(\s*[x×]?(\d+)\s*\)$/i);
  const head = tail ? null : s.match(/^(\d+)\s?[x×]\s+/i);
  if (tail) {
    quantity = parseInt(tail[1], 10);
    s = s.slice(0, tail.index).trim();
  } else if (head) {
    quantity = parseInt(head[1], 10);
    s = s.slice(head[0].length).trim();
  }
  return { name: s, quantity: quantity >= 1 ? quantity : 1 };
}

function findRarity(text: string): Rarity | undefined {
  const t = text.toLowerCase();
  // Longest first so "very rare" beats "rare".
  const ordered = [...RARITIES].sort((a, b) => b.length - a.length);
  return ordered.find((r) => t.includes(r));
}

/**
 * Attunement as stated in an item's text — some DMs note it in the recap
 * ("(requires attunement)", "no attunement needed"). The negative runs first so
 * "does not require attunement" can't trip the positive match.
 */
function detectAttunement(blob: string): boolean | undefined {
  if (
    /\b(?:does\s+not|doesn['’]t|not)\s+require\s+attunement\b|\bno\s+attunement\s+(?:is\s+)?required\b|\battunement\s+(?:is\s+)?not\s+required\b|\bwithout\s+attunement\b|\bno\s+attunement\s+needed\b/i.test(
      blob,
    )
  ) {
    return false;
  }
  if (/\brequires?\s+attunement\b|\battunement\s+required\b/i.test(blob)) return true;
  return undefined;
}

/** "[VR]" / "[Uncommon]" style rarity tags trailing an item name. */
const RARITY_ABBREVIATIONS: Record<string, Rarity> = {
  c: 'common',
  com: 'common',
  u: 'uncommon',
  uc: 'uncommon',
  r: 'rare',
  vr: 'very rare',
  l: 'legendary',
  leg: 'legendary',
  a: 'artifact',
};

function bracketRarity(bracketContent: string): Rarity | undefined {
  const key = bracketContent.trim().toLowerCase();
  return RARITY_ABBREVIATIONS[key] ?? (key.length <= 12 ? findRarity(key) : undefined);
}

/** "Weapon" / "Potion" / "Wondrous Item" type words → category, when recognisable. */
function kindCategory(kind: string): ItemCategory | undefined {
  if (/potion|oil|elixir|philtre?|scroll/i.test(kind)) return 'consumable';
  if (/weapon|armou?r|shield|wondrous|ring|rod|staff|wand|ammunition/i.test(kind)) return 'magic_item';
  if (/gear|equipment/i.test(kind)) return 'equipment';
  return undefined;
}

interface PendingItem {
  name: string;
  quantity: number;
  category: ItemCategory;
  rarity?: Rarity;
  /** True when a `*Weapon, rare*` type-line explicitly set the category. */
  kindSet: boolean;
  sawTypeLine: boolean;
  descriptionLines: string[];
}

export function parseLogText(text: string, characterId: string): TextImportResult {
  const warnings: string[] = [];
  // Spoiler bars hide content on Discord, they don't delete it.
  const lines = text.replace(/\|\|/g, '').split(/\r?\n/);

  let title: string | undefined;
  let date: string | undefined;
  let dm: string | undefined;
  let location: string | undefined;
  let gpEach: number | undefined;
  let gpNote: string | undefined;
  let downtime: number | undefined;

  const items: GainedItem[] = [];
  let section: ItemCategory | null = null;
  let firstItemSectionIdx = -1;
  let current: PendingItem | null = null;

  function enterSection(label: string, idx: number): ItemCategory | null {
    const cat = sectionCategory(label);
    if (cat !== null && firstItemSectionIdx === -1) firstItemSectionIdx = idx;
    return cat;
  }

  function flush() {
    if (!current) return;
    const blob = `${current.name} ${current.descriptionLines.join(' ')}`;
    let minorProperty: MinorProperty | undefined;
    if (/propert/i.test(blob)) {
      minorProperty = MINOR_PROPERTIES.find((p) => new RegExp(`\\b${p}\\b`, 'i').test(blob));
    }
    // The catalog knows consumables/equipment: matching fixes category, rarity and
    // canonical spelling so stacks merge with hand-entered items. A potion/scroll-ish
    // name overrides the section default unless a type-line explicitly said otherwise.
    const match = lookupCatalog(current.name);
    const category =
      match?.category ??
      (!current.kindSet && CONSUMABLE_NAME_RE.test(current.name)
        ? 'consumable'
        : current.category);
    const description = stripMd(current.descriptionLines.join(' ')).replace(/\s+/g, ' ').trim();
    items.push(
      makeGain({
        name: match ? match.item.name : current.name,
        category,
        rarity: match?.item.rarity ?? current.rarity,
        quantity: current.quantity,
        description,
        minorProperty,
        requiresAttunement: detectAttunement(blob),
      }),
    );
    current = null;
  }

  /** Record one item from a bare name (bullet, plain line, or inline list entry). */
  function pushNamedItem(rawName: string, category: ItemCategory, description?: string) {
    const { name, quantity } = splitQuantity(stripMd(rawName).replace(/[,.;]+$/, ''));
    if (!name || /\bgp\b/i.test(name)) return;
    const match = lookupCatalog(name);
    const resolved = match?.category ?? (CONSUMABLE_NAME_RE.test(name) ? 'consumable' : category);
    items.push(
      makeGain({
        name: match ? match.item.name : name,
        category: resolved,
        rarity: match?.item.rarity,
        quantity,
        description,
      }),
    );
  }

  /** "Magic Items: A, B, C" / "Story Awards: **Name**: text" — items inline after a label. */
  function handleInlineItems(content: string, category: ItemCategory) {
    const c = content.trim();
    if (/^(n\/?a|none|nil|—|-+)$/i.test(c)) return;
    const bolds = [...c.matchAll(/\*\*(.+?)\*\*/g)];
    if (bolds.length === 1) {
      const description = stripMd(c.replace(bolds[0][0], '')).replace(/^[:\s—–-]+/, '');
      pushNamedItem(bolds[0][1], category, description);
    } else if (bolds.length > 1) {
      for (const b of bolds) pushNamedItem(b[1], category);
    } else {
      for (const part of c.split(/[;,]/)) {
        const p = part.trim();
        if (p && isPlainItemName(p)) pushNamedItem(p, category);
      }
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;

    const heading = line.match(/^#{1,6}\s*(.+)$/);
    if (heading) {
      flush();
      const h = stripMd(heading[1]).replace(/:$/, '').trim();
      section = enterSection(h, idx);
      if (!title && section === null && h && !GENERIC_HEADING_RE.test(h)) title = h;
      continue;
    }

    // "Magic Items:" on a bare line is a section header too — many recaps skip markdown.
    const plainHeader = line.match(/^([^:]{1,40}):\s*$/);
    if (plainHeader) {
      flush();
      section = enterSection(stripMd(plainHeader[1]), idx);
      continue;
    }

    if (/^epilogue\b/i.test(stripMd(line))) {
      flush();
      section = null;
      continue;
    }

    const meta = stripMd(line);
    const dateLine = meta.match(/^(?:date|when|played(?:\s+on)?)\s*[:=]\s*(.+)$/i);
    if (dateLine && !date) {
      const parsed = parseLooseDate(dateLine[1]);
      if (parsed) date = parsed;
      else warnings.push(`Couldn't read the date "${dateLine[1].trim()}" — set to today instead.`);
      continue;
    }
    const dmLine = meta.match(/^(?:dm|gm|dungeon master)\s*[:=]\s*(.+)$/i);
    if (dmLine && !dm) {
      const value = dmLine[1].replace(/^@/, '').trim();
      if (/^<@!?\d+>$/.test(value)) {
        warnings.push('The DM was tagged as a Discord @mention — type their name in yourself.');
      } else {
        dm = value;
      }
      continue;
    }
    const locationLine = meta.match(/^(?:location|where)\s*[:=]\s*(.+)$/i);
    if (locationLine && !location) {
      location = locationLine[1].trim();
      continue;
    }
    const downtimeLine = meta.match(/^\+?(\d+)\s+downtime\s+days?\b/i);
    if (downtimeLine && downtime === undefined && !current) {
      downtime = parseInt(downtimeLine[1], 10);
      continue;
    }

    if (gpEach === undefined && !current) {
      // "900 GP Each", "14009gp ea", "1500 GP per player", "7142.85gp per character".
      const each = meta.match(
        /([\d,]+(?:\.\d+)?)\s*gp\s*(?:ea(?:ch)?|apiece|per\s+(?:player|char(?:acter)?|person|pc))\b/i,
      );
      if (each) {
        gpEach = parseFloat(each[1].replace(/,/g, ''));
        continue;
      }
      const split = meta.match(/([\d,]+(?:\.\d+)?)\s*gp\s*\/\s*(\d+)/i);
      if (split) {
        const total = parseFloat(split[1].replace(/,/g, ''));
        const players = parseInt(split[2], 10);
        if (Number.isFinite(total) && players > 0) {
          gpEach = Math.round((total / players) * 100) / 100;
          gpNote = `Split ${total} GP by ${players} → ${gpEach} GP for you — double-check the share.`;
        }
        continue;
      }
      // "Gold: 14009" — a labelled line; without "each" it may be the table total.
      const goldLine = meta.match(/^(?:gold|gp|gold pieces?)\s*[:=]\s*(.*)$/i);
      if (goldLine) {
        const amount = goldLine[1].match(/([\d,]+(?:\.\d+)?)/);
        if (amount) {
          gpEach = parseFloat(amount[1].replace(/,/g, ''));
          gpNote = `Found "Gold: ${gpEach}" — check it's your share, not the whole table's.`;
          continue;
        }
      }
    }

    // "Magic Items: A, B, C" — a section label with its items on the same line.
    const inlineList = line.match(/^([^:*]{1,30}):\s+(.+)$/);
    if (inlineList) {
      const category = sectionCategory(inlineList[1]);
      if (category !== null) {
        flush();
        if (firstItemSectionIdx === -1) firstItemSectionIdx = idx;
        handleInlineItems(inlineList[2], category);
        continue;
      }
    }

    // `**Item Name**` starts an item block (inside item sections). A trailer is allowed
    // when it's metadata — "[VR]", "(Bagpipes)" — but not prose ("**Property (X)** text…"
    // stays part of the current item's description).
    const bold = line.match(/^\*\*(.+?)\*\*(.*)$/);
    if (bold && section !== null && !bold[2].includes('**')) {
      const trailer = bold[2].replace(/^:/, '').trim();
      const rawName = bold[1].trim();
      if (
        (trailer === '' || /^[[(]/.test(trailer)) &&
        rawName &&
        !/\bgp\b/i.test(rawName) &&
        !/^total\b/i.test(rawName)
      ) {
        flush();
        const { name, quantity } = splitQuantity(rawName);
        current = {
          name,
          quantity,
          category: section,
          kindSet: false,
          sawTypeLine: false,
          descriptionLines: [],
        };
        // Trailer metadata: [VR]-style rarity tags, a short "(Bagpipes)" variant that
        // belongs in the name; anything else is description.
        let rest = trailer;
        for (const b of trailer.matchAll(/\[([^\]]*)\]/g)) {
          const rarity = bracketRarity(b[1]);
          if (rarity && !current.rarity) {
            current.rarity = rarity;
            rest = rest.replace(b[0], '');
          }
        }
        const variant = rest.match(/^\s*\(([^)]{1,28})\)/);
        if (variant) {
          current.name += ` (${variant[1]})`;
          rest = rest.replace(variant[0], '');
        }
        rest = rest.trim();
        if (rest) current.descriptionLines.push(rest);
        continue;
      }
    }

    // `*Weapon, rare*` right after an item name gives its kind and rarity.
    const italic = line.match(/^\*([^*]+)\*$/);
    if (italic && current && !current.sawTypeLine) {
      current.sawTypeLine = true;
      const kind = kindCategory(italic[1]);
      if (kind) {
        current.category = kind;
        current.kindSet = true;
      }
      const rarity = findRarity(italic[1]);
      if (rarity) current.rarity = rarity;
      continue;
    }

    // `- Potion of Healing x2` style bullets inside item sections.
    const bullet = line.match(/^[-•+]\s+(.+)$/) ?? line.match(/^\*\s+([^*].*)$/);
    if (bullet && section !== null && !current) {
      pushNamedItem(bullet[1], section);
      continue;
    }

    if (current) {
      const description = line.replace(/^>\s?/, '').trim();
      if (description) current.descriptionLines.push(description);
      continue;
    }

    // Bare "Ring of Protection" lines inside an item section (no bullets, no bold) —
    // prose paragraphs around the list are filtered out by isPlainItemName.
    if (section !== null && isPlainItemName(stripMd(line))) {
      pushNamedItem(line, section);
    }
  }
  flush();

  if (!title) {
    // The adventure name, if present at all, sits above the first item section:
    // a short line with letters that isn't a "Label: value" line or a generic heading.
    const limit = firstItemSectionIdx === -1 ? lines.length : firstItemSectionIdx;
    for (let i = 0; i < limit; i++) {
      const l = stripMd(lines[i]).replace(/^#+\s*/, '').trim();
      if (!l || l.length > 120) continue;
      if (!/[a-z]/i.test(l) || /^\d/.test(l)) continue;
      if (/^[^:]{1,24}:\s/.test(l)) continue;
      if (GENERIC_HEADING_RE.test(l)) continue;
      title = l;
      break;
    }
  }
  if (!date) {
    if (!warnings.some((w) => w.startsWith("Couldn't read the date"))) {
      warnings.push("Couldn't find a date — set to today instead.");
    }
    date = new Date().toISOString().slice(0, 10);
  }
  if (gpEach === undefined) {
    warnings.push("Couldn't find a gold amount per player — GP gained is set to 0.");
  } else if (gpNote) {
    warnings.push(gpNote);
  }
  if (items.length === 0) {
    warnings.push('No items were recognised — add any loot by hand.');
  } else {
    warnings.push("This lists the whole party's loot — remove anything your character didn't take.");
  }
  warnings.push(
    downtime === undefined
      ? 'Assumed +1 level and +10 downtime days (the usual session rewards) — adjust if needed.'
      : 'Assumed +1 level (the usual session reward) — adjust if needed.',
  );

  return {
    log: buildSessionLog(characterId, {
      date,
      title,
      dm,
      location,
      gpGained: gpEach,
      downtimeGained: downtime,
      items,
    }),
    warnings,
  };
}

// ---- Chatbot bridge ----------------------------------------------------------------

/** Self-contained instructions the user pastes into any AI chatbot. */
export function buildChatbotPrompt(text: string): string {
  return `You are helping fill in a D&D Adventurers League play log. Read the session write-up between the <recap> tags below and answer with ONE JSON object only — no explanation, no markdown code fences.

Use exactly this shape:
{
  "date": "YYYY-MM-DD, or null if not stated",
  "title": "the adventure's name, or a short title",
  "dm": "the DM's name, or null",
  "location": "where it was played, or null",
  "gpGained": number — the gold ONE player takes home. If the write-up splits a total between players (e.g. "3600 GP / 4 = 900 each"), use the per-player share.,
  "downtimeGained": number — use 10 if not stated,
  "levelsGained": number — use 1 if not stated,
  "itemsGained": [
    {
      "name": "item name",
      "category": one of "magic_item", "consumable", "equipment", "story_award", "blessing", "charm", "boon",
      "rarity": one of "common", "uncommon", "rare", "very rare", "legendary", "artifact" — or null,
      "quantity": number,
      "description": "one short sentence, or null",
      "minorProperty": one of ${MINOR_PROPERTIES.map((p) => `"${p}"`).join(', ')} — or null,
      "requiresAttunement": true or false — magic items only: whether the write-up says the item requires attunement; null if it doesn't say
    }
  ],
  "notes": "anything else worth keeping (story awards, epilogue in one line), or null"
}

Rules:
- Potions, oils, elixirs and scrolls are "consumable". Magical weapons, armor and wondrous items are "magic_item". Ordinary gear is "equipment".
- Spell scrolls: name them "Spell Scroll of <Spell Name>" (e.g. "Spell Scroll of Fireball"), not "Spell Scroll (Spell Name)".
- Some write-ups state a magic item's attunement requirement ("requires attunement", "no attunement needed") — record exactly that in "requiresAttunement". If the write-up doesn't mention it, use null; don't guess from the item's name.
- List every item the party received; the player will remove the ones they didn't take.
- Text between || bars is a Discord spoiler — read it normally.
- If something is unclear, make your best guess: a person reviews everything afterwards.

<recap>
${text.trim()}
</recap>`;
}

/** Parse and validate the JSON a chatbot produced from buildChatbotPrompt's instructions. */
export function parseChatbotReply(reply: string, characterId: string): TextImportResult {
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

  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim() : undefined;
  const numeric = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) ? n : undefined;
  };

  let date = str(data.date);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    date = parseLooseDate(date) ?? undefined;
  }
  if (!date) warnings.push("The reply had no usable date — set to today instead.");

  const items: GainedItem[] = [];
  const rawItems = Array.isArray(data.itemsGained) ? data.itemsGained : [];
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const name = str(item.name);
    if (!name) {
      warnings.push('Skipped an item without a name.');
      continue;
    }
    let category = str(item.category)?.toLowerCase().replace(/[\s-]+/g, '_') as
      | ItemCategory
      | undefined;
    if (!category || !ITEM_CATEGORIES.includes(category)) {
      const match = lookupCatalog(name);
      category = match?.category ?? (CONSUMABLE_NAME_RE.test(name) ? 'consumable' : 'magic_item');
      warnings.push(`"${name}" had an unknown category — recorded as ${category.replace('_', ' ')}.`);
    }
    const rawRarity = str(item.rarity)?.toLowerCase();
    const rarity =
      rawRarity && (RARITIES as readonly string[]).includes(rawRarity)
        ? (rawRarity as Rarity)
        : undefined;
    if (rawRarity && !rarity) warnings.push(`"${name}" had an unknown rarity "${rawRarity}" — check its rarity field.`);
    const rawProperty = str(item.minorProperty);
    const minorProperty = MINOR_PROPERTIES.find(
      (p) => p.toLowerCase() === rawProperty?.toLowerCase(),
    );
    items.push(
      makeGain({
        name,
        category,
        rarity,
        quantity: numeric(item.quantity) ?? 1,
        description: str(item.description),
        minorProperty,
        // What the write-up said (via the chatbot) wins over the items-list lookup.
        requiresAttunement:
          typeof item.requiresAttunement === 'boolean' ? item.requiresAttunement : undefined,
      }),
    );
  }
  if (items.length === 0) warnings.push('The reply listed no items — add any loot by hand.');
  else warnings.push("This lists the whole party's loot — remove anything your character didn't take.");
  warnings.push('An AI filled this in — double-check the numbers before saving.');

  return {
    log: buildSessionLog(characterId, {
      date,
      title: str(data.title),
      dm: str(data.dm),
      location: str(data.location),
      gpGained: numeric(data.gpGained),
      downtimeGained: numeric(data.downtimeGained),
      levelsGained: numeric(data.levelsGained),
      notes: str(data.notes),
      items,
    }),
    warnings,
  };
}
