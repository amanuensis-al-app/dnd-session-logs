import { useMemo, useState } from 'react';
import type { SpellDefinition } from '../spells';
import { SPELL_LIST, rarityForSpellLevel, spellLevelLabel } from '../spells';
import { Modal } from './Modal';

interface Props {
  onPick: (spell: SpellDefinition) => void;
  onClose: () => void;
  /** Hide spells below this level (Copy Spell passes 1 — cantrips can't be copied). */
  minLevel?: number;
  title?: string;
  /** Explanatory line above the search box; the default describes the scroll flow. */
  intro?: string;
}

/** Search-and-pick modal over SPELL_LIST. Default configuration serves the
 * "Spell Scroll of <Spell>" flow: closing without picking (Escape, backdrop click,
 * or the Cancel button) leaves the caller's item name as plain "Spell Scroll" — the
 * user can keep typing the rest by hand. The Copy Spell log reuses it with
 * `minLevel={1}` and its own wording. */
export function SpellScrollPicker({ onPick, onClose, minLevel = 0, title, intro }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = SPELL_LIST.filter((s) => s.level >= minLevel);
    return q ? pool.filter((s) => s.name.toLowerCase().includes(q)) : pool;
  }, [query, minLevel]);

  return (
    <Modal title={title ?? 'Pick a Spell'} onClose={onClose}>
      <p className="muted">
        {intro ??
          'Sets the item to "Spell Scroll of <Spell>" with its rarity (and, in a Purchase log, its price) from the spell\'s level.'}
      </p>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search spells…"
      />
      <div className="spell-picker-list">
        {results.map((s) => (
          <button
            key={s.name}
            type="button"
            className="spell-picker-item"
            onClick={() => onPick(s)}
          >
            <span>{s.name}</span>
            <span className="muted">
              {spellLevelLabel(s.level)} · {rarityForSpellLevel(s.level)}
            </span>
          </button>
        ))}
        {results.length === 0 && <p className="muted">No spells match "{query}".</p>}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
