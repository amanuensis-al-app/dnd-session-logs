// ---- Item categories -------------------------------------------------------

export const ITEM_CATEGORIES = [
  'magic_item',
  'consumable',
  'equipment',
  'story_award',
  'blessing',
  'charm',
  'boon',
  'copied_spell',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  magic_item: 'Magic Items',
  consumable: 'Consumables',
  equipment: 'Equipment',
  story_award: 'Story Awards',
  blessing: 'Blessings',
  charm: 'Charms',
  boon: 'Boons',
  copied_spell: 'Copied Spells',
};

export const CATEGORY_LABELS_SINGULAR: Record<ItemCategory, string> = {
  magic_item: 'Magic Item',
  consumable: 'Consumable',
  equipment: 'Equipment',
  story_award: 'Story Award',
  blessing: 'Blessing',
  charm: 'Charm',
  boon: 'Boon',
  copied_spell: 'Copied Spell',
};

export const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'very rare',
  'legendary',
  'artifact',
] as const;

export type Rarity = (typeof RARITIES)[number];

/** Categories that carry a rarity. */
export const RARITY_CATEGORIES: ItemCategory[] = ['magic_item', 'consumable'];

/** Categories the "equipped" mark applies to. Story Awards aren't "equippable" in
 * this tracker's sense. (Owner decision 2026-07-18 originally excluded mundane
 * Equipment too — reversed 2026-07-19 when the Prep tab gained an unlimited
 * Equipment pool; Story Awards remain the only non-equippable category.) */
export const EQUIPPABLE_CATEGORIES: ItemCategory[] = [
  'magic_item',
  'consumable',
  'equipment',
  'blessing',
  'charm',
  'boon',
];

/**
 * 2024 DMG minor properties: a magic item may have up to one. Purely descriptive
 * flavor text (no mechanical effect the tracker needs to act on), stored as a
 * name on the GainedItem so it shows up in inventory and log history.
 */
export const MINOR_PROPERTIES = [
  'Beacon',
  'Compass',
  'Delver',
  'Guardian',
  'Harmonious',
  'Key',
  'Secret Message',
  'Sentinel',
  'Songcraft',
  'Strange Material',
  'Temperate',
  'Unbreakable',
  'War Leader',
  'Waterborne',
] as const;

export type MinorProperty = (typeof MINOR_PROPERTIES)[number];

// ---- Logs -------------------------------------------------------------------

export const LOG_TYPES = ['session', 'catchup', 'transaction', 'copy_spell', 'purchase', 'sell', 'creation', 'free'] as const;

export type LogType = (typeof LOG_TYPES)[number];

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  session: 'Session',
  catchup: 'Catch Up',
  // Displayed as "Trade" (the actual AL term, owner correction 2026-07-20); the
  // internal type id stays 'transaction' — it's stored in every saved log/backup.
  transaction: 'Trade',
  copy_spell: 'Copy Spell',
  purchase: 'Purchase',
  sell: 'Sell',
  // Displayed as "Starting Log" (owner correction 2026-07-20 — the more common
  // term); the internal type id stays 'creation', same deal as transaction/"Trade".
  creation: 'Starting Log',
  free: 'Free Log',
};

/**
 * Categories with no per-instance identity: any two with the same name and rarity are
 * the same item, so they stack. They carry no description, and their GainedItem id is
 * content-derived (see stackedItemId) — the SAME id may appear in many logs, and the
 * derive engine sums the quantities. Other categories (magic items, …) keep a unique
 * uuid per gained instance.
 */
export const STACKED_CATEGORIES: ItemCategory[] = ['consumable', 'equipment'];

/** Deterministic GainedItem id for stacked categories: identity = category+name+rarity. */
export function stackedItemId(item: {
  category: ItemCategory;
  name: string;
  rarity?: Rarity;
}): string {
  return `stk:${item.category}|${item.name.trim().toLowerCase()}|${item.rarity ?? ''}`;
}

/** Where a copied spell (a Wizard's spellbook entry, category 'copied_spell') came
 * from — recorded by Copy Spell logs so editing one can rebuild its form rows. */
export interface CopiedSpellSource {
  source: 'scroll' | 'player';
  /** 'player' source only: who it was copied from ("player / character name" free
   * text, same convention as a transaction's tradePartner). */
  partner?: string;
}

/** An item granted by a log entry. For non-stacked categories the id identifies this
 * item instance forever; for stacked categories it is the content-derived stack id. */
export interface GainedItem {
  id: string;
  name: string;
  category: ItemCategory;
  rarity?: Rarity;
  quantity: number;
  /** Not used by stacked categories. */
  description?: string;
  /** Magic items only: at most one of MINOR_PROPERTIES. */
  minorProperty?: MinorProperty;
  /** Magic items only: whether the item requires attunement — a property of the ITEM
   * itself, unlike attuned/not-attuned which is a per-character prep state (see
   * AttunementState). Absent = requires attunement (the tracker's original default:
   * every magic item used to show Prep's attunement dropdown), so only `false` is
   * ever meaningful to read. */
  requiresAttunement?: boolean;
  /** Purchase price per unit in GP. Recorded by purchase logs, which derive their GP spent from it. */
  cost?: number;
  /** Copied spells only: the spell's level (1–9; cantrips can't be copied). */
  spellLevel?: number;
  /** Copied spells only: where the spell was copied from. */
  copiedFrom?: CopiedSpellSource;
}

