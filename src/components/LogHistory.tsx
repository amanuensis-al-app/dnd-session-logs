import type { DerivedStats, LogEntry, LogType } from '../types';
import { CATEGORY_LABELS_SINGULAR, LOG_TYPE_LABELS, LOSS_REASON_LABELS } from '../types';
import { formatGp } from '../derive';

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
  free: 'badge-free',
};

export function LogHistory({ logs, derived, onEditLog, onDeleteLog }: Props) {
  if (logs.length === 0) {
    return (
      <div className="empty-state">
        <p>No logs yet.</p>
        <p className="muted">
          Tip: start with a <strong>Free Log</strong> recording the character's starting level,
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
                      {item.rarity ? `, ${item.rarity}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {log.itemsLost.length > 0 && (
              <ul className="log-items">
                {log.itemsLost.map((loss, i) => (
                  <li key={i} className="delta-loss">
                    − {itemNameById.get(loss.itemId) ?? '(deleted item)'}
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
