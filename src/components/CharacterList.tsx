import { useRef, useState } from 'react';
import type { Character, DerivedStats, LogEntry, LogType } from '../types';
import { LOG_TYPE_LABELS, newId } from '../types';
import { deriveCharacter, formatGp } from '../derive';
import { importAlLog, type AlImportResult } from '../importAlLog';
import { importSheetLog } from '../importSheetLog';
import { Modal } from './Modal';

interface Props {
  characters: Character[];
  derivedByCharacter: Map<string, DerivedStats>;
  onOpen: (characterId: string) => void;
  onCreate: (character: Character) => void;
  onImport: (character: Character, logs: LogEntry[]) => void;
}

export function CharacterList({ characters, derivedByCharacter, onOpen, onCreate, onImport }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const [charClass, setCharClass] = useState('');
  const [importPreview, setImportPreview] = useState<{ title: string; result: AlImportResult } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const importKindRef = useRef<'al' | 'sheet'>('al');

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
      setImportPreview(
        importKindRef.current === 'al'
          ? { title: 'Import from Adventurers League Log', result: importAlLog(text) }
          : { title: 'Import from Log Sheet', result: importSheetLog(text, file.name) }
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
              importKindRef.current = 'sheet';
              importInputRef.current?.click();
            }}
            title="Import a character from a personal log-sheet CSV (Adventure/Trade/Purchase columns)"
          >
            Import Log Sheet
          </button>
          <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New Character'}
          </button>
        </div>
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
            Create a character, then use a <strong>Creation</strong> log to record their
            starting gold and equipment.
          </p>
        </div>
      ) : (
        <div className="character-grid">
          {characters.map((c) => {
            const d = derivedByCharacter.get(c.id)!;
            return (
              <button key={c.id} className="card character-card" onClick={() => onOpen(c.id)}>
                <div className="character-card-name">{c.name}</div>
                <div className="character-card-sub muted">
                  {[c.species, c.class].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="character-card-stats">
                  <span>
                    <strong>Lv {d.level}</strong>
                  </span>
                  <span>{formatGp(d.gp)} gp</span>
                  <span>{d.downtimeDays} downtime</span>
                  <span>{d.inventory.length} items</span>
                </div>
              </button>
            );
          })}
        </div>
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
    </div>
  );
}
