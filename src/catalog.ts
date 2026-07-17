import type { ItemCategory, Rarity } from './types';

export interface CatalogItem {
  name: string;
  /** Purchase cost per unit in GP (1 CP = 0.01, 1 SP = 0.1, 1 EP = 0.5, 1 PP = 10). */
  cost: number;
  /** Auto-filled on pick for rarity-bearing categories (consumables). */
  rarity?: Rarity;
  /** Dropdown section heading (rendered as an <optgroup> in the item-name picker). */
  group?: string;
}

/** Tag every item in a dropdown section with its heading. */
function section(group: string, items: Omit<CatalogItem, 'group'>[]): CatalogItem[] {
  return items.map((item) => ({ ...item, group }));
}

// ---- Character creation packages ---------------------------------------------

/** One starting-equipment grant; quantity defaults to 1. All are equipment. */
export interface CreationItem {
  name: string;
  quantity?: number;
}

/** One of the pickable starting packages of a creation source (Option A / B). */
export interface CreationOption {
  gp: number;
  items: CreationItem[];
}

/** A background or class offering starting-equipment options. */
export interface CreationSource {
  name: string;
  /** Option A (equipment package), then Option B (usually gold only), … */
  options: CreationOption[];
}

/**
 * 2024 PHB backgrounds: starting equipment Option A, or Option B (50 GP).
 * Picking one prefills the creation log's gold and item rows — the rows stay
 * editable, so "(any)" placeholder items (gaming set, instrument, artisan's
 * tools) can be specialized by the player afterwards.
 */
