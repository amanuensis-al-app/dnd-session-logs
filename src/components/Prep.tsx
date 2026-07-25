import { useState } from 'react';
import type { AttunementState, Character, DerivedStats, InventoryItem, Rarity } from '../types';
import { EQUIPPABLE_CATEGORIES, RARITIES } from '../types';
import {
  ATTUNEMENT_CAP,
  PREP_POOL_LABELS,
  PREP_POOL_ORDER,
  prepLimit,
  prepPoolOf,
  tierForLevel,
  type PrepPool,
} from '../tiers';
import { highlight, MIN_QUERY_LENGTH } from '../searchHighlight';
import { itemSearchText } from '../itemSearch';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** Toggles an item's equipped mark on/off — fills/empties a slot. */
  onToggleMark: (itemId: string) => void;
  /** Sets (or clears, if undefined) a magic item's attunement state. */
  onSetAttunement: (itemId: string, state: AttunementState | undefined) => void;
  /** Sets how many units of an equipped consumable stack are prepped (undefined =
   * the whole stack). */
  onSetEquipQuantity: (itemId: string, quantity: number | undefined) => void;
}

const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);
const byRarityThenName = (a: InventoryItem, b: InventoryItem) =>
  rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name);

const MAGIC_ITEM_POOLS: PrepPool[] = ['magicItemUncommonPlus', 'magicItemCommon'];

/** Pools where stacked items prep per-UNIT, each unit counting toward the pool's
 * used number (equipment's count is informational only — its pool is uncapped). */
const QUANTITY_POOLS: PrepPool[] = ['consumable', 'equipment'];

/**
 * AL carry limits, tier-gated: fixed slots per pool (Magic Items split Uncommon+ /
 * Common, plus Consumables / Blessings / Charms / Boons — see tiers.ts); Equipment
 * is the one UNCAPPED pool (weight is the real AL limit, untracked here), so it
 * shows a plain count and always offers one empty slot. Filled
 * slots show the equipped item with an unequip toggle; a character under their limit
 * gets empty slots, each a dropdown to pick any owned-but-unequipped item of that
 * pool straight into it. Equipping past the limit (e.g. from the Inventory tab) is
 * never blocked — Prep just flags the pool as over, same "warn don't block"
 * philosophy as the rest of the app (negative-quantity items, downtime overspend).
 *
 * Magic items (both pools) also get an attunement dropdown when the item requires
 * attunement (its own `requiresAttunement` property — set from the Inventory tab or
 * the log form): Not Attuned / Attuned. The "Attuned" option is disabled once the
 * character hits the shared 3-item cap (ATTUNEMENT_CAP in tiers.ts), so it can be
 * seen but not selected, same "cannot be selected" behavior for whichever item
 * would push the count over the cap. Items that don't require attunement show a
 * static "Attunement Not Required" tag instead of the dropdown.
 *
 * Consumable and Equipment stacks prep by QUANTITY, not per stack: an equipped
 * stack shows a quantity picker (1…remaining; default the whole stack, stored
 * sparsely in Character.equipQuantities) and counts that many toward the pool's
 * used number — prepping 3 of 5 potions uses 3 consumable slots. Equipment's
 * count is informational only, its pool being uncapped.
 */
