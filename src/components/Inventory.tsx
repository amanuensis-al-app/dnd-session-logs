import type { Character, DerivedStats, InventoryItem, ItemCategory, LogEntry } from '../types';
import { CATEGORY_LABELS, ITEM_CATEGORIES, STACKED_CATEGORIES, newId } from '../types';

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

  const byCategory = new Map<ItemCategory, InventoryItem[]>();
  for (const item of derived.inventory) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  if (derived.inventory.length === 0) {
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
                        <span className="muted"> ×{item.remaining}</span>
                      ) : null}
                    </span>
                    {item.rarity && <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>{item.rarity}</span>}
                    {USABLE.includes(category) && (
                      <button className="chip" onClick={() => useItem(item)}>
                        Use
                      </button>
                    )}
                  </div>
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
