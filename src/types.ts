// ---- Item categories -------------------------------------------------------

export const ITEM_CATEGORIES = [
  'magic_item',
  'consumable',
  'equipment',
  'story_award',
  'blessing',
  'charm',
  'boon',
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
};

export const CATEGORY_LABELS_SINGULAR: Record<ItemCategory, string> = {
  magic_item: 'Magic Item',
  consumable: 'Consumable',
  equipment: 'Equipment',
  story_award: 'Story Award',
  blessing: 'Blessing',
  charm: 'Charm',
  boon: 'Boon',
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

// ---- Logs -------------------------------------------------------------------

export const LOG_TYPES = ['session', 'catchup', 'transaction', 'purchase', 'free'] as const;

export type LogType = (typeof LOG_TYPES)[number];

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  session: 'Session',
  catchup: 'Catch Up',
  transaction: 'Transaction',
  purchase: 'Purchase',
  free: 'Free Log',
};

/** An item granted by a log entry. The id identifies this item instance forever. */
export interface GainedItem {
  id: string;
  name: string;
  category: ItemCategory;
  rarity?: Rarity;
  quantity: number;
  description?: string;
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
  createdAt: number;
}

// ---- Characters ---------------------------------------------------------------

export interface Character {
  id: string;
  name: string;
  species: string;
  class: string;
  notes?: string;
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
