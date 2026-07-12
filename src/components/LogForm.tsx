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
  STACKED_CATEGORIES,
  newId,
  stackedItemId,
} from '../types';
import { ITEM_CATALOG } from '../catalog';
import { formatGp } from '../derive';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** Every DM name ever logged, for the dropdown. */
  knownDMs: string[];
  /** Every location ever logged, for the dropdown. */
  knownLocations: string[];
  /** When set, the form edits this log in place instead of creating a new one. */
  existingLog?: LogEntry;
  onSave: (log: LogEntry) => void;
  onCancel: () => void;
}

/** Pick from previously used values, or switch to manual input for a new one. */
function ComboInput({
  value,
  options,
  placeholder,
  onChange,
  optionLabel,
  optionGroup,
}: {
  value: string;
  options: string[];
  placeholder: string;
  onChange: (value: string) => void;
  /** Display text for a dropdown option; the option's value stays the plain string. */
  optionLabel?: (option: string) => string;
  /** Section heading for an option; consecutive options sharing one render in an <optgroup>. */
  optionGroup?: (option: string) => string | undefined;
}) {
  const [manual, setManual] = useState(
    () => options.length === 0 || (value !== '' && !options.includes(value)),
  );

  if (manual || options.length === 0) {
    return (
      <span className="combo">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {options.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            title="Pick from previous entries"
            onClick={() => {
              setManual(false);
              onChange('');
            }}
          >
            ▾
          </button>
        )}
      </span>
    );
  }

  const sections: { group?: string; options: string[] }[] = [];
  for (const o of options) {
    const group = optionGroup?.(o);
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.options.push(o);
    else sections.push({ group, options: [o] });
  }
  const renderOption = (o: string) => (
    <option key={o} value={o}>
      {optionLabel ? optionLabel(o) : o}
    </option>
  );

  return (
    <select
      value={options.includes(value) ? value : ''}
      onChange={(e) => {
        if (e.target.value === '__manual__') {
          setManual(true);
          onChange('');
        } else {
          onChange(e.target.value);
        }
      }}
    >
      <option value="">—</option>
      {sections.map((s) =>
        s.group ? (
          <optgroup key={s.group} label={s.group}>
            {s.options.map(renderOption)}
          </optgroup>
        ) : (
          s.options.map(renderOption)
        ),
      )}
      <option value="__manual__">✏️ Input manually…</option>
    </select>
  );
}

const TYPE_HELP: Record<LogType, string> = {
  session: 'A played session: rewards (and occasional losses) of gold, downtime, items and buffs.',
  catchup: 'Downtime activity: spend 10 downtime days to gain 1 level.',
  transaction: 'Trade a magic item for another of the same rarity. Costs 5 downtime days.',
  purchase: 'Spend gold on equipment or consumables.',
  free: 'Record anything: character creation, DM rewards, corrections…',
};

interface GainDraft {
  key: string;
  /** Original GainedItem id when editing — preserved so later losses keep pointing at it. */
  id?: string;
  category: ItemCategory;
  name: string;
  rarity: Rarity;
  quantity: string;
  description: string;
  /** Per-unit price in GP; only shown (and saved) for purchase logs. */
  cost: string;
}

interface LossDraft {
  key: string;
  itemId: string;
  quantity: string;
  reason: LossReason;
}

function emptyGain(category: ItemCategory = 'magic_item'): GainDraft {
  return {
    key: newId(),
    category,
    name: '',
    rarity: 'uncommon',
    quantity: '1',
    description: '',
    cost: '',
  };
}

