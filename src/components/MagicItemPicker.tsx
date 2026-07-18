import { useMemo, useState } from 'react';
import { KNOWN_MAGIC_ITEMS, type KnownMagicItem } from '../data/magicItems';
import { Modal } from './Modal';

interface Props {
  onPick: (item: KnownMagicItem) => void;
  onClose: () => void;
}

/** How many matches render at most — the full list is ~1000 entries, so an empty
 * search shows only the first few and asks for a query instead. */
const EMPTY_QUERY_SHOWN = 50;
const MAX_SHOWN = 100;

/** Search-and-pick modal for a magic item from the 5e.tools list. Closing without
 * picking (Escape, backdrop click, or Cancel) leaves the row's name as it was —
 * the user can still type it by hand. */
export function MagicItemPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState('');

  const { results, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? KNOWN_MAGIC_ITEMS.filter((i) => i.name.toLowerCase().includes(q))
      : KNOWN_MAGIC_ITEMS;
    const cap = q ? MAX_SHOWN : EMPTY_QUERY_SHOWN;
    return { results: matches.slice(0, cap), total: matches.length };
  }, [query]);

  return (
    <Modal title="Pick a Magic Item" onClose={onClose}>
      <p className="muted">
        Fills in the item's name, rarity and attunement requirement from the 5e.tools list.
      </p>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search magic items…"
      />
      <div className="spell-picker-list">
        {results.map((item) => (
          <button
            key={item.name}
            type="button"
            className="spell-picker-item"
            onClick={() => onPick(item)}
          >
            <span>{item.name}</span>
            <span className="muted">
              {item.rarity} · {item.requiresAttunement ? 'attunement' : 'no attunement'}
              {item.generic ? ' · template' : ''}
            </span>
          </button>
        ))}
        {results.length === 0 && <p className="muted">No magic items match "{query}".</p>}
        {total > results.length && (
          <p className="muted">…and {total - results.length} more — keep typing to narrow it down.</p>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
