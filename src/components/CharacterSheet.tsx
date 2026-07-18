import { useState } from 'react';
import type { AttunementState, Character, DerivedStats, LogEntry } from '../types';
import { formatGp, knownValues, logsForCharacter } from '../derive';
import { Inventory } from './Inventory';
import { Prep } from './Prep';
import { LogHistory } from './LogHistory';
import { LogForm } from './LogForm';
import { AddLogFromText } from './AddLogFromText';
import { CharacterAvatar } from './CharacterAvatar';
import { AvatarEditor } from './AvatarEditor';

/** 'new' = adding, LogEntry = editing that log, prefill = new log parsed from
 * pasted text (with review warnings), null = form closed. */
type LogDraftState = 'new' | LogEntry | { prefill: LogEntry; warnings: string[] } | null;

interface Props {
  character: Character;
  derived: DerivedStats;
  logs: LogEntry[];
  onSaveCharacter: (character: Character) => void;
  onDeleteCharacter: (characterId: string) => void;
  onSaveLog: (log: LogEntry) => void;
  onDeleteLog: (logId: string) => void;
  onBack: () => void;
}

export function CharacterSheet({
  character,
  derived,
  logs,
  onSaveCharacter,
  onDeleteCharacter,
  onSaveLog,
  onDeleteLog,
  onBack,
}: Props) {
  const [tab, setTab] = useState<'inventory' | 'prep' | 'logs'>('inventory');
  const [logDraft, setLogDraft] = useState<LogDraftState>(null);
  const [showTextImport, setShowTextImport] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingIcon, setEditingIcon] = useState(false);
  const [name, setName] = useState(character.name);
  const [species, setSpecies] = useState(character.species);
  const [charClass, setCharClass] = useState(character.class);

  const characterLogs = logsForCharacter(logs, character.id);

  function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSaveCharacter({
      ...character,
      name: name.trim(),
      species: species.trim(),
      class: charClass.trim(),
    });
    setEditing(false);
  }

  /** Equip toggle: present in itemMarks = equipped, absent = not. */
  function toggleItemMark(itemId: string) {
    const itemMarks = { ...character.itemMarks };
    if (itemMarks[itemId]) delete itemMarks[itemId];
    else itemMarks[itemId] = 'equipped';
    onSaveCharacter({ ...character, itemMarks });
  }

  /** Sets (or clears, if undefined) a magic item's attunement state — Prep's
   * dropdown picks the value directly, this just persists it. */
  function setItemAttunement(itemId: string, state: AttunementState | undefined) {
    const attunement = { ...character.attunement };
    if (state) attunement[itemId] = state;
    else delete attunement[itemId];
    onSaveCharacter({ ...character, attunement });
  }

  return (
    <div className="character-sheet">
      <button className="btn btn-ghost back-link" onClick={onBack}>
        ← All characters
      </button>

      <div className="card sheet-header">
        {editing ? (
          <form onSubmit={saveEdit}>
            <div className="sheet-avatar-edit">
              <button
                type="button"
                className="sheet-avatar-edit-button"
                onClick={() => setEditingIcon(true)}
                title="Change character icon"
              >
                <CharacterAvatar character={character} size={72} />
                <span className="sheet-avatar-edit-overlay">✎</span>
              </button>
              {character.icon && (
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => onSaveCharacter({ ...character, icon: undefined })}
                >
                  Remove Icon
                </button>
              )}
            </div>
            <div className="form-grid">
              <label>
                Name *
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label>
                Species
                <input value={species} onChange={(e) => setSpecies(e.target.value)} />
              </label>
              <label>
                Class
                <input value={charClass} onChange={(e) => setCharClass(e.target.value)} />
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Save
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${character.name} and all ${characterLogs.length} of their logs? This cannot be undone.`,
                    )
                  ) {
                    onDeleteCharacter(character.id);
                  }
                }}
              >
                Delete Character
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="sheet-header-top">
              <div className="sheet-header-identity">
                <CharacterAvatar character={character} size={72} />
                <div>
                  <h1>{character.name}</h1>
                  <div className="muted">
                    {[character.species, character.class].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
            <div className="stat-row">
              <div className="stat">
                <div className="stat-value">{derived.level}</div>
                <div className="stat-label">Level</div>
              </div>
              <div className="stat">
                <div className="stat-value">{formatGp(derived.gp)}</div>
                <div className="stat-label">GP</div>
              </div>
              <div className="stat">
                <div className="stat-value">{derived.downtimeDays}</div>
                <div className="stat-label">Downtime Days</div>
              </div>
              <div className="stat">
                <div className="stat-value">
                  {derived.inventory.filter((i) => i.category === 'magic_item').length}
                </div>
                <div className="stat-label">Magic Items Owned</div>
              </div>
            </div>
          </>
        )}
      </div>

      {editingIcon && (
        <AvatarEditor
          onSave={(icon) => {
            onSaveCharacter({ ...character, icon });
            setEditingIcon(false);
          }}
          onClose={() => setEditingIcon(false)}
        />
      )}

      <div className="sheet-toolbar">
        <div className="tabs">
          <button
            className={tab === 'inventory' ? 'tab active' : 'tab'}
            onClick={() => setTab('inventory')}
          >
            Inventory
          </button>
          <button className={tab === 'prep' ? 'tab active' : 'tab'} onClick={() => setTab('prep')}>
            Prep
          </button>
          <button className={tab === 'logs' ? 'tab active' : 'tab'} onClick={() => setTab('logs')}>
            Logs ({characterLogs.length})
          </button>
        </div>
        <div className="sheet-toolbar-actions">
          <button
            className="btn"
            title="Paste a session write-up (e.g. from Discord) and get the form prefilled"
            onClick={() => setShowTextImport(true)}
          >
            + Add Log from Text
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              setLogDraft('new');
              setTab('logs');
            }}
          >
            + Add Log
          </button>
        </div>
      </div>

      {showTextImport && (
        <AddLogFromText
          characterId={character.id}
          onClose={() => setShowTextImport(false)}
          onDraft={(log, warnings) => {
            setShowTextImport(false);
            setLogDraft({ prefill: log, warnings });
            setTab('logs');
          }}
        />
      )}

      {/* Built once; rendered at the top when adding (blank or prefilled from text),
          or in place of the edited log inside LogHistory when editing. */}
      {(() => {
        const editingLog =
          logDraft !== null && logDraft !== 'new' && !('prefill' in logDraft) ? logDraft : null;
        const prefillDraft =
          logDraft !== null && logDraft !== 'new' && 'prefill' in logDraft ? logDraft : null;
        const logForm =
          logDraft !== null ? (
            <LogForm
              key={logDraft === 'new' ? 'new' : (editingLog?.id ?? prefillDraft?.prefill.id)}
              character={character}
              derived={derived}
              characterLogs={characterLogs}
              knownDMs={knownValues(logs, 'dm')}
              knownLocations={knownValues(logs, 'location')}
              existingLog={editingLog ?? undefined}
              prefill={prefillDraft?.prefill}
              onSave={(log) => {
                onSaveLog(log);
                setLogDraft(null);
                setTab('logs');
              }}
              onCancel={() => setLogDraft(null)}
            />
          ) : null;

        return (
          <>
            {(logDraft === 'new' || prefillDraft) && (
              /* hidden, not unmounted, off the Logs tab — a half-typed draft must
                 survive switching to Inventory and back */
              <div hidden={tab !== 'logs'}>
                {prefillDraft && prefillDraft.warnings.length > 0 && (
                  <div className="warning import-draft-warnings">
                    <strong>Filled in from your text — please check:</strong>
                    <ul>
                      {prefillDraft.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {logForm}
              </div>
            )}

            {tab === 'inventory' && (
              <Inventory character={character} derived={derived} onToggleMark={toggleItemMark} />
            )}
            {tab === 'prep' && (
              <Prep
                character={character}
                derived={derived}
                onToggleMark={toggleItemMark}
                onSetAttunement={setItemAttunement}
              />
            )}
            {/* Always mounted (hidden off the Logs tab) so an in-place edit form's
               draft survives tab switches, same as the add form above. */}
            <div hidden={tab !== 'logs'}>
              <LogHistory
                logs={characterLogs}
                derived={derived}
                editingLogId={editingLog?.id}
                editForm={editingLog ? logForm : null}
                onEditLog={(log) => setLogDraft(log)}
                onDeleteLog={(logId) => {
                  if (editingLog?.id === logId) {
                    setLogDraft(null);
                  }
                  onDeleteLog(logId);
                }}
              />
            </div>
          </>
        );
      })()}
    </div>
  );
}
