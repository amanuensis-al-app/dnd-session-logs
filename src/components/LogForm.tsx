import { useMemo, useState } from 'react';
import type {
  Character,
  DerivedStats,
  GainedItem,
  ItemCategory,
  LogEntry,
  LogType,
  LossReason,
  Rarity,
} from '../types';
import {
  CATEGORY_LABELS_SINGULAR,
  ITEM_CATEGORIES,
  LOG_TYPES,
  LOG_TYPE_LABELS,
  LOSS_REASON_LABELS,
  RARITIES,
  RARITY_CATEGORIES,
  newId,
} from '../types';

interface Props {
  character: Character;
  derived: DerivedStats;
  onSave: (log: LogEntry) => void;
  onCancel: () => void;
}

const TYPE_HELP: Record<LogType, string> = {
  session: 'A played session: rewards (and occasional losses) of gold, downtime, items and buffs.',
  catchup: 'Downtime activity: spend 10 downtime days to gain 1 level.',
  transaction: 'Trade a magic item for another of the same rarity. Costs 5 downtime days.',
  purchase: 'Spend gold on equipment (non-magic items).',
  free: 'Record anything: character creation, DM rewards, corrections…',
};

interface GainDraft {
  key: string;
  category: ItemCategory;
  name: string;
  rarity: Rarity;
  quantity: string;
  description: string;
}

interface LossDraft {
  key: string;
  itemId: string;
  quantity: string;
  reason: LossReason;
}

function emptyGain(category: ItemCategory = 'magic_item'): GainDraft {
  return { key: newId(), category, name: '', rarity: 'uncommon', quantity: '1', description: '' };
}

