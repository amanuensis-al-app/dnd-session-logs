import type { GainedItem } from './types';
import { stackedItemId } from './types';

/**
 * 2024 PHB "Packs": one Adventuring Gear entry in ITEM_CATALOG.equipment (catalog.ts)
 * that actually bundles several other equipment items. The pack itself is never kept
 * as an inventory item — gaining one, by any path (LogForm's dropdown or manual name
 * entry, a session/purchase/free log, or any import), unpacks it into its contents.
 * Names must match ITEM_CATALOG.equipment exactly (including the curly apostrophe) so
 * a manual catalog cross-check would find them; matching against user/import text goes
 * through the normalized lookup below instead, so spelling/case/punctuation variants
 * still resolve. Constituent item names also match the catalog exactly, so they stack
 * with anything else of the same name.
 */
export const PACKS: Record<string, { name: string; quantity: number }[]> = {
  'Burglar’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Ball Bearings', quantity: 1 },
    { name: 'Bell', quantity: 1 },
    { name: 'Candle', quantity: 10 },
    { name: 'Crowbar', quantity: 1 },
    { name: 'Hooded Lantern', quantity: 1 },
    { name: 'Oil', quantity: 7 },
    { name: 'Rations', quantity: 5 },
    { name: 'Rope', quantity: 1 },
    { name: 'Tinderbox', quantity: 1 },
    { name: 'Waterskin', quantity: 1 },
  ],
  'Diplomat’s Pack': [
    { name: 'Chest', quantity: 1 },
    { name: 'Fine Clothes', quantity: 1 },
    { name: 'Ink', quantity: 1 },
    { name: 'Ink Pen', quantity: 5 },
    { name: 'Lamp', quantity: 1 },
    { name: 'Map or Scroll Case', quantity: 2 },
    { name: 'Oil', quantity: 4 },
    { name: 'Paper', quantity: 5 },
    { name: 'Parchment', quantity: 5 },
    { name: 'Perfume', quantity: 1 },
    { name: 'Tinderbox', quantity: 1 },
  ],
  'Dungeoneer’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Caltrops', quantity: 1 },
    { name: 'Crowbar', quantity: 1 },
    { name: 'Oil', quantity: 2 },
    { name: 'Rations', quantity: 10 },
    { name: 'Rope', quantity: 1 },
    { name: 'Tinderbox', quantity: 1 },
    { name: 'Torch', quantity: 10 },
    { name: 'Waterskin', quantity: 1 },
  ],
  'Entertainer’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Bedroll', quantity: 1 },
    { name: 'Bell', quantity: 1 },
    { name: 'Bullseye Lantern', quantity: 1 },
    { name: 'Costume', quantity: 3 },
    { name: 'Mirror', quantity: 1 },
    { name: 'Oil', quantity: 8 },
    { name: 'Rations', quantity: 9 },
    { name: 'Tinderbox', quantity: 1 },
    { name: 'Waterskin', quantity: 1 },
  ],
  'Explorer’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Bedroll', quantity: 1 },
    { name: 'Oil', quantity: 2 },
    { name: 'Rations', quantity: 10 },
    { name: 'Rope', quantity: 1 },
    { name: 'Tinderbox', quantity: 1 },
    { name: 'Torch', quantity: 10 },
    { name: 'Waterskin', quantity: 1 },
  ],
  'Priest’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Blanket', quantity: 1 },
    { name: 'Holy Water', quantity: 1 },
    { name: 'Lamp', quantity: 1 },
    { name: 'Rations', quantity: 7 },
    { name: 'Robe', quantity: 1 },
    { name: 'Tinderbox', quantity: 1 },
  ],
  'Scholar’s Pack': [
    { name: 'Backpack', quantity: 1 },
    { name: 'Book', quantity: 1 },
    { name: 'Ink', quantity: 1 },
    { name: 'Ink Pen', quantity: 1 },
    { name: 'Lamp', quantity: 1 },
    { name: 'Oil', quantity: 10 },
    { name: 'Parchment', quantity: 10 },
    { name: 'Tinderbox', quantity: 1 },
  ],
};

/** name.toLowerCase() with punctuation/whitespace stripped, so "Burglar's Pack",
 * "burglars pack" and the catalog's own "Burglar’s Pack" all resolve the same way —
 * same normalization approach as importAlLog.ts's normalizeKey, kept local here so
 * this stays a leaf module the import paths can depend on. */
function normalizePackKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PACKS_BY_KEY = new Map(
  Object.entries(PACKS).map(([name, contents]) => [normalizePackKey(name), contents] as const),
);

/**
 * Replace any Pack gains with their contents (each constituent's quantity multiplied
 * by how many packs were gained), dropping the pack itself — packs are never kept as
 * an inventory item. Everything else — including ordinary equipment rows, with their
 * cost/description intact — passes through completely untouched (same object), so
 * this is safe to run unconditionally over every gains array.
 *
 * Pack CONTENTS from different packs (or the same pack bought more than once) DO get
 * merged into one stack apiece — Tinderbox turns up in nearly every pack, so buying
 * two different packs in one log would otherwise produce two separate "Tinderbox ×1"
 * rows instead of one "Tinderbox ×2". Pack contents never carry cost/description (the
 * PHB gives packs one bundle price, not a per-item breakdown), so this merge can't
 * lose anything. It deliberately does NOT reach into non-pack rows in the same gains
 * array — an ordinary hand-added "Tinderbox" row stays separate from a pack's, so its
 * cost/description are never at risk of being merged away.
 */
export function expandPacks(items: GainedItem[]): GainedItem[] {
  const result: GainedItem[] = [];
  const packContentIndex = new Map<string, number>();

  for (const item of items) {
    const contents = item.category === 'equipment' ? PACKS_BY_KEY.get(normalizePackKey(item.name)) : undefined;
    if (!contents) {
      result.push(item);
      continue;
    }
    for (const content of contents) {
      const quantity = content.quantity * item.quantity;
      const id = stackedItemId({ category: 'equipment', name: content.name });
      const at = packContentIndex.get(id);
      if (at !== undefined) result[at].quantity += quantity;
      else {
        packContentIndex.set(id, result.length);
        result.push({ id, name: content.name, category: 'equipment', quantity });
      }
    }
  }

  return result;
}
