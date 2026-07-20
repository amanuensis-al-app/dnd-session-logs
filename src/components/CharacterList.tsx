import { useEffect, useRef, useState } from 'react';
import type { Character, DerivedStats, LogEntry, LogType } from '../types';
import { LOG_TYPE_LABELS, newId } from '../types';
import { deriveCharacter, formatGp } from '../derive';
import type { AlImportResult } from '../importAlLog';
import { prepareBackupImport, type BackupImportResult } from '../importBackup';
import { validateBundle } from '../db';
import { tierForLevel } from '../tiers';
import { Modal } from './Modal';
import { CharacterAvatar } from './CharacterAvatar';
import { GpAmount } from './GpAmount';
import { ImportAlLog } from './ImportAlLog';
import { ImportCsvLog } from './ImportCsvLog';
import { ImportLogSheet } from './ImportLogSheet';

interface Props {
  characters: Character[];
  derivedByCharacter: Map<string, DerivedStats>;
  onOpen: (characterId: string) => void;
  onCreate: (character: Character) => void;
  onImport: (character: Character, logs: LogEntry[]) => void;
  /** Adds one or more brand-new characters + logs from a backup file — see
   * importBackup.ts; never overwrites anything existing. */
  onImportBackup: (characters: Character[], logs: LogEntry[]) => void;
}

