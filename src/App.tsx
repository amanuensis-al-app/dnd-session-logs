import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db';
import { deriveCharacter } from './derive';
import type { Character, ExportBundle, LogEntry } from './types';
import { CharacterList } from './components/CharacterList';
import { CharacterSheet } from './components/CharacterSheet';
import { Modal } from './components/Modal';

type View = { screen: 'list' } | { screen: 'character'; characterId: string };

/** Steps of the restore flow that need a modal; null = no modal open. */
type RestoreStep = { step: 'warn-unbacked' } | { step: 'choose-mode'; bundle: ExportBundle } | null;

const LAST_BACKUP_KEY = 'al-tracker:lastBackupAt';
const LAST_CHANGE_KEY = 'al-tracker:lastChangeAt';

/** ISO timestamps compare lexically, so string > is chronological. */
function readHasUnbackedChanges(): boolean {
  const changed = localStorage.getItem(LAST_CHANGE_KEY);
  if (!changed) return false;
  const backedUp = localStorage.getItem(LAST_BACKUP_KEY);
  return !backedUp || changed > backedUp;
}

/**
 * One-time migration (2026-07-19): "Attunement Not Required" used to be a
 * per-character mark (`AttunementState = 'not-required'`); it is now a property of
 * the magic item itself (`GainedItem.requiresAttunement`). Moves every legacy
 * 'not-required' mark onto its item in the item's source log (magic items are
 * non-stacked, so the id lives in exactly one log) and strips it from the
 * character; 'attuned' marks keep their meaning untouched. Self-terminating — once
 * no 'not-required' marks remain there is nothing to do — and also runs after a
 * restore, which can reintroduce legacy data from an old backup file.
 */
