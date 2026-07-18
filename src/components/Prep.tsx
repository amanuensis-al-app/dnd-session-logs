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

interface Props {
  character: Character;
  derived: DerivedStats;
  /** Toggles an item's equipped mark on/off — fills/empties a slot. */
  onToggleMark: (itemId: string) => void;
  /** Sets (or clears, if undefined) a magic item's attunement state. */
  onSetAttunement: (itemId: string, state: AttunementState | undefined) => void;
}

const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);
const byRarityThenName = (a: InventoryItem, b: InventoryItem) =>
  rarityRank(b.rarity) - rarityRank(a.rarity) || a.name.localeCompare(b.name);

const MAGIC_ITEM_POOLS: PrepPool[] = ['magicItemUncommonPlus', 'magicItemCommon'];

/**
 * AL carry limits, tier-gated: fixed slots per pool (Magic Items split Uncommon+ /
 * Common, plus Consumables / Blessings / Charms / Boons — see tiers.ts). Filled
 * slots show the equipped item with an unequip toggle; a character under their limit
 * gets empty slots, each a dropdown to pick any owned-but-unequipped item of that
 * pool straight into it. Equipping past the limit (e.g. from the Inventory tab) is
 * never blocked — Prep just flags the pool as over, same "warn don't block"
 * philosophy as the rest of the app (negative-quantity items, downtime overspend).
 *
 * Magic items (both pools) also get an attunement dropdown (Not Attuned / Attuned /
 * Attunement Not Required) — the "Attuned" option is disabled once the character
 * hits the shared 3-item cap (ATTUNEMENT_CAP in tiers.ts), so it can be seen but not
 * selected, same "cannot be selected" behavior for whichever item would push the
 * count over the cap.
 */
export function Prep({ character, derived, onToggleMark, onSetAttunement }: Props) {
  const tier = tierForLevel(derived.level);

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

  // Shared across both magic item pools — a character is attuned to at most
  // ATTUNEMENT_CAP items total, regardless of rarity.
  const attunedCount = MAGIC_ITEM_POOLS.reduce(
    (sum, pool) =>
      sum + pools.get(pool)!.equipped.filter((i) => character.attunement?.[i.id] === 'attuned').length,
    0,
  );

  return (
    <div className="inventory">
      <p className="muted prep-tier">
        Tier {tier} · Level {derived.level} · Attunement {attunedCount}/{ATTUNEMENT_CAP}
      </p>
      {PREP_POOL_ORDER.map((pool) => {
        const limit = prepLimit(tier, pool);
        const { equipped, available } = pools.get(pool)!;
        if (limit === 0 && equipped.length === 0) return null;
        const emptySlots = Math.max(0, limit - equipped.length);
        const overBy = Math.max(0, equipped.length - limit);
        const isMagicItemPool = MAGIC_ITEM_POOLS.includes(pool);
        return (
          <section key={pool} className="card inventory-section">
            <h2>
              {PREP_POOL_LABELS[pool]}{' '}
              <span className="muted">
                ({equipped.length}/{limit})
              </span>
            </h2>
            {overBy > 0 && (
              <div className="warning prep-over-limit">
                ⚠ {equipped.length} equipped but Tier {tier} only allows {limit} — unequip {overBy} to
                fix.
              </div>
            )}
            <ul className="inventory-items prep-slots">
              {equipped.map((item) => {
                const attunement = character.attunement?.[item.id];
                return (
                  <li key={item.id} className="inventory-item">
                    <div className="inventory-item-main">
                      <span className="inventory-item-name">
                        {item.name}
                        {item.remaining > 1 && <span className="muted"> ×{item.remaining}</span>}
                      </span>
                      {item.rarity && (
                        <span className={`rarity rarity-${item.rarity.replace(' ', '-')}`}>
                          {item.rarity}
                        </span>
                      )}
                      {isMagicItemPool && (
                        <select
                          className={`attune-select${attunement ? ` attune-${attunement}` : ''}`}
                          value={attunement ?? ''}
                          onChange={(e) =>
                            onSetAttunement(
                              item.id,
                              (e.target.value || undefined) as AttunementState | undefined,
                            )
                          }
                        >
                          <option value="">Not Attuned</option>
                          <option value="attuned" disabled={attunement !== 'attuned' && attunedCount >= ATTUNEMENT_CAP}>
                            Attuned
                          </option>
                          <option value="not-required">Attunement Not Required</option>
                        </select>
                      )}
                      <button
                        className="equip-toggle mark-equipped"
                        title="Equipped — click to unequip"
                        onClick={() => onToggleMark(item.id)}
                      >
                        ⚔️
                      </button>
                    </div>
                    {item.description && (
                      <div className="inventory-item-desc muted">{item.description}</div>
                    )}
                    {item.minorProperty && (
                      <div className="inventory-item-desc muted">Minor property: {item.minorProperty}</div>
                    )}
                  </li>
                );
              })}
              {Array.from({ length: emptySlots }).map((_, i) => (
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
