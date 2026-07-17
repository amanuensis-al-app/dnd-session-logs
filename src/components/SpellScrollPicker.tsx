import { useMemo, useState } from 'react';
import type { SpellDefinition } from '../spells';
import { SPELL_LIST, rarityForSpellLevel, spellLevelLabel } from '../spells';
import { Modal } from './Modal';

interface Props {
  onPick: (spell: SpellDefinition) => void;
  onClose: () => void;
}

/** Search-and-pick modal for "Spell Scroll of <Spell>". Closing without picking (Escape,
 * backdrop click, or the Cancel button) leaves the caller's item name as plain
 * "Spell Scroll" — the user can keep typing the rest by hand. */
export function SpellScrollPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? SPELL_LIST.filter((s) => s.name.toLowerCase().includes(q)) : SPELL_LIST;
  }, [query]);

  return (
    <Modal title="Pick a Spell" onClose={onClose}>
      <p className="muted">
        Sets the item to "Spell Scroll of &lt;Spell&gt;" with its rarity (and, in a
        Purchase log, its price) from the spell's level.
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
