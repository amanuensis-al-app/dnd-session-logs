import type { ItemCategory, Rarity } from './types';

export type Tier = 1 | 2 | 3 | 4;

/** AL character tier from level: T1 1–4, T2 5–10, T3 11–16, T4 17–20. */
export function tierForLevel(level: number): Tier {
  if (level <= 4) return 1;
  if (level <= 10) return 2;
  if (level <= 16) return 3;
  return 4;
}

/**
 * The seven "carry slot" pools the Prep tab enforces, each capped independently by
 * tier (owner-supplied AL tables, 2026-07-18). Magic items split by rarity —
 * Uncommon+ (uncommon/rare/very rare/legendary/artifact) vs Common — everything else
 * is one pool per category. Equipment (added 2026-07-19) has NO cap: mundane gear
 * is only limited by weight, which this tracker doesn't compute.
 */
export type PrepPool =
  | 'magicItemUncommonPlus'
  | 'magicItemCommon'
  | 'consumable'
  | 'equipment'
  | 'blessing'
  | 'charm'
  | 'boon';

/** Display order in the Prep tab. */
export const PREP_POOL_ORDER: PrepPool[] = [
  'magicItemUncommonPlus',
  'magicItemCommon',
  'consumable',
  'equipment',
  'blessing',
  'charm',
  'boon',
];

export const PREP_POOL_LABELS: Record<PrepPool, string> = {
  magicItemUncommonPlus: 'Magic Items (Uncommon+)',
  magicItemCommon: 'Magic Items (Common)',
  consumable: 'Consumables',
  equipment: 'Equipment',
  blessing: 'Blessings',
  charm: 'Charms',
  boon: 'Boons',
};

const TIER_LIMITS: Record<Tier, Record<PrepPool, number>> = {
  1: { magicItemUncommonPlus: 1, magicItemCommon: 5, consumable: 5, equipment: Infinity, blessing: 1, charm: 2, boon: 0 },
  2: { magicItemUncommonPlus: 3, magicItemCommon: 5, consumable: 10, equipment: Infinity, blessing: 1, charm: 5, boon: 0 },
  3: { magicItemUncommonPlus: 6, magicItemCommon: 5, consumable: 10, equipment: Infinity, blessing: 1, charm: 5, boon: 0 },
  4: { magicItemUncommonPlus: 10, magicItemCommon: 5, consumable: 15, equipment: Infinity, blessing: 1, charm: 5, boon: 1 },
};

/** Slots allowed per pool. `Infinity` means the pool is uncapped (Equipment). */
export function prepLimit(tier: Tier, pool: PrepPool): number {
  return TIER_LIMITS[tier][pool];
}

/**
 * Which Prep pool an equippable item belongs to, or undefined for a category Prep
 * doesn't track (Story Awards — see EQUIPPABLE_CATEGORIES, checked by the
 * caller). A magic item with no rarity set lands in Uncommon+, the more restrictive
 * pool: every magic item created in-app has a rarity by default (LogForm defaults
 * new gains to 'uncommon'), so a blank one is old/imported data worth flagging by
 * costing the scarcer slot rather than quietly landing in the roomier Common pool.
 */
export function prepPoolOf(category: ItemCategory, rarity: Rarity | undefined): PrepPool | undefined {
  switch (category) {
    case 'magic_item':
      return rarity === 'common' ? 'magicItemCommon' : 'magicItemUncommonPlus';
    case 'consumable':
      return 'consumable';
    case 'equipment':
      return 'equipment';
    case 'blessing':
      return 'blessing';
    case 'charm':
      return 'charm';
    case 'boon':
      return 'boon';
    default:
      return undefined;
  }
}

/** A character can be attuned to at most this many magic items at once — shared
 * across every rarity (Uncommon+ and Common alike), owner rule 2026-07-19. Prep
 * disables the "Attuned" option in each item's attunement dropdown once the
 * character's current total (both magic item pools combined) hits this cap. */
export const ATTUNEMENT_CAP = 3;
