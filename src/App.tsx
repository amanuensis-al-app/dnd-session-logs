import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db';
import { deriveCharacter } from './derive';
import type { Character, ExportBundle, LogEntry } from './types';
import { EXAMPLE_CHARACTER, EXAMPLE_LOGS } from './exampleCharacter';
import { CharacterList } from './components/CharacterList';
import { CharacterSheet } from './components/CharacterSheet';
import { Modal } from './components/Modal';

type View = { screen: 'list' } | { screen: 'character'; characterId: string };

/** Steps of the restore flow that need a modal; null = no modal open. */
type RestoreStep = { step: 'warn-unbacked' } | { step: 'choose-mode'; bundle: ExportBundle } | null;

const LAST_BACKUP_KEY = 'al-tracker:lastBackupAt';
const LAST_CHANGE_KEY = 'al-tracker:lastChangeAt';
const GUIDE_OPENED_KEY = 'al-tracker:guideOpened';
const EXAMPLE_SEEDED_KEY = 'al-tracker:exampleSeeded';

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

/**
 * First-ever visit only (added 2026-07-25): seeds one bundled example character
 * (see exampleCharacter.ts) so a brand-new browser sees a filled-out example
 * instead of a blank list. Runs at most once per browser, tracked by
 * EXAMPLE_SEEDED_KEY — set right away regardless of outcome, so deleting the
 * example character afterward (or restoring a backup that happens to be empty)
 * never brings it back. Only actually inserts anything the FIRST time this runs
 * with zero existing characters — an existing user's data is never touched.
 */