async function migrateLegacyAttunement(
  characters: Character[],
  logs: LogEntry[],
): Promise<{ characters: Character[]; logs: LogEntry[]; migrated: boolean }> {
  const notRequired = new Set<string>();
  for (const c of characters) {
    for (const [itemId, state] of Object.entries(c.attunement ?? {})) {
      // The narrowed AttunementState no longer names the legacy value — compare as string.
      if ((state as string) === 'not-required') notRequired.add(itemId);
    }
  }
  if (notRequired.size === 0) return { characters, logs, migrated: false };

  const nextLogs = logs.map((log) => {
    if (!log.itemsGained.some((item) => notRequired.has(item.id))) return log;
    return {
      ...log,
      itemsGained: log.itemsGained.map((item) =>
        notRequired.has(item.id) ? { ...item, requiresAttunement: false } : item,
      ),
    };
  });
  const nextCharacters = characters.map((c) => {
    if (!Object.values(c.attunement ?? {}).some((s) => (s as string) === 'not-required')) return c;
    return {
      ...c,
      attunement: Object.fromEntries(
        Object.entries(c.attunement ?? {}).filter(([, s]) => (s as string) !== 'not-required'),
      ),
    };
  });
  for (let i = 0; i < logs.length; i++) {
    if (nextLogs[i] !== logs[i]) await db.putLog(nextLogs[i]);
  }
  for (let i = 0; i < characters.length; i++) {
    if (nextCharacters[i] !== characters[i]) await db.putCharacter(nextCharacters[i]);
  }
  return { characters: nextCharacters, logs: nextLogs, migrated: true };
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [view, setView] = useState<View>({ screen: 'list' });
  const [hasUnbackedChanges, setHasUnbackedChanges] = useState(readHasUnbackedChanges);
  const [restore, setRestore] = useState<RestoreStep>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  function markChanged() {
    localStorage.setItem(LAST_CHANGE_KEY, new Date().toISOString());
    setHasUnbackedChanges(true);
  }

  function markBackedUp() {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    setHasUnbackedChanges(false);
  }

  useEffect(() => {
    Promise.all([db.getAllCharacters(), db.getAllLogs()]).then(async ([chars, allLogs]) => {
      const migrated = await migrateLegacyAttunement(chars, allLogs);
      if (migrated.migrated) markChanged();
      setCharacters(migrated.characters.sort((a, b) => a.createdAt - b.createdAt));
      setLogs(migrated.logs);
      setLoaded(true);
    });
  }, []);

  const derivedByCharacter = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveCharacter>>();
    for (const c of characters) map.set(c.id, deriveCharacter(c, logs));
    return map;
  }, [characters, logs]);

  async function saveCharacter(character: Character) {
    await db.putCharacter(character);
    setCharacters((prev) => {
      const i = prev.findIndex((c) => c.id === character.id);
      if (i === -1) return [...prev, character];
      const next = [...prev];
      next[i] = character;
      return next;
    });
    markChanged();
  }

  async function removeCharacter(characterId: string) {
    await db.deleteCharacter(characterId);
    setCharacters((prev) => prev.filter((c) => c.id !== characterId));
    setLogs((prev) => prev.filter((l) => l.characterId !== characterId));
    setView({ screen: 'list' });
    markChanged();
  }

  async function importCharacter(character: Character, importedLogs: LogEntry[]) {
    await db.putCharacter(character);
    for (const log of importedLogs) await db.putLog(log);
    setCharacters((prev) => [...prev, character]);
    setLogs((prev) => [...prev, ...importedLogs]);
    markChanged();
    setView({ screen: 'character', characterId: character.id });
  }

  async function saveLog(log: LogEntry) {
    await db.putLog(log);
    setLogs((prev) => {
      const i = prev.findIndex((l) => l.id === log.id);
      if (i === -1) return [...prev, log];
      const next = [...prev];
      next[i] = log;
      return next;
    });
    markChanged();
  }

  async function removeLog(logId: string) {
    await db.deleteLog(logId);
    setLogs((prev) => prev.filter((l) => l.id !== logId));
    markChanged();
  }

  async function handleBackup() {
    const bundle = await db.exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `al-tracker-backup-${bundle.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markBackedUp();
  }

  function handleRestoreClick() {
    if (hasUnbackedChanges) setRestore({ step: 'warn-unbacked' });
    else restoreInputRef.current?.click();
  }

  async function handleRestoreFile(file: File) {
    let bundle: ExportBundle;
    try {
      bundle = db.validateBundle(JSON.parse(await file.text()));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that file.');
      return;
    }
    setRestore({ step: 'choose-mode', bundle });
  }

  async function applyRestore(bundle: ExportBundle, mode: 'replace' | 'merge') {
    setRestore(null);
    await db.importData(bundle, mode);
    const [chars, allLogs] = await Promise.all([db.getAllCharacters(), db.getAllLogs()]);
    // An old backup can reintroduce legacy 'not-required' marks — migrate them again.
    const migrated = await migrateLegacyAttunement(chars, allLogs);
    setCharacters(migrated.characters.sort((a, b) => a.createdAt - b.createdAt));
    setLogs(migrated.logs);
    setView({ screen: 'list' });
    // After a full replace the local data equals the backup file, so nothing is unbacked
    // — unless the migration rewrote it, in which case it no longer matches the file.
    // A merge can produce a combined state that exists in no file — still needs a backup.
    if (mode === 'replace' && !migrated.migrated) markBackedUp();
    else markChanged();
  }

  if (!loaded) return <div className="app-loading">Loading…</div>;

  const activeCharacter =
    view.screen === 'character' ? characters.find((c) => c.id === view.characterId) : undefined;

  return (
    <div className="app">
      <header className="app-header">
        <button className="app-title" onClick={() => setView({ screen: 'list' })}>
          <span className="app-title-icon">⚔️</span> AL Tracker
        </button>
        <div className="app-header-actions">
          <button
            className="btn btn-ghost"
            onClick={handleBackup}
            title="Download a backup of all data as JSON"
          >
            Backup
          </button>
          <button
            className="btn btn-ghost"
            onClick={handleRestoreClick}
            title="Restore data from a backup file"
          >
            Restore
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleRestoreFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </header>

      <main className="app-main">
        {activeCharacter ? (
          <CharacterSheet
            character={activeCharacter}
            derived={derivedByCharacter.get(activeCharacter.id)!}
            logs={logs}
            onSaveCharacter={saveCharacter}
            onDeleteCharacter={removeCharacter}
            onSaveLog={saveLog}
            onDeleteLog={removeLog}
            onBack={() => setView({ screen: 'list' })}
          />
        ) : (
          <CharacterList
            characters={characters}
            derivedByCharacter={derivedByCharacter}
            onOpen={(id) => setView({ screen: 'character', characterId: id })}
            onCreate={saveCharacter}
            onImport={importCharacter}
          />
        )}
      </main>

      {hasUnbackedChanges && (
        <div className="unbacked-indicator" role="status">
          <span>
            You have unexported changes. Back them up before closing your browser to prevent
            data loss.
          </span>
          <button className="btn btn-small btn-primary" onClick={handleBackup}>
            Backup now
          </button>
        </div>
      )}

      {restore?.step === 'warn-unbacked' && (
        <Modal title="Unexported changes" onClose={() => setRestore(null)}>
          <p>
            You have changes that haven't been backed up yet. Restoring can overwrite them, and
            once overwritten they can't be recovered.
          </p>
          <p className="muted">Tip: hit Cancel and use Backup first, then restore safely.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setRestore(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setRestore(null);
                restoreInputRef.current?.click();
              }}
            >
              Restore anyway
            </button>
          </div>
        </Modal>
      )}

      {restore?.step === 'choose-mode' && (
        <Modal title="Restore from backup" onClose={() => setRestore(null)}>
          <p>
            This backup contains <strong>{restore.bundle.characters.length}</strong> character(s)
            and <strong>{restore.bundle.logs.length}</strong> log(s).
          </p>
          <p className="muted">
            Replace wipes all current data first. Merge updates by id and is safe to repeat.
          </p>
          <div className="modal-actions">
            <button
              className="btn btn-danger"
              onClick={() => applyRestore(restore.bundle, 'replace')}
            >
              Replace everything
            </button>
            <button
              className="btn btn-primary"
              onClick={() => applyRestore(restore.bundle, 'merge')}
            >
              Merge into existing data
            </button>
            <button className="btn btn-ghost" onClick={() => setRestore(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
