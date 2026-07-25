import type { InventoryItem } from './types';
import { CATEGORY_LABELS_SINGULAR } from './types';
import { spellLevelLabel } from './spells';

/** Everything an inventory item can be found by: name, description, minor
 * property, category, rarity, spell level (for Copied Spells), and who a
 * player-copied spell came from. Shared by Inventory and Prep's search boxes. */
export function itemSearchText(item: InventoryItem): string {
  const parts: string[] = [
    item.name,
    item.description ?? '',
    item.minorProperty ?? '',
    CATEGORY_LABELS_SINGULAR[item.category],
    item.rarity ?? '',
  ];
  if (item.spellLevel != null) parts.push(spellLevelLabel(item.spellLevel));
  if (item.copiedFrom?.partner) parts.push(item.copiedFrom.partner);
  return parts.join('\n').toLowerCase();
}