export function CharacterList({
  characters,
  derivedByCharacter,
  onOpen,
  onCreate,
  onImport,
  onImportBackup,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const [charClass, setCharClass] = useState('');
  const [importPreview, setImportPreview] = useState<{ title: string; result: AlImportResult } | null>(null);
  /** AL-log file waiting in the engine-chooser modal (Quick Import vs AI chatbot). */
  const [alImport, setAlImport] = useState<{ csvText: string; fileName: string } | null>(null);
  /** Log-sheet file waiting in the engine-chooser modal (Quick Import vs AI chatbot). */
  const [sheetImport, setSheetImport] = useState<{ csvText: string; fileName: string } | null>(null);
  /** Free-form CSV file waiting in the AI-only chatbot modal (no offline engine). */
  const [csvImport, setCsvImport] = useState<{ csvText: string; fileName: string } | null>(null);
  const [backupImportPreview, setBackupImportPreview] = useState<BackupImportResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importKindRef = useRef<'al' | 'sheet' | 'csv'>('al');
  const backupImportInputRef = useRef<HTMLInputElement>(null);
  // "Import Log Sheet" reads the owner's own private log-sheet format — not something
  // a random AMAnuensis user would have. Hidden behind typing R R Q anywhere on this
  // screen (not while typing in a field) so it doesn't confuse everyone else.
  const [logSheetUnlocked, setLogSheetUnlocked] = useState(false);

  useEffect(() => {
    const buffer: string[] = [];
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key.length !== 1) return;
      buffer.push(e.key.toLowerCase());
      if (buffer.length > 3) buffer.shift();
      if (buffer.join('') === 'rrq') setLogSheetUnlocked(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      id: newId(),
      name: name.trim(),
      species: species.trim(),
      class: charClass.trim(),
      createdAt: Date.now(),
    });
    setName('');
    setSpecies('');
    setCharClass('');
    setCreating(false);
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      // AL and log-sheet CSVs get an engine choice first (offline parser vs AI
      // chatbot); the free-form CSV kind goes straight to the AI-only modal.
      if (importKindRef.current === 'al') {
        setAlImport({ csvText: text, fileName: file.name });
      } else if (importKindRef.current === 'sheet') {
        setSheetImport({ csvText: text, fileName: file.name });
      } else {
        setCsvImport({ csvText: text, fileName: file.name });
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }

  async function handleBackupImportFile(file: File) {
    try {
      const bundle = validateBundle(JSON.parse(await file.text()));
      setBackupImportPreview(
        prepareBackupImport(
          bundle,
          characters.map((c) => c.name),
        ),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not read that file.');
    }
  }

  const preview =
    importPreview && deriveCharacter(importPreview.result.character, importPreview.result.logs);
  const typeCounts =
    importPreview &&
    importPreview.result.logs.reduce((map, log) => {
      map.set(log.type, (map.get(log.type) ?? 0) + 1);
      return map;
    }, new Map<LogType, number>());

  // Highest level first, then name (the props come in creation order).
  const sorted = [...characters].sort(
    (a, b) =>
      (derivedByCharacter.get(b.id)?.level ?? 1) - (derivedByCharacter.get(a.id)?.level ?? 1) ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="character-list">
      <div className="page-heading">
        <h1>Characters</h1>
        <div className="page-heading-actions">
          <button
            className="btn btn-ghost"
            onClick={() => {
              importKindRef.current = 'al';
              importInputRef.current?.click();
            }}
            title="Import a character from an adventurersleaguelog.com CSV export"
          >
            Import AL Log
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              importKindRef.current = 'csv';
              importInputRef.current?.click();
            }}
            title="Import a character from any CSV play log — an AI chatbot works out the format and converts it"
          >
            Import CSV Log
          </button>
          {logSheetUnlocked && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                importKindRef.current = 'sheet';
                importInputRef.current?.click();
              }}
              title="Import a character from a personal log-sheet CSV (Adventure/Trade/Purchase columns)"
            >
              Import Log Sheet
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => backupImportInputRef.current?.click()}
            title="Import character(s) from an AMAnuensis backup file (Backup All or Backup Character) — always added as new, never overwrites anything"
          >
            Import Backup
          </button>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New Character'}
          </button>
        </div>
        <input
          ref={backupImportInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleBackupImportFile(file);
            e.target.value = '';
          }}
        />
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImportFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {creating && (
        <form className="card form-card" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Name *
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Thistle Brambleburr"
                required
              />
            </label>
            <label>
              Species
              <input
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                placeholder="e.g. Halfling"
              />
            </label>
            <label>
              Class
              <input
                value={charClass}
                onChange={(e) => setCharClass(e.target.value)}
                placeholder="e.g. Rogue"
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Create Character
            </button>
          </div>
        </form>
      )}

      {characters.length === 0 && !creating ? (
        <div className="empty-state">
          <p>No characters yet.</p>
          <p className="muted">
            Create a character, then use a <strong>Starting Log</strong> to record their
            starting gold and equipment.
          </p>
        </div>
      ) : (
        <div className="character-grid">
          {sorted.map((c) => {
            const d = derivedByCharacter.get(c.id)!;
            return (
              <button
                key={c.id}
                className={`card character-card tier-${tierForLevel(d.level)}`}
                onClick={() => onOpen(c.id)}
              >
                <div className="character-card-header">
                  <CharacterAvatar character={c} size={48} />
                  <div>
                    <div className="character-card-name">{c.name}</div>
                    <div className="character-card-sub muted">
                      {[c.species, c.class].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                </div>
                <div className="character-card-stats">
                  <span>
                    <strong>Lv {d.level}</strong>
                  </span>
                  <span>
                    <GpAmount value={d.gp} /> gp
                  </span>
                  <span>{d.downtimeDays} downtime</span>
                  <span>{d.sessionsPlayed} sessions played</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {alImport && (
        <ImportAlLog
          csvText={alImport.csvText}
          fileName={alImport.fileName}
          onClose={() => setAlImport(null)}
          onResult={(result) => {
            setAlImport(null);
            setImportPreview({ title: 'Import from Adventurers League Log', result });
          }}
        />
      )}

      {sheetImport && (
        <ImportLogSheet
          csvText={sheetImport.csvText}
          fileName={sheetImport.fileName}
          onClose={() => setSheetImport(null)}
          onResult={(result) => {
            setSheetImport(null);
            setImportPreview({ title: 'Import from Log Sheet', result });
          }}
        />
      )}

      {csvImport && (
        <ImportCsvLog
          csvText={csvImport.csvText}
          fileName={csvImport.fileName}
          onClose={() => setCsvImport(null)}
          onResult={(result) => {
            setCsvImport(null);
            setImportPreview({ title: 'Import from CSV Log', result });
          }}
        />
      )}

      {importPreview && preview && typeCounts && (
        <Modal title={importPreview.title} onClose={() => setImportPreview(null)}>
          <p>
            <strong>{importPreview.result.character.name}</strong>
            {[importPreview.result.character.species, importPreview.result.character.class]
              .filter(Boolean)
              .map((s) => ` · ${s}`)
              .join('')}
          </p>
          <p>
            {importPreview.result.logs.length} log(s):{' '}
            {[...typeCounts.entries()]
              .map(([type, count]) => `${count} ${LOG_TYPE_LABELS[type]}`)
              .join(', ') || 'none'}
          </p>
          <p>
            Result: <strong>Lv {preview.level}</strong> · {formatGp(preview.gp)} gp ·{' '}
            {preview.downtimeDays} downtime · {preview.inventory.length} item(s)
          </p>
          {importPreview.result.warnings.length > 0 && (
            <>
              <p className="muted">
                Best-effort notes — review these after importing (each log stays editable):
              </p>
              <ul className="import-warnings">
                {importPreview.result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setImportPreview(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onImport(importPreview.result.character, importPreview.result.logs);
                setImportPreview(null);
              }}
            >
              Import Character
            </button>
          </div>
        </Modal>
      )}

      {backupImportPreview && (
        <Modal title="Import from Backup" onClose={() => setBackupImportPreview(null)}>
          <p>
            This file contains <strong>{backupImportPreview.characters.length}</strong> character
            {backupImportPreview.characters.length === 1 ? '' : 's'} and{' '}
            <strong>{backupImportPreview.logs.length}</strong> log(s).
          </p>
          <ul className="import-warnings">
            {backupImportPreview.characters.map((c) => (
              <li key={c.id}>
                {c.name}
                {[c.species, c.class].filter(Boolean).length > 0 &&
                  ` — ${[c.species, c.class].filter(Boolean).join(' · ')}`}
              </li>
            ))}
          </ul>
          {backupImportPreview.renames.length > 0 && (
            <>
              <p className="muted">Renamed to avoid clashing with a character you already have:</p>
              <ul className="import-warnings">
                {backupImportPreview.renames.map((r, i) => (
                  <li key={i}>
                    {r.from} → {r.to}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            Imported as brand-new character{backupImportPreview.characters.length === 1 ? '' : 's'} —
            nothing you already have is changed or overwritten.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setBackupImportPreview(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onImportBackup(backupImportPreview.characters, backupImportPreview.logs);
                setBackupImportPreview(null);
              }}
            >
              Import {backupImportPreview.characters.length === 1
                ? 'Character'
                : `${backupImportPreview.characters.length} Characters`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