export const CREATION_BACKGROUNDS: CreationSource[] = [
  {
    name: 'Custom Background',
    options: [{ gp: 50, items: [] }],
  },
  {
    name: 'Acolyte',
    options: [
      {
        gp: 8,
        items: [
          { name: 'Calligrapher’s Supplies' },
          { name: 'Book (prayers)' },
          { name: 'Holy Symbol (any)' },
          { name: 'Parchment', quantity: 10 },
          { name: 'Robe' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Artisan',
    options: [
      {
        gp: 32,
        items: [
          { name: 'Artisan’s Tools (any)' },
          { name: 'Pouch', quantity: 2 },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Charlatan',
    options: [
      {
        gp: 15,
        items: [{ name: 'Forgery Kit' }, { name: 'Costume' }, { name: 'Fine Clothes' }],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Criminal',
    options: [
      {
        gp: 16,
        items: [
          { name: 'Dagger', quantity: 2 },
          { name: 'Thieves’ Tools' },
          { name: 'Crowbar' },
          { name: 'Pouch', quantity: 2 },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Entertainer',
    options: [
      {
        gp: 11,
        items: [
          { name: 'Musical Instrument (any)' },
          { name: 'Costume', quantity: 2 },
          { name: 'Mirror' },
          { name: 'Perfume' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Farmer',
    options: [
      {
        gp: 30,
        items: [
          { name: 'Sickle' },
          { name: 'Carpenter’s Tools' },
          { name: 'Healer’s Kit' },
          { name: 'Iron Pot' },
          { name: 'Shovel' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Guard',
    options: [
      {
        gp: 12,
        items: [
          { name: 'Spear' },
          { name: 'Light Crossbow' },
          { name: 'Bolt', quantity: 20 },
          { name: 'Gaming Set (any)' },
          { name: 'Hooded Lantern' },
          { name: 'Manacles' },
          { name: 'Quiver' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Guide',
    options: [
      {
        gp: 3,
        items: [
          { name: 'Shortbow' },
          { name: 'Arrow', quantity: 20 },
          { name: 'Cartographer’s Tools' },
          { name: 'Bedroll' },
          { name: 'Quiver' },
          { name: 'Tent' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Hermit',
    options: [
      {
        gp: 16,
        items: [
          { name: 'Quarterstaff' },
          { name: 'Herbalism Kit' },
          { name: 'Bedroll' },
          { name: 'Book (philosophy)' },
          { name: 'Lamp' },
          { name: 'Oil', quantity: 3 },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Merchant',
    options: [
      {
        gp: 22,
        items: [
          { name: 'Navigator’s Tools' },
          { name: 'Pouch', quantity: 2 },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Noble',
    options: [
      {
        gp: 29,
        items: [{ name: 'Gaming Set (any)' }, { name: 'Fine Clothes' }, { name: 'Perfume' }],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Sage',
    options: [
      {
        gp: 8,
        items: [
          { name: 'Quarterstaff' },
          { name: 'Calligrapher’s Supplies' },
          { name: 'Book (history)' },
          { name: 'Parchment', quantity: 8 },
          { name: 'Robe' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Sailor',
    options: [
      {
        gp: 20,
        items: [
          { name: 'Dagger' },
          { name: 'Navigator’s Tools' },
          { name: 'Rope' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Scribe',
    options: [
      {
        gp: 23,
        items: [
          { name: 'Calligrapher’s Supplies' },
          { name: 'Fine Clothes' },
          { name: 'Lamp' },
          { name: 'Oil', quantity: 3 },
          { name: 'Parchment', quantity: 12 },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Soldier',
    options: [
      {
        gp: 14,
        items: [
          { name: 'Spear' },
          { name: 'Shortbow' },
          { name: 'Arrow', quantity: 20 },
          { name: 'Gaming Set (any)' },
          { name: 'Healer’s Kit' },
          { name: 'Quiver' },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Wayfarer',
    options: [
      {
        gp: 16,
        items: [
          { name: 'Dagger', quantity: 2 },
          { name: 'Thieves’ Tools' },
          { name: 'Gaming Set (any)' },
          { name: 'Bedroll' },
          { name: 'Pouch', quantity: 2 },
          { name: 'Traveler’s Clothes' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
];

/**
 * 2024 PHB classes: starting equipment Option A/B (Fighter: A/B/C), or gold only.
 * Same prefill behavior as backgrounds — a Creation log sums the background pick
 * and the class pick. Placeholder items ("Musical Instrument (any)", combined
 * choices like Monk's tool-or-instrument) are left as free text for the player
 * to specialize, same convention as the background packages.
 */
export const CREATION_CLASSES: CreationSource[] = [
  {
    name: 'Artificer',
    options: [
      {
        gp: 16,
        items: [
          { name: 'Studded Leather Armor' },
          { name: 'Dagger' },
          { name: 'Thieves’ Tools' },
          { name: 'Tinker’s Tools' },
          { name: 'Dungeoneer’s Pack' },
        ],
      },
      { gp: 150, items: [] },
    ],
  },
  {
    name: 'Barbarian',
    options: [
      {
        gp: 15,
        items: [
          { name: 'Greataxe' },
          { name: 'Handaxe', quantity: 4 },
          { name: 'Explorer’s Pack' },
        ],
      },
      { gp: 75, items: [] },
    ],
  },
  {
    name: 'Bard',
    options: [
      {
        gp: 19,
        items: [
          { name: 'Leather Armor' },
          { name: 'Dagger', quantity: 2 },
          { name: 'Musical Instrument (any)' },
          { name: 'Entertainer’s Pack' },
        ],
      },
      { gp: 90, items: [] },
    ],
  },
  {
    name: 'Cleric',
    options: [
      {
        gp: 7,
        items: [
          { name: 'Chain Shirt' },
          { name: 'Shield' },
          { name: 'Mace' },
          { name: 'Holy Symbol (any)' },
          { name: 'Priest’s Pack' },
        ],
      },
      { gp: 110, items: [] },
    ],
  },
  {
    name: 'Druid',
    options: [
      {
        gp: 9,
        items: [
          { name: 'Leather Armor' },
          { name: 'Shield' },
          { name: 'Sickle' },
          { name: 'Druidic Focus (Quarterstaff)' },
          { name: 'Explorer’s Pack' },
          { name: 'Herbalism Kit' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Fighter',
    options: [
      {
        gp: 4,
        items: [
          { name: 'Chain Mail' },
          { name: 'Greatsword' },
          { name: 'Flail' },
          { name: 'Javelin', quantity: 8 },
          { name: 'Dungeoneer’s Pack' },
        ],
      },
      {
        gp: 11,
        items: [
          { name: 'Studded Leather Armor' },
          { name: 'Scimitar' },
          { name: 'Shortsword' },
          { name: 'Longbow' },
          { name: 'Arrow', quantity: 20 },
          { name: 'Quiver' },
          { name: 'Dungeoneer’s Pack' },
        ],
      },
      { gp: 155, items: [] },
    ],
  },
  {
    name: 'Monk',
    options: [
      {
        gp: 11,
        items: [
          { name: 'Spear' },
          { name: 'Dagger', quantity: 5 },
          { name: 'Artisan’s Tools or Musical Instrument (any)' },
          { name: 'Explorer’s Pack' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Paladin',
    options: [
      {
        gp: 9,
        items: [
          { name: 'Chain Mail' },
          { name: 'Shield' },
          { name: 'Longsword' },
          { name: 'Javelin', quantity: 6 },
          { name: 'Holy Symbol (any)' },
          { name: 'Priest’s Pack' },
        ],
      },
      { gp: 150, items: [] },
    ],
  },
  {
    name: 'Ranger',
    options: [
      {
        gp: 7,
        items: [
          { name: 'Studded Leather Armor' },
          { name: 'Scimitar' },
          { name: 'Shortsword' },
          { name: 'Longbow' },
          { name: 'Arrow', quantity: 20 },
          { name: 'Quiver' },
          { name: 'Druidic Focus (Sprig of Mistletoe)' },
          { name: 'Explorer’s Pack' },
        ],
      },
      { gp: 150, items: [] },
    ],
  },
  {
    name: 'Rogue',
    options: [
      {
        gp: 8,
        items: [
          { name: 'Leather Armor' },
          { name: 'Dagger', quantity: 2 },
          { name: 'Shortsword' },
          { name: 'Shortbow' },
          { name: 'Arrow', quantity: 20 },
          { name: 'Quiver' },
          { name: 'Thieves’ Tools' },
          { name: 'Burglar’s Pack' },
        ],
      },
      { gp: 100, items: [] },
    ],
  },
  {
    name: 'Sorcerer',
    options: [
      {
        gp: 28,
        items: [
          { name: 'Spear' },
          { name: 'Dagger', quantity: 2 },
          { name: 'Arcane Focus (Crystal)' },
          { name: 'Dungeoneer’s Pack' },
        ],
      },
      { gp: 50, items: [] },
    ],
  },
  {
    name: 'Warlock',
    options: [
      {
        gp: 15,
        items: [
          { name: 'Leather Armor' },
          { name: 'Sickle' },
          { name: 'Dagger', quantity: 2 },
          { name: 'Arcane Focus (Orb)' },
          { name: 'Book (occult lore)' },
          { name: 'Scholar’s Pack' },
        ],
      },
      { gp: 100, items: [] },
    ],
  },
  {
    name: 'Wizard',
    options: [
      {
        gp: 5,
        items: [
          { name: 'Dagger', quantity: 2 },
          { name: 'Arcane Focus (Quarterstaff)' },
          { name: 'Robe' },
          { name: 'Spellbook' },
          { name: 'Scholar’s Pack' },
        ],
      },
      { gp: 55, items: [] },
    ],
  },
];

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
    ...section('Simple Melee Weapons', [
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
    ]),
    ...section('Simple Ranged Weapons', [
      { name: 'Dart', cost: 0.05 },
      { name: 'Light Crossbow', cost: 25 },
      { name: 'Shortbow', cost: 25 },
      { name: 'Sling', cost: 0.1 },
    ]),
    ...section('Martial Melee Weapons', [
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
    ]),
    ...section('Martial Ranged Weapons', [
      { name: 'Blowgun', cost: 10 },
      { name: 'Hand Crossbow', cost: 75 },
      { name: 'Heavy Crossbow', cost: 50 },
      { name: 'Longbow', cost: 50 },
    ]),
    ...section('Light Armor', [
      { name: 'Padded Armor', cost: 5 },
      { name: 'Leather Armor', cost: 10 },
      { name: 'Studded Leather Armor', cost: 45 },
    ]),
    ...section('Medium Armor', [
      { name: 'Hide Armor', cost: 10 },
      { name: 'Chain Shirt', cost: 50 },
      { name: 'Scale Mail', cost: 50 },
      { name: 'Breastplate', cost: 400 },
      { name: 'Half Plate Armor', cost: 750 },
    ]),
    ...section('Heavy Armor', [
      { name: 'Ring Mail', cost: 30 },
      { name: 'Chain Mail', cost: 75 },
      { name: 'Splint Armor', cost: 200 },
      { name: 'Plate Armor', cost: 1500 },
    ]),
    ...section('Shield', [{ name: 'Shield', cost: 10 }]),
    ...section('Artisan’s Tools', [
      { name: 'Alchemist’s Supplies', cost: 50 },
      { name: 'Brewer’s Supplies', cost: 20 },
      { name: 'Calligrapher’s Supplies', cost: 10 },
      { name: 'Carpenter’s Tools', cost: 8 },
      { name: 'Cartographer’s Tools', cost: 15 },
      { name: 'Cobbler’s Tools', cost: 5 },
      { name: 'Cook’s Utensils', cost: 1 },
      { name: 'Glassblower’s Tools', cost: 30 },
      { name: 'Jeweler’s Tools', cost: 25 },
      { name: 'Leatherworker’s Tools', cost: 5 },
      { name: 'Mason’s Tools', cost: 10 },
      { name: 'Painter’s Supplies', cost: 10 },
      { name: 'Potter’s Tools', cost: 10 },
      { name: 'Smith’s Tools', cost: 20 },
      { name: 'Tinker’s Tools', cost: 50 },
      { name: 'Weaver’s Tools', cost: 1 },
      { name: 'Woodcarver’s Tools', cost: 1 },
    ]),
    // Gaming Set and Musical Instrument have per-variant prices, so each variant
    // is its own entry (a self-describing name beats a bare "Dice" in the inventory).
    ...section('Other Tools', [
      { name: 'Disguise Kit', cost: 25 },
      { name: 'Forgery Kit', cost: 15 },
      { name: 'Gaming Set (Dice)', cost: 0.1 },
      { name: 'Gaming Set (Dragonchess)', cost: 1 },
      { name: 'Gaming Set (Playing Cards)', cost: 0.5 },
      { name: 'Gaming Set (Three-Dragon Ante)', cost: 1 },
      { name: 'Herbalism Kit', cost: 5 },
      { name: 'Musical Instrument (Bagpipes)', cost: 30 },
      { name: 'Musical Instrument (Drum)', cost: 6 },
      { name: 'Musical Instrument (Dulcimer)', cost: 25 },
      { name: 'Musical Instrument (Flute)', cost: 2 },
      { name: 'Musical Instrument (Horn)', cost: 3 },
      { name: 'Musical Instrument (Lute)', cost: 35 },
      { name: 'Musical Instrument (Lyre)', cost: 30 },
      { name: 'Musical Instrument (Pan Flute)', cost: 12 },
      { name: 'Musical Instrument (Shawm)', cost: 2 },
      { name: 'Musical Instrument (Viol)', cost: 30 },
      { name: 'Navigator’s Tools', cost: 25 },
      { name: 'Poisoner’s Kit', cost: 50 },
      { name: 'Thieves’ Tools', cost: 25 },
    ]),
    // Comma-inverted PHB table names ("Lantern, Bullseye") are naturalized the way the
    // PHB's own prose writes them, and the list re-alphabetized by the natural name.
    // Deliberately absent: Potion of Healing (already a consumable; a second
    // equipment entry would create a separate stack).
    ...section('Adventuring Gear', [
      { name: 'Acid', cost: 25 },
      { name: 'Alchemist’s Fire', cost: 50 },
      { name: 'Antitoxin', cost: 50 },
      { name: 'Backpack', cost: 2 },
      { name: 'Ball Bearings', cost: 1 },
      { name: 'Barrel', cost: 2 },
      { name: 'Basic Poison', cost: 100 },
      { name: 'Basket', cost: 0.4 },
      { name: 'Bedroll', cost: 1 },
      { name: 'Bell', cost: 1 },
      { name: 'Blanket', cost: 0.5 },
      { name: 'Block and Tackle', cost: 1 },
      { name: 'Book', cost: 25 },
      { name: 'Bucket', cost: 0.05 },
      { name: 'Bullseye Lantern', cost: 10 },
      { name: 'Burglar’s Pack', cost: 16 },
      { name: 'Caltrops', cost: 1 },
      { name: 'Candle', cost: 0.01 },
      { name: 'Chain', cost: 5 },
      { name: 'Chest', cost: 5 },
      { name: 'Climber’s Kit', cost: 25 },
      { name: 'Component Pouch', cost: 25 },
      { name: 'Costume', cost: 5 },
      { name: 'Crossbow Bolt Case', cost: 1 },
      { name: 'Crowbar', cost: 2 },
      { name: 'Diplomat’s Pack', cost: 39 },
      { name: 'Dungeoneer’s Pack', cost: 12 },
      { name: 'Entertainer’s Pack', cost: 40 },
      { name: 'Explorer’s Pack', cost: 10 },
      { name: 'Fine Clothes', cost: 15 },
      { name: 'Flask', cost: 0.02 },
      { name: 'Glass Bottle', cost: 2 },
      { name: 'Grappling Hook', cost: 2 },
      { name: 'Healer’s Kit', cost: 5 },
      { name: 'Holy Water', cost: 25 },
      { name: 'Hooded Lantern', cost: 5 },
      { name: 'Hunting Trap', cost: 5 },
      { name: 'Ink', cost: 10 },
      { name: 'Ink Pen', cost: 0.02 },
      { name: 'Iron Pot', cost: 2 },
      { name: 'Iron Spikes', cost: 1 },
      { name: 'Jug', cost: 0.02 },
      { name: 'Ladder', cost: 0.1 },
      { name: 'Lamp', cost: 0.5 },
      { name: 'Lock', cost: 10 },
      { name: 'Magnifying Glass', cost: 100 },
      { name: 'Manacles', cost: 2 },
      { name: 'Map', cost: 1 },
      { name: 'Map or Scroll Case', cost: 1 },
      { name: 'Mirror', cost: 5 },
      { name: 'Net', cost: 1 },
      { name: 'Oil', cost: 0.1 },
      { name: 'Paper', cost: 0.2 },
      { name: 'Parchment', cost: 0.1 },
      { name: 'Perfume', cost: 5 },
      { name: 'Pole', cost: 0.05 },
      { name: 'Portable Ram', cost: 4 },
      { name: 'Pouch', cost: 0.5 },
      { name: 'Priest’s Pack', cost: 33 },
      { name: 'Quiver', cost: 1 },
      { name: 'Rations', cost: 0.5 },
      { name: 'Robe', cost: 1 },
      { name: 'Rope', cost: 1 },
      { name: 'Sack', cost: 0.01 },
      { name: 'Scholar’s Pack', cost: 40 },
      { name: 'Shovel', cost: 2 },
      { name: 'Signal Whistle', cost: 0.05 },
      { name: 'Spyglass', cost: 1000 },
      { name: 'String', cost: 0.1 },
      { name: 'Tent', cost: 2 },
      { name: 'Tinderbox', cost: 0.5 },
      { name: 'Torch', cost: 0.01 },
      { name: 'Traveler’s Clothes', cost: 2 },
      { name: 'Vial', cost: 1 },
      { name: 'Waterskin', cost: 0.2 },
    ]),
    // Ammunition is priced per unit (the PHB sells bundles: 20 for 1 GP) so a
    // purchase row's qty × cost works and the names stack with the creation
    // packages' Arrow ×20 / Bolt ×20 grants. Firearm/sling bullets and needles
    // are omitted (never used).
    ...section('Ammunition', [
      { name: 'Arrow', cost: 0.05 },
      { name: 'Bolt', cost: 0.05 },
    ]),
    ...section('Arcane Focuses', [
      { name: 'Arcane Focus (Crystal)', cost: 10 },
      { name: 'Arcane Focus (Orb)', cost: 20 },
      { name: 'Arcane Focus (Rod)', cost: 10 },
      { name: 'Arcane Focus (Staff)', cost: 5 },
      { name: 'Arcane Focus (Wand)', cost: 10 },
    ]),
    ...section('Druidic Focuses', [
      { name: 'Druidic Focus (Sprig of Mistletoe)', cost: 1 },
      { name: 'Druidic Focus (Wooden Staff)', cost: 5 },
      { name: 'Druidic Focus (Yew Wand)', cost: 10 },
    ]),
    ...section('Holy Symbols', [
      { name: 'Holy Symbol (Amulet)', cost: 5 },
      { name: 'Holy Symbol (Emblem)', cost: 5 },
      { name: 'Holy Symbol (Reliquary)', cost: 5 },
    ]),
    ...section('Mounts and Other Animals', [
      { name: 'Camel', cost: 50 },
      { name: 'Draft Horse', cost: 50 },
      { name: 'Elephant', cost: 200 },
      { name: 'Mastiff', cost: 25 },
      { name: 'Mule', cost: 8 },
      { name: 'Pony', cost: 30 },
      { name: 'Riding Horse', cost: 75 },
      { name: 'Warhorse', cost: 400 },
    ]),
  ],
  // Costs are the AL standard by-rarity prices for consumables (half the DMG
  // magic item value): common 50, uncommon 200, rare 2,000, very rare 20,000,
  // legendary 100,000.
  consumable: [
    // Picking this opens the spell picker (see LogForm) instead of filling in a
    // rarity/cost directly — those come from the chosen spell's level.
    ...section('Spell Scroll', [{ name: 'Spell Scroll', cost: 0 }]),
    ...section('Common', [
      { name: 'Potion of Climbing', cost: 50, rarity: 'common' },
      { name: 'Potion of Comprehension', cost: 50, rarity: 'common' },
      { name: 'Potion of Healing', cost: 50, rarity: 'common' },
    ]),
    ...section('Uncommon', [
      { name: 'Oil of Slipperiness', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Animal Friendship', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Fire Breath', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Growth', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Healing (Greater)', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Hill Giant Strength', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Poison', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Pugilism', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Resistance', cost: 200, rarity: 'uncommon' },
      { name: 'Potion of Water Breathing', cost: 200, rarity: 'uncommon' },
    ]),
    ...section('Rare', [
      { name: 'Elixir of Health', cost: 2000, rarity: 'rare' },
      { name: 'Oil of Etherealness', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Clairvoyance', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Diminution', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Fire Giant Strength', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Frost Giant Strength', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Gaseous Form', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Healing (Superior)', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Heroism', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Invisibility', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Invulnerability', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Mind Reading', cost: 2000, rarity: 'rare' },
      { name: 'Potion of Stone Giant Strength', cost: 2000, rarity: 'rare' },
    ]),
    ...section('Very Rare', [
      { name: 'Oil of Sharpness', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Cloud Giant Strength', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Flying', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Greater Invisibility', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Healing (Supreme)', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Longevity', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Speed', cost: 20000, rarity: 'very rare' },
      { name: 'Potion of Vitality', cost: 20000, rarity: 'very rare' },
    ]),
    ...section('Legendary', [
      { name: 'Potion of Storm Giant Strength', cost: 100000, rarity: 'legendary' },
    ]),
  ],
};
