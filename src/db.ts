import type { Character, ExportBundle, LogEntry } from './types';

const DB_NAME = 'al-tracker';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('characters')) {
        db.createObjectStore('characters', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('logs')) {
        const logs = db.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('characterId', 'characterId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAll<T>(storeName: string): Promise<T[]> {
  return openDB().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const req = db.transaction(storeName).objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function getAllCharacters(): Promise<Character[]> {
  return getAll<Character>('characters');
}

export function getAllLogs(): Promise<LogEntry[]> {
  return getAll<LogEntry>('logs');
}

export async function putCharacter(character: Character): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('characters', 'readwrite');
  tx.objectStore('characters').put(character);
  await txDone(tx);
}

/** Deletes a character and every log that belongs to it. */
export async function deleteCharacter(characterId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['characters', 'logs'], 'readwrite');
  tx.objectStore('characters').delete(characterId);
  const logStore = tx.objectStore('logs');
  const idx = logStore.index('characterId');
  const cursorReq = idx.openKeyCursor(IDBKeyRange.only(characterId));
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (cursor) {
      logStore.delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  await txDone(tx);
}

export async function putLog(log: LogEntry): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('logs', 'readwrite');
  tx.objectStore('logs').put(log);
  await txDone(tx);
}

export async function deleteLog(logId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('logs', 'readwrite');
  tx.objectStore('logs').delete(logId);
  await txDone(tx);
}

export async function exportData(): Promise<ExportBundle> {
  const [characters, logs] = await Promise.all([getAllCharacters(), getAllLogs()]);
  return {
    app: 'al-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    characters,
    logs,
  };
}

export function validateBundle(data: unknown): ExportBundle {
  const bundle = data as ExportBundle;
  if (
    !bundle ||
    bundle.app !== 'al-tracker' ||
    !Array.isArray(bundle.characters) ||
    !Array.isArray(bundle.logs)
  ) {
    throw new Error('Not a valid AMAnuensis backup file.');
  }
  return bundle;
}

/**
 * Imports a bundle. `replace` wipes existing data first; `merge` upserts by id,
 * so re-importing the same file is safe.
 */
export async function importData(bundle: ExportBundle, mode: 'replace' | 'merge'): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(['characters', 'logs'], 'readwrite');
  const characters = tx.objectStore('characters');
  const logs = tx.objectStore('logs');
  if (mode === 'replace') {
    characters.clear();
    logs.clear();
  }
  for (const c of bundle.characters) characters.put(c);
  for (const l of bundle.logs) logs.put(l);
  await txDone(tx);
}
