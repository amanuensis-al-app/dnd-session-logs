import type { Character, DerivedStats, InventoryItem, ItemCategory, LogEntry, Rarity } from '../types';
import { CATEGORY_LABELS, ITEM_CATEGORIES, RARITIES, STACKED_CATEGORIES, newId } from '../types';

interface Props {
  character: Character;
  derived: DerivedStats;
  onSaveLog: (log: LogEntry) => void;
}

/** Categories where a one-click "use up" action makes sense. */
const USABLE: ItemCategory[] = ['consumable', 'charm', 'story_award'];

export function Inventory({ character, derived, onSaveLog }: Props) {
  function useItem(item: InventoryItem) {
    if (!confirm(`Use 1 × ${item.name}? A Free Log recording the use will be added.`)) return;
    onSaveLog({
      id: newId(),
      characterId: character.id,
      type: 'free',
      date: new Date().toISOString().slice(0, 10),
      title: `Used ${item.name}`,
      gpGained: 0,
      gpLost: 0,
      downtimeGained: 0,
      downtimeSpent: 0,
      levelGained: 0,
      itemsGained: [],
      itemsLost: [{ itemId: item.id, quantity: 1, reason: 'used' }],
      createdAt: Date.now(),
    });
  }

  // remaining < 0 means more was lost/used than ever gained — an invalid log somewhere.
  // Show those with a warning instead of hiding them, so the user can find and fix it.
  const visibleItems = derived.allItems.filter((i) => i.remaining !== 0);

  const byCategory = new Map<ItemCategory, InventoryItem[]>();
  for (const item of visibleItems) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  // Within a section: valid items before negative ones, then rarest first, then name.
  const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);
  for (const list of byCategory.values()) {
    list.sort(
      (a, b) =>
        (a.remaining < 0 ? 1 : 0) - (b.remaining < 0 ? 1 : 0) ||
        rarityRank(b.rarity) - rarityRank(a.rarity) ||
        a.name.localeCompare(b.name),
    );
  }

  if (visibleItems.length === 0) {
    return (
      <div className="empty-state">
        <p>Nothing in the inventory yet.</p>
        <p className="muted">Items appear here when logs grant them.</p>
      </div>
    );
  }

  return (
    <div className="inventory">
      {ITEM_CATEGORIES.map((category) => {
        const items = byCategory.get(category);
        if (!items?.length) return null;
        return (
          <section key={category} className="card inventory-section">
            <h2>
              {CATEGORY_LABELS[category]} <span className="muted">({items.length})</span>
            </h2>
            <ul className="inventory-items">
              {items.map((item) => (
                <li key={item.id} className="inventory-item">
                  <div className="inventory-item-main">
                    <span className="inventory-item-name">
                      {item.name}
                      {item.quantity > 1 || item.remaining !== item.quantity ? (
                        <span className={item.remaining < 0 ? 'delta-loss' : 'muted'}>
                          {' '}
                          ×{item.remaining}
                        </span>
                      ) : null}
                    </span>
                    {item.rarity && <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>{item.rarity}</span>}
                    {USABLE.includes(category) && item.remaining > 0 && (
                      <button className="chip" onClick={() => useItem(item)}>
                        Use
                      </button>
                    )}
                  </div>
                  {item.remaining < 0 && (
                    <div className="warning inventory-item-warning">
                      ⚠ Negative quantity: {-item.remaining} more lost/used than ever gained.
                      There is an invalid log — check this item's gains and losses.
                    </div>
                  )}
                  {item.description && <div className="inventory-item-desc muted">{item.description}</div>}
                  {!STACKED_CATEGORIES.includes(category) && (
                    <div className="inventory-item-meta muted">Acquired {item.acquiredDate}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
