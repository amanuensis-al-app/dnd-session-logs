import type {
  Character,
  GainedItem,
  ItemCategory,
  LogEntry,
  LogType,
  LossReason,
  LostItem,
  MinorProperty,
  Rarity,
} from './types';
import { LOG_TYPE_LABELS, MINOR_PROPERTIES, newId, stackedItemId } from './types';
import {
  lookupCatalog,
  normalizeKey,
  parseCsv,
  parseNotesItems,
  parseRarity,
  type AlImportResult,
  type NotesItem,
} from './importAlLog';
import { canonicalizeSpellScrollForImport, resolveSpellScroll } from './spells';

/**
 * Importer for the owner's personal Google-Sheets log format ("DND Log Sheet").
 *
 * File layout (one character per file, one header row, roughly newest-first):
 *   Adventure / Trade / Purchase, Date, Total Level at End, Downtime, Gold, DM,
 *   Location, Magic Items, [Rarity, Rarity Value, Count], Consumables, [Rarity,
 *   Rarity Value, Count], Magic Learnt Spell Slot [+ Count], Story Awards, Notes
 *
 * A row with a non-empty first column starts a new log entry; rows below it with a
 * blank first column are continuations carrying more items/notes for the same entry.
 * Positive item counts are gains, negative counts are losses (traded/consumed).
 *
 * Differences from the AL Log importer that matter:
 * - The item COLUMNS are authoritative. Notes bullets often repeat the same items
 *   ("* 3 Potion of Invul"), so bullets are only parsed as items on Purchase rows
 *   that have no column items at all (that's where equipment purchases live).
 * - "Total Level at End" is a cumulative checkpoint, not a delta. Deltas are
 *   computed chronologically; only session / catch-up / creation rows may level.
 *   Checkpoints that disagree on non-leveling rows are reported, not applied.
 * - "Downtime" and "Gold" are signed deltas (+gained / −spent).
 */

interface SheetItemRow {
  kind: 'magic' | 'consumable';
  name: string;
  rarity?: Rarity;
  count: number;
}

interface SheetEntry {
  fileIndex: number;
  title: string;
  date?: string;
  levelAtEnd?: number;
  downtime: number;
  gold: number;
  dm?: string;
  location?: string;
  items: SheetItemRow[];
  storyAwards: string[];
  spellSlots: string[];
  noteChunks: string[];
}

function num(value: string): number {
  const n = parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** "Fish Suit (Temperate)" → name "Fish Suit" + minor property Temperate.
 * Only exact single-word DMG property names in a trailing parenthetical count. */
function splitMinorProperty(name: string): { name: string; minorProperty?: MinorProperty } {
  const m = name.match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (m) {
    const prop = MINOR_PROPERTIES.find((p) => p.toLowerCase() === m[2].trim().toLowerCase());
    if (prop) return { name: m[1], minorProperty: prop };
  }
  return { name };
}

/** Identity with every trailing parenthetical stripped, for fuzzy loss matching:
 * "Balagos' Belt (Dragonhide Belt +3)" and "Balagos' Belt (+3 Dragonhide Belt)"
 * both key as "balagosbelt". Shared with the chatbot bridge (importSheetChatbot.ts). */
export function baseNameKey(name: string): string {
  let s = name.trim();
  for (;;) {
    const m = s.match(/^(.*\S)\s*\([^()]*\)$/);
    if (!m) break;
    s = m[1];
  }
  return normalizeKey(s);
}

/** The sheet spells some consumables differently from the catalog ("Potion of
 * Superior Healing"); canonicalize so stacks merge with app-entered logs.
 * Shared with the chatbot bridge (importSheetChatbot.ts). */
export function canonicalConsumable(name: string, rarity?: Rarity): { name: string; rarity?: Rarity } {
  const match = lookupCatalog(name);
  if (match && match.category === 'consumable') {
    return { name: match.item.name, rarity: match.item.rarity ?? rarity };
  }
  return { name, rarity };
}

/** "* Long Bow - 50GP" → "* Long Bow (50gp)" so parseNotesItems reads the price. */
function transformDashPrices(notes: string): string {
  return notes
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*[-–]\s*([\d,]+(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)\s*$/i, ' ($1$2)'))
    .join('\n');
}