function emptyLoss(reason: LossReason = 'consumed'): LossDraft {
  return { key: newId(), itemId: '', quantity: '1', reason };
}

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function LogForm({ character, derived, onSave, onCancel }: Props) {
  const [type, setType] = useState<LogType>('session');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tradePartner, setTradePartner] = useState('');
  const [gpGained, setGpGained] = useState('0');
  const [gpLost, setGpLost] = useState('0');
  const [downtimeGained, setDowntimeGained] = useState('10');
  const [downtimeSpent, setDowntimeSpent] = useState('0');
  const [levelGained, setLevelGained] = useState('1');
  const [gains, setGains] = useState<GainDraft[]>([]);
  const [losses, setLosses] = useState<LossDraft[]>([]);
  // Transaction-specific: the item given away and the item received.
  const [tradeLostItemId, setTradeLostItemId] = useState('');
  const [tradeGainedName, setTradeGainedName] = useState('');

  const ownedItems = derived.inventory;
  const ownedMagicItems = useMemo(
    () => ownedItems.filter((i) => i.category === 'magic_item'),
    [ownedItems],
  );
  const tradeLostItem = ownedMagicItems.find((i) => i.id === tradeLostItemId);

  function switchType(next: LogType) {
    setType(next);
    // Sensible defaults per type; the user can still adjust visible fields.
    if (next === 'session') {
      setDowntimeGained('10');
      setLevelGained('1');
    } else if (next === 'free') {
      setDowntimeGained('0');
      setLevelGained('0');
    }
    setGains([]);
    setLosses([]);
  }

  function updateGain(key: string, patch: Partial<GainDraft>) {
    setGains((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function updateLoss(key: string, patch: Partial<LossDraft>) {
    setLosses((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function buildLog(): LogEntry | string {
    const base: LogEntry = {
      id: newId(),
      characterId: character.id,
      type,
      date,
      title: title.trim(),
      notes: notes.trim() || undefined,
      gpGained: 0,
      gpLost: 0,
      downtimeGained: 0,
      downtimeSpent: 0,
      levelGained: 0,
      itemsGained: [],
      itemsLost: [],
      createdAt: Date.now(),
    };

    const gainedItems: GainedItem[] = gains
      .filter((g) => g.name.trim())
      .map((g) => ({
        id: newId(),
        name: g.name.trim(),
        category: g.category,
        rarity: RARITY_CATEGORIES.includes(g.category) ? g.rarity : undefined,
        quantity: Math.max(1, Math.round(num(g.quantity))),
        description: g.description.trim() || undefined,
      }));

    const lostItems = losses
      .filter((l) => l.itemId)
      .map((l) => ({
        itemId: l.itemId,
        quantity: Math.max(1, Math.round(num(l.quantity))),
        reason: l.reason,
      }));

    switch (type) {
      case 'session':
        return {
          ...base,
          title: base.title || 'Session',
          gpGained: Math.max(0, num(gpGained)),
          gpLost: Math.max(0, num(gpLost)),
          downtimeGained: Math.max(0, num(downtimeGained)),
          levelGained: Math.max(0, Math.round(num(levelGained))),
          itemsGained: gainedItems,
          itemsLost: lostItems,
        };
      case 'catchup':
        return {
          ...base,
          title: base.title || 'Catching Up',
          downtimeSpent: 10,
          levelGained: 1,
        };
      case 'transaction': {
        if (!tradeLostItem) return 'Pick the magic item you are trading away.';
        if (!tradeGainedName.trim()) return 'Enter the magic item you received.';
        return {
          ...base,
          title: base.title || `Traded ${tradeLostItem.name} for ${tradeGainedName.trim()}`,
          tradePartner: tradePartner.trim() || undefined,
          downtimeSpent: 5,
          itemsGained: [
            {
              id: newId(),
              name: tradeGainedName.trim(),
              category: 'magic_item',
              rarity: tradeLostItem.rarity,
              quantity: 1,
            },
          ],
          itemsLost: [{ itemId: tradeLostItem.id, quantity: 1, reason: 'traded' }],
        };
      }
      case 'purchase':
        if (gainedItems.length === 0) return 'Add at least one piece of equipment.';
        return {
          ...base,
          title: base.title || `Bought ${gainedItems.map((i) => i.name).join(', ')}`,
          gpLost: Math.max(0, num(gpLost)),
          itemsGained: gainedItems,
        };
      case 'free':
        return {
          ...base,
          title: base.title || 'Free Log',
          gpGained: Math.max(0, num(gpGained)),
          gpLost: Math.max(0, num(gpLost)),
          downtimeGained: Math.max(0, num(downtimeGained)),
          downtimeSpent: Math.max(0, num(downtimeSpent)),
          levelGained: Math.round(num(levelGained)),
          itemsGained: gainedItems,
          itemsLost: lostItems,
        };
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = buildLog();
    if (typeof result === 'string') {
      alert(result);
      return;
    }
    onSave(result);
  }

  const downtimeWarning =
    (type === 'catchup' && derived.downtimeDays < 10) ||
    (type === 'transaction' && derived.downtimeDays < 5);

  const gainCategories: ItemCategory[] =
    type === 'purchase' ? ['equipment'] : [...ITEM_CATEGORIES];

  const showGains = type === 'session' || type === 'purchase' || type === 'free';
  const showLosses = type === 'session' || type === 'free';

  return (
    <form className="card log-form" onSubmit={submit}>
      <div className="log-form-types">
        {LOG_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={type === t ? 'tab active' : 'tab'}
            onClick={() => switchType(t)}
          >
            {LOG_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="muted log-form-help">{TYPE_HELP[type]}</p>
      {downtimeWarning && (
        <p className="warning">
          ⚠ {character.name} has only {derived.downtimeDays} downtime days — this log spends{' '}
          {type === 'catchup' ? 10 : 5}. It will still be recorded if you save.
        </p>
      )}

      <div className="form-grid">
        <label>
          Date *
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          {type === 'session' ? 'Adventure name' : 'Title'}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'session' ? 'e.g. DDAL04-01 Suits of the Mists' : 'optional'}
          />
        </label>
        {type === 'transaction' && (
          <label>
            Traded with *
            <input
              value={tradePartner}
              onChange={(e) => setTradePartner(e.target.value)}
              placeholder="player / character name"
              required
            />
          </label>
        )}
      </div>

      {(type === 'session' || type === 'free') && (
        <div className="form-grid">
          <label>
            GP gained
            <input type="number" min="0" step="0.01" value={gpGained} onChange={(e) => setGpGained(e.target.value)} />
          </label>
          <label>
            GP lost
            <input type="number" min="0" step="0.01" value={gpLost} onChange={(e) => setGpLost(e.target.value)} />
          </label>
          <label>
            Downtime gained
            <input
              type="number"
              min="0"
              value={downtimeGained}
              onChange={(e) => setDowntimeGained(e.target.value)}
            />
          </label>
          {type === 'free' && (
            <label>
              Downtime spent
              <input
                type="number"
                min="0"
                value={downtimeSpent}
                onChange={(e) => setDowntimeSpent(e.target.value)}
              />
            </label>
          )}
          <label>
            Levels gained
            <input
              type="number"
              min={type === 'free' ? undefined : 0}
              value={levelGained}
              onChange={(e) => setLevelGained(e.target.value)}
            />
          </label>
        </div>
      )}

      {type === 'purchase' && (
        <div className="form-grid">
          <label>
            GP spent *
            <input
              type="number"
              min="0"
              step="0.01"
              value={gpLost}
              onChange={(e) => setGpLost(e.target.value)}
              required
            />
          </label>
        </div>
      )}

      {type === 'catchup' && (
        <p className="log-form-fixed">
          Fixed effect: <span className="delta delta-loss">−10 downtime days</span>{' '}
          <span className="delta delta-gain">+1 level</span>
        </p>
      )}

      {type === 'transaction' && (
        <>
          <p className="log-form-fixed">
            Fixed effect: <span className="delta delta-loss">−5 downtime days</span>
          </p>
          <div className="form-grid">
            <label>
              Magic item given away *
              <select value={tradeLostItemId} onChange={(e) => setTradeLostItemId(e.target.value)}>
                <option value="">— pick from inventory —</option>
                {ownedMagicItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.rarity ? ` (${i.rarity})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Magic item received *
              <input
                value={tradeGainedName}
                onChange={(e) => setTradeGainedName(e.target.value)}
                placeholder="name of the item you got"
              />
            </label>
          </div>
          {tradeLostItem?.rarity && (
            <p className="muted">
              Received item will be recorded as <strong>{tradeLostItem.rarity}</strong> (same
              rarity as the item traded away).
            </p>
          )}
          {ownedMagicItems.length === 0 && (
            <p className="warning">⚠ {character.name} owns no magic items to trade.</p>
          )}
        </>
      )}

      {showGains && (
        <fieldset className="log-form-items">
          <legend>Items gained</legend>
          {gains.map((g) => (
            <div key={g.key} className="item-row">
              <select
                value={g.category}
                onChange={(e) => updateGain(g.key, { category: e.target.value as ItemCategory })}
                disabled={gainCategories.length === 1}
              >
                {gainCategories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS_SINGULAR[c]}
                  </option>
                ))}
              </select>
              <input
                className="item-row-name"
                value={g.name}
                onChange={(e) => updateGain(g.key, { name: e.target.value })}
                placeholder="item name *"
              />
              {RARITY_CATEGORIES.includes(g.category) && (
                <select
                  value={g.rarity}
                  onChange={(e) => updateGain(g.key, { rarity: e.target.value as Rarity })}
                >
                  {RARITIES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              )}
              <input
                className="item-row-qty"
                type="number"
                min="1"
                value={g.quantity}
                onChange={(e) => updateGain(g.key, { quantity: e.target.value })}
                title="Quantity"
              />
              <input
                className="item-row-desc"
                value={g.description}
                onChange={(e) => updateGain(g.key, { description: e.target.value })}
                placeholder="description (optional)"
              />
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setGains((prev) => prev.filter((x) => x.key !== g.key))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setGains((prev) => [...prev, emptyGain(gainCategories[0])])}
          >
            + Add item
          </button>
        </fieldset>
      )}

      {showLosses && (
        <fieldset className="log-form-items">
          <legend>Items lost / consumed</legend>
          {losses.map((l) => (
            <div key={l.key} className="item-row">
              <select
                className="item-row-name"
                value={l.itemId}
                onChange={(e) => updateLoss(l.key, { itemId: e.target.value })}
              >
                <option value="">— pick from inventory —</option>
                {ownedItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({CATEGORY_LABELS_SINGULAR[i.category]}
                    {i.remaining > 1 ? `, ×${i.remaining}` : ''})
                  </option>
                ))}
              </select>
              <input
                className="item-row-qty"
                type="number"
                min="1"
                value={l.quantity}
                onChange={(e) => updateLoss(l.key, { quantity: e.target.value })}
                title="Quantity"
              />
              <select
                value={l.reason}
                onChange={(e) => updateLoss(l.key, { reason: e.target.value as LossReason })}
              >
                {(Object.keys(LOSS_REASON_LABELS) as LossReason[]).map((r) => (
                  <option key={r} value={r}>
                    {LOSS_REASON_LABELS[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setLosses((prev) => prev.filter((x) => x.key !== l.key))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLosses((prev) => [...prev, emptyLoss()])}
            disabled={ownedItems.length === 0}
          >
            + Add loss
          </button>
        </fieldset>
      )}

      <label className="log-form-notes">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </label>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          Save Log
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
