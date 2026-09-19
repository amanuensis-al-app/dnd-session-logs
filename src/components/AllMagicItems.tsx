import { useMemo, useRef, useState } from 'react';
import type { Character, DerivedStats, InventoryItem, Rarity } from '../types';
import { RARITIES } from '../types';
import { Modal } from './Modal';
import { IconTip } from './IconTip';
import { useScrollFade } from './useScrollFade';
import { highlight, MIN_QUERY_LENGTH } from '../searchHighlight';
import { tierForLevel } from '../tiers';

interface Props {
  /** Already in the character list's display order. */
  characters: Character[];
  derivedByCharacter: Map<string, DerivedStats>;
  onOpenCharacter: (characterId: string) => void;
  onClose: () => void;
}

interface Row {
  item: InventoryItem;
  owner: Character;
}

type GroupBy = 'rarity' | 'character';

const RARITY_ORDER: (Rarity | undefined)[] = [...RARITIES].reverse();

/**
 * "Show All Magic Items" on the Characters screen (added 2026-09-20): every magic
 * item currently owned (remaining > 0) across ALL characters in one list — handy
 * for planning trades between your own characters or checking who holds what.
 * Grouped by rarity (rarest first) or by character, with a search box; each row
 * names its owner, whose name opens that character's sheet. Read-only.
 */