export function characterNameFromFile(fileName: string | undefined, warnings: string[]): string {
  const base = (fileName ?? '').replace(/\.[^.]+$/, '').trim();
  // "DND Log Sheet - Melfyn Goodfellow - Logs" → the middle segment(s).
  const parts = base.split(/\s+-\s+/);
  const name = parts.length >= 3 ? parts.slice(1, -1).join(' - ') : parts[parts.length - 1] ?? '';
  if (name) return name;
  warnings.push('Could not read a character name from the file name — rename the character after importing.');
  return 'Imported Character';
}

export function importSheetLog(csvText: string, fileName?: string): AlImportResult {
  const rows = parseCsv(csvText);
  if (rows[0]?.[0]?.trim() === 'name') {
    throw new Error('This looks like an Adventurers League Log export — use "Import AL Log" instead.');
  }
  const header = rows[0] ?? [];
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const cDate = col('date');
  const cLevel = col('total level at end');
  const cDowntime = col('downtime');
  const cGold = col('gold');
  const cDm = col('dm');
  const cLocation = col('location');
  const cMagic = col('magic items');
  const cMagicRarity = col('magic items rarity');
  const cMagicCount = col('magic items count');
  const cCons = col('consumables');
  const cConsRarity = col('consumables rarity');
  const cConsCount = col('consumables count');
  const cSpell = col('magic learnt spell slot');
  const cSpellCount = col('magic learnt spell slot count');
  const cStory = col('story awards');
  const cNotes = header.findIndex((h) => h.trim().toLowerCase().startsWith('notes'));
  if (cDate < 0 || cMagic < 0 || cMagicCount < 0) {
    throw new Error(
      'This does not look like a personal log-sheet CSV (expected "Date", "Magic Items" and "Magic Items Count" columns).'
    );
  }

  const warnings: string[] = [];

  // ---- Group rows into entries (file order, newest first) -----------------------
  const entries: SheetEntry[] = [];
  for (const row of rows.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const title = cell(0);
    if (title) {
      const levelRaw = cell(cLevel);
      entries.push({
        fileIndex: entries.length,
        title,
        date: cell(cDate).match(/^\d{4}-\d{2}-\d{2}/)?.[0],
        levelAtEnd: /^\d+$/.test(levelRaw) ? parseInt(levelRaw, 10) : undefined,
        downtime: num(cell(cDowntime)),
        gold: num(cell(cGold)),
        dm: cell(cDm) || undefined,
        location: cell(cLocation) || undefined,
        items: [],
        storyAwards: [],
        spellSlots: [],
        noteChunks: [],
      });
    }
    const entry = entries[entries.length - 1];
    if (!entry) {
      warnings.push('Rows before the first titled entry were skipped.');
      continue;
    }
    const addItem = (kind: SheetItemRow['kind'], nameCol: number, rarityCol: number, countCol: number) => {
      const name = cell(nameCol);
      if (!name) return;
      const countRaw = cell(countCol);
      entry.items.push({
        kind,
        name,
        rarity: parseRarity(cell(rarityCol), warnings, `"${name}"`),
        count: countRaw === '' ? 1 : Math.trunc(num(countRaw)),
      });
    };
    addItem('magic', cMagic, cMagicRarity, cMagicCount);
    addItem('consumable', cCons, cConsRarity, cConsCount);
    const spell = cell(cSpell);
    if (spell) entry.spellSlots.push(cell(cSpellCount) ? `${spell} ×${cell(cSpellCount)}` : spell);
    const story = cell(cStory);
    if (story) entry.storyAwards.push(story);
    const note = cell(cNotes);
    if (note) entry.noteChunks.push(note);
  }
  if (entries.length === 0) throw new Error('The file contained no log entries.');

  // Undated rows (some catch-ups) sit between dated neighbors; the next OLDER
  // entry below them in the file is the closest safe date.
  entries.forEach((e, i) => {
    if (!e.date) {
      const below = entries.slice(i + 1).find((x) => x.date);
      const above = [...entries.slice(0, i)].reverse().find((x) => x.date);
      e.date = below?.date ?? above?.date ?? new Date().toISOString().slice(0, 10);
      warnings.push(`"${e.title}" has no date — assumed ${e.date} (from its nearest dated neighbor).`);
    }
  });

  // ---- Chronological order ------------------------------------------------------
  // The file is newest-first, so ties on the same date replay in REVERSE file order.
  const chrono = [...entries].sort((a, b) =>
    a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : b.fileIndex - a.fileIndex
  );

  const character: Character = {
    id: newId(),
    name: characterNameFromFile(fileName, warnings),
    species: '',
    class: '',
    notes: `Imported from a personal log-sheet CSV on ${new Date().toISOString().slice(0, 10)}.`,
    createdAt: Date.now(),
  };
  warnings.push('Species and class are not in the CSV — fill them in by editing the character.');

  // ---- Registries for matching losses against earlier gains ---------------------
  const gainedMagic: { keys: string[]; baseKey: string; id: string; remaining: number }[] = [];
  const stackGains = new Map<string, number>();
  const purchaseCostByStack = new Map<string, number>();

  function gainMagicRow(row: SheetItemRow): GainedItem {
    const category: ItemCategory = /^\[boon\]/i.test(row.name)
      ? 'boon'
      : /^blessing\b/i.test(row.name)
        ? 'blessing'
        : 'magic_item';
    const stripped = row.name.replace(/^\[boon\]\s*/i, '');

    // The Magic Items column can carry spell scrolls too — recognize them so they land
    // in the same consumable stack as scrolls from the Consumables column or notes.
    if (category === 'magic_item') {
      const scroll = canonicalizeSpellScrollForImport(stripped, row.rarity);
      if (scroll.isSpellScroll) {
        const item: GainedItem = {
          id: stackedItemId({ category: 'consumable', name: scroll.name, rarity: scroll.rarity }),
          name: scroll.name,
          category: 'consumable',
          rarity: scroll.rarity,
          quantity: Math.max(1, row.count),
        };
        gainedMagic.push({
          keys: [normalizeKey(row.name), normalizeKey(scroll.name)],
          baseKey: baseNameKey(scroll.name),
          id: item.id,
          remaining: item.quantity,
        });
        return item;
      }
    }

    const { name, minorProperty } =
      category === 'magic_item' ? splitMinorProperty(stripped) : { name: stripped, minorProperty: undefined };
    const item: GainedItem = {
      id: newId(),
      name,
      category,
      rarity: category === 'magic_item' ? row.rarity : undefined,
      quantity: Math.max(1, row.count),
      minorProperty,
    };
    gainedMagic.push({
      keys: [normalizeKey(row.name), normalizeKey(name)],
      baseKey: baseNameKey(row.name),
      id: item.id,
      remaining: item.quantity,
    });
    return item;
  }

  function loseMagicByName(rawName: string, quantity: number, reason: LossReason, label: string): LostItem | null {
    // Canonicalize so a loss recorded under either spell-scroll spelling still
    // matches the id an earlier gain registered.
    const canonicalName = resolveSpellScroll(rawName)?.name ?? rawName;
    for (const pass of [0, 1] as const) {
      const needle = pass === 0 ? normalizeKey(canonicalName) : baseNameKey(canonicalName);
      for (let i = gainedMagic.length - 1; i >= 0; i--) {
        const g = gainedMagic[i];
        const match = pass === 0 ? g.keys.includes(needle) : g.baseKey === needle;
        if (match && g.remaining > 0) {
          g.remaining -= quantity;
          return { itemId: g.id, quantity, reason };
        }
      }
    }
    warnings.push(
      `"${label}": lost "${rawName}", but no earlier log gained that item — the loss was skipped. Check the dates involved and record it manually if needed.`
    );
    return null;
  }

  function gainConsumableRow(row: SheetItemRow): GainedItem {
    const c0 = canonicalConsumable(row.name, row.rarity);
    const scroll = canonicalizeSpellScrollForImport(c0.name, c0.rarity);
    return {
      id: stackedItemId({ category: 'consumable', name: scroll.name, rarity: scroll.rarity }),
      name: scroll.name,
      category: 'consumable',
      rarity: scroll.rarity,
      quantity: Math.max(1, row.count),
    };
  }

  /** Match a consumable/equipment removal against earlier stacked gains, falling
   * back to magic items by name (in case an item sits in the wrong column). */
  function loseStacked(
    rawName: string,
    rarity: Rarity | undefined,
    quantity: number,
    reason: LossReason,
    label: string
  ): LostItem | null {
    const c0 = canonicalConsumable(rawName, rarity);
    const scroll = canonicalizeSpellScrollForImport(c0.name, c0.rarity);
    const c = { name: scroll.name, rarity: scroll.rarity };
    for (const category of ['consumable', 'equipment'] as const) {
      const id = stackedItemId({
        category,
        name: c.name,
        rarity: category === 'consumable' ? c.rarity : undefined,
      });
      const have = stackGains.get(id) ?? 0;
      if (have > 0) {
        stackGains.set(id, have - quantity);
        if (have < quantity) {
          warnings.push(
            `"${label}": removed ${quantity}× "${c.name}" but only ${have} were gained by earlier logs — the inventory will flag it.`
          );
        }
        return { itemId: id, quantity, reason };
      }
    }
    return loseMagicByName(rawName, quantity, reason, label);
  }

  function registerStackedGains(items: GainedItem[], isPurchase = false) {
    for (const g of items) {
      if (g.category === 'consumable' || g.category === 'equipment') {
        stackGains.set(g.id, (stackGains.get(g.id) ?? 0) + g.quantity);
        if (isPurchase && g.cost != null) purchaseCostByStack.set(g.id, g.cost);
      }
    }
  }

  function stackIdOf(it: NotesItem): string {
    const rarity = it.category === 'consumable' ? it.rarity : undefined;
    return stackedItemId({ category: it.category, name: it.name, rarity });
  }

  /** Explicit bullet price, else half the tracked purchase price, else half catalog. */
  function importSalePrice(it: NotesItem): number | undefined {
    if (it.totalCost !== undefined) return it.totalCost / it.quantity;
    const bought = purchaseCostByStack.get(stackIdOf(it));
    if (bought != null) return bought / 2;
    const cat = lookupCatalog(it.name);
    return cat ? cat.item.cost / 2 : undefined;
  }

  function notesItemsToGained(items: NotesItem[], withCost: boolean): GainedItem[] {
    return items.map((it) => {
      const rarity = it.category === 'magic_item' || it.category === 'consumable' ? it.rarity : undefined;
      const stacked = it.category === 'consumable' || it.category === 'equipment';
      return {
        id: stacked ? stackedItemId({ category: it.category, name: it.name, rarity }) : newId(),
        name: it.name,
        category: it.category,
        rarity,
        quantity: it.quantity,
        cost: withCost && it.unitCost !== undefined ? it.unitCost : undefined,
      };
    });
  }

  // ---- Type classification and level checkpoints --------------------------------

  function classify(entry: SheetEntry): LogType {
    if (/^trade\b/i.test(entry.title)) return 'transaction';
    if (/^purchase\b/i.test(entry.title)) return entry.gold > 0 ? 'sell' : 'purchase';
    if (/^catch\s*up\b/i.test(entry.title)) return 'catchup';
    if (/^character creation\b/i.test(entry.title)) return 'creation';
    if (entry.dm || entry.location) return 'session';
    return 'free';
  }

  let currentLevel = 1;

  /** Turn a "Total Level at End" checkpoint into this log's level delta. */
  function applyLevel(type: LogType, entry: SheetEntry): number {
    const L = entry.levelAtEnd;
    if (type === 'creation') {
      if (L === undefined) return 0;
      currentLevel = L;
      return L - 1;
    }
    if (type === 'catchup') {
      const fromDowntime =
        entry.downtime < 0 && -entry.downtime % 10 === 0 ? -entry.downtime / 10 : undefined;
      const levels = L !== undefined ? Math.max(L - currentLevel, 0) : fromDowntime ?? 0;
      if (L !== undefined && fromDowntime !== undefined && levels !== fromDowntime) {
        warnings.push(
          `"${entry.title}" (${entry.date}): the level column says +${levels} level(s) but the ${-entry.downtime} downtime spent implies +${fromDowntime} — the level column was used.`
        );
      }
      currentLevel += levels;
      return levels;
    }
    if (type === 'session') {
      if (L === undefined) return 0;
      const delta = L - currentLevel;
      if (delta < 0) {
        warnings.push(
          `"${entry.title}" (${entry.date}): the level column says ${L} but the running level is already ${currentLevel} — a level can't go down, so it was not applied.`
        );
        return 0;
      }
      currentLevel = L;
      return delta;
    }
    if (L !== undefined && L !== currentLevel) {
      warnings.push(
        `"${entry.title}" (${entry.date}): the level column says ${L} but the running level is ${currentLevel} — a ${LOG_TYPE_LABELS[type]} log doesn't change level, so it was ignored.`
      );
    }
    return 0;
  }

  function partnerOf(entry: SheetEntry): string | undefined {
    const withM = entry.title.match(/^trade\s+with\s+(.+)$/i);
    if (withM) return withM[1].trim();
    const parenM = entry.title.match(/^trade\s*\(\s*\*?\s*(.+?)\s*\)$/i);
    if (parenM) return parenM[1].trim();
    const first = entry.noteChunks[0]?.split(/\r?\n/)[0]?.replace(/^[\s*•]+|^[+-]\s+/, '').trim();
    if (first && first.length <= 60) return first;
    return undefined;
  }

  // ---- Build logs (chronological, so losses can match earlier gains) ------------

  const logs: LogEntry[] = [];
  const createdAtBase = Date.now();
  let spellSlotWarned = false;

  chrono.forEach((entry, chronoIndex) => {
    const type = classify(entry);
    const label = entry.title;
    const rawNotes = entry.noteChunks.join('\n');

    if (entry.spellSlots.length > 0 && !spellSlotWarned) {
      warnings.push('The "Magic Learnt Spell Slot" column has no tracker field — its values were kept as note lines.');
      spellSlotWarned = true;
    }
    const notes =
      [rawNotes, ...entry.spellSlots.map((s) => `Magic Learnt Spell Slot: ${s}`)]
        .filter(Boolean)
        .join('\n') || undefined;

    const levelGained = applyLevel(type, entry);

    const columnGains: GainedItem[] = [];
    const columnLosses: SheetItemRow[] = [];
    for (const it of entry.items) {
      if (it.count >= 0) columnGains.push(it.kind === 'magic' ? gainMagicRow(it) : gainConsumableRow(it));
      else columnLosses.push(it);
    }
    for (const award of entry.storyAwards) {
      columnGains.push({ id: newId(), name: award, category: 'story_award', quantity: 1 });
    }

    const base: Omit<LogEntry, 'type' | 'itemsGained' | 'itemsLost'> = {
      id: newId(),
      characterId: character.id,
      date: entry.date!,
      title: entry.title,
      notes,
      gpGained: Math.max(0, entry.gold),
      gpLost: Math.max(0, -entry.gold),
      downtimeGained: Math.max(0, entry.downtime),
      downtimeSpent: Math.max(0, -entry.downtime),
      levelGained,
      createdAt: createdAtBase + chronoIndex,
    };

    const loseColumnRows = (magicReason: LossReason, consumableReason: LossReason): LostItem[] =>
      columnLosses
        .map((it) =>
          it.kind === 'magic'
            ? loseMagicByName(it.name, -it.count, magicReason, label)
            : loseStacked(it.name, it.rarity, -it.count, consumableReason, label)
        )
        .filter((l): l is LostItem => l !== null);

    if (type === 'purchase') {
      // Equipment purchases live only in the notes; when the item columns are
      // filled, the bullets just repeat them, so parse bullets only when the
      // columns are empty. Dash bullets in a spending row are bullet style, not
      // sales (owner rule — a positive-gold row would have classified as 'sell').
      let bulletGains: GainedItem[] = [];
      if (entry.items.length === 0 && rawNotes) {
        const { gained, removed } = parseNotesItems(transformDashPrices(rawNotes), 'equipment');
        bulletGains = notesItemsToGained([...gained, ...removed], true);
      }
      const gains = [...columnGains, ...bulletGains];
      if (gains.length === 1 && gains[0].cost === undefined) {
        gains[0].cost = round2(base.gpLost / gains[0].quantity);
      }
      const priced = gains.every((g) => g.cost !== undefined);
      const total = round2(gains.reduce((sum, g) => sum + (g.cost ?? 0) * g.quantity, 0));
      if (gains.length === 0) {
        warnings.push(`"${label}" (${entry.date}): no items could be read — imported with the GP spent only.`);
      } else if (!priced || Math.abs(total - base.gpLost) > 0.05) {
        warnings.push(
          `"${label}" (${entry.date}): GP spent (${base.gpLost}) doesn't match the item prices found (${total}). The imported log keeps ${base.gpLost}, but re-saving it in the editor will recompute from item costs.`
        );
      }
      registerStackedGains(gains, true);
      logs.push({ ...base, type: 'purchase', itemsGained: gains, itemsLost: loseColumnRows('other', 'used') });
      return;
    }

    if (type === 'sell') {
      const sold: NotesItem[] = [];
      if (entry.items.length === 0 && rawNotes) {
        const { gained, removed } = parseNotesItems(transformDashPrices(rawNotes), 'equipment');
        sold.push(...gained, ...removed); // every bullet in a gold-gaining purchase row is a sale
      }
      registerStackedGains(columnGains);
      const lost: LostItem[] = [];
      let total = 0;
      for (const it of sold) {
        const price = importSalePrice(it);
        if (price === undefined) {
          warnings.push(`"${label}" (${entry.date}): no sale price known for "${it.name}" — set to 0; edit the Sell log to fix it.`);
        }
        total += (price ?? 0) * it.quantity;
        const matched =
          loseStacked(it.name, it.rarity, it.quantity, 'sold', label) ??
          { itemId: stackIdOf(it), quantity: it.quantity, reason: 'sold' as const };
        if (price !== undefined) matched.salePrice = round2(price);
        lost.push(matched);
      }
      lost.push(...loseColumnRows('sold', 'sold'));
      total = round2(total);
      if (sold.length > 0 && Math.abs(entry.gold - total) > 0.05) {
        const only = lost.length === 1 ? lost[0] : undefined;
        if (only) only.salePrice = round2(entry.gold / only.quantity);
        else {
          warnings.push(
            `"${label}" (${entry.date}): the log gained ${entry.gold} gp but the sold items were valued at ${total} gp — kept ${entry.gold} gp; edit the Sell log's prices to match.`
          );
        }
      }
      logs.push({
        ...base,
        type: 'sell',
        title: sold.length > 0 ? `Sold ${sold.map((i) => i.name).join(', ')}` : entry.title,
        itemsGained: columnGains,
        itemsLost: lost,
      });
      return;
    }

    if (type === 'transaction') {
      registerStackedGains(columnGains);
      logs.push({
        ...base,
        type: 'transaction',
        tradePartner: partnerOf(entry),
        itemsGained: columnGains,
        itemsLost: loseColumnRows('traded', 'traded'),
      });
      return;
    }

    // creation / catchup / session / free share the same shape: column items,
    // signed gold/downtime, plus DM & location on sessions.
    registerStackedGains(columnGains);
    logs.push({
      ...base,
      type,
      location: type === 'session' ? entry.location : undefined,
      dm: type === 'session' ? entry.dm : undefined,
      itemsGained: columnGains,
      itemsLost: loseColumnRows('other', 'used'),
    });
  });

  return { character, logs, warnings };
}
