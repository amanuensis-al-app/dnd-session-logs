import { useState } from 'react';
import type { KnownMagicItem } from '../data/magicItems';
import { MagicItemPicker } from './MagicItemPicker';

/**
 * Magic-item name cell with two ways to fill the name (owner request 2026-07-19):
 * "✏️ Input manually" — free text, like Equipment's manual input — or "📋 Pick from
 * List", a search modal over the 5e.tools items list. Rows start in "choose" mode
 * when the name is blank (new row), in "manual" mode when it isn't (editing a log,
 * prefilled import); the pick lands in manual mode so the name stays editable
 * afterwards. Used by LogForm's gain rows and the trade "Received" field, and by
 * the Inventory tab's item edit modal.
 */
export function MagicItemNameField({
  value,
  onChangeName,
  onPick,
  autoFocus = false,
}: {
  value: string;
  onChangeName: (name: string) => void;
  onPick: (item: KnownMagicItem) => void;
  autoFocus?: boolean;
}) {
  const [mode, setMode] = useState<'choose' | 'manual'>(() => (value.trim() ? 'manual' : 'choose'));
  const [picking, setPicking] = useState(false);

  if (mode === 'manual') {
    return (
      <span className="combo">
        <input
          value={value}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="item name *"
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="btn btn-ghost btn-small"
          title="Pick from the magic items list instead"
          onClick={() => setMode('choose')}
        >
          ▾
        </button>
      </span>
    );
  }

  return (
    <span className="magic-name-choose">
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode('manual')}>
        ✏️ Input manually
      </button>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setPicking(true)}>
        📋 Pick from List
      </button>
      {picking && (
        <MagicItemPicker
          onClose={() => setPicking(false)}
          onPick={(item) => {
            setPicking(false);
            setMode('manual');
            onPick(item);
          }}
        />
      )}
    </span>
  );
}
