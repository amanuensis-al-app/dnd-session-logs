import { useEffect, useMemo, useState } from 'react';
import type {
  Character,
  DerivedStats,
  GainedItem,
  ItemCategory,
  LogEntry,
  LogType,
  LossReason,
  MinorProperty,
  Rarity,
} from '../types';
import {
  CATEGORY_LABELS_SINGULAR,
  EQUIPPABLE_CATEGORIES,
  ITEM_CATEGORIES,
  LOG_TYPES,
  LOG_TYPE_LABELS,
  LOSS_REASON_LABELS,
  MINOR_PROPERTIES,
  RARITIES,
  RARITY_CATEGORIES,
  STACKED_CATEGORIES,
  newId,
  stackedItemId,
} from '../types';
import { CREATION_BACKGROUNDS, CREATION_CLASSES, ITEM_CATALOG } from '../catalog';
import type { CreationOption } from '../catalog';
import { MagicItemNameField } from './MagicItemNameField';
import { formatGp, sortLogs } from '../derive';
import { costForSpellLevel, rarityForSpellLevel, type SpellDefinition } from '../spells';
import { SpellScrollPicker } from './SpellScrollPicker';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** All of this character's logs, for looking up what an item was bought for. */
  characterLogs: LogEntry[];
  /** Every DM name ever logged, for the dropdown. */
  knownDMs: string[];
  /** Every location ever logged, for the dropdown. */
  knownLocations: string[];
  /** When set, the form edits this log in place instead of creating a new one. */
  existingLog?: LogEntry;
  /** Initial values for a NEW log (e.g. parsed from pasted text) — unlike existingLog,
   * the log gets saved as a fresh entry and the type tabs stay enabled. */
  prefill?: LogEntry;
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
  // A value set from outside (e.g. the spell picker filling in "Spell Scroll of X")
  // can land here after mount, once the dropdown is already showing — without this the
  // <select> would just show blank instead of switching to an editable text field.
  useEffect(() => {
    if (!manual && value !== '' && !options.includes(value)) setManual(true);
  }, [value, options, manual]);

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
      {/* Manual input sits on top: with long grouped catalogs it would otherwise
          take a lot of scrolling to reach. */}
      <option value="__manual__">✏️ Input manually…</option>
      {sections.map((s) =>
        s.group ? (
          <optgroup key={s.group} label={s.group}>
            {s.options.map(renderOption)}
          </optgroup>
        ) : (
          s.options.map(renderOption)
        ),
      )}
    </select>
  );
}

const TYPE_HELP: Record<LogType, string> = {
  session: 'A played session: rewards (and occasional losses) of gold, downtime, items and buffs.',
  catchup: 'Downtime activity: spend 10 downtime days per level gained.',
  transaction: 'Trade a magic item for another of the same rarity. Costs 5 downtime days.',
  purchase: 'Spend gold on equipment or consumables.',
  sell: 'Sell equipment for gold. The price prefills at half of what you paid (or half list price).',
  creation: 'Character creation: starting gold and equipment. Pick a background to prefill.',
  free: 'Record anything: DM rewards, corrections…',
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
  /** Magic items only: at most one of MINOR_PROPERTIES, or '' for none. */
  minorProperty: MinorProperty | '';
  /** Magic items only: whether the item requires attunement (saved on the item). */
  requiresAttunement: boolean;
  /** Per-unit price in GP; only shown (and saved) for purchase logs. */
  cost: string;
}

interface LossDraft {
  key: string;
  /** Draft-only filter for the item dropdown (like the gain side's category pick).
   * Never saved — the picked item's own category is authoritative. */
  category: ItemCategory;
  itemId: string;
  quantity: string;
  reason: LossReason;
  /** Sale price per unit in GP; only shown (and saved) for sell logs. */
  salePrice: string;
}

