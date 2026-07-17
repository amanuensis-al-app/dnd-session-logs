import type {
  Character,
  GainedItem,
  ItemCategory,
  LogEntry,
  LostItem,
  Rarity,
} from './types';
import { newId, RARITIES, stackedItemId } from './types';
import { ITEM_CATALOG, type CatalogItem } from './catalog';

/**
 * Importer for CSV exports from adventurersleaguelog.com ("Adventurers League Log").
 *
 * File layout (one character per file):
 *   row 0: character header (name,race,class_and_levels,faction,...)
 *   row 1: character values
 *   row 2: log-entry header (type,adventure_title,...,notes,date_dmed,campaign_id)
 *   row 3: magic-item header (MAGIC ITEM,name,rarity,...)
 *   rows 4+: log rows (CharacterLogEntry | PurchaseLogEntry | TradeLogEntry), each
 *            followed by 0+ "MAGIC ITEM" / "TRADED MAGIC ITEM" rows belonging to it.
 *
 * The source format is loose — consumables/equipment live as free-text bullets in the
 * notes column, levels aren't recorded at all — so conversion is best-effort and every
 * assumption made is reported back in `warnings`.
 */

export interface AlImportResult {
  character: Character;
  logs: LogEntry[];
  warnings: string[];
}

// ---- CSV ----------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted fields may contain commas, quotes ("") and newlines.
 * Shared with the personal log-sheet importer (importSheetLog.ts). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ',') {
      endField();
      i++;
    } else if (ch === '\n' || ch === '\r') {
      endRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  // Drop rows that are entirely empty (trailing newlines etc.).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---- Small parsing helpers ------------------------------------------------------

function num(value: string | undefined): number {
  const n = parseFloat((value ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** "2025-02-22 12:00:00 UTC" → { date: '2025-02-22', time: '12:00' }. Taken verbatim
 * (no timezone conversion) so log order matches what the AL Log site shows. */
function parseDateTime(value: string): { date: string; time?: string } | null {
  const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return { date: m[1], time: `${m[2]}:${m[3]}` };
  const dateOnly = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return dateOnly ? { date: dateOnly[1] } : null;
}

export function parseRarity(value: string, warnings: string[], context: string): Rarity | undefined {
  const raw = value.trim().toLowerCase().replace(/_/g, ' ');
  if (!raw) return undefined;
  if ((RARITIES as readonly string[]).includes(raw)) return raw as Rarity;
  warnings.push(`Unknown rarity "${value.trim()}" on ${context} — left blank.`);
  return undefined;
}

// ---- Item-name matching against the catalog -------------------------------------

/** Loose identity for name matching: case, spaces, punctuation and apostrophes ignored. */
export function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Common AL Log phrasings that differ from the catalog's canonical names. */
const NAME_ALIASES: Record<string, string> = {
  potionofgreaterhealing: 'Potion of Healing (Greater)',
  potionofsuperiorhealing: 'Potion of Healing (Superior)',
  potionofsupremehealing: 'Potion of Healing (Supreme)',
};

const catalogByKey: Map<string, { item: CatalogItem; category: ItemCategory }> = (() => {
  const map = new Map<string, { item: CatalogItem; category: ItemCategory }>();
  // Consumables first so they win any name collision with equipment.
  for (const category of ['consumable', 'equipment'] as const) {
    for (const item of ITEM_CATALOG[category] ?? []) {
      const key = normalizeKey(item.name);
      if (!map.has(key)) map.set(key, { item, category });
    }
  }
  for (const [alias, canonical] of Object.entries(NAME_ALIASES)) {
    const target = map.get(normalizeKey(canonical));
    if (target && !map.has(alias)) map.set(alias, target);
  }
  return map;
})();

/** Try exact key, then naive singular/plural variants ("Tinker's Tool" → "Tinker's Tools").
 * Also used by the paste-a-recap importer (importText.ts). */
export function lookupCatalog(name: string): { item: CatalogItem; category: ItemCategory } | undefined {
  const key = normalizeKey(name);
  return catalogByKey.get(key) ?? catalogByKey.get(`${key}s`) ?? catalogByKey.get(key.replace(/s$/, ''));
}

export const CONSUMABLE_NAME_RE = /^(potion|oil|elixir|philter|philtre|scroll|spell scroll)\b/i;

// ---- Free-text item bullets ------------------------------------------------------

interface ParsedItemLine {
  name: string;
  quantity: number;
  /** Total GP for the line, when the bullet had a "(15GP)" style price. */
  totalCost?: number;
}

const CURRENCY_GP: Record<string, number> = { pp: 10, gp: 1, ep: 0.5, sp: 0.1, cp: 0.01 };

/** Parse one "Crossbow Bolt x20 (1GP)" style bullet body (marker already stripped). */
function parseItemLine(body: string): ParsedItemLine | null {
  let s = body.trim();
  if (!s) return null;

  let totalCost: number | undefined;
  const cost = s.match(/\(\s*([\d,]+(?:\.\d+)?)\s*(pp|gp|ep|sp|cp)?\s*\)$/i);
  if (cost) {
    const n = parseFloat(cost[1].replace(/,/g, ''));
    if (Number.isFinite(n)) totalCost = n * CURRENCY_GP[(cost[2] ?? 'gp').toLowerCase()];
    s = s.slice(0, cost.index).trim();
  }

  let quantity = 1;
  const tail = s.match(/\s[x×]\s?(\d+)$/i) ?? s.match(/\s(\d+)\s?[x×]$/i);
  const head = tail ? null : s.match(/^(\d+)\s?[x×]\s+/i);
  if (tail) {
    quantity = parseInt(tail[1], 10);
    s = s.slice(0, tail.index).trim();
  } else if (head) {
    quantity = parseInt(head[1], 10);
    s = s.slice(head[0].length).trim();
  }
  s = s.replace(/[,.;]+$/, '').trim();
  if (!s || quantity < 1) return null;
  return { name: s, quantity, totalCost };
}

export interface NotesItem extends ParsedItemLine {
  category: ItemCategory;
  rarity?: Rarity;
  /** Per-unit GP from the bullet's own price, falling back to the catalog. */
  unitCost?: number;
}

/**
 * Extract item bullets from a log's free-text notes. Only lines starting with a bullet
 * marker are treated as items (prose lines like "Starting Equipment:" are left alone).
 * Markers `*`, `•` and `+ ` list items gained; `- ` lists items removed (sold in a
 * purchase log, lost/used elsewhere). `+`/`-` require a space after the marker so item
 * names like "+1 Longsword" aren't mistaken for markers.
 * Category: catalog match wins; otherwise potion/oil/scroll-looking names are consumables
 * and everything else gets `defaultCategory`.
 *
 * `skipGoldNotes`: outside purchase logs, bullets ending in a bare gold amount
 * ("* Fighter 155GP") are gold-source notes, not items — leave them as prose.
 *
 * Also used by the personal log-sheet importer (importSheetLog.ts).
 */
export function parseNotesItems(
  notes: string,
  defaultCategory: ItemCategory,
  skipGoldNotes = false
): { gained: NotesItem[]; removed: NotesItem[] } {
  const gained: NotesItem[] = [];
  const removed: NotesItem[] = [];
  // \r must go before matching: the AL Log quotes multi-line notes with CRLF, and a
  // trailing \r stops `(\S.*)$` from matching (JS `.` excludes line terminators).
  for (const line of notes.split(/\r?\n/)) {
    const m = line.match(/^\s*([+-])\s+(\S.*)$/) ?? line.match(/^\s*([*•])\s*(\S.*)$/);
    if (!m) continue;
    const parsed = parseItemLine(m[2]);
    if (!parsed) continue;
    if (skipGoldNotes && /\d[\d,]*(?:\.\d+)?\s*(pp|gp|ep|sp|cp)$/i.test(parsed.name)) continue;
    const match = lookupCatalog(parsed.name);
    const category = match?.category ?? (CONSUMABLE_NAME_RE.test(parsed.name) ? 'consumable' : defaultCategory);
    (m[1] === '-' ? removed : gained).push({
      ...parsed,
      name: match ? match.item.name : parsed.name, // canonical name so stacks merge
      category,
      rarity: match?.item.rarity,
      unitCost: parsed.totalCost !== undefined ? parsed.totalCost / parsed.quantity : match?.item.cost,
    });
  }
  return { gained, removed };
}

// ---- Structure grouping ----------------------------------------------------------

interface RawMagicRow {
  traded: boolean;
  name: string;
  rarity?: Rarity;
  notes?: string;
}

interface RawEntry {
  kind: 'CharacterLogEntry' | 'PurchaseLogEntry' | 'TradeLogEntry';
  cols: string[];
  magic: RawMagicRow[];
}

const LOG_ROW_KINDS = ['CharacterLogEntry', 'PurchaseLogEntry', 'TradeLogEntry'] as const;

// ---- Main conversion ---------------------------------------------------------------

export function importAlLog(csvText: string): AlImportResult {
  const rows = parseCsv(csvText);
  if (rows.length < 3 || rows[0][0]?.trim() !== 'name' || rows[2]?.[0]?.trim() !== 'type') {
    throw new Error(
      'This does not look like an Adventurers League Log CSV export (expected a character row followed by log entries).'
    );
  }

  const warnings: string[] = [];

  // Column maps from the file's own headers, so column reordering can't break us.
  const charCol = new Map(rows[0].map((h, i) => [h.trim(), i] as const));
  const logCol = new Map(rows[2].map((h, i) => [h.trim(), i] as const));
  const charField = (name: string) => (rows[1][charCol.get(name) ?? -1] ?? '').trim();
  const logField = (cols: string[], name: string) => (cols[logCol.get(name) ?? -1] ?? '').trim();

  const characterName = charField('name');
  if (!characterName) throw new Error('The CSV has no character name.');

  const noteLines = [
    `Imported from Adventurers League Log on ${new Date().toISOString().slice(0, 10)}.`,
    charField('faction') && `Faction: ${charField('faction')}`,
    charField('background') && `Background: ${charField('background')}`,
    charField('lifestyle') && `Lifestyle: ${charField('lifestyle')}`,
  ].filter(Boolean) as string[];

  const character: Character = {
    id: newId(),
    name: characterName,
    species: charField('race'),
    class: charField('class_and_levels'),
    notes: noteLines.join('\n'),
    createdAt: Date.now(),
  };

  // Group log rows with their magic-item rows.
  const entries: RawEntry[] = [];
  for (const row of rows.slice(3)) {
    const kind = row[0]?.trim();
    if ((LOG_ROW_KINDS as readonly string[]).includes(kind)) {
      entries.push({ kind: kind as RawEntry['kind'], cols: row, magic: [] });
    } else if (kind === 'MAGIC ITEM' || kind === 'TRADED MAGIC ITEM') {
      if (row[1]?.trim() === 'name') continue; // the magic-item header row
      const name = (row[1] ?? '').trim();
      if (!name) continue; // placeholder rows ("MAGIC ITEM,,common,...") carry no item
      const last = entries[entries.length - 1];
      const magic: RawMagicRow = {
        traded: kind === 'TRADED MAGIC ITEM',
        name,
        rarity: parseRarity(row[2] ?? '', warnings, `"${name}"`),
        notes: (row[6] ?? '').trim() || undefined,
      };
      if (last) last.magic.push(magic);
      else warnings.push(`Magic item "${name}" appeared before any log entry — skipped.`);
    } else {
      warnings.push(`Unrecognized row type "${kind}" — skipped.`);
    }
  }

  // Every magic item gained so far, for matching TRADED MAGIC ITEM rows by name.
  const gainedMagic: { key: string; name: string; id: string; remaining: number }[] = [];

  function gainMagicItem(row: RawMagicRow): GainedItem {
    const item: GainedItem = {
      id: newId(),
      name: row.name,
      category: 'magic_item',
      rarity: row.rarity,
      quantity: 1,
      description: row.notes,
    };
    gainedMagic.push({ key: normalizeKey(row.name), name: row.name, id: item.id, remaining: 1 });
    return item;
  }

  function loseMagicItem(row: RawMagicRow, logTitle: string): LostItem | null {
    const key = normalizeKey(row.name);
    for (let i = gainedMagic.length - 1; i >= 0; i--) {
      if (gainedMagic[i].key === key && gainedMagic[i].remaining > 0) {
        gainedMagic[i].remaining--;
        return { itemId: gainedMagic[i].id, quantity: 1, reason: 'traded' };
      }
    }
    warnings.push(
      `"${logTitle}": traded away "${row.name}", but no earlier log gained that item — the loss was skipped. Record it manually if needed.`
    );
    return null;
  }

  // Stacked (consumable/equipment) quantities gained so far, for matching "- Item"
  // removals; and the last per-unit purchase price per stack, for valuing sales.
  const stackGains = new Map<string, number>();
  const purchaseCostByStack = new Map<string, number>();

  const round2 = (n: number) => Math.round(n * 100) / 100;

  function stackIdOf(it: NotesItem): string {
    const rarity = it.category === 'consumable' ? it.rarity : undefined;
    return stackedItemId({ category: it.category, name: it.name, rarity });
  }

  /** Half of what it was bought for, else half the catalog list price, else unknown. */
  function importSalePrice(it: NotesItem): number | undefined {
    if (it.totalCost !== undefined) return it.totalCost / it.quantity; // explicit price wins
    const bought = purchaseCostByStack.get(stackIdOf(it));
    if (bought != null) return bought / 2;
    const cat = lookupCatalog(it.name);
    return cat ? cat.item.cost / 2 : undefined;
  }

  /** Match a "- Item" bullet against earlier gains: its own stack, the sibling stacked
   * category, then magic items by name. Unmatched → warning + null (text stays in notes). */
  function loseParsedItem(it: NotesItem, logTitle: string, reason: LostItem['reason']): LostItem | null {
    const categories: ItemCategory[] =
      it.category === 'equipment' ? ['equipment', 'consumable'] : ['consumable', 'equipment'];
    for (const category of categories) {
      const rarity = category === 'consumable' ? it.rarity : undefined;
      const id = stackedItemId({ category, name: it.name, rarity });
      const have = stackGains.get(id) ?? 0;
      if (have > 0) {
        stackGains.set(id, have - it.quantity);
        if (have < it.quantity) {
          warnings.push(
            `"${logTitle}": removed ${it.quantity}× "${it.name}" but only ${have} were gained by earlier logs — the inventory will flag it.`
          );
        }
        return { itemId: id, quantity: it.quantity, reason };
      }
    }
    const key = normalizeKey(it.name);
    for (let i = gainedMagic.length - 1; i >= 0; i--) {
      if (gainedMagic[i].key === key && gainedMagic[i].remaining > 0) {
        gainedMagic[i].remaining--;
        return { itemId: gainedMagic[i].id, quantity: 1, reason };
      }
    }
    warnings.push(
      `"${logTitle}": removed "${it.name}", but no earlier log gained that item — the loss was skipped (it's still in the log's notes).`
    );
    return null;
  }

  function notesItemsToGained(items: NotesItem[], withCost: boolean): GainedItem[] {
    return items.map((it) => {
      const rarity = it.category === 'magic_item' || it.category === 'consumable' ? it.rarity : undefined;
      const stacked = it.category === 'consumable' || it.category === 'equipment';
      return {
        id: stacked
          ? stackedItemId({ category: it.category, name: it.name, rarity })
          : newId(),
        name: it.name,
        category: it.category,
        rarity,
        quantity: it.quantity,
        cost: withCost && it.unitCost !== undefined ? it.unitCost : undefined,
      };
    });
  }

  const logs: LogEntry[] = [];
  const createdAtBase = Date.now();
  let lastDate: string | undefined;
  let assumedSessionLevels = 0;

  /** Record stacked gains (and purchase prices) so later "- Item" removals and
   * sale-price lookups can find them. */
  function registerStackedGains(items: GainedItem[], isPurchase = false) {
    for (const g of items) {
      if (g.category === 'consumable' || g.category === 'equipment') {
        stackGains.set(g.id, (stackGains.get(g.id) ?? 0) + g.quantity);
        if (isPurchase && g.cost != null) purchaseCostByStack.set(g.id, g.cost);
      }
    }
  }

  /** Push a finished log whose stacked gains haven't been registered yet. */
  function pushLog(log: LogEntry) {
    registerStackedGains(log.itemsGained, log.type === 'purchase');
    logs.push(log);
  }

  entries.forEach((entry, index) => {
    const f = (name: string) => logField(entry.cols, name);
    const title = f('adventure_title');
    const gp = num(f('gp_gained'));
    const downtime = num(f('downtime_gained'));
    const rawNotes = f('notes');

    let when = parseDateTime(f('date_played'));
    if (!when && f('date_dmed')) {
      when = parseDateTime(f('date_dmed'));
      if (when) warnings.push(`"${title || 'Log'}" only has a DM date — imported using it.`);
    }
    if (!when) {
      when = { date: lastDate ?? new Date().toISOString().slice(0, 10) };
      warnings.push(`"${title || `Log ${index + 1}`}" has no readable date — used ${when.date}.`);
    }
    lastDate = when.date;

    // Side facts the tracker has no field for get preserved as note lines.
    const extraNotes: string[] = [];
    if (num(f('xp_gained')) !== 0) extraNotes.push(`XP gained: ${f('xp_gained')}`);
    if (num(f('renown_gained')) !== 0) extraNotes.push(`Renown gained: ${f('renown_gained')}`);
    if (f('session_num')) extraNotes.push(`Session #${f('session_num')}`);

    const base: Omit<LogEntry, 'type' | 'title'> = {
      id: newId(),
      characterId: character.id,
      date: when.date,
      time: when.time,
      notes: undefined,
      gpGained: Math.max(0, gp),
      gpLost: Math.max(0, -gp),
      downtimeGained: Math.max(0, downtime),
      downtimeSpent: Math.max(0, -downtime),
      levelGained: 0,
      itemsGained: [],
      itemsLost: [],
      // File order breaks date+time ties during replay.
      createdAt: createdAtBase + index,
    };
    const finishNotes = (main?: string) =>
      [main, ...extraNotes].filter(Boolean).join('\n') || undefined;

    if (entry.kind === 'TradeLogEntry') {
      const gained = entry.magic.filter((m) => !m.traded).map(gainMagicItem);
      const lostRows = entry.magic.filter((m) => m.traded);
      const tradeTitle =
        title ||
        (lostRows[0] && gained[0] ? `Traded ${lostRows[0].name} for ${gained[0].name}` : 'Trade');
      const lost = lostRows
        .map((m) => loseMagicItem(m, tradeTitle))
        .filter((l): l is LostItem => l !== null);
      pushLog({
        ...base,
        type: 'transaction',
        title: tradeTitle,
        // The AL Log puts the trade partner in the notes column.
        tradePartner: rawNotes || undefined,
        notes: finishNotes(),
        itemsGained: gained,
        itemsLost: lost,
      });
      return;
    }

    if (entry.kind === 'PurchaseLogEntry') {
      let { gained: boughtItems, removed: soldItems } = parseNotesItems(rawNotes, 'equipment');
      // "-" is only unambiguously "sold" next to "+" items. A list of ONLY dashes may
      // just be someone's bullet style, so the log's own gold decides (owner rule):
      // gold coming in (+) = a sale, gold going out (−/0) = an ordinary purchase.
      if (boughtItems.length === 0 && soldItems.length > 0 && gp <= 0) {
        boughtItems = soldItems;
        soldItems = [];
      }
      const magicGains = entry.magic.filter((m) => !m.traded).map(gainMagicItem);
      const label = title || 'Purchase';

      // "- Item" bullets in a purchase log are sales: they become their own Sell log
      // (the AL Log records only the NET gold change, so the two sides are recovered
      // from item prices — explicit "(NGP)" first, then half purchase/catalog price).
      const buildSell = (): {
        log: Omit<LogEntry, 'id' | 'createdAt'>;
        total: number;
        unpriced: string[];
      } | null => {
        if (soldItems.length === 0) return null;
        const lost: LostItem[] = [];
        const unpriced: string[] = [];
        let total = 0;
        for (const it of soldItems) {
          const price = importSalePrice(it);
          if (price === undefined) unpriced.push(it.name);
          total += (price ?? 0) * it.quantity;
          // Register the removal against earlier gains (warns if never gained), but
          // always record the loss under the item's own stack id so gold still counts.
          const matched = loseParsedItem(it, label, 'sold');
          lost.push(
            matched ?? { itemId: stackIdOf(it), quantity: it.quantity, reason: 'sold' }
          );
          const last = lost[lost.length - 1];
          if (price !== undefined) last.salePrice = round2(price);
        }
        total = round2(total);
        return {
          total,
          unpriced,
          log: {
            ...base,
            type: 'sell',
            title: `Sold ${soldItems.map((i) => i.name).join(', ')}`,
            notes: finishNotes(rawNotes || undefined),
            gpGained: total,
            gpLost: 0,
            itemsGained: [],
            itemsLost: lost,
          },
        };
      };

      if (boughtItems.length === 0 && magicGains.length === 0 && soldItems.length > 0) {
        // Pure sale (only "-" items and, per the reclassification above, gold coming
        // in). The CSV's net gold IS the sale proceeds — trust it over estimates.
        const sell = buildSell()!;
        if (Math.abs(gp - sell.total) > 0.05) {
          const only = sell.log.itemsLost.length === 1 ? sell.log.itemsLost[0] : undefined;
          if (only) only.salePrice = round2(gp / only.quantity);
          else {
            warnings.push(
              `"${label}" (${when.date}): the log gained ${gp} gp but the sold items were valued at ${sell.total} gp — kept ${gp} gp; edit the Sell log's prices to match.`
            );
          }
        }
        pushLog({ ...sell.log, gpGained: gp, id: newId(), createdAt: createdAtBase + index });
        return;
      }

      if (gp > 0 && soldItems.length === 0) {
        // A purchase log that GAINS gold with no "- Item" sales is a free-form entry
        // (e.g. "Starting Equipment" logs) — the purchase type can't gain GP.
        warnings.push(
          `"${label}" gains ${gp} gp, which a Purchase log can't do — imported as a Free Log.`
        );
        pushLog({
          ...base,
          type: 'free',
          title: label,
          notes: finishNotes(rawNotes || undefined),
          itemsGained: [...magicGains, ...notesItemsToGained(boughtItems, false)],
        });
        return;
      }

      const sell = buildSell();
      // net = sale proceeds − purchase cost, so the purchase side spent (proceeds − net).
      const gpSpent = round2(Math.max(0, (sell?.total ?? 0) - gp));
      const gained = notesItemsToGained(boughtItems, true);
      if (gained.length === 1 && gained[0].cost === undefined) {
        gained[0].cost = gpSpent / gained[0].quantity;
      }
      const priced = gained.every((g) => g.cost !== undefined);
      const total = gained.reduce((sum, g) => sum + (g.cost ?? 0) * g.quantity, 0);
      if (gained.length === 0 && magicGains.length === 0) {
        warnings.push(
          `"${label}" (${when.date}): no items could be parsed from its notes — imported with the GP spent only.`
        );
      } else if (gained.length > 0 && (!priced || Math.abs(total - gpSpent) > 0.05)) {
        warnings.push(
          `"${label}" (${when.date}): GP spent in the log (${gpSpent}) doesn't match the item prices found (${round2(total)}). The imported log keeps ${gpSpent}, but re-saving it in the editor will recompute from item costs.`
        );
      }
      pushLog({
        ...base,
        // All incoming gold belongs to the sale side (a plain purchase has none anyway).
        gpGained: 0,
        gpLost: gpSpent,
        type: 'purchase',
        title: title || (gained.length ? `Bought ${gained.map((i) => i.name).join(', ')}` : 'Purchase'),
        notes: finishNotes(rawNotes || undefined),
        itemsGained: [...magicGains, ...gained],
      });
      if (sell) {
        for (const name of sell.unpriced) {
          warnings.push(
            `"${label}" (${when.date}): no sale price known for "${name}" — set to 0; edit the Sell log to fix it.`
          );
        }
        warnings.push(
          `"${label}" (${when.date}): its "- Item" lines were split into a separate Sell log (+${sell.total} gp) so the purchase and the sale each keep their own gold math.`
        );
        pushLog({ ...sell.log, id: newId(), createdAt: createdAtBase + index + 0.5 });
      }
      return;
    }

    // CharacterLogEntry — session, catch-up, or free-form depending on what's filled in.
    const location = f('location_played');
    const dm = f('dm_name');
    const dmDci = f('dm_dci_number');
    const magicGained = entry.magic.filter((m) => !m.traded);
    const isSession = Boolean(dm || location || magicGained.length > 0);

    if (!isSession) {
      const { gained: freeItems, removed } = parseNotesItems(rawNotes, 'equipment', true);
      const isCatchup =
        gp === 0 && downtime < 0 && -downtime % 10 === 0 &&
        freeItems.length === 0 && removed.length === 0;
      if (isCatchup) {
        pushLog({
          ...base,
          type: 'catchup',
          title: title || 'Catching Up',
          notes: finishNotes(rawNotes || undefined),
          levelGained: -downtime / 10,
        });
        return;
      }
      // No DM, no location, no magic items: someone used a session log as a free log.
      // Gains register before removals match, so "gained and used in the same log" works.
      const freeGained = notesItemsToGained(freeItems, false);
      registerStackedGains(freeGained);
      const freeLost = removed
        .map((it) => loseParsedItem(it, title || 'Free Log', 'other'))
        .filter((l): l is LostItem => l !== null);
      logs.push({
        ...base,
        type: 'free',
        title: title || 'Free Log',
        notes: finishNotes(rawNotes || undefined),
        itemsGained: freeGained,
        itemsLost: freeLost,
      });
      return;
    }

    const { gained: consumables, removed } = parseNotesItems(rawNotes, 'consumable', true);
    const sessionGained = [...magicGained.map(gainMagicItem), ...notesItemsToGained(consumables, false)];
    registerStackedGains(sessionGained);
    const lost = [
      ...entry.magic
        .filter((m) => m.traded)
        .map((m) => loseMagicItem(m, title || 'Session')),
      ...removed.map((it) => loseParsedItem(it, title || 'Session', 'used')),
    ].filter((l): l is LostItem => l !== null);
    assumedSessionLevels++;
    logs.push({
      ...base,
      type: 'session',
      title: title || 'Session',
      location: location || undefined,
      dm: dm || undefined,
      notes: finishNotes([rawNotes, dmDci && `DM DCI: ${dmDci}`].filter(Boolean).join('\n') || undefined),
      levelGained: 1,
      itemsGained: sessionGained,
      itemsLost: lost,
    });
  });

  if (assumedSessionLevels > 0) {
    warnings.unshift(
      `Assumed +1 level for each of the ${assumedSessionLevels} DM'd session(s) — the AL Log export doesn't record level-ups. Edit any session where you chose not to level.`
    );
  }
  if (logs.length === 0) warnings.push('The file contained no log entries — only the character was imported.');

  return { character, logs, warnings };
}
