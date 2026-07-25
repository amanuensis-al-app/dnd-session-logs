import { useState } from 'react';
import type { Character, DerivedStats, InventoryItem, ItemCategory, Rarity } from '../types';
import {
  CATEGORY_LABELS,
  EQUIPPABLE_CATEGORIES,
  ITEM_CATEGORIES,
  RARITIES,
  STACKED_CATEGORIES,
} from '../types';
import { ItemEditModal, type ItemEditChanges } from './ItemEditModal';
import { spellLevelLabel } from '../spells';
import { highlight, MIN_QUERY_LENGTH } from '../searchHighlight';
import { itemSearchText } from '../itemSearch';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** Toggles an item's equipped mark on/off. */
  onToggleMark: (itemId: string) => void;
  /** Saves edits to an item (name/rarity/description/minor property/attunement) —
   * written back to its source log(s). */
  onEditItem: (item: InventoryItem, changes: ItemEditChanges) => void;
}

export function Inventory({ character, derived, onToggleMark, onEditItem }: Props) {
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  // Which category sections are collapsed. Local to this mount (like LogForm's own
  // minimise state) — the Inventory tab unmounts when you switch away, so this resets
  // on return; harmless since nothing here is unsaved draft data.
  const [collapsed, setCollapsed] = useState<Set<ItemCategory>>(new Set());
  function toggleCollapsed(category: ItemCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }
  // Full-text search across name, description, minor property, category, rarity,
  // spell level, and copied-from partner — see itemSearchText.
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const activeQuery = query.length >= MIN_QUERY_LENGTH ? query : '';

  // remaining < 0 means more was lost/used than ever gained — an invalid log somewhere.
  // Show those with a warning instead of hiding them, so the user can find and fix it.
  const visibleItems = derived.allItems.filter((i) => i.remaining !== 0);
  const matchedItems = activeQuery
    ? visibleItems.filter((i) => itemSearchText(i).includes(activeQuery))
    : visibleItems;

  const byCategory = new Map<ItemCategory, InventoryItem[]>();
  for (const item of matchedItems) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  // Within a section: equipped first, then valid items before negative ones,
  // then rarest first, then name. Equipment/Story Awards can't be equipped (see
  // EQUIPPABLE_CATEGORIES) so a stray mark on one is never ranked first.
  const markRank = (item: InventoryItem) =>
    EQUIPPABLE_CATEGORIES.includes(item.category) && character.itemMarks?.[item.id] ? 0 : 1;
  const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);
  for (const list of byCategory.values()) {
    list.sort(
      (a, b) =>
        markRank(a) - markRank(b) ||
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

  const searchBar = (
    <div className="search-bar">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search inventory — name, description, category…"
        aria-label="Search inventory"
      />
      {search && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setSearch('')}>
          ✕ Clear
        </button>
      )}
      {query && !activeQuery && (
        <span className="muted search-hint">Keep typing… ({MIN_QUERY_LENGTH}+ characters)</span>
      )}
    </div>
  );

  return (
    <div className="inventory">
      {searchBar}
      {activeQuery && (
        <p className="muted search-summary">
          {matchedItems.length} of {visibleItems.length} items match
        </p>
      )}
      {activeQuery && matchedItems.length === 0 && (
        <div className="empty-state">
          <p>No items match "{search.trim()}".</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      )}
      {ITEM_CATEGORIES.map((category) => {
        const items = byCategory.get(category);
        if (!items?.length) return null;
        // Force sections open while actively searching, so a match hiding behind
        // a manually-collapsed section is never invisible.
        const isCollapsed = !activeQuery && collapsed.has(category);
        return (
          <section key={category} className="card inventory-section">
            <h2>
              <button
                type="button"
                className="inventory-section-toggle"
                onClick={() => toggleCollapsed(category)}
                title={isCollapsed ? 'Expand' : 'Collapse'}
              >
                <span className={`chevron${isCollapsed ? ' chevron-collapsed' : ''}`}>▾</span>
                {CATEGORY_LABELS[category]} <span className="muted">({items.length})</span>
              </button>
            </h2>
            {!isCollapsed && (
            <ul className="inventory-items">
              {items.map((item) => {
                const equippable = EQUIPPABLE_CATEGORIES.includes(item.category);
                const marked = equippable && !!character.itemMarks?.[item.id];
                return (
                  <li key={item.id} className="inventory-item">
                    <div className="inventory-item-main">
                      <span className="inventory-item-name">
                        {highlight(item.name, activeQuery)}
                        {item.quantity > 1 || item.remaining !== item.quantity ? (
                          <span className={item.remaining < 0 ? 'delta-loss' : 'muted'}>
                            {' '}
                            ×{item.remaining}
                          </span>
                        ) : null}
                      </span>
                      {item.rarity && <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>{item.rarity}</span>}
                      {item.spellLevel != null && (
                        <span className="muted">{spellLevelLabel(item.spellLevel)} level</span>
                      )}
                      {item.remaining > 0 && equippable && (
                        <button
                          className={`equip-toggle${marked ? ' mark-equipped' : ''}`}
                          title={marked ? 'Equipped — click to unequip' : 'Mark as equipped'}
                          onClick={() => onToggleMark(item.id)}
                        >
                          ⚔️
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-small"
                        title="Edit this item"
                        onClick={() => setEditing(item)}
                      >
                        ✎
                      </button>
                    </div>
                    {item.remaining < 0 && (
                      <div className="warning inventory-item-warning">
                        ⚠ Negative quantity: {-item.remaining} more lost/used than ever gained.
                        There is an invalid log — check this item's gains and losses.
                      </div>
                    )}
                    {item.description && (
                      <div className="inventory-item-desc muted">
                        {highlight(item.description, activeQuery)}
                      </div>
                    )}
                    {item.minorProperty && (
                      <div className="inventory-item-desc muted">
                        Minor property: {highlight(item.minorProperty, activeQuery)}
                      </div>
                    )}
                    {!STACKED_CATEGORIES.includes(category) && (
                      <div className="inventory-item-meta muted">Acquired {item.acquiredDate}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        );
      })}
      {editing && (
        <ItemEditModal
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(changes) => {
            onEditItem(editing, changes);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
