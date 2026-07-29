import { useEffect, useMemo, useState } from 'react';
import type {
  Character,
  DerivedStats,
  GainedItem,
  ItemCategory,
  LogEntry,
  LogType,
  LossReason,
  LostItem,
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
import { expandPacks } from '../packs';
import { MagicItemNameField } from './MagicItemNameField';
import { deriveCharacter, formatGp, sortLogs } from '../derive';
import {
  copyCostForLevel,
  copyDowntimeForLevel,
  costForSpellLevel,
  lookupSpell,
  rarityForSpellLevel,
  spellFromScrollName,
  type SpellDefinition,
} from '../spells';
import { SpellScrollPicker } from './SpellScrollPicker';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** All of this character's logs, for looking up what an item was bought for. */
  characterLogs: LogEntry[];
  /** Every character (incl. this one) — lets a new Trade log pick another of the
   * user's own characters as the partner instead of an external free-text name. */
  characters: Character[];
  /** Every log across every character — used to derive a trade partner
   * character's current magic-item inventory when they're one of `characters`. */
  allLogs: LogEntry[];
  /** Every DM name ever logged, for the dropdown. */
  knownDMs: string[];
  /** Every location ever logged, for the dropdown. */
  knownLocations: string[];
  /** When set, the form edits this log in place instead of creating a new one. */
  existingLog?: LogEntry;
  /** Initial values for a NEW log (e.g. parsed from pasted text) — unlike existingLog,
   * the log gets saved as a fresh entry (new id/createdAt). */
  prefill?: LogEntry;
  onSave: (log: LogEntry) => void;
  /** Saves BOTH halves of a new Trade made with another of the user's own
   * characters — see the "Trading with" character/item pickers below. */
  onSaveLinkedTrade: (mine: LogEntry, other: LogEntry) => void;
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
  session: 'A played D&D session: rewards magic items, equipments, gold, level, and downtime. Also record items consumed.',
  catchup: 'Downtime activity: spend 10 downtime days per level gained.',
  transaction: 'Trade a magic item for another of the same rarity. Costs 5 downtime days.',
  copy_spell:
    'Wizard only: copy spells into the spellbook — 50 gp per spell level, 1 downtime day (levels 1–4) or 2 (5+). Copying from a scroll consumes the scroll.',
  purchase: 'Spend gold on equipment or consumables.',
  sell: 'Sell equipment for gold. The price prefills at half of what you paid (or half list price).',
  creation: 'Character creation: starting gold and equipment. Pick a class and a background to prefill.',
  free: 'Record anything not yet covered by other type of logs.',
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

interface CopySpellDraft {
  key: string;
  /** Original GainedItem id when editing — preserved so later losses keep pointing at it. */
  id?: string;
  name: string;
  /** Spell level as typed, '1'–'9'. */
  level: string;
  /** 'none' (Free Logs only — corrections may not know the source) saves the item
   * with no copiedFrom at all; a Copy Spell log requires scroll or player. */
  source: 'scroll' | 'player' | 'none';
  /** 'scroll' source: id of the "Spell Scroll of <name>" inventory stack consumed. */
  scrollItemId: string;
  /** 'player' source: who it was copied from ("player / character name"). */
  partner: string;
}

function emptyCopySpell(): CopySpellDraft {
  return {
    key: newId(),
    name: '',
    level: '',
    source: 'scroll',
    scrollItemId: '',
    partner: '',
  };
}

/** Auto-fill value for a Copy Spell log's downtime: 1 day per spell of level 1–4,
 * 2 days for 5+ (a half-typed row counts as the 1-day minimum). The field itself
 * stays editable — special class rules (e.g. Scribe wizard) change the real cost,
 * and the tracker doesn't try to model those. */
function computeCopyDowntime(rows: CopySpellDraft[]): number {
  return rows
    .filter((c) => c.name.trim())
    .reduce((sum, c) => sum + copyDowntimeForLevel(Math.max(1, Math.round(num(c.level)))), 0);
}

/** Auto-fill value for a Copy Spell log's GP cost: 50 gp × level per spell. Editable
 * for the same reason as the downtime. */
function computeCopyGp(rows: CopySpellDraft[]): number {
  return rows
    .filter((c) => c.name.trim())
    .reduce((sum, c) => sum + copyCostForLevel(Math.max(0, Math.round(num(c.level)))), 0);
}

/** Which of a log's itemsLost rows belong to its Copy Spell rows: one 'used' scroll
 * loss per scroll-sourced copied gain, matched by the scroll's spell name, each loss
 * claimable once. Returned as gainId → itemsLost index. Both the copy-row and the
 * generic-loss initializers consult this, so on edit every scroll loss is owned by
 * exactly one side and can't be double-recorded on save. */
function claimScrollLosses(log: LogEntry, itemNameById: Map<string, string>): Map<string, number> {
  const byGain = new Map<string, number>();
  const claimed = new Set<number>();
  for (const g of log.itemsGained) {
    if (g.category !== 'copied_spell' || g.copiedFrom?.source !== 'scroll') continue;
    const target = g.name.trim().toLowerCase();
    const idx = log.itemsLost.findIndex((l, i) => {
      if (claimed.has(i) || l.reason !== 'used') return false;
      const n = itemNameById.get(l.itemId);
      const spell = n ? spellFromScrollName(n) : undefined;
      return spell?.spellName.toLowerCase() === target;
    });
    if (idx >= 0) {
      claimed.add(idx);
      byGain.set(g.id, idx);
    }
  }
  return byGain;
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
  characters,
  allLogs,
  knownDMs,
  knownLocations,
  existingLog,
  prefill,
  onSave,
  onSaveLinkedTrade,
  onCancel,
}: Props) {
  const editing = existingLog !== undefined;
  // Field initial values come from the edited log or a prefill draft; everything that
  // must only apply while EDITING (id/createdAt reuse, downtime backout, loss add-back)
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
    // Copied spells have their own dedicated rows (copySpells below) in the two
    // types that can grant them — keep them out of the generic gain drafts.
    const drafts = (initial?.itemsGained ?? [])
      .filter(
        (item) =>
          !(
            item.category === 'copied_spell' &&
            (initial?.type === 'copy_spell' || initial?.type === 'free')
          ),
      )
      .map((item) => ({
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
    // Scroll losses that belong to the Copy Spell rows are rebuilt from those rows
    // on save — exclude them here so an edited Free Log doesn't record them twice.
    const claimedIdx =
      initial?.type === 'copy_spell' || initial?.type === 'free'
        ? new Set(
            claimScrollLosses(
              initial,
              new Map(derived.allItems.map((i) => [i.id, i.name])),
            ).values(),
          )
        : new Set<number>();
    const drafts = (initial?.itemsLost ?? []).flatMap((lost, i) => {
      if (claimedIdx.has(i)) return [];
      return [
        {
          key: `${lost.itemId}:${i}`,
          // The lost item's own category preselects the dropdown filter.
          category:
            derived.allItems.find((it) => it.id === lost.itemId)?.category ?? ('consumable' as ItemCategory),
          itemId: lost.itemId,
          quantity: String(lost.quantity),
          reason: lost.reason,
          salePrice: lost.salePrice != null ? String(lost.salePrice) : '',
        },
      ];
    });
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
  // Creation ("Starting") log: which background/option and class/option are
  // selected. Stored on the log (LogEntry.creationBackground/creationClass, added
  // 2026-07-20) so the choice survives edits — but picking one still just PREFILLS
  // the gold and item rows below (as the sum of both picks), which stay freely
  // editable afterward; re-initializing here doesn't re-run the prefill.
  const [creationBackground, setCreationBackground] = useState(
    initial?.type === 'creation' ? (initial.creationBackground?.name ?? '') : '',
  );
  const [creationBgOption, setCreationBgOption] = useState(
    initial?.type === 'creation' ? (initial.creationBackground?.option ?? 0) : 0,
  );
  const [creationClass, setCreationClass] = useState(
    initial?.type === 'creation' ? (initial.creationClass?.name ?? '') : '',
  );
  const [creationClassOption, setCreationClassOption] = useState(
    initial?.type === 'creation' ? (initial.creationClass?.option ?? 0) : 0,
  );
  // Starting level (most tables start at 1; some allow starting higher, e.g. a
  // Tier 2 one-shot). Stored as the log's ordinary levelGained (starting level − 1)
  // — this field just presents that as an absolute level instead of a delta.
  const [creationStartingLevel, setCreationStartingLevel] = useState(() =>
    String(
      initial?.type === 'creation' ? Math.min(20, Math.max(1, (initial.levelGained ?? 0) + 1)) : 1,
    ),
  );
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
  // Trading with another of the user's own characters (as opposed to an external,
  // untracked partner) — only offered when CREATING a new Trade log (not editing:
  // an existing linked trade is edited with the plain fields below, same as an
  // external one, and just gets a warning banner — see `existingLog?.linkedTrade`).
  // Picking a partner character replaces the free-text "Traded with" name with a
  // character picker, and the "Received" fieldset with a picker over THAT
  // character's own current magic items instead of freeform entry.
  const [tradePartnerMode, setTradePartnerMode] = useState<'external' | 'character'>('external');
  const [tradePartnerCharacterId, setTradePartnerCharacterId] = useState('');
  const [tradePartnerItemId, setTradePartnerItemId] = useState('');

  // Copy Spell rows — used by Copy Spell logs AND Free Logs (there without the
  // auto gp/downtime). Editing rebuilds them from the saved gains: level from
  // spellLevel, source from copiedFrom, and — for scroll copies — the consumed
  // scroll re-found among this log's own losses by its "Spell Scroll of <name>"
  // name (each loss row claimable once, so two copies off one stack round-trip).
  const [copySpells, setCopySpells] = useState<CopySpellDraft[]>(() => {
    if (initial?.type !== 'copy_spell' && initial?.type !== 'free') return [];
    const nameById = new Map(derived.allItems.map((i) => [i.id, i.name]));
    const claims = claimScrollLosses(initial, nameById);
    return (initial.itemsGained ?? [])
      .filter((item) => item.category === 'copied_spell')
      .map((item) => {
        const lossIdx = claims.get(item.id);
        return {
          key: item.id,
          id: item.id,
          name: item.name,
          level: item.spellLevel != null ? String(item.spellLevel) : '',
          source: item.copiedFrom?.source ?? 'none',
          scrollItemId: lossIdx != null ? initial.itemsLost[lossIdx].itemId : '',
          partner: item.copiedFrom?.partner ?? '',
        };
      });
  });

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

  // Character-to-character trade: every OTHER character to pick as the partner,
  // that partner's derived state (only computed once one is actually picked — this
  // is the only place a LogForm looks at data outside its own character), their
  // current magic items to receive, and the specific one picked.
  const otherCharacters = useMemo(
    () => characters.filter((c) => c.id !== character.id),
    [characters, character.id],
  );
  const tradePartnerCharacter = otherCharacters.find((c) => c.id === tradePartnerCharacterId);
  const tradePartnerDerived = useMemo(
    () => (tradePartnerCharacter ? deriveCharacter(tradePartnerCharacter, allLogs) : undefined),
    [tradePartnerCharacter, allLogs],
  );
  const tradePartnerMagicItems = useMemo(
    () =>
      (tradePartnerDerived?.allItems ?? []).filter(
        (i) => i.category === 'magic_item' && i.remaining > 0,
      ),
    [tradePartnerDerived],
  );
  const tradePartnerItem = tradePartnerMagicItems.find((i) => i.id === tradePartnerItemId);
  // Only a NEW transaction log in 'character' mode gets the character/item pickers
  // below — editing (linked or not) always uses the plain external-style fields.
  const isCharacterTrade = type === 'transaction' && !editing && tradePartnerMode === 'character';

  // Purchase logs derive their GP spent from the item costs (rounded to copper).
  const purchaseTotal =
    Math.round(
      gains.reduce(
        (sum, g) => sum + Math.max(0, num(g.cost)) * Math.max(1, Math.round(num(g.quantity))),
        0,
      ) * 100,
    ) / 100;

  // Copy Spell auto-fill totals (50 gp × level; 1 downtime day for levels 1–4, 2 for
  // 5+). Both land in the ordinary editable gpLost/downtimeSpent fields — the user
  // may override (Scribe wizard etc.), and any change to the rows re-runs the
  // auto-fill (owner rule 2026-07-20).
  const copyRows = copySpells.filter((c) => c.name.trim());
  const copyDowntimeTotal = computeCopyDowntime(copySpells);
  const copyGpTotal = computeCopyGp(copySpells);

  /** Owned consumable scroll stacks for the given spell ("Spell Scroll of X" in
   * either written form, matched via spellFromScrollName). */
  function matchingScrolls(spellName: string) {
    const target = spellName.trim().toLowerCase();
    return ownedItems.filter(
      (i) =>
        i.category === 'consumable' &&
        spellFromScrollName(i.name)?.spellName.toLowerCase() === target,
    );
  }

  /** Scroll options for a Copy Spell row: with a spell name, the stacks matching it;
   * with the name still empty, EVERY owned spell scroll (minus known cantrips, which
   * can't be copied) — picking one then fills the name/level in. */
  function scrollOptionsFor(c: CopySpellDraft) {
    if (c.name.trim()) return matchingScrolls(c.name);
    return ownedItems.filter((i) => {
      if (i.category !== 'consumable') return false;
      const spell = spellFromScrollName(i.name);
      return spell !== undefined && spell.level !== 0;
    });
  }

  /** Auto-select the scroll when exactly one stack matches the spell name. */
  function autoScrollFor(spellName: string): string {
    const matches = matchingScrolls(spellName);
    return matches.length === 1 ? matches[0].id : '';
  }

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
    // While editing, switching type clears the item rows below — equivalent to
    // deleting this log and starting a new one of the new type (id/createdAt are
    // kept, so the log stays at the same date/order position). Worth a confirm:
    // a misclick would otherwise silently discard the original log's items.
    if (
      editing &&
      next !== type &&
      !confirm(
        `Change this log's type to "${LOG_TYPE_LABELS[next]}"? The item rows below will be cleared — saving is like deleting this log and creating a new ${LOG_TYPE_LABELS[next]} with the same date.`,
      )
    ) {
      return;
    }
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
      setDowntimeGained('0');
      setCreationBackground('');
      setCreationBgOption(0);
      setCreationClass('');
      setCreationClassOption(0);
      setCreationStartingLevel('1');
    } else if (next === 'copy_spell') {
      // Rows start empty, so both auto-filled fields start at 0.
      setGpLost('0');
      setDowntimeSpent('0');
    }
    setGains([]);
    setLosses([]);
    setCopySpells([]);
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

  /** All Copy Spell row mutations funnel through here: in a Copy Spell log, any
   * change re-runs the gp/downtime auto-fill immediately (owner rule — the fields
   * stay editable for special class rules like Scribe wizard, but only until the
   * next row change). Free Logs keep their manually entered numbers. */
  function mutateCopySpells(next: CopySpellDraft[]) {
    setCopySpells(next);
    if (type === 'copy_spell') {
      setGpLost(String(computeCopyGp(next)));
      setDowntimeSpent(String(computeCopyDowntime(next)));
    }
  }

  function updateCopySpell(key: string, patch: Partial<CopySpellDraft>) {
    mutateCopySpells(copySpells.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }

  // Copy Spell row (by key) currently showing the spell picker, or null.
  const [copySpellPickerFor, setCopySpellPickerFor] = useState<string | null>(null);

  /** Turns the Copy Spell rows into gains + consumed-scroll losses, or an error
   * string. Shared by Copy Spell logs (requireSource: every spell must say where it
   * came from) and Free Logs (corrections may leave the source unrecorded). A spell
   * can only ever be copied once: duplicates within the log and spells already in
   * the spellbook (except this log's own, when editing) are refused. */
  function buildCopiedSpells(
    requireSource: boolean,
  ): { gains: GainedItem[]; losses: LostItem[] } | string {
    const gains: GainedItem[] = [];
    const losses: LostItem[] = [];
    // Several rows may draw on the same scroll stack — track combined usage so
    // two copies can't consume more scrolls than the character owns.
    const scrollUse = new Map<string, number>();
    const seen = new Set<string>();
    for (const c of copyRows) {
      const name = c.name.trim();
      const nameKey = name.toLowerCase();
      const level = Math.round(num(c.level));
      if (level < 1 || level > 9) {
        return `"${name}": spell level must be 1–9 (cantrips can't be copied).`;
      }
      if (seen.has(nameKey)) {
        return `"${name}" is listed twice — a spell can only be copied into the book once.`;
      }
      seen.add(nameKey);
      const already = ownedItems.find(
        (i) =>
          i.category === 'copied_spell' &&
          i.name.trim().toLowerCase() === nameKey &&
          i.sourceLogId !== existingLog?.id,
      );
      if (already) {
        return `"${name}" is already in ${character.name}'s spellbook (copied ${already.acquiredDate}) — a spell can only be copied once.`;
      }
      if (c.source === 'scroll') {
        const scroll = ownedItems.find((i) => i.id === c.scrollItemId);
        if (!scroll) {
          return `"${name}": pick the Spell Scroll it was copied from — copying from a scroll requires owning "Spell Scroll of ${name}".`;
        }
        const fromScroll = spellFromScrollName(scroll.name);
        if (!fromScroll || fromScroll.spellName.toLowerCase() !== nameKey) {
          return `"${name}": the selected scroll (${scroll.name}) doesn't match the spell.`;
        }
        const used = (scrollUse.get(scroll.id) ?? 0) + 1;
        if (used > scroll.remaining) {
          return `"${name}": only ${scroll.remaining} × ${scroll.name} owned, but ${used} would be consumed.`;
        }
        scrollUse.set(scroll.id, used);
        losses.push({ itemId: scroll.id, quantity: 1, reason: 'used' });
      } else if (c.source === 'player') {
        if (!c.partner.trim()) {
          return `"${name}": enter who it was copied from (player / character name).`;
        }
      } else if (requireSource) {
        return `"${name}": pick where it was copied from (scroll or another player).`;
      }
      gains.push({
        id: c.id ?? newId(),
        name,
        category: 'copied_spell',
        quantity: 1,
        spellLevel: level,
        copiedFrom:
          c.source === 'scroll'
            ? { source: 'scroll' }
            : c.source === 'player'
              ? { source: 'player', partner: c.partner.trim() }
              : undefined,
        description:
          c.source === 'scroll'
            ? 'Copied from a spell scroll'
            : c.source === 'player'
              ? `Copied from ${c.partner.trim()}`
              : undefined,
      });
    }
    return { gains, losses };
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

    const gainedItems: GainedItem[] = expandPacks(
      gains
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
        }),
    );

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
              // Keep the received item's id only when this log already was a
              // transaction — after a type switch the old itemsGained belong to a
              // different log, and reusing that id would retarget later losses of
              // the old item onto the traded-for one.
              id:
                existingLog?.type === 'transaction'
                  ? (existingLog.itemsGained[0]?.id ?? newId())
                  : newId(),
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
      case 'copy_spell': {
        if (copyRows.length === 0) return 'Add at least one spell copied.';
        const copied = buildCopiedSpells(true);
        if (typeof copied === 'string') return copied;
        return {
          ...base,
          title: base.title || `Copied ${copied.gains.map((g) => g.name).join(', ')}`,
          gpLost: Math.max(0, num(gpLost)),
          downtimeSpent: Math.max(0, num(downtimeSpent)),
          itemsGained: copied.gains,
          itemsLost: copied.losses,
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
        const startingLevel = Math.min(20, Math.max(1, Math.round(num(creationStartingLevel)) || 1));
        return {
          ...base,
          title: base.title || (creationDesc ? `Character Creation (${creationDesc})` : 'Character Creation'),
          gpGained: Math.max(0, num(gpGained)),
          downtimeGained: Math.max(0, num(downtimeGained)),
          levelGained: startingLevel - 1,
          itemsGained: gainedItems,
          creationBackground: creationBackground
            ? { name: creationBackground, option: creationBgOption }
            : undefined,
          creationClass: creationClass
            ? { name: creationClass, option: creationClassOption }
            : undefined,
        };
      }
      case 'free': {
        const copied = buildCopiedSpells(false);
        if (typeof copied === 'string') return copied;
        return {
          ...base,
          title: base.title || 'Free Log',
          gpGained: Math.max(0, num(gpGained)),
          gpLost: Math.max(0, num(gpLost)),
          downtimeGained: Math.max(0, num(downtimeGained)),
          downtimeSpent: Math.max(0, num(downtimeSpent)),
          levelGained: Math.round(num(levelGained)),
          itemsGained: [...gainedItems, ...copied.gains],
          itemsLost: [...lostItems, ...copied.losses],
        };
      }
    }
  }

  /**
   * A Trade with another of the user's own characters saves TWO independent log
   * entries — one per character, each fully self-consistent (see LinkedTrade in
   * types.ts) — instead of the single entry every other log type produces. Only
   * reachable when CREATING a new transaction log with `tradePartnerMode ===
   * 'character'`; editing an existing (possibly linked) trade always goes through
   * the plain `buildLog()` path below, single-log, same as an external trade.
   */
  function buildLinkedTrade(): { mine: LogEntry; other: LogEntry } | string {
    if (!tradeLostItem) return 'Pick the magic item you are trading away.';
    if (!tradePartnerCharacter) return 'Pick which character you are trading with.';
    if (!tradePartnerItem) {
      return `Pick the magic item to receive from ${tradePartnerCharacter.name}.`;
    }
    const myLogId = newId();
    const otherLogId = newId();
    const now = Date.now();
    const mine: LogEntry = {
      id: myLogId,
      characterId: character.id,
      type: 'transaction',
      date,
      time: time || undefined,
      title: title.trim() || `Traded ${tradeLostItem.name} for ${tradePartnerItem.name}`,
      notes: notes.trim() || undefined,
      gpGained: 0,
      gpLost: 0,
      downtimeGained: 0,
      downtimeSpent: 5,
      levelGained: 0,
      tradePartner: tradePartnerCharacter.name,
      itemsGained: [
        {
          id: newId(),
          name: tradePartnerItem.name,
          category: 'magic_item',
          rarity: tradePartnerItem.rarity,
          quantity: 1,
          description: tradePartnerItem.description,
          minorProperty: tradePartnerItem.minorProperty,
          requiresAttunement: tradePartnerItem.requiresAttunement,
        },
      ],
      itemsLost: [{ itemId: tradeLostItem.id, quantity: 1, reason: 'traded' }],
      linkedTrade: { characterId: tradePartnerCharacter.id, logId: otherLogId },
      createdAt: now,
    };
    const other: LogEntry = {
      id: otherLogId,
      characterId: tradePartnerCharacter.id,
      type: 'transaction',
      date,
      time: time || undefined,
      title: `Traded ${tradePartnerItem.name} for ${tradeLostItem.name}`,
      gpGained: 0,
      gpLost: 0,
      downtimeGained: 0,
      downtimeSpent: 5,
      levelGained: 0,
      tradePartner: character.name,
      itemsGained: [
        {
          id: newId(),
          name: tradeLostItem.name,
          category: 'magic_item',
          rarity: tradeLostItem.rarity,
          quantity: 1,
          description: tradeLostItem.description,
          minorProperty: tradeLostItem.minorProperty,
          requiresAttunement: tradeLostItem.requiresAttunement,
        },
      ],
      itemsLost: [{ itemId: tradePartnerItem.id, quantity: 1, reason: 'traded' }],
      linkedTrade: { characterId: character.id, logId: myLogId },
      createdAt: now,
    };
    return { mine, other };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (type === 'transaction' && !editing && tradePartnerMode === 'character') {
      const result = buildLinkedTrade();
      if (typeof result === 'string') {
        alert(result);
        return;
      }
      onSaveLinkedTrade(result.mine, result.other);
      return;
    }
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
    (type === 'transaction' && downtimeAvailable < 5) ||
    (type === 'copy_spell' && num(downtimeSpent) > 0 && downtimeAvailable < num(downtimeSpent));

  // Copied spells never appear in the generic gain rows — Copy Spell logs AND Free
  // Logs both get the dedicated "Spells copied" section instead. Purchase logs are
  // gold-for-goods, so equipment/consumable only (no cost field on magic items).
  // Starting logs get magic_item too — some AL rules grant a starting character a
  // free magic item at a high enough starting level (owner request 2026-07-21).
  const gainCategories: ItemCategory[] =
    type === 'purchase'
      ? ['equipment', 'consumable']
      : type === 'creation'
        ? ['equipment', 'consumable', 'magic_item']
        : ITEM_CATEGORIES.filter((c) => c !== 'copied_spell');

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
          >
            {LOG_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="muted log-form-help">{TYPE_HELP[type]}</p>
      {type === 'transaction' && editing && existingLog?.linkedTrade && (
        <p className="warning">
          ⚠ This is one half of a Trade with {existingLog.tradePartner ?? 'another character'}.
          Changes here won't update their matching log automatically — edit or delete it there too
          if needed.
        </p>
      )}
      {downtimeWarning && (
        <p className="warning">
          ⚠ {character.name} has only {downtimeAvailable} downtime days — this log spends{' '}
          {type === 'catchup' ? catchupLevels * 10 : type === 'copy_spell' ? num(downtimeSpent) : 5}.
          It will still be recorded if you save.
        </p>
      )}
      {isCharacterTrade && tradePartnerCharacter && tradePartnerDerived && tradePartnerDerived.downtimeDays < 5 && (
        <p className="warning">
          ⚠ {tradePartnerCharacter.name} has only {tradePartnerDerived.downtimeDays} downtime days —
          this trade spends 5 for them too. It will still be recorded if you save.
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
        {type === 'transaction' && !editing && otherCharacters.length > 0 && (
          <label>
            Trading with
            <select
              value={tradePartnerMode}
              onChange={(e) => {
                const mode = e.target.value as 'external' | 'character';
                setTradePartnerMode(mode);
                if (mode === 'external') {
                  setTradePartnerCharacterId('');
                  setTradePartnerItemId('');
                } else {
                  setTradePartner('');
                }
              }}
            >
              <option value="external">An external partner</option>
              <option value="character">One of my characters</option>
            </select>
          </label>
        )}
        {type === 'transaction' && !isCharacterTrade && (
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
        {isCharacterTrade && (
          <label>
            Character *
            <select
              value={tradePartnerCharacterId}
              onChange={(e) => {
                setTradePartnerCharacterId(e.target.value);
                setTradePartnerItemId('');
              }}
              required
            >
              <option value="">— pick a character —</option>
              {otherCharacters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
              Starting level
              <select
                value={creationStartingLevel}
                onChange={(e) => setCreationStartingLevel(e.target.value)}
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            Most characters start at level 1 — you may also pick a higher level (e.g. starting at level 5) based on AL or campaign specific rules. 
          </p>
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
            <label>
              Downtime days gained
              <input
                type="number"
                min="0"
                step="1"
                value={downtimeGained}
                onChange={(e) => setDowntimeGained(e.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            Picking a background and class fills in the gold (sum of both) and item rows —
            adjust them freely, e.g. replace an “(any)” placeholder with the specific tool or
            instrument you chose. If your background isn’t on the list, pick Custom Background
            and adjust the gold and equipment accordingly. Starting above level 1 may come with
            downtime days too — add them above if so.
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
            {isCharacterTrade && tradePartnerCharacter && (
              <span className="muted"> (spent by both {character.name} and {tradePartnerCharacter.name})</span>
            )}
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
            {isCharacterTrade ? (
              <>
                <label>
                  Magic item *
                  <select
                    value={tradePartnerItemId}
                    onChange={(e) => setTradePartnerItemId(e.target.value)}
                    disabled={!tradePartnerCharacter}
                  >
                    <option value="">
                      {tradePartnerCharacter
                        ? '— pick from their inventory —'
                        : '— pick a character first —'}
                    </option>
                    {tradePartnerMagicItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                        {i.rarity ? ` (${i.rarity})` : ''}
                        {minorPropertySuffix(i)}
                      </option>
                    ))}
                  </select>
                </label>
                {tradePartnerItem && (tradePartnerItem.minorProperty || tradePartnerItem.description) && (
                  <p className="muted log-form-trade-note">
                    {tradePartnerItem.minorProperty && (
                      <>Minor property: {tradePartnerItem.minorProperty}</>
                    )}
                    {tradePartnerItem.minorProperty && tradePartnerItem.description && ' — '}
                    {tradePartnerItem.description}
                  </p>
                )}
                {tradePartnerItem && (
                  <p className="muted log-form-trade-note">
                    {(tradePartnerItem.requiresAttunement ?? true)
                      ? 'Requires attunement'
                      : 'Attunement not required'}
                  </p>
                )}
                {tradePartnerCharacter && tradePartnerMagicItems.length === 0 && (
                  <p className="warning">
                    ⚠ {tradePartnerCharacter.name} owns no magic items to trade.
                  </p>
                )}
                {tradeLostItem && tradePartnerItem && tradeLostItem.rarity !== tradePartnerItem.rarity && (
                  <p className="warning">
                    ⚠ Rarity mismatch: giving away {tradeLostItem.rarity ?? 'an unknown rarity'},
                    receiving {tradePartnerItem.rarity ?? 'an unknown rarity'}. AL trades normally
                    require matching rarity — this will still be recorded if you save.
                  </p>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </fieldset>
        </>
      )}

      {type === 'copy_spell' && (
        <div className="form-grid">
          <label>
            <span>
              GP cost <span className="muted">(auto-fills: 50 gp × level — editable)</span>
            </span>
            <span className="combo">
              <input
                type="number"
                min="0"
                step="0.01"
                value={gpLost}
                onChange={(e) => setGpLost(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-small"
                title="Recompute from the spells listed (50 gp × level)"
                onClick={() => setGpLost(String(copyGpTotal))}
              >
                ↺ Auto
              </button>
            </span>
          </label>
          <label>
            <span>
              Downtime spent{' '}
              <span className="muted">(auto-fills: 1 day ≤4th, 2 days 5th+ — editable, e.g. Scribe Wiz)</span>
            </span>
            <span className="combo">
              <input
                type="number"
                min="0"
                value={downtimeSpent}
                onChange={(e) => setDowntimeSpent(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost btn-small"
                title="Recompute from the spells listed (1 day for levels 1–4, 2 days for 5+)"
                onClick={() => setDowntimeSpent(String(copyDowntimeTotal))}
              >
                ↺ Auto
              </button>
            </span>
          </label>
        </div>
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

      {(type === 'copy_spell' || type === 'free') && (
        <>
          <fieldset className="log-form-items">
            <legend>Spells copied</legend>
            {copySpells.map((c) => {
              const scrolls = scrollOptionsFor(c);
              const nameKey = c.name.trim().toLowerCase();
              const dupInLog =
                nameKey !== '' &&
                copySpells.some((o) => o.key !== c.key && o.name.trim().toLowerCase() === nameKey);
              const alreadyOwned =
                nameKey !== '' &&
                ownedItems.some(
                  (i) =>
                    i.category === 'copied_spell' &&
                    i.name.trim().toLowerCase() === nameKey &&
                    i.sourceLogId !== existingLog?.id,
                );
              return (
                <div key={c.key}>
                  <div className="item-row">
                    <span className="item-row-name">
                      <input
                        value={c.name}
                        placeholder="spell name *"
                        onChange={(e) => {
                          const name = e.target.value;
                          // A known spell fills in its level; the scroll pick resets
                          // since it must match the (new) name.
                          const known = lookupSpell(name);
                          updateCopySpell(c.key, {
                            name,
                            ...(known && known.level >= 1 ? { level: String(known.level) } : {}),
                            ...(c.source === 'scroll' ? { scrollItemId: autoScrollFor(name) } : {}),
                          });
                        }}
                      />
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      title="Pick from the spell list"
                      onClick={() => setCopySpellPickerFor(c.key)}
                    >
                      📋
                    </button>
                    <input
                      className="item-row-qty"
                      type="number"
                      min="1"
                      max="9"
                      value={c.level}
                      placeholder="lvl"
                      title="Spell level (1–9; cantrips can't be copied)"
                      onChange={(e) => updateCopySpell(c.key, { level: e.target.value })}
                    />
                    <select
                      value={c.source}
                      title="Where the spell was copied from"
                      onChange={(e) => {
                        const source = e.target.value as CopySpellDraft['source'];
                        updateCopySpell(c.key, {
                          source,
                          scrollItemId: source === 'scroll' ? autoScrollFor(c.name) : '',
                        });
                      }}
                    >
                      <option value="scroll">From a scroll</option>
                      <option value="player">From another player</option>
                      {/* Free Logs are corrections — the source may simply not be
                          known. A Copy Spell log requires scroll or player. */}
                      {(type === 'free' || c.source === 'none') && (
                        <option value="none">Source not recorded</option>
                      )}
                    </select>
                    {c.source === 'scroll' && (
                      <select
                        className="item-row-name"
                        value={c.scrollItemId}
                        onChange={(e) => {
                          const scrollItemId = e.target.value;
                          // With the spell name still empty, picking a scroll IS the
                          // spell pick: fill the name (and level, when recognized)
                          // from the scroll.
                          if (scrollItemId && c.name.trim() === '') {
                            const item = ownedItems.find((i) => i.id === scrollItemId);
                            const spell = item && spellFromScrollName(item.name);
                            updateCopySpell(c.key, {
                              scrollItemId,
                              ...(spell
                                ? {
                                    name: spell.spellName,
                                    ...(spell.level != null && spell.level >= 1
                                      ? { level: String(spell.level) }
                                      : {}),
                                  }
                                : {}),
                            });
                            return;
                          }
                          updateCopySpell(c.key, { scrollItemId });
                        }}
                      >
                        <option value="">— pick the scroll consumed * —</option>
                        {scrolls.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.remaining > 1 ? ` (×${s.remaining})` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {c.source === 'player' && (
                      <input
                        value={c.partner}
                        placeholder="player / character name *"
                        onChange={(e) => updateCopySpell(c.key, { partner: e.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => mutateCopySpells(copySpells.filter((x) => x.key !== c.key))}
                    >
                      ✕
                    </button>
                  </div>
                  {dupInLog && (
                    <p className="warning">
                      ⚠ "{c.name.trim()}" is listed twice in this log — a spell can only be
                      copied once.
                    </p>
                  )}
                  {!dupInLog && alreadyOwned && (
                    <p className="warning">
                      ⚠ "{c.name.trim()}" is already in {character.name}'s spellbook — it can't
                      be copied again.
                    </p>
                  )}
                  {c.source === 'scroll' && scrolls.length === 0 && (
                    <p className="warning">
                      {c.name.trim() !== '' ? (
                        <>
                          ⚠ {character.name} owns no "Spell Scroll of {c.name.trim()}" — copying
                          from a scroll requires that scroll in the inventory.
                        </>
                      ) : (
                        <>
                          ⚠ {character.name} owns no copyable spell scrolls — add one to the
                          inventory first, or change the source.
                        </>
                      )}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => mutateCopySpells([...copySpells, emptyCopySpell()])}
            >
              + Add spell
            </button>
          </fieldset>
          <p className="muted log-form-footnote">
            Copying from a scroll consumes the scroll (it is recorded as used by this log).
            {type === 'free' &&
              ' In a Free Log the GP / downtime costs are entered manually above (standard rule: 50 gp × level; 1 downtime day for levels 1–4, 2 for 5+).'}
          </p>
        </>
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

      {copySpellPickerFor && (
        <SpellScrollPicker
          minLevel={1}
          title="Pick a Spell to Copy"
          intro="Fills in the spell name and level. Cantrips can't be copied into a spellbook."
          onPick={(spell) => {
            updateCopySpell(copySpellPickerFor, {
              name: spell.name,
              level: String(spell.level),
              scrollItemId: autoScrollFor(spell.name),
            });
            setCopySpellPickerFor(null);
          }}
          onClose={() => setCopySpellPickerFor(null)}
        />
      )}
    </form>
  );
}
