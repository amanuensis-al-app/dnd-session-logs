import type { DerivedStats, LogEntry, LogType, LossReason } from '../types';
import { CATEGORY_LABELS_SINGULAR, LOG_TYPE_LABELS, LOSS_REASON_LABELS } from '../types';
import { formatGp } from '../derive';

/**
 * One display line per lost item name + reason. A stack loss is stored split across
 * the gained-item instances it drew from (FIFO); readers only care about the total.
 */
function groupedLosses(
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

interface Props {
  /** Already filtered to one character and sorted in replay order. */
  logs: LogEntry[];
  derived: DerivedStats;
  onEditLog: (log: LogEntry) => void;
  onDeleteLog: (logId: string) => void;
}

const TYPE_BADGE: Record<LogType, string> = {
  session: 'badge-session',
  catchup: 'badge-catchup',
  transaction: 'badge-transaction',
  purchase: 'badge-purchase',
  sell: 'badge-sell',
  creation: 'badge-creation',
  free: 'badge-free',
};

export function LogHistory({ logs, derived, onEditLog, onDeleteLog }: Props) {
  if (logs.length === 0) {
    return (
      <div className="empty-state">
        <p>No logs yet.</p>
        <p className="muted">
          Tip: start with a <strong>Creation</strong> log recording the character's starting
          gold and equipment.
        </p>
      </div>
    );
  }

  const itemNameById = new Map(derived.allItems.map((i) => [i.id, i.name]));

  // Newest first for reading; derivation always uses replay order internally.
  const display = [...logs].reverse();

  return (
    <div className="log-history">
      {display.map((log) => (
        <article key={log.id} className="card log-entry">
          <header className="log-entry-header">
            <span className={`badge ${TYPE_BADGE[log.type]}`}>{LOG_TYPE_LABELS[log.type]}</span>
            <span className="log-entry-title">{log.title || '(untitled)'}</span>
            <span className="muted log-entry-date">
              {log.date}
              {log.time ? ` ${log.time}` : ''}
            </span>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => onEditLog(log)}
              title="Edit this log"
            >
              ✎
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => {
                if (confirm(`Delete log "${log.title || log.date}"? Derived stats will recompute.`))
                  onDeleteLog(log.id);
              }}
              title="Delete this log"
            >
              ✕
            </button>
          </header>

          <div className="log-entry-body">
            {log.tradePartner && (
              <div className="log-line">
                Traded with <strong>{log.tradePartner}</strong>
              </div>
            )}
            {(log.dm || log.location) && (
              <div className="log-line muted">
                {log.dm && (
                  <>
                    DM: <strong>{log.dm}</strong>
                  </>
                )}
                {log.dm && log.location && ' · '}
                {log.location && <>at {log.location}</>}
              </div>
            )}
            <div className="log-deltas">
              {log.levelGained !== 0 && (
                <span className="delta delta-gain">
                  {log.levelGained > 0 ? '+' : ''}
                  {log.levelGained} level{Math.abs(log.levelGained) !== 1 ? 's' : ''}
                </span>
              )}
              {log.gpGained > 0 && <span className="delta delta-gain">+{formatGp(log.gpGained)} gp</span>}
              {log.gpLost > 0 && <span className="delta delta-loss">−{formatGp(log.gpLost)} gp</span>}
              {log.downtimeGained > 0 && (
                <span className="delta delta-gain">+{log.downtimeGained} downtime</span>
              )}
              {log.downtimeSpent > 0 && (
                <span className="delta delta-loss">−{log.downtimeSpent} downtime</span>
              )}
            </div>
            {log.itemsGained.length > 0 && (
              <ul className="log-items">
                {log.itemsGained.map((item) => (
                  <li key={item.id} className="delta-gain">
                    + {item.name}
                    {item.quantity > 1 ? ` ×${item.quantity}` : ''}{' '}
                    <span className="muted">
                      ({CATEGORY_LABELS_SINGULAR[item.category]}
                      {item.rarity ? `, ${item.rarity}` : ''}
                      {item.minorProperty ? `, ${item.minorProperty}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {log.itemsLost.length > 0 && (
              <ul className="log-items">
                {groupedLosses(log, itemNameById).map((loss) => (
                  <li key={`${loss.name}|${loss.reason}`} className="delta-loss">
                    − {loss.name}
                    {loss.quantity > 1 ? ` ×${loss.quantity}` : ''}{' '}
                    <span className="muted">({LOSS_REASON_LABELS[loss.reason]})</span>
                  </li>
                ))}
              </ul>
            )}
            {log.notes && <div className="log-notes muted">{log.notes}</div>}
          </div>
        </article>
      ))}
    </div>
  );
}
