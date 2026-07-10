import { useEffect, useMemo, useRef, useState } from 'react';
import * as db from './db';
import { deriveCharacter } from './derive';
import type { Character, ExportBundle, LogEntry } from './types';
import { CharacterList } from './components/CharacterList';
import { CharacterSheet } from './components/CharacterSheet';

type View = { screen: 'list' } | { screen: 'character'; characterId: string };

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [view, setView] = useState<View>({ screen: 'list' });
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([db.getAllCharacters(), db.getAllLogs()]).then(([chars, allLogs]) => {
      setCharacters(chars.sort((a, b) => a.createdAt - b.createdAt));
      setLogs(allLogs);
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
  }

  async function removeCharacter(characterId: string) {
    await db.deleteCharacter(characterId);
    setCharacters((prev) => prev.filter((c) => c.id !== characterId));
    setLogs((prev) => prev.filter((l) => l.characterId !== characterId));
    setView({ screen: 'list' });
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
  }

  async function removeLog(logId: string) {
    await db.deleteLog(logId);
    setLogs((prev) => prev.filter((l) => l.id !== logId));
  }

  async function handleExport() {
    const bundle = await db.exportData();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `al-tracker-export-${bundle.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    let bundle: ExportBundle;
    try {
      bundle = db.validateBundle(JSON.parse(await file.text()));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that file.');
      return;
    }
    const merge = confirm(
      `Import ${bundle.characters.length} character(s) and ${bundle.logs.length} log(s).\n\n` +
        'OK = merge into existing data (upserts by id, safe to repeat)\n' +
        'Cancel = replace everything instead',
    );
    if (!merge && !confirm('REPLACE all existing local data with the file contents?')) return;
    await db.importData(bundle, merge ? 'merge' : 'replace');
    const [chars, allLogs] = await Promise.all([db.getAllCharacters(), db.getAllLogs()]);
    setCharacters(chars.sort((a, b) => a.createdAt - b.createdAt));
    setLogs(allLogs);
    setView({ screen: 'list' });
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
          <button className="btn btn-ghost" onClick={handleExport} title="Download all data as JSON">
            Export
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => importInputRef.current?.click()}
            title="Import a JSON export"
          >
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
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
          />
        )}
      </main>
    </div>
  );
}