export type LossReason = 'used' | 'traded' | 'sold' | 'lost' | 'other';

export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  used: 'Used / Consumed',
  traded: 'Traded away',
  sold: 'Sold',
  lost: 'Lost / Destroyed',
  other: 'Other',
};

/** A loss recorded by a log entry, referencing a previously gained item instance. */
export interface LostItem {
  itemId: string;
  quantity: number;
  reason: LossReason;
  /** Sale price per unit in GP. Recorded by sell logs, which derive their GP gained from it. */
  salePrice?: number;
}

/** A 2024 PHB background or class starting package picked on a creation
 * ("Starting") log — stored so the choice survives edits and shows in displays.
 * The actual gold/items are the ordinary editable log fields the pick prefilled;
 * this only remembers WHAT was picked. */
export interface CreationPick {
  name: string;
  /** 0-based index into the source's options in catalog.ts (Option A = 0). */
  option: number;
}

export interface LogEntry {
  id: string;
  characterId: string;
  type: LogType;
  /** ISO date (yyyy-mm-dd). Logs replay in date order, then time, then creation order. */
  date: string;
  /** Optional time of day (HH:mm, 24h). Treated as 00:00 when absent. */
  time?: string;
  /** Adventure name / short description of the log. */
  title: string;
  notes?: string;
  gpGained: number;
  gpLost: number;
  downtimeGained: number;
  downtimeSpent: number;
  /** Level delta. Sessions usually +1; free logs may be any value (incl. negative). */
  levelGained: number;
  itemsGained: GainedItem[];
  itemsLost: LostItem[];
  /** Transaction logs: who the trade was with. */
  tradePartner?: string;
  /** Session logs: where it was played. */
  location?: string;
  /** Session logs: who ran the table. */
  dm?: string;
  /** Creation ("Starting") logs: the picked background starting package. */
  creationBackground?: CreationPick;
  /** Creation ("Starting") logs: the picked class starting package. */
  creationClass?: CreationPick;
  createdAt: number;
}

// ---- Characters ---------------------------------------------------------------

/**
 * Per-item equip state, keyed by GainedItem id (the stack id for stacked
 * categories). Present = equipped, absent = not — equipped items sort first in the
 * inventory and the log form's loss picker, and make up the Prep tab. Pure UI
 * priority, no rules meaning. (Reads are truthiness checks on purpose: the value
 * was 'bookmarked' for a few hours on 2026-07-18, and any such dev data now simply
 * reads as equipped.)
 */
export type ItemMark = 'equipped';

/**
 * Attunement state for an equipped magic item in the context of preparation
 * (`category === 'magic_item'` only — meaningless elsewhere). Absent = not attuned,
 * the default. A character can be attuned to at most 3 magic items at once (shared
 * cap across every rarity, see `ATTUNEMENT_CAP` in `tiers.ts`) — this type is just
 * the stored shape, set from Prep's attunement dropdown.
 *
 * Whether an item REQUIRES attunement is a separate concern: a property of the item
 * itself (`GainedItem.requiresAttunement`), not stored here. Until 2026-07-19 this
 * type also had `'not-required'` for that; App.tsx migrates any such legacy marks
 * onto their items on load, so only 'attuned' remains.
 */
export type AttunementState = 'attuned';

export interface Character {
  id: string;
  name: string;
  species: string;
  class: string;
  notes?: string;
  /** Square portrait as a JPEG data URL (base64), max 256×256 — set via the avatar
   * editor. Client-side only, never uploaded anywhere; travels in the backup JSON
   * like every other field. */
  icon?: string;
  /** Equipped item ids (see ItemMark). Travels in the backup JSON. */
  itemMarks?: Record<string, ItemMark>;
  /** How many units of an equipped consumable/equipment stack are prepped (Prep
   * tab), keyed by the same stack id as itemMarks. Absent = the whole stack.
   * Sparse; meaningless for non-stacked categories and dangles harmlessly, same
   * philosophy as itemMarks. Consumables count these as slots in Prep: prepping
   * 3 of 5 potions spends 3 consumable slots. */
  equipQuantities?: Record<string, number>;
  /** Attunement state per magic item id (see AttunementState). Travels in the
   * backup JSON; harmless if it dangles on an item that's since been unequipped or
   * lost, same philosophy as itemMarks. */
  attunement?: Record<string, AttunementState>;
  createdAt: number;
}

// ---- Derived state (computed by replaying logs, never stored) -----------------

export interface ItemHistoryEvent {
  logId: string;
  date: string;
  quantity: number;
  reason: LossReason;
}

export interface InventoryItem extends GainedItem {
  sourceLogId: string;
  acquiredDate: string;
  /** quantity gained minus quantities lost. 0 = fully consumed/gone. */
  remaining: number;
  losses: ItemHistoryEvent[];
}

export interface DerivedStats {
  level: number;
  gp: number;
  downtimeDays: number;
  /** Every item this character ever gained, including depleted ones. */
  allItems: InventoryItem[];
  /** Items with remaining > 0, i.e. currently owned. */
  inventory: InventoryItem[];
}

// ---- Export / import -----------------------------------------------------------

export interface ExportBundle {
  app: 'al-tracker';
  version: 1;
  exportedAt: string;
  characters: Character[];
  logs: LogEntry[];
}

export function newId(): string {
  return crypto.randomUUID();
}
