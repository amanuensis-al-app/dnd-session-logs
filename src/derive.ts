import type { Character, DerivedStats, InventoryItem, LogEntry } from './types';

/** Replay order: by date, then time (blank = 00:00), ties broken by creation time. */
export function sortLogs(logs: LogEntry[]): LogEntry[] {
  return [...logs].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.time || '00:00';
    const bt = b.time || '00:00';
    if (at !== bt) return at < bt ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

/** Distinct non-empty values of a log field, for "pick from previous" dropdowns. */
export function knownValues(logs: LogEntry[], field: 'dm' | 'location'): string[] {
  const values = new Set<string>();
  for (const log of logs) {
    const v = log[field]?.trim();
    if (v) values.add(v);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function logsForCharacter(logs: LogEntry[], characterId: string): LogEntry[] {
  return sortLogs(logs.filter((l) => l.characterId === characterId));
}

/**
 * Derives a character's current state by replaying their logs in order.
 * Level starts at 1; GP and downtime start at 0; inventory is built from
 * item gains and losses (losses reference the gained item instance by id).
 */
export function deriveCharacter(character: Character, allLogs: LogEntry[]): DerivedStats {
  const logs = logsForCharacter(allLogs, character.id);

  let gp = 0;
  let downtimeDays = 0;
  let level = 1;
  const items = new Map<string, InventoryItem>();

  for (const log of logs) {
    gp += (log.gpGained || 0) - (log.gpLost || 0);
    downtimeDays += (log.downtimeGained || 0) - (log.downtimeSpent || 0);
    level += log.levelGained || 0;

    for (const gained of log.itemsGained) {
      items.set(gained.id, {
        ...gained,
        sourceLogId: log.id,
        acquiredDate: log.date,
        remaining: gained.quantity,
        losses: [],
      });
    }
    for (const lost of log.itemsLost) {
      const item = items.get(lost.itemId);
      if (!item) continue; // source log was deleted; ignore the dangling loss
      item.remaining -= lost.quantity;
      item.losses.push({
        logId: log.id,
        date: log.date,
        quantity: lost.quantity,
        reason: lost.reason,
      });
    }
  }

  const allItems = [...items.values()];
  return {
    level: Math.max(1, Math.min(20, level)),
    gp,
    downtimeDays,
    allItems,
    inventory: allItems.filter((i) => i.remaining > 0),
  };
}

/** Round to 2 decimals and drop trailing zeros — AL gold can have sp/cp fractions. */
export function formatGp(value: number): string {
  return (Math.round(value * 100) / 100).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