export function AllMagicItems({ characters, derivedByCharacter, onOpenCharacter, onClose }: Props) {
  const [groupBy, setGroupBy] = useState<GroupBy>('rarity');
  const [search, setSearch] = useState('');
  // Unticking hides equipped items — e.g. to see what's spare / free to trade.
  const [includeEquipped, setIncludeEquipped] = useState(true);
  // Collapsed groups, keyed `${groupBy}:${group key}` so each view remembers its
  // own. Not persisted — resets whenever the modal reopens.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const query = search.trim().toLowerCase();
  const activeQuery = query.length >= MIN_QUERY_LENGTH ? query : '';

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const owner of characters) {
      for (const item of derivedByCharacter.get(owner.id)?.inventory ?? []) {
        if (item.category === 'magic_item') out.push({ item, owner });
      }
    }
    return out;
  }, [characters, derivedByCharacter]);

  const visible = rows.filter(
    ({ item, owner }) =>
      (includeEquipped || !owner.itemMarks?.[item.id]) &&
      (!activeQuery ||
        [item.name, item.description, item.minorProperty, owner.name]
          .filter(Boolean)
          .join('\n')
          .toLowerCase()
          .includes(activeQuery)),
  );
  const filtering = !!activeQuery || !includeEquipped;

  const byName = (a: Row, b: Row) => a.item.name.localeCompare(b.item.name);
  const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);

  const groups: { key: string; label: string; rows: Row[] }[] =
    groupBy === 'rarity'
      ? RARITY_ORDER.concat(undefined)
          .filter((r, i, all) => all.indexOf(r) === i)
          .map((rarity) => ({
            key: rarity ?? 'none',
            label: rarity ?? 'Rarity not set',
            rows: visible
              .filter(({ item }) => item.rarity === rarity)
              .sort((a, b) => byName(a, b) || a.owner.name.localeCompare(b.owner.name)),
          }))
      : characters.map((owner) => ({
          key: owner.id,
          label: owner.name,
          rows: visible
            .filter((r) => r.owner.id === owner.id)
            .sort((a, b) => rarityRank(b.item.rarity) - rarityRank(a.item.rarity) || byName(a, b)),
        }));

  const ownerCount = new Set(rows.map((r) => r.owner.id)).size;
  // Fade the list's top/bottom edge while there's more to scroll that way.
  const listRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollFade(listRef, [rows.length, visible.length, groupBy, collapsed, includeEquipped]);

  // While searching every group is shown open — a match hidden inside a collapsed
  // group would look like "no results".
  const isCollapsed = (key: string) => !activeQuery && collapsed.has(`${groupBy}:${key}`);
  function toggleGroup(key: string) {
    const id = `${groupBy}:${key}`;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal title="All Magic Items" className="all-items-modal" closeButton onClose={onClose}>
      {rows.length === 0 ? (
        <p className="muted">None of your characters own a magic item yet.</p>
      ) : (
        <>
          <p className="muted all-items-summary">
            {rows.length} magic item{rows.length === 1 ? '' : 's'} across {ownerCount} character
            {ownerCount === 1 ? '' : 's'}
            {filtering && ` · ${visible.length} shown`}
          </p>
          <div className="all-items-controls">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search item, description or character…"
              aria-label="Search magic items"
              autoFocus
            />
            <div className="tabs" role="group" aria-label="Group by">
              <button
                type="button"
                className={`tab${groupBy === 'rarity' ? ' active' : ''}`}
                onClick={() => setGroupBy('rarity')}
              >
                By Rarity
              </button>
              <button
                type="button"
                className={`tab${groupBy === 'character' ? ' active' : ''}`}
                onClick={() => setGroupBy('character')}
              >
                By Character
              </button>
            </div>
          </div>
          <div className="all-items-legend">
            <span className="muted">
              <span className="all-items-equipped">Underlined name</span> = equipped · ✧ requires
              attunement · ❋ minor property
            </span>
            <label className="all-items-check">
              <input
                type="checkbox"
                checked={includeEquipped}
                onChange={(e) => setIncludeEquipped(e.target.checked)}
              />
              Include equipped
            </label>
          </div>
          <div ref={listRef} className={`all-items-list scroll-fade${fadeClass}`}>
            {visible.length === 0 && (
              <p className="muted">
                {activeQuery ? 'No magic items match.' : 'Every magic item is equipped.'}
              </p>
            )}
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <section key={g.key} className="all-items-group">
                  {/* Groups take a color for their heading text AND trailing rule
                     (via currentColor): the rarity's color, or the character's
                     tier color (same scale as the character cards' borders). */}
                  <h3
                    className={`all-items-group-heading${
                      groupBy === 'rarity'
                        ? ` all-items-rarity-label${
                            g.key === 'none' ? '' : ` rarity-${g.key.replace(' ', '-')}`
                          }`
                        : ` all-items-tier-${tierForLevel(derivedByCharacter.get(g.key)?.level ?? 1)}`
                    }`}
                  >
                    <button
                      type="button"
                      className="all-items-group-toggle"
                      onClick={() => toggleGroup(g.key)}
                      aria-expanded={!isCollapsed(g.key)}
                    >
                      <span
                        className={`chevron${isCollapsed(g.key) ? ' chevron-collapsed' : ''}`}
                        aria-hidden="true"
                      >
                        ▾
                      </span>
                      <span>{g.label}</span>
                      <span className="all-items-group-count">{g.rows.length}</span>
                    </button>
                  </h3>
                  {!isCollapsed(g.key) && (
                    <>
                      <ul className="inventory-items">
                        {g.rows.map(({ item, owner }) => {
                          const equipped = !!owner.itemMarks?.[item.id];
                          return (
                            <li key={`${owner.id}:${item.id}`} className="inventory-item">
                              <div className="inventory-item-main">
                                {/* Equipped = the name gets a soft gold underline (no icon). */}
                                <span
                                  className={`inventory-item-name${
                                    equipped ? ' all-items-equipped' : ''
                                  }`}
                                  title={equipped ? 'Equipped' : undefined}
                                >
                                  {highlight(item.name, activeQuery)}
                                  {item.remaining > 1 && (
                                    <span className="muted"> ×{item.remaining}</span>
                                  )}
                                </span>
                                {groupBy === 'character' && item.rarity && (
                                  <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>
                                    {item.rarity}
                                  </span>
                                )}
                                <span className="all-items-icons">
                                  {/* Only whether the item needs attunement — who is actually
                                     attuned is a Prep concern, not this who-owns-what list. */}
                                  {(item.requiresAttunement ?? true) && (
                                    <IconTip icon="✧" label="Requires attunement" />
                                  )}
                                </span>
                                {item.minorProperty && (
                                  <span
                                    className="all-items-minor"
                                    title={`Minor property: ${item.minorProperty}`}
                                  >
                                    ❋ {highlight(item.minorProperty, activeQuery)}
                                  </span>
                                )}
                                {/* Right edge: (By Rarity) the owner. */}
                                <span className="all-items-right">
                                  {groupBy === 'rarity' && (
                                    <button
                                      type="button"
                                      className="all-items-owner"
                                      onClick={() => onOpenCharacter(owner.id)}
                                      title={`Open ${owner.name}`}
                                    >
                                      {highlight(owner.name, activeQuery)}
                                    </button>
                                  )}
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      {groupBy === 'character' && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-small all-items-open"
                          onClick={() => onOpenCharacter(g.key)}
                        >
                          Open {g.label} →
                        </button>
                      )}
                    </>
                  )}
                </section>
              ))}
          </div>
        </>
      )}
    </Modal>
  );
}
