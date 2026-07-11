import type { ItemCategory, Rarity } from './types';

export interface CatalogItem {
  name: string;
  /** Purchase cost per unit in GP (1 CP = 0.01, 1 SP = 0.1, 1 EP = 0.5, 1 PP = 10). */
  cost: number;
  /** Auto-filled on pick for rarity-bearing categories (consumables). */
  rarity?: Rarity;
}

/**
 * Hardcoded common items offered in the item-name dropdown when gaining an item.
 * Picking one auto-fills its rarity, and (in a purchase log) its cost; users can
 * always switch to manual input for anything not listed.
 *
 * Equipment = 2024 PHB weapons + armor tables. Consumables = the potions/oils the
 * owner allows for purchase. Categories without an entry here (magic items,
 * blessings, …) get a plain text input, since those are too varied to enumerate.
 */
export const ITEM_CATALOG: Partial<Record<ItemCategory, CatalogItem[]>> = {
  equipment: [
    // Simple melee weapons
    { name: 'Club', cost: 0.1 },
    { name: 'Dagger', cost: 2 },
    { name: 'Greatclub', cost: 0.2 },
    { name: 'Handaxe', cost: 5 },
    { name: 'Javelin', cost: 0.5 },
    { name: 'Light Hammer', cost: 2 },
    { name: 'Mace', cost: 5 },
    { name: 'Quarterstaff', cost: 0.2 },
    { name: 'Sickle', cost: 1 },
    { name: 'Spear', cost: 1 },
    // Simple ranged weapons
    { name: 'Dart', cost: 0.05 },
    { name: 'Light Crossbow', cost: 25 },
    { name: 'Shortbow', cost: 25 },
    { name: 'Sling', cost: 0.1 },
    // Martial melee weapons
    { name: 'Battleaxe', cost: 10 },
    { name: 'Flail', cost: 10 },
    { name: 'Glaive', cost: 20 },
    { name: 'Greataxe', cost: 30 },
    { name: 'Greatsword', cost: 50 },
    { name: 'Halberd', cost: 20 },
    { name: 'Lance', cost: 10 },
    { name: 'Longsword', cost: 15 },
    { name: 'Maul', cost: 10 },
    { name: 'Morningstar', cost: 15 },
    { name: 'Pike', cost: 5 },
    { name: 'Rapier', cost: 25 },
    { name: 'Scimitar', cost: 25 },
    { name: 'Shortsword', cost: 10 },
    { name: 'Trident', cost: 5 },
    { name: 'Warhammer', cost: 15 },
    { name: 'War Pick', cost: 5 },
    { name: 'Whip', cost: 2 },
    // Martial ranged weapons
    { name: 'Blowgun', cost: 10 },
    { name: 'Hand Crossbow', cost: 75 },
    { name: 'Heavy Crossbow', cost: 50 },
    { name: 'Longbow', cost: 50 },
    // Light armor
    { name: 'Padded Armor', cost: 5 },
    { name: 'Leather Armor', cost: 10 },
    { name: 'Studded Leather Armor', cost: 45 },
    // Medium armor
    { name: 'Hide Armor', cost: 10 },
    { name: 'Chain Shirt', cost: 50 },
    { name: 'Scale Mail', cost: 50 },
    { name: 'Breastplate', cost: 400 },
    { name: 'Half Plate Armor', cost: 750 },
    // Heavy armor
    { name: 'Ring Mail', cost: 30 },
    { name: 'Chain Mail', cost: 75 },
    { name: 'Splint Armor', cost: 200 },
    { name: 'Plate Armor', cost: 1500 },
    // Shield
    { name: 'Shield', cost: 10 },
  ],
  consumable: [
    // Common potions
    { name: 'Potion of Healing', cost: 50, rarity: 'common' },
    // Uncommon potions
    { name: 'Oil of Slipperiness', cost: 200, rarity: 'uncommon' },
    { name: 'Potion of Water Breathing', cost: 200, rarity: 'uncommon' },
    { name: 'Potion of Growth', cost: 200, rarity: 'uncommon' },
    { name: 'Potion of Pugilism', cost: 200, rarity: 'uncommon' },
    // Rare potions
    { name: 'Potion of Invulnerability', cost: 2000, rarity: 'rare' },
    { name: 'Potion of Heroism', cost: 2000, rarity: 'rare' },
    // Very rare potions
    { name: 'Potion of Speed', cost: 20000, rarity: 'very rare' },
    { name: 'Oil of Sharpness', cost: 20000, rarity: 'very rare' },
  ],
};
