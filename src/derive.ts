import type { Character, DerivedStats, InventoryItem, LogEntry, LossReason } from './types';
import { STACKED_CATEGORIES, stackedItemId } from './types';

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
  // Data from before stacked categories existed gave every gain a uuid; map those
  // onto the content-derived stack id so old logs and backups keep deriving correctly.
  const legacyAlias = new Map<string, string>();

  for (const log of logs) {
    gp += (log.gpGained || 0) - (log.gpLost || 0);
    downtimeDays += (log.downtimeGained || 0) - (log.downtimeSpent || 0);
    level += log.levelGained || 0;

    for (const gained of log.itemsGained) {
      if (STACKED_CATEGORIES.includes(gained.category)) {
        const id = stackedItemId(gained);
        if (gained.id !== id) legacyAlias.set(gained.id, id);
        const stack = items.get(id);
        if (stack) {
          stack.quantity += gained.quantity;
          stack.remaining += gained.quantity;
        } else {
          items.set(id, {
            ...gained,
            id,
            description: undefined,
            sourceLogId: log.id,
            acquiredDate: log.date,
            remaining: gained.quantity,
            losses: [],
          });
        }
      } else {
        items.set(gained.id, {
          ...gained,
          sourceLogId: log.id,
          acquiredDate: log.date,
          remaining: gained.quantity,
          losses: [],
        });
      }
    }
    for (const lost of log.itemsLost) {
      const item = items.get(lost.itemId) ?? items.get(legacyAlias.get(lost.itemId) ?? '');
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
    sessionsPlayed: logs.filter((l) => l.type === 'session').length,
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

/**
 * Splits a GP amount into a whole-number part and a (sp/cp) fractional part, e.g.
 * 144067.31 → { sign: '', whole: '144,067', fraction: '31' } — for displays that
 * print the fraction smaller than the whole number (components/GpAmount.tsx), so
 * the number that actually conveys "how rich is this character" reads at a glance.
 * `fraction` is null for a whole GP amount (nothing to print smaller).
 */
export function formatGpParts(value: number): { sign: string; whole: string; fraction: string | null } {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded < 0 ? '−' : '';
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs);
  const fraction = Math.round((abs - whole) * 100);
  return {
    sign,
    whole: whole.toLocaleString(),
    fraction: fraction === 0 ? null : String(fraction).padStart(2, '0'),
  };
}

/**
 * One display line per lost item name + reason. A stack loss is stored split across
 * the gained-item instances it drew from (FIFO); readers only care about the total.
 */
export function groupedLosses(
  log: LogEntry,
  itemNameById: Map<string, string>,
): { name: string; reason: LossReason; quantity: number }[] {
  const rows: { name: string; reason: LossReason; quantity: number }[] = [];
  const index = new Map<string, number>();
  for (const loss of log.itemsLost) {
    const name = itemNameById.get(loss.itemId) ?? '(deleted item)';
    const key = `${name}|${loss.reason}`;
    const at = index.get(key);
    if (at != null) rows[at].quantity += loss.quantity;
    else {
      index.set(key, rows.length);
      rows.push({ name, reason: loss.reason, quantity: loss.quantity });
    }
  }
  return rows;
}
