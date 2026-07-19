import { useEffect, useState } from 'react';
import type { DerivedStats, LogEntry, LogType } from '../types';
import { CATEGORY_LABELS_SINGULAR, LOG_TYPE_LABELS, LOSS_REASON_LABELS } from '../types';
import { formatGp, groupedLosses } from '../derive';

interface Props {
  /** Already filtered to one character and sorted in replay order. */
  logs: LogEntry[];
  derived: DerivedStats;
  /** When set, the matching log's card is replaced by `editForm` in place. */
  editingLogId?: string;
  editForm?: React.ReactNode;
  onEditLog: (log: LogEntry) => void;
  onDeleteLog: (logId: string) => void;
}

const TYPE_BADGE: Record<LogType, string> = {
  session: 'badge-session',
  catchup: 'badge-catchup',
  transaction: 'badge-transaction',
  copy_spell: 'badge-copy-spell',
  purchase: 'badge-purchase',
  sell: 'badge-sell',
  creation: 'badge-creation',
  free: 'badge-free',
};

/** Logs shown per page — everything is in memory anyway; this is about not
 * rendering hundreds of cards at once on slow machines. */
const PAGE_SIZE = 30;

export function LogHistory({
  logs,
  derived,
  editingLogId,
  editForm,
  onEditLog,
  onDeleteLog,
}: Props) {
  // Pagination: 30 cards per page — all logs are in memory anyway, this is about
  // not rendering hundreds of cards at once on slow machines.
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);

  // The edit form replaces a log's card in place — jump to the page holding it,
  // or the form would be invisible on another page.
  useEffect(() => {
    if (!editingLogId) return;
    const idx = logs.findIndex((l) => l.id === editingLogId);
    if (idx !== -1) setPage(Math.floor((logs.length - 1 - idx) / PAGE_SIZE));
  }, [editingLogId, logs]);

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

  // Level after each log, computed in REPLAY order (level starts at 1) even though
  // the list shows newest first — displayed next to the level delta on logs that
  // change level.
  const levelAfterByLogId = new Map<string, number>();
  let runningLevel = 1;
  for (const log of logs) {
    runningLevel += log.levelGained || 0;
    levelAfterByLogId.set(log.id, runningLevel);
  }

  // Newest first for reading; derivation always uses replay order internally.
  const display = [...logs].reverse();
  const pageLogs = display.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const pager = pageCount > 1 && (
    <div className="log-pager">
      <button
        className="btn btn-ghost btn-small"
        disabled={currentPage === 0}
        onClick={() => setPage(currentPage - 1)}
      >
        ← Newer
      </button>
      <span className="muted">
        Page {currentPage + 1} of {pageCount} · {logs.length} logs
      </span>
      <button
        className="btn btn-ghost btn-small"
        disabled={currentPage >= pageCount - 1}
        onClick={() => setPage(currentPage + 1)}
      >
        Older →
      </button>
    </div>
  );

  return (
    <div className="log-history">
      {pager}
      {pageLogs.map((log) =>
        log.id === editingLogId && editForm ? (
          /* Keep the entry's card header while the edit form replaces its body. */
          <article key={log.id} className="card log-entry log-entry-editing">
            <header className="log-entry-header">
              <span className={`badge ${TYPE_BADGE[log.type]}`}>{LOG_TYPE_LABELS[log.type]}</span>
              <span className="log-entry-title">{log.title || '(untitled)'}</span>
              {/* CSS hides this while the form is expanded (its Date field shows it). */}
              <span className="muted log-entry-date">
                {log.date}
                {log.time ? ` ${log.time}` : ''}
              </span>
            </header>
            {editForm}
          </article>
        ) : (
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
                  <span className="muted"> → {levelAfterByLogId.get(log.id)}</span>
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
        ),
      )}
      {pager}
    </div>
  );
}