export function Prep({ character, derived, onToggleMark, onSetAttunement, onSetEquipQuantity }: Props) {
  const tier = tierForLevel(derived.level);

  // Full-text search, same fields/threshold as Inventory (see itemSearch.ts).
  // Display only: (1) non-matching equipped rows are hidden (matches are shown,
  // highlighted), and (2) each empty slot's pick list is narrowed to matches. The
  // pool header's used/limit count and the over-limit warning are computed off the
  // TRUE equipped set below, unaffected by search — a hidden item still holds its
  // slot for real, so those numbers must never lie.
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const activeQuery = query.length >= MIN_QUERY_LENGTH ? query : '';
  const matches = (item: InventoryItem) => !activeQuery || itemSearchText(item).includes(activeQuery);

  // Equipment/Story Awards can't carry an equip mark at all (see EQUIPPABLE_CATEGORIES);
  // depleted items (remaining = 0) aren't something you can prep either.
  const pools = new Map<PrepPool, { equipped: InventoryItem[]; available: InventoryItem[] }>();
  for (const pool of PREP_POOL_ORDER) pools.set(pool, { equipped: [], available: [] });
  for (const item of derived.inventory) {
    if (!EQUIPPABLE_CATEGORIES.includes(item.category)) continue;
    const pool = prepPoolOf(item.category, item.rarity);
    if (!pool) continue;
    const bucket = pools.get(pool)!;
    (character.itemMarks?.[item.id] ? bucket.equipped : bucket.available).push(item);
  }
  for (const bucket of pools.values()) {
    bucket.equipped.sort(byRarityThenName);
    bucket.available.sort(byRarityThenName);
  }

  // How many units of an equipped stack are prepped — the stored value clamped to
  // what's actually owned (losses can shrink a stack below it), default the whole
  // stack. Pools outside QUANTITY_POOLS always spend 1 slot per equipped item.
  const preparedOf = (item: InventoryItem) =>
    Math.min(character.equipQuantities?.[item.id] ?? item.remaining, item.remaining);
  const slotsUsed = (pool: PrepPool, equipped: InventoryItem[]) =>
    QUANTITY_POOLS.includes(pool)
      ? equipped.reduce((sum, i) => sum + preparedOf(i), 0)
      : equipped.length;

  // Shared across both magic item pools — a character is attuned to at most
  // ATTUNEMENT_CAP items total, regardless of rarity. Only items that require
  // attunement can hold a cap slot; a stray 'attuned' mark on a not-required item
  // (flag flipped after attuning) doesn't count.
  const attunedCount = MAGIC_ITEM_POOLS.reduce(
    (sum, pool) =>
      sum +
      pools
        .get(pool)!
        .equipped.filter(
          (i) => (i.requiresAttunement ?? true) && character.attunement?.[i.id] === 'attuned',
        ).length,
    0,
  );

  // For the search summary line only — doesn't affect slot counts/limits.
  let matchedEquippedCount = 0;
  let matchedAvailableCount = 0;
  if (activeQuery) {
    for (const { equipped, available } of pools.values()) {
      matchedEquippedCount += equipped.filter(matches).length;
      matchedAvailableCount += available.filter(matches).length;
    }
  }

  return (
    <div className="inventory">
      <div className="search-bar">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prepped gear — name, description, category…"
          aria-label="Search prep"
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
      {activeQuery && (
        <p className="muted search-summary">
          {matchedEquippedCount} equipped, {matchedAvailableCount} owned-but-unequipped match
        </p>
      )}
      <p className="muted prep-tier">
        Tier {tier} · Level {derived.level} · Attunement {attunedCount}/{ATTUNEMENT_CAP}
      </p>
      {PREP_POOL_ORDER.map((pool) => {
        const limit = prepLimit(tier, pool);
        const { equipped, available: allAvailable } = pools.get(pool)!;
        const available = activeQuery ? allAvailable.filter(matches) : allAvailable;
        if (limit === 0 && equipped.length === 0) return null;
        // Equipment is uncapped: it can never go over, and there is always one
        // empty slot to add the next piece of gear.
        const unlimited = !Number.isFinite(limit);
        // Used/limit/over-limit math always reflects the TRUE equipped set, never
        // the search — a hidden non-matching item still occupies its slot, and the
        // header count and warning must stay honest even while filtering the list.
        const used = slotsUsed(pool, equipped);
        const emptySlots = unlimited ? 1 : Math.max(0, limit - used);
        const overBy = unlimited ? 0 : Math.max(0, used - limit);
        const isMagicItemPool = MAGIC_ITEM_POOLS.includes(pool);
        const isQuantityPool = QUANTITY_POOLS.includes(pool);
        // Display only: non-matching equipped rows are hidden while searching (the
        // header/warning above still count them). A pool with nothing relevant —
        // no matching equipped row, no matching item to fill an empty slot, and no
        // over-limit warning to show — disappears entirely instead of showing an
        // empty shell.
        const equippedToShow = activeQuery ? equipped.filter(matches) : equipped;
        // While searching, only show as many empty slots as there are matching
        // items to fill them with — an empty slot whose dropdown would offer
        // nothing relevant is just noise.
        const emptySlotsToShow = activeQuery ? Math.min(emptySlots, available.length) : emptySlots;
        if (activeQuery && equippedToShow.length === 0 && available.length === 0 && overBy === 0) {
          return null;
        }
        return (
          <section key={pool} className="card inventory-section">
            <h2>
              {PREP_POOL_LABELS[pool]}{' '}
              <span className="muted">
                ({used}
                {unlimited ? '' : `/${limit}`})
              </span>
            </h2>
            {overBy > 0 && (
              <div className="warning prep-over-limit">
                ⚠ {used} equipped but Tier {tier} only allows {limit} — unequip {overBy} to
                fix.
              </div>
            )}
            <ul className="inventory-items prep-slots">
              {equippedToShow.map((item) => {
                const attuned = character.attunement?.[item.id] === 'attuned';
                const requiresAttunement = item.requiresAttunement ?? true;
                const prepared = preparedOf(item);
                return (
                  <li key={item.id} className="inventory-item">
                    <div className="inventory-item-main">
                      <span className="inventory-item-name">
                        {highlight(item.name, activeQuery)}
                        {isQuantityPool && item.remaining > 1 ? (
                          <>
                            {' '}
                            <select
                              className="prep-qty-select"
                              value={prepared}
                              title="How many to prepare (each takes a slot)"
                              onChange={(e) => {
                                const q = Number(e.target.value);
                                onSetEquipQuantity(item.id, q >= item.remaining ? undefined : q);
                              }}
                            >
                              {Array.from({ length: item.remaining }, (_, i) => i + 1).map((q) => (
                                <option key={q} value={q}>
                                  {q}
                                </option>
                              ))}
                            </select>
                            <span className="muted"> of ×{item.remaining}</span>
                          </>
                        ) : (
                          item.remaining > 1 && <span className="muted"> ×{item.remaining}</span>
                        )}
                      </span>
                      {item.rarity && (
                        <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>
                          {item.rarity}
                        </span>
                      )}
                      {isMagicItemPool &&
                        (requiresAttunement ? (
                          <select
                            className={`attune-select${attuned ? ' attune-attuned' : ''}`}
                            value={attuned ? 'attuned' : ''}
                            onChange={(e) =>
                              onSetAttunement(
                                item.id,
                                (e.target.value || undefined) as AttunementState | undefined,
                              )
                            }
                          >
                            <option value="">Not Attuned</option>
                            <option
                              value="attuned"
                              disabled={!attuned && attunedCount >= ATTUNEMENT_CAP}
                            >
                              Attuned
                            </option>
                          </select>
                        ) : (
                          <span className="attune-select attune-not-required">
                            Attunement Not Required
                          </span>
                        ))}
                      <button
                        className="equip-toggle mark-equipped"
                        title="Equipped — click to unequip"
                        onClick={() => onToggleMark(item.id)}
                      >
                        ⚔️
                      </button>
                    </div>
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
                  </li>
                );
              })}
              {Array.from({ length: emptySlotsToShow }).map((_, i) => (
                <li key={`empty-${i}`} className="inventory-item prep-slot-empty">
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value) onToggleMark(e.target.value);
                    }}
                  >
                    <option value="">— empty slot —</option>
                    {available.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.rarity ? ` (${item.rarity})` : ''}
                        {item.remaining > 1 ? ` ×${item.remaining}` : ''}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