function emptyLoss(reason: LossReason = 'used'): LossDraft {
  return { key: newId(), itemId: '', quantity: '1', reason };
}

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function LogForm({
  character,
  derived,
  knownDMs,
  knownLocations,
  existingLog,
  onSave,
  onCancel,
}: Props) {
  const editing = existingLog !== undefined;
  const [minimized, setMinimized] = useState(false);
  const [type, setType] = useState<LogType>(existingLog?.type ?? 'session');
  const [date, setDate] = useState(() => existingLog?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(existingLog?.time ?? '');
  const [location, setLocation] = useState(existingLog?.location ?? '');
  const [dm, setDm] = useState(existingLog?.dm ?? '');
  const [title, setTitle] = useState(existingLog?.title ?? '');
  const [notes, setNotes] = useState(existingLog?.notes ?? '');
  const [tradePartner, setTradePartner] = useState(existingLog?.tradePartner ?? '');
  const [gpGained, setGpGained] = useState(String(existingLog?.gpGained ?? 0));
  const [gpLost, setGpLost] = useState(String(existingLog?.gpLost ?? 0));
  const [downtimeGained, setDowntimeGained] = useState(String(existingLog?.downtimeGained ?? 10));
  const [downtimeSpent, setDowntimeSpent] = useState(String(existingLog?.downtimeSpent ?? 0));
  const [levelGained, setLevelGained] = useState(String(existingLog?.levelGained ?? 1));
  const [gains, setGains] = useState<GainDraft[]>(() => {
    const drafts = (existingLog?.itemsGained ?? []).map((item) => ({
      key: item.id,
      id: item.id,
      category: item.category,
      name: item.name,
      rarity: item.rarity ?? 'uncommon',
      quantity: String(item.quantity),
      description: item.description ?? '',
      cost: item.cost != null ? String(item.cost) : '',
    }));
    // Purchase logs saved before per-item costs existed only stored the total; put it
    // back on a sole item so the recomputed GP spent matches the stored one.
    if (
      existingLog?.type === 'purchase' &&
      drafts.length === 1 &&
      drafts[0].cost === '' &&
      existingLog.gpLost > 0
    ) {
      drafts[0].cost = String(existingLog.gpLost / Math.max(1, existingLog.itemsGained[0].quantity));
    }
    return drafts;
  });
  const [losses, setLosses] = useState<LossDraft[]>(() =>
    (existingLog?.itemsLost ?? []).map((lost, i) => ({
      key: `${lost.itemId}:${i}`,
      itemId: lost.itemId,
      quantity: String(lost.quantity),
      reason: lost.reason,
    })),
  );
  // Transaction-specific: the item given away and the item received.
  const [tradeLostItemId, setTradeLostItemId] = useState(
    existingLog?.type === 'transaction' ? (existingLog.itemsLost[0]?.itemId ?? '') : '',
  );
  const [tradeGainedName, setTradeGainedName] = useState(
    existingLog?.type === 'transaction' ? (existingLog.itemsGained[0]?.name ?? '') : '',
  );

  // Items this form may record as lost: current inventory, plus whatever this log
  // already lost (so an edit can keep or re-pick those).
  const ownedItems = useMemo(() => {
    const addBack = new Map<string, number>();
    for (const lost of existingLog?.itemsLost ?? []) {
      addBack.set(lost.itemId, (addBack.get(lost.itemId) ?? 0) + lost.quantity);
    }
    return derived.allItems
      .map((i) => ({ ...i, remaining: i.remaining + (addBack.get(i.id) ?? 0) }))
      .filter((i) => i.remaining > 0);
  }, [derived, existingLog]);
  const ownedMagicItems = useMemo(
    () => ownedItems.filter((i) => i.category === 'magic_item'),
    [ownedItems],
  );

  // When editing, this log's own downtime effect is already in the derived total —
  // back it out so the "not enough downtime" warning stays truthful.
  const downtimeAvailable =
    derived.downtimeDays +
    (existingLog ? existingLog.downtimeSpent - existingLog.downtimeGained : 0);
  const tradeLostItem = ownedMagicItems.find((i) => i.id === tradeLostItemId);

  // Purchase logs derive their GP spent from the item costs (rounded to copper).
  const purchaseTotal =
    Math.round(
      gains.reduce(
        (sum, g) => sum + Math.max(0, num(g.cost)) * Math.max(1, Math.round(num(g.quantity))),
        0,
      ) * 100,
    ) / 100;

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
      id: existingLog?.id ?? newId(),
      characterId: character.id,
      type,
      date,
      time: time || undefined,
      title: title.trim(),
      notes: notes.trim() || undefined,
      gpGained: 0,
      gpLost: 0,
      downtimeGained: 0,
      downtimeSpent: 0,
      levelGained: 0,
      itemsGained: [],
      itemsLost: [],
      createdAt: existingLog?.createdAt ?? Date.now(),
    };

    const gainedItems: GainedItem[] = gains
      .filter((g) => g.name.trim())
      .map((g) => {
        const name = g.name.trim();
        const rarity = RARITY_CATEGORIES.includes(g.category) ? g.rarity : undefined;
        const stacked = STACKED_CATEGORIES.includes(g.category);
        return {
          // Stacked categories always recompute their content-derived id, so renames
          // re-bucket naturally; instance ids of other categories are preserved forever.
          id: stacked ? stackedItemId({ category: g.category, name, rarity }) : (g.id ?? newId()),
          name,
          category: g.category,
          rarity,
          quantity: Math.max(1, Math.round(num(g.quantity))),
          description: stacked ? undefined : g.description.trim() || undefined,
          cost: type === 'purchase' && g.cost.trim() !== '' ? Math.max(0, num(g.cost)) : undefined,
        };
      });

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
          location: location.trim() || undefined,
          dm: dm.trim() || undefined,
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
              id: existingLog?.itemsGained[0]?.id ?? newId(),
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
        if (gainedItems.length === 0) return 'Add at least one item you bought.';
        return {
          ...base,
          title: base.title || `Bought ${gainedItems.map((i) => i.name).join(', ')}`,
          gpLost: purchaseTotal,
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
    (type === 'catchup' && downtimeAvailable < 10) ||
    (type === 'transaction' && downtimeAvailable < 5);

  const gainCategories: ItemCategory[] =
    type === 'purchase' ? ['equipment', 'consumable'] : [...ITEM_CATEGORIES];

  const showGains = type === 'session' || type === 'purchase' || type === 'free';
  const showLosses = type === 'session' || type === 'free';

  if (minimized) {
    return (
      <div className="card log-form log-form-minimized">
        <span className="muted">
          {editing
            ? `✎ Editing “${existingLog.title || existingLog.date}”`
            : `New ${LOG_TYPE_LABELS[type]} (draft)`}
        </span>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setMinimized(false)}>
          ▾ Expand
        </button>
      </div>
    );
  }

  return (
    <form className="card log-form" onSubmit={submit}>
      <button
        type="button"
        className="btn btn-ghost btn-small log-form-minimize"
        title="Minimise (keeps what you typed)"
        onClick={() => setMinimized(true)}
      >
        —
      </button>
      <div className="log-form-types">
        {LOG_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={type === t ? 'tab active' : 'tab'}
            onClick={() => switchType(t)}
            disabled={editing}
            title={editing ? 'The type cannot change while editing' : undefined}
          >
            {LOG_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {editing && (
        <p className="log-form-editing">
          ✎ Editing “{existingLog.title || existingLog.date}” — saving updates the log in place.
        </p>
      )}
      <p className="muted log-form-help">{TYPE_HELP[type]}</p>
      {downtimeWarning && (
        <p className="warning">
          ⚠ {character.name} has only {downtimeAvailable} downtime days — this log spends{' '}
          {type === 'catchup' ? 10 : 5}. It will still be recorded if you save.
        </p>
      )}

      <div className="form-grid">
        <label>
          Date *
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          <span>
            Time <span className="muted">(optional)</span>
          </span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
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

      <div className={type === 'session' ? 'form-grid context-row context-session' : 'form-grid context-row'}>
        <label>
          {type === 'session' ? 'Adventure name' : 'Title'}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'session' ? 'e.g. DDAL04-01 Suits of the Mists' : 'optional'}
          />
        </label>
        {type === 'session' && (
          <>
            <label>
              Location
              <ComboInput
                value={location}
                options={knownLocations}
                placeholder="e.g. FLGS, Roll20…"
                onChange={setLocation}
              />
            </label>
            <label>
              DM
              <ComboInput
                value={dm}
                options={knownDMs}
                placeholder="who ran the table"
                onChange={setDm}
              />
            </label>
          </>
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
            <span>
              GP spent <span className="muted">(auto: Σ cost × qty)</span>
            </span>
            <input className="input-computed" value={purchaseTotal} readOnly tabIndex={-1} />
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
              <span className="item-row-name">
                <ComboInput
                  key={g.category}
                  value={g.name}
                  // Catalog order (grouped by section), NOT alphabetical.
                  options={(ITEM_CATALOG[g.category] ?? []).map((c) => c.name)}
                  optionGroup={(name) =>
                    ITEM_CATALOG[g.category]?.find((c) => c.name === name)?.group
                  }
                  optionLabel={
                    // Prices only matter when buying. The selected option keeps its
                    // plain name so the closed select shows "Flail", not "Flail — 10 gp".
                    type === 'purchase'
                      ? (name) => {
                          if (name === g.name) return name;
                          const entry = ITEM_CATALOG[g.category]?.find((c) => c.name === name);
                          return entry ? `${name} — ${formatGp(entry.cost)} gp` : name;
                        }
                      : undefined
                  }
                  placeholder="item name *"
                  onChange={(name) => {
                    const entry = ITEM_CATALOG[g.category]?.find((c) => c.name === name);
                    // Picking a catalog item fills in its rarity, and its price in a purchase.
                    updateGain(g.key, {
                      name,
                      ...(entry?.rarity ? { rarity: entry.rarity } : {}),
                      ...(type === 'purchase' && entry ? { cost: String(entry.cost) } : {}),
                    });
                  }}
                />
              </span>
              {type === 'purchase' && (
                <input
                  className="item-row-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={g.cost}
                  onChange={(e) => updateGain(g.key, { cost: e.target.value })}
                  placeholder="gp each"
                  title="Cost per unit in GP"
                />
              )}
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
              {!STACKED_CATEGORIES.includes(g.category) && (
                <input
                  className="item-row-desc"
                  value={g.description}
                  onChange={(e) => updateGain(g.key, { description: e.target.value })}
                  placeholder="description (optional)"
                />
              )}
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
          {editing ? 'Save Changes' : 'Save Log'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
