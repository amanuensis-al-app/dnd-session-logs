import type { Character, ExportBundle, LogEntry } from './types';
import { newId } from './types';

export interface BackupImportResult {
  /** Original name → the name it will actually be imported as; only entries that
   * actually had to change to avoid a clash. */
  renames: { from: string; to: string }[];
  characters: Character[];
  logs: LogEntry[];
}

/** Appends " (Copy)", then " (Copy 2)", " (Copy 3)"… until `name` doesn't collide
 * with anything in `taken`. */
function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let candidate = `${name} (Copy)`;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name} (Copy ${n})`;
  return candidate;
}

/**
 * Turns a backup bundle (from "Backup All" or "Backup Character" — one character or
 * a whole collection) into brand-new characters + logs, ready to add alongside
 * whatever's already in the tracker. Unlike Restore (which upserts by id, so it can
 * update the SAME character/log it came from), this NEVER overwrites or merges:
 * every character and log gets a freshly generated id, so re-importing the same
 * file — or importing someone else's backup that happens to share an id with
 * existing data — always just adds new, independent copies. A character name that
 * clashes with one already in the tracker becomes "Name (Copy)" (then "Name
 * (Copy 2)", … if that's also taken, including by another character in the SAME
 * bundle being imported).
 *
 * Item ids inside a log (GainedItem.id / LostItem.itemId) are left untouched — the
 * derive engine only ever looks up items within one character's own logs (see
 * deriveCharacter in derive.ts), so those ids only need to be unique WITHIN the
 * copied character's own log set, which is already guaranteed since the whole set
 * of logs came from one source character. A log's own `createdAt` is preserved
 * (it's meaningful: replay uses it to break same-date/time ties, see sortLogs in
 * derive.ts) — but the character's `createdAt` is reset to "now", matching how
 * every other import path (AL Log, Log Sheet) stamps a freshly-imported character.
 */
export function prepareBackupImport(bundle: ExportBundle, existingNames: string[]): BackupImportResult {
  const taken = new Set(existingNames);
  const renames: BackupImportResult['renames'] = [];
  const characters: Character[] = [];
  const logs: LogEntry[] = [];

  for (const oldCharacter of bundle.characters) {
    const name = uniqueName(oldCharacter.name, taken);
    taken.add(name);
    if (name !== oldCharacter.name) renames.push({ from: oldCharacter.name, to: name });

    const newCharacterId = newId();
    characters.push({ ...oldCharacter, id: newCharacterId, name, createdAt: Date.now() });

    for (const log of bundle.logs) {
      if (log.characterId !== oldCharacter.id) continue;
      logs.push({ ...log, id: newId(), characterId: newCharacterId });
    }
  }

  return { renames, characters, logs };
}