function emptyGain(category: ItemCategory = 'magic_item'): GainDraft {
  return {
    key: newId(),
    category,
    name: '',
    rarity: 'uncommon',
    quantity: '1',
    description: '',
    minorProperty: '',
    // Default true: absent requiresAttunement on a saved item also means "requires
    // attunement" (the tracker's original behavior for every magic item).
    requiresAttunement: true,
    cost: '',
  };
}

function emptyLoss(reason: LossReason = 'used', category: ItemCategory = 'consumable'): LossDraft {
  return { key: newId(), category, itemId: '', quantity: '1', reason, salePrice: '' };
}

function num(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** " [Guardian]" suffix for an item-picker option, or '' if it has no minor property. */
function minorPropertySuffix(item: { minorProperty?: MinorProperty }): string {
  return item.minorProperty ? ` [${item.minorProperty}]` : '';
}

export function LogForm({
  character,
  derived,
  characterLogs,
  knownDMs,
  knownLocations,
  existingLog,
  prefill,
  onSave,
  onCancel,
}: Props) {
  const editing = existingLog !== undefined;
  // Field initial values come from the edited log or a prefill draft; everything that
  // must only apply while EDITING (id/createdAt reuse, locked type, downtime backout)
  // keeps checking existingLog.
  const initial = existingLog ?? prefill;
  const [minimized, setMinimized] = useState(false);
  const [type, setType] = useState<LogType>(initial?.type ?? 'session');
  const [date, setDate] = useState(() => initial?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(initial?.time ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [dm, setDm] = useState(initial?.dm ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [tradePartner, setTradePartner] = useState(initial?.tradePartner ?? '');
  const [gpGained, setGpGained] = useState(String(initial?.gpGained ?? 0));
  const [gpLost, setGpLost] = useState(String(initial?.gpLost ?? 0));
  const [downtimeGained, setDowntimeGained] = useState(String(initial?.downtimeGained ?? 10));
  const [downtimeSpent, setDowntimeSpent] = useState(String(initial?.downtimeSpent ?? 0));
  const [levelGained, setLevelGained] = useState(String(initial?.levelGained ?? 1));
  const [gains, setGains] = useState<GainDraft[]>(() => {
    const drafts = (initial?.itemsGained ?? []).map((item) => ({
      key: item.id,
      id: item.id,
      category: item.category,
      name: item.name,
      rarity: item.rarity ?? 'uncommon',
      quantity: String(item.quantity),
      description: item.description ?? '',
      minorProperty: (item.minorProperty ?? '') as MinorProperty | '',
      requiresAttunement: item.requiresAttunement ?? true,
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
  const [losses, setLosses] = useState<LossDraft[]>(() => {
    const drafts = (initial?.itemsLost ?? []).map((lost, i) => ({
      key: `${lost.itemId}:${i}`,
      // The lost item's own category preselects the dropdown filter.
      category: derived.allItems.find((i) => i.id === lost.itemId)?.category ?? 'consumable',
      itemId: lost.itemId,
      quantity: String(lost.quantity),
      reason: lost.reason,
      salePrice: lost.salePrice != null ? String(lost.salePrice) : '',
    }));
    // Sell logs saved without per-item prices (imports may not know them) only stored
    // the total; put it back on a sole item so the recomputed GP gained matches.
    if (
      existingLog?.type === 'sell' &&
      drafts.length === 1 &&
      drafts[0].salePrice === '' &&
      existingLog.gpGained > 0
    ) {
      drafts[0].salePrice = String(existingLog.gpGained / Math.max(1, existingLog.itemsLost[0].quantity));
    }
    return drafts;
  });
  // Creation-specific: which background/option and class/option are selected.
  // Not stored on the log — picking these just prefills the gold and item rows
  // below (as the sum of both picks), which stay freely editable afterward.
  const [creationBackground, setCreationBackground] = useState('');
  const [creationBgOption, setCreationBgOption] = useState(0);
  const [creationClass, setCreationClass] = useState('');
  const [creationClassOption, setCreationClassOption] = useState(0);
  // Transaction-specific: the item given away and the item received.
  const [tradeLostItemId, setTradeLostItemId] = useState(
    existingLog?.type === 'transaction' ? (existingLog.itemsLost[0]?.itemId ?? '') : '',
  );
  const [tradeGainedName, setTradeGainedName] = useState(
    existingLog?.type === 'transaction' ? (existingLog.itemsGained[0]?.name ?? '') : '',
  );
  const [tradeGainedMinorProperty, setTradeGainedMinorProperty] = useState<MinorProperty | ''>(
    existingLog?.type === 'transaction' ? (existingLog.itemsGained[0]?.minorProperty ?? '') : '',
  );
  const [tradeGainedDescription, setTradeGainedDescription] = useState(
    existingLog?.type === 'transaction' ? (existingLog.itemsGained[0]?.description ?? '') : '',
  );
  const [tradeGainedRequiresAttunement, setTradeGainedRequiresAttunement] = useState(
    existingLog?.type === 'transaction'
      ? (existingLog.itemsGained[0]?.requiresAttunement ?? true)
      : true,
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
  const ownedEquipment = useMemo(
    () => ownedItems.filter((i) => i.category === 'equipment'),
    [ownedItems],
  );
  // Loss rows filter items by category — only offer categories the character owns.
  const lossCategories = useMemo(
    () => ITEM_CATEGORIES.filter((c) => ownedItems.some((i) => i.category === c)),
    [ownedItems],
  );
  // Loss options sorted like the Inventory tab: equipped first, then rarest first,
  // then name. (ownedItems all have remaining > 0, so the Inventory sort's
  // negative-quantities-last rule doesn't apply here.)
  const lossItemOptions = useMemo(() => {
    const markRank = (item: { id: string; category: ItemCategory }) =>
      EQUIPPABLE_CATEGORIES.includes(item.category) && character.itemMarks?.[item.id] ? 0 : 1;
    const rarityRank = (r?: Rarity) => (r ? RARITIES.indexOf(r) : -1);
    return [...ownedItems].sort(
      (a, b) =>
        markRank(a) - markRank(b) ||
        rarityRank(b.rarity) - rarityRank(a.rarity) ||
        a.name.localeCompare(b.name),
    );
  }, [ownedItems, character.itemMarks]);

  // What each (stacked) item was last bought for, per unit — sell prices prefill at
  // half of this, falling back to half the catalog list price, else 0.
  const purchaseCostById = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of sortLogs(characterLogs)) {
      if (log.type !== 'purchase') continue;
      for (const item of log.itemsGained) {
        if (item.cost != null) map.set(item.id, item.cost);
      }
    }
    return map;
  }, [characterLogs]);

  function sellPriceFor(itemId: string): number {
    const bought = purchaseCostById.get(itemId);
    if (bought != null) return Math.round(bought * 50) / 100;
    const name = ownedItems.find((i) => i.id === itemId)?.name;
    const entry = name && ITEM_CATALOG.equipment?.find((c) => c.name === name);
    return entry ? Math.round(entry.cost * 50) / 100 : 0;
  }

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

  // Sell logs derive their GP gained from the sale prices (rounded to copper).
  const sellTotal =
    Math.round(
      losses.reduce(
        (sum, l) =>
          sum + Math.max(0, num(l.salePrice)) * Math.max(1, Math.round(num(l.quantity))),
        0,
      ) * 100,
    ) / 100;

  function switchType(next: LogType) {
    setType(next);
    // Sensible defaults per type; the user can still adjust visible fields.
    if (next === 'session' || next === 'catchup') {
      setDowntimeGained('10');
      setLevelGained('1');
    } else if (next === 'free') {
      setDowntimeGained('0');
      setLevelGained('0');
    } else if (next === 'creation') {
      setGpGained('0');
      setCreationBackground('');
      setCreationBgOption(0);
      setCreationClass('');
      setCreationClassOption(0);
    }
    setGains([]);
    setLosses([]);
  }

  /** Creation log: (re)fill the gold + item rows from the picked background AND class option. */
  function applyCreationPicks(
    bgName: string,
    bgOptionIndex: number,
    className: string,
    classOptionIndex: number,
  ) {
    setCreationBackground(bgName);
    setCreationBgOption(bgOptionIndex);
    setCreationClass(className);
    setCreationClassOption(classOptionIndex);
    const bgOption = CREATION_BACKGROUNDS.find((b) => b.name === bgName)?.options[bgOptionIndex];
    const classOption = CREATION_CLASSES.find((c) => c.name === className)?.options[
      classOptionIndex
    ];
    setGpGained(String((bgOption?.gp ?? 0) + (classOption?.gp ?? 0)));
    setGains(
      [...(bgOption?.items ?? []), ...(classOption?.items ?? [])].map((item) => ({
        ...emptyGain('equipment'),
        name: item.name,
        quantity: String(item.quantity ?? 1),
      })),
    );
  }

  function creationOptionLabel(option: CreationOption, index: number): string {
    const letter = String.fromCharCode(65 + index);
    return option.items.length > 0
      ? `Option ${letter}: equipment package + ${option.gp} GP`
      : `Option ${letter}: ${option.gp} GP`;
  }

  function updateGain(key: string, patch: Partial<GainDraft>) {
    setGains((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  // Gain row (by key) currently showing the spell picker, or null. Picking a spell sets
  // rarity from its level, and (in a Purchase log) price from the doubled DMG cost table;
  // closing without picking leaves the item name at plain "Spell Scroll".
  const [spellPickerFor, setSpellPickerFor] = useState<string | null>(null);

  function pickSpellScroll(key: string, spell: SpellDefinition) {
    updateGain(key, {
      name: `Spell Scroll of ${spell.name}`,
      rarity: rarityForSpellLevel(spell.level),
      ...(type === 'purchase' ? { cost: String(costForSpellLevel(spell.level)) } : {}),
    });
    setSpellPickerFor(null);
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
          minorProperty: g.category === 'magic_item' && g.minorProperty ? g.minorProperty : undefined,
          requiresAttunement: g.category === 'magic_item' ? g.requiresAttunement : undefined,
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
          downtimeSpent: catchupLevels * 10,
          levelGained: catchupLevels,
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
              description: tradeGainedDescription.trim() || undefined,
              minorProperty: tradeGainedMinorProperty || undefined,
              requiresAttunement: tradeGainedRequiresAttunement,
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
      case 'sell': {
        const sold = losses.filter((l) => l.itemId);
        if (sold.length === 0) return 'Pick at least one equipment item to sell.';
        const names = sold.map(
          (l) => ownedItems.find((i) => i.id === l.itemId)?.name ?? 'item',
        );
        return {
          ...base,
          title: base.title || `Sold ${names.join(', ')}`,
          gpGained: sellTotal,
          itemsLost: sold.map((l) => ({
            itemId: l.itemId,
            quantity: Math.max(1, Math.round(num(l.quantity))),
            reason: 'sold' as const,
            salePrice: l.salePrice.trim() !== '' ? Math.max(0, num(l.salePrice)) : undefined,
          })),
        };
      }
      case 'creation': {
        const creationDesc = [creationBackground, creationClass].filter(Boolean).join(' / ');
        return {
          ...base,
          title: base.title || (creationDesc ? `Character Creation (${creationDesc})` : 'Character Creation'),
          gpGained: Math.max(0, num(gpGained)),
          itemsGained: gainedItems,
        };
      }
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

  // Catch Up spends 10 downtime days per level gained.
  const catchupLevels = Math.max(1, Math.round(num(levelGained)));
  const downtimeWarning =
    (type === 'catchup' && downtimeAvailable < catchupLevels * 10) ||
    (type === 'transaction' && downtimeAvailable < 5);

  const gainCategories: ItemCategory[] =
    type === 'purchase' || type === 'creation'
      ? ['equipment', 'consumable']
      : [...ITEM_CATEGORIES];

  const showGains =
    type === 'session' || type === 'purchase' || type === 'creation' || type === 'free';
  const showLosses = type === 'session' || type === 'free';

  if (minimized) {
    return (
      <div className="card log-form log-form-minimized">
        <span className="muted">
          {/* When editing, the entry's card header above already names the log. */}
          {editing ? '✎ Editing (draft kept)' : `New ${LOG_TYPE_LABELS[type]} (draft)`}
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
      <p className="muted log-form-help">{TYPE_HELP[type]}</p>
      {downtimeWarning && (
        <p className="warning">
          ⚠ {character.name} has only {downtimeAvailable} downtime days — this log spends{' '}
          {type === 'catchup' ? catchupLevels * 10 : 5}. It will still be recorded if you save.
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

      {type === 'sell' && (
        <>
          <div className="form-grid">
            <label>
              <span>
                GP gained <span className="muted">(auto: Σ price × qty)</span>
              </span>
              <input className="input-computed" value={sellTotal} readOnly tabIndex={-1} />
            </label>
          </div>
          <fieldset className="log-form-items">
            <legend>Equipment sold</legend>
            {losses.map((l) => (
              <div key={l.key} className="item-row">
                <select
                  className="item-row-name"
                  value={l.itemId}
                  onChange={(e) => {
                    const itemId = e.target.value;
                    // Picking an item prefills its per-unit sale price: half the last
                    // purchase price, else half the catalog price, else 0.
                    updateLoss(l.key, {
                      itemId,
                      salePrice: itemId ? String(sellPriceFor(itemId)) : '',
                    });
                  }}
                >
                  <option value="">— pick equipment from inventory —</option>
                  {ownedEquipment.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.remaining > 1 ? ` (×${i.remaining})` : ''}
                    </option>
                  ))}
                </select>
                <input
                  className="item-row-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.salePrice}
                  onChange={(e) => updateLoss(l.key, { salePrice: e.target.value })}
                  placeholder="gp each"
                  title="Sale price per unit in GP"
                />
                <input
                  className="item-row-qty"
                  type="number"
                  min="1"
                  value={l.quantity}
                  onChange={(e) => updateLoss(l.key, { quantity: e.target.value })}
                  title="Quantity"
                />
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
              onClick={() => setLosses((prev) => [...prev, emptyLoss('sold')])}
              disabled={ownedEquipment.length === 0}
            >
              + Add item
            </button>
            {ownedEquipment.length === 0 && (
              <p className="warning">⚠ {character.name} owns no equipment to sell.</p>
            )}
          </fieldset>
        </>
      )}

      {type === 'creation' && (
        <>
          <div className="form-grid">
            <label>
              Background
              <select
                value={creationBackground}
                onChange={(e) =>
                  applyCreationPicks(e.target.value, 0, creationClass, creationClassOption)
                }
              >
                <option value="">— pick a background —</option>
                {CREATION_BACKGROUNDS.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Background equipment
              <select
                value={creationBgOption}
                onChange={(e) =>
                  applyCreationPicks(
                    creationBackground,
                    Number(e.target.value),
                    creationClass,
                    creationClassOption,
                  )
                }
                disabled={!creationBackground}
              >
                {(
                  CREATION_BACKGROUNDS.find((b) => b.name === creationBackground)?.options ?? []
                ).map((o, i) => (
                  <option key={i} value={i}>
                    {creationOptionLabel(o, i)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Class
              <select
                value={creationClass}
                onChange={(e) =>
                  applyCreationPicks(creationBackground, creationBgOption, e.target.value, 0)
                }
              >
                <option value="">— pick a class —</option>
                {CREATION_CLASSES.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Class equipment
              <select
                value={creationClassOption}
                onChange={(e) =>
                  applyCreationPicks(
                    creationBackground,
                    creationBgOption,
                    creationClass,
                    Number(e.target.value),
                  )
                }
                disabled={!creationClass}
              >
                {(CREATION_CLASSES.find((c) => c.name === creationClass)?.options ?? []).map(
                  (o, i) => (
                    <option key={i} value={i}>
                      {creationOptionLabel(o, i)}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              GP gained <span className="muted">(background + class)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={gpGained}
                onChange={(e) => setGpGained(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Picking a background and class fills in the gold (sum of both) and item rows —
            adjust them freely, e.g. replace an “(any)” placeholder with the specific tool or
            instrument you chose. If your background isn’t on the list, pick Custom Background
            and adjust the gold and equipment accordingly.
          </p>
        </>
      )}

      {type === 'catchup' && (
        <>
          <div className="form-grid">
            <label>
              Levels to gain
              <input
                type="number"
                min={1}
                step={1}
                value={levelGained}
                onChange={(e) => setLevelGained(e.target.value)}
              />
            </label>
          </div>
          <p className="log-form-fixed">
            Effect:{' '}
            <span className="delta delta-loss">−{catchupLevels * 10} downtime days</span>{' '}
            <span className="delta delta-gain">
              +{catchupLevels} level{catchupLevels === 1 ? '' : 's'}
            </span>
          </p>
        </>
      )}

      {type === 'transaction' && (
        <>
          <p className="log-form-fixed">
            Fixed effect: <span className="delta delta-loss">−5 downtime days</span>
          </p>

          <fieldset className="log-form-items log-form-trade-side">
            <legend>↑ Given away</legend>
            <label>
              Magic item *
              <select value={tradeLostItemId} onChange={(e) => setTradeLostItemId(e.target.value)}>
                <option value="">— pick from inventory —</option>
                {ownedMagicItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                    {i.rarity ? ` (${i.rarity})` : ''}
                    {minorPropertySuffix(i)}
                  </option>
                ))}
              </select>
            </label>
            {tradeLostItem && (tradeLostItem.minorProperty || tradeLostItem.description) && (
              <p className="muted log-form-trade-note">
                {tradeLostItem.minorProperty && <>Minor property: {tradeLostItem.minorProperty}</>}
                {tradeLostItem.minorProperty && tradeLostItem.description && ' — '}
                {tradeLostItem.description}
              </p>
            )}
            {ownedMagicItems.length === 0 && (
              <p className="warning">⚠ {character.name} owns no magic items to trade.</p>
            )}
          </fieldset>

          <fieldset className="log-form-items log-form-trade-side">
            <legend>↓ Received</legend>
            <div className="field-stack">
              <span>Magic item *</span>
              <MagicItemNameField
                value={tradeGainedName}
                onChangeName={setTradeGainedName}
                onPick={(item) => {
                  setTradeGainedName(item.name);
                  setTradeGainedRequiresAttunement(item.requiresAttunement);
                  // Rarity deliberately untouched: a trade keeps the rarity of the
                  // item given away (see the note below the fields).
                }}
              />
            </div>
            <div className="form-grid">
              <label>
                Minor property
                <select
                  value={tradeGainedMinorProperty}
                  onChange={(e) =>
                    setTradeGainedMinorProperty(e.target.value as MinorProperty | '')
                  }
                >
                  <option value="">— none —</option>
                  {MINOR_PROPERTIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Attunement
                <select
                  value={tradeGainedRequiresAttunement ? 'required' : 'not-required'}
                  onChange={(e) =>
                    setTradeGainedRequiresAttunement(e.target.value === 'required')
                  }
                >
                  <option value="required">Requires Attunement</option>
                  <option value="not-required">Attunement Not Required</option>
                </select>
              </label>
              <label>
                Description
                <input
                  value={tradeGainedDescription}
                  onChange={(e) => setTradeGainedDescription(e.target.value)}
                  placeholder="description (optional)"
                />
              </label>
            </div>
            {tradeLostItem?.rarity && (
              <p className="muted log-form-trade-note">
                Will be recorded as <strong>{tradeLostItem.rarity}</strong> (same rarity as the
                item given away).
              </p>
            )}
          </fieldset>
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
                {g.category === 'magic_item' ? (
                  <MagicItemNameField
                    value={g.name}
                    onChangeName={(name) => updateGain(g.key, { name })}
                    onPick={(item) =>
                      updateGain(g.key, {
                        name: item.name,
                        rarity: item.rarity,
                        requiresAttunement: item.requiresAttunement,
                      })
                    }
                  />
                ) : (
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
                      // "Spell Scroll" has no fixed price (it depends which spell gets
                      // picked), so it's left bare either way.
                      type === 'purchase'
                        ? (name) => {
                            if (name === g.name || name === 'Spell Scroll') return name;
                            const entry = ITEM_CATALOG[g.category]?.find((c) => c.name === name);
                            return entry ? `${name} — ${formatGp(entry.cost)} gp` : name;
                          }
                        : undefined
                    }
                    placeholder="item name *"
                    onChange={(name) => {
                      // "Spell Scroll" opens the picker instead of filling anything in
                      // directly — rarity/cost come from whichever spell gets chosen.
                      if (g.category === 'consumable' && name === 'Spell Scroll') {
                        updateGain(g.key, { name });
                        setSpellPickerFor(g.key);
                        return;
                      }
                      const entry = ITEM_CATALOG[g.category]?.find((c) => c.name === name);
                      // Picking a catalog item fills in its rarity, and its price in a purchase.
                      updateGain(g.key, {
                        name,
                        ...(entry?.rarity ? { rarity: entry.rarity } : {}),
                        ...(type === 'purchase' && entry ? { cost: String(entry.cost) } : {}),
                      });
                    }}
                  />
                )}
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
              {g.category === 'magic_item' && (
                <select
                  className="item-row-minor-property"
                  value={g.minorProperty}
                  title="Minor property (at most one, optional)"
                  onChange={(e) =>
                    updateGain(g.key, { minorProperty: e.target.value as MinorProperty | '' })
                  }
                >
                  <option value="">— none —</option>
                  {MINOR_PROPERTIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              )}
              {g.category === 'magic_item' && (
                <select
                  value={g.requiresAttunement ? 'required' : 'not-required'}
                  title="Whether this item requires attunement"
                  onChange={(e) =>
                    updateGain(g.key, { requiresAttunement: e.target.value === 'required' })
                  }
                >
                  <option value="required">Requires Attunement</option>
                  <option value="not-required">Attunement Not Required</option>
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
                value={l.category}
                onChange={(e) =>
                  // Re-picking the type clears the item — it belongs to another category.
                  updateLoss(l.key, { category: e.target.value as ItemCategory, itemId: '' })
                }
                disabled={lossCategories.length === 1}
                title="Filter by item type"
              >
                {lossCategories.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS_SINGULAR[c]}
                  </option>
                ))}
              </select>
              <select
                className="item-row-name"
                value={l.itemId}
                onChange={(e) => updateLoss(l.key, { itemId: e.target.value })}
              >
                <option value="">— pick from inventory —</option>
                {lossItemOptions
                  .filter((i) => i.category === l.category)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.remaining > 1 ? ` (×${i.remaining})` : ''}
                      {minorPropertySuffix(i)}
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
            onClick={() =>
              setLosses((prev) => [...prev, emptyLoss('used', lossCategories[0] ?? 'consumable')])
            }
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

      {spellPickerFor && (
        <SpellScrollPicker
          onPick={(spell) => pickSpellScroll(spellPickerFor, spell)}
          onClose={() => setSpellPickerFor(null)}
        />
      )}
    </form>
  );
}