async function seedExampleCharacter(
  characters: Character[],
  logs: LogEntry[],
): Promise<{ characters: Character[]; logs: LogEntry[] }> {
  if (localStorage.getItem(EXAMPLE_SEEDED_KEY)) return { characters, logs };
  localStorage.setItem(EXAMPLE_SEEDED_KEY, '1');
  if (characters.length > 0) return { characters, logs };

  const character: Character = { ...EXAMPLE_CHARACTER, createdAt: Date.now() };
  await db.putCharacter(character);
  for (const log of EXAMPLE_LOGS) await db.putLog(log);
  return { characters: [character], logs: EXAMPLE_LOGS };
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [view, setView] = useState<View>({ screen: 'list' });
  const [hasUnbackedChanges, setHasUnbackedChanges] = useState(readHasUnbackedChanges);
  // Whether the player's guide has ever been opened in this browser — drives the
  // glowing "unread" dot on the header's Guide link until they click it once.
  const [guideOpened, setGuideOpened] = useState(
    () => localStorage.getItem(GUIDE_OPENED_KEY) === '1',
  );
  const [restore, setRestore] = useState<RestoreStep>(null);
  // Which character a Restore flow is scoped to (set right before the file picker
  // opens), or undefined for the whole-collection "Restore All". Read by
  // handleRestoreFile/applyRestore once the user picks a file.
  const [restoreScope, setRestoreScope] = useState<string | undefined>(undefined);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  function markChanged() {
    localStorage.setItem(LAST_CHANGE_KEY, new Date().toISOString());
    setHasUnbackedChanges(true);
  }

  function markBackedUp() {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    setHasUnbackedChanges(false);
  }

  function markGuideOpened() {
    localStorage.setItem(GUIDE_OPENED_KEY, '1');
    setGuideOpened(true);
  }

  useEffect(() => {
    Promise.all([db.getAllCharacters(), db.getAllLogs()]).then(async ([chars, allLogs]) => {
      // Seeded data doesn't count as an "unbacked change" — it's factory-installed,
      // not something the user did, so it shouldn't trigger the backup reminder.
      const seeded = await seedExampleCharacter(chars, allLogs);
      const migrated = await migrateLegacyAttunement(seeded.characters, seeded.logs);
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

  /** "Import Backup" — one or more brand-new characters + logs, already prepared
   * (fresh ids, clash-free names) by importBackup.ts. Jumps to the character page
   * only when there's exactly one; a whole-collection backup just adds to the list. */
  async function importBackup(newCharacters: Character[], newLogs: LogEntry[]) {
    for (const character of newCharacters) await db.putCharacter(character);
    for (const log of newLogs) await db.putLog(log);
    setCharacters((prev) => [...prev, ...newCharacters]);
    setLogs((prev) => [...prev, ...newLogs]);
    markChanged();
    if (newCharacters.length === 1) setView({ screen: 'character', characterId: newCharacters[0].id });
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

  function downloadBundle(bundle: ExportBundle, filename: string) {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleBackup() {
    const bundle = await db.exportData();
    downloadBundle(bundle, `amanuensis-backup-${bundle.exportedAt.slice(0, 10)}.json`);
    markBackedUp();
  }

  /** Downloads just one character + their own logs. Deliberately does NOT call
   * markBackedUp() — that flag means ALL data is backed up, which a single
   * character's export doesn't cover; the global indicator should stay accurate. */
  function handleBackupCharacter(target: Character) {
    const exportedAt = new Date().toISOString();
    const bundle: ExportBundle = {
      app: 'al-tracker',
      version: 1,
      exportedAt,
      characters: [target],
      logs: logs.filter((l) => l.characterId === target.id),
    };
    const slug =
      target.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'character';
    downloadBundle(bundle, `amanuensis-${slug}-backup-${exportedAt.slice(0, 10)}.json`);
  }

  /** Opens the restore flow. `characterId` scopes it to that one character (from a
   * character sheet's "Restore Character" button); omitted = whole-collection
   * "Restore All" from the header. */
  function handleRestoreClick(characterId?: string) {
    setRestoreScope(characterId);
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
    if (restoreScope && (bundle.characters.length !== 1 || bundle.characters[0].id !== restoreScope)) {
      alert(
        'This file isn’t a single-character backup for this character. Use a file made by ' +
          'this character’s own "Backup Character" button, or use "Restore All" from the ' +
          'Characters screen for whole-collection backups.',
      );
      return;
    }
    setRestore({ step: 'choose-mode', bundle });
  }

  function closeRestore() {
    setRestore(null);
    setRestoreScope(undefined);
  }

  async function applyRestore(bundle: ExportBundle, mode: 'replace' | 'merge') {
    setRestore(null);
    const scope = restoreScope;
    setRestoreScope(undefined);

    if (scope) {
      // Scoped to one character: 'replace' wipes just THIS character's existing logs
      // first (their logs end up exactly matching the bundle); 'merge' upserts by id
      // and leaves any of this character's logs that aren't in the bundle untouched
      // — same replace/merge semantics as the whole-collection restore, just scoped
      // down to the one character (already validated to match this bundle's id).
      if (mode === 'replace') {
        for (const log of logs.filter((l) => l.characterId === scope)) await db.deleteLog(log.id);
      }
      await db.putCharacter(bundle.characters[0]);
      for (const l of bundle.logs) await db.putLog(l);
      const [chars, allLogs] = await Promise.all([db.getAllCharacters(), db.getAllLogs()]);
      const migrated = await migrateLegacyAttunement(chars, allLogs);
      setCharacters(migrated.characters.sort((a, b) => a.createdAt - b.createdAt));
      setLogs(migrated.logs);
      markChanged();
      return;
    }

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
        <div className="app-title-wrap">
          <button className="app-title" onClick={() => setView({ screen: 'list' })}>
            <img
              className="app-title-icon"
              src={`${import.meta.env.BASE_URL}ama-icon.png`}
              alt=""
            />
            AMAnuensis
          </button>
          <a
            className="app-version"
            href="https://github.com/amanuensis-al-app/dnd-session-logs"
            target="_blank"
            rel="noreferrer"
            title="View on GitHub"
          >
            v{__APP_VERSION__}
          </a>
          <a
            className={`app-version guide-link${guideOpened ? '' : ' guide-link-unread'}`}
            href={`${import.meta.env.BASE_URL}guide.html`}
            target="_blank"
            rel="noreferrer"
            title="Getting-started guide"
            onClick={markGuideOpened}
          >
            Guide
          </a>
        </div>
        <div className="app-header-actions">
          <button
            className="btn btn-ghost"
            onClick={handleBackup}
            title="Download a backup of all characters' data as JSON"
          >
            Backup All
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => handleRestoreClick()}
            title="Restore data from a backup file"
          >
            Restore All
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
            characters={characters}
            onSaveCharacter={saveCharacter}
            onDeleteCharacter={removeCharacter}
            onSaveLog={saveLog}
            onDeleteLog={removeLog}
            onBack={() => setView({ screen: 'list' })}
            onBackupCharacter={() => handleBackupCharacter(activeCharacter)}
            onRestoreCharacter={() => handleRestoreClick(activeCharacter.id)}
          />
        ) : (
          <CharacterList
            characters={characters}
            derivedByCharacter={derivedByCharacter}
            onOpen={(id) => setView({ screen: 'character', characterId: id })}
            onCreate={saveCharacter}
            onImport={importCharacter}
            onImportBackup={importBackup}
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
        <Modal title="Unexported changes" onClose={closeRestore}>
          <p>
            You have changes that haven't been backed up yet. Restoring can overwrite them, and
            once overwritten they can't be recovered.
          </p>
          <p className="muted">Tip: hit Cancel and use Backup first, then restore safely.</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={closeRestore}>
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
        <Modal
          title={restoreScope ? `Restore ${restore.bundle.characters[0]?.name ?? 'Character'}` : 'Restore from backup'}
          onClose={closeRestore}
        >
          {restoreScope ? (
            <>
              <p>
                This backup contains <strong>{restore.bundle.characters[0]?.name}</strong>'s data:{' '}
                <strong>{restore.bundle.logs.length}</strong> log(s).
              </p>
              <p className="muted">
                Replace wipes this character's existing logs first. Merge updates by id and is
                safe to repeat.
              </p>
            </>
          ) : (
            <>
              <p>
                This backup contains <strong>{restore.bundle.characters.length}</strong> character(s)
                and <strong>{restore.bundle.logs.length}</strong> log(s).
              </p>
              <p className="muted">
                Replace wipes all current data first. Merge updates by id and is safe to repeat.
              </p>
            </>
          )}
          <div className="modal-actions">
            <button
              className="btn btn-danger"
              onClick={() => applyRestore(restore.bundle, 'replace')}
            >
              {restoreScope ? "Replace this character's logs" : 'Replace everything'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => applyRestore(restore.bundle, 'merge')}
            >
              {restoreScope ? 'Merge into this character' : 'Merge into existing data'}
            </button>
            <button className="btn btn-ghost" onClick={closeRestore}>
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
