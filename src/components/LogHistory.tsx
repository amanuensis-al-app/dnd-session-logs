import { useEffect, useState } from 'react';
import type { DerivedStats, LogEntry, LogType } from '../types';
import { CATEGORY_LABELS_SINGULAR, LOG_TYPE_LABELS, LOSS_REASON_LABELS } from '../types';
import { formatGp, groupedLosses } from '../derive';
import { creationPickLabel } from '../catalog';
import { highlight, MIN_QUERY_LENGTH } from '../searchHighlight';
import { Modal } from './Modal';

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

/** Everything a log can be found by: title, notes, DM/location/trade partner,
 * creation picks, and every gained/lost item's name — so "search anything"
 * actually means anything. */
function searchTextFor(log: LogEntry, itemNameById: Map<string, string>): string {
  const parts: string[] = [
    log.title,
    log.notes ?? '',
    LOG_TYPE_LABELS[log.type],
    log.dm ?? '',
    log.location ?? '',
    log.tradePartner ?? '',
  ];
  if (log.creationBackground) parts.push(creationPickLabel(log.creationBackground, 'background'));
  if (log.creationClass) parts.push(creationPickLabel(log.creationClass, 'class'));
  for (const item of log.itemsGained) {
    parts.push(item.name, item.description ?? '', item.minorProperty ?? '');
  }
  for (const loss of log.itemsLost) {
    parts.push(itemNameById.get(loss.itemId) ?? '', LOSS_REASON_LABELS[loss.reason]);
  }
  return parts.join('\n').toLowerCase();
}

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
  // Deleting a log that's one half of a Trade with another character gets a proper
  // modal (the stakes are higher — the other side won't be cleaned up
  // automatically) instead of the plain window.confirm() every other log uses.
  const [deleteLinkedConfirm, setDeleteLinkedConfirm] = useState<LogEntry | null>(null);
  // Full-text search across title, notes, DM/location/trade partner, creation
  // picks, and every gained/lost item's name — see searchTextFor.
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const activeQuery = query.length >= MIN_QUERY_LENGTH ? query : '';

  const itemNameById = new Map(derived.allItems.map((i) => [i.id, i.name]));

  // Newest first for reading; derivation always uses replay order internally.
  // The log currently being edited is always kept in, even if it stops matching
  // the search as the user types — else the open edit form would vanish out from
  // under them.
  const filtered = [...logs]
    .reverse()
    .filter(
      (log) =>
        log.id === editingLogId ||
        !activeQuery ||
        searchTextFor(log, itemNameById).includes(activeQuery),
    );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);

  // Reset to the first page whenever the active search term changes — the old
  // page number may not exist in the (usually much shorter) filtered results.
  useEffect(() => {
    setPage(0);
  }, [activeQuery]);

  // The edit form replaces a log's card in place — jump to the page holding it,
  // or the form would be invisible on another page.
  useEffect(() => {
    if (!editingLogId) return;
    const idx = filtered.findIndex((l) => l.id === editingLogId);
    if (idx !== -1) setPage(Math.floor(idx / PAGE_SIZE));
  }, [editingLogId, filtered]);

  if (logs.length === 0) {
    return (
      <div className="empty-state">
        <p>No logs yet.</p>
        <p className="muted">
          Tip: start with a <strong>Starting Log</strong> recording the character's starting
          gold and equipment.
        </p>
      </div>
    );
  }

  // Level after each log, computed in REPLAY order (level starts at 1) even though
  // the list shows newest first — displayed next to the level delta on logs that
  // change level.
  const levelAfterByLogId = new Map<string, number>();
  let runningLevel = 1;
  for (const log of logs) {
    runningLevel += log.levelGained || 0;
    levelAfterByLogId.set(log.id, runningLevel);
  }

  const pageLogs = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const searchBar = (
    <div className="search-bar">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search logs — title, notes, items, DM, location…"
        aria-label="Search logs"
      />
      {search && (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setSearch('')}>
          ✕ Clear
        </button>
      )}
      {query && !activeQuery && (
        <span className="muted search-hint">Keep typing… ({MIN_QUERY_LENGTH}+ characters)</span>
      )}
    </div>
  );

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
        Page {currentPage + 1} of {pageCount} ·{' '}
        {activeQuery ? `${filtered.length} of ${logs.length} logs match` : `${logs.length} logs`}
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
      {searchBar}
      {activeQuery && pageCount <= 1 && (
        <p className="muted search-summary">
          {filtered.length} of {logs.length} logs match
        </p>
      )}
      {pager}
      {pageLogs.length === 0 && (
        <div className="empty-state">
          <p>No logs match "{search.trim()}".</p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      )}
      {pageLogs.map((log) =>
        log.id === editingLogId && editForm ? (
          /* Keep the entry's card header while the edit form replaces its body. */
          <article key={log.id} className="card log-entry log-entry-editing">
            <header className="log-entry-header">
              <span className={`badge ${TYPE_BADGE[log.type]}`}>{LOG_TYPE_LABELS[log.type]}</span>
              <span className="log-entry-title">
                {log.title ? highlight(log.title, activeQuery) : '(untitled)'}
              </span>
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
            <span className="log-entry-title">
              {log.title ? highlight(log.title, activeQuery) : '(untitled)'}
            </span>
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
                if (log.linkedTrade) {
                  setDeleteLinkedConfirm(log);
                } else if (
                  confirm(`Delete log "${log.title || log.date}"? Derived stats will recompute.`)
                ) {
                  onDeleteLog(log.id);
                }
              }}
              title="Delete this log"
            >
              ✕
            </button>
          </header>

          <div className="log-entry-body">
            {log.tradePartner && (
              <div className="log-line">
                Traded with <strong>{highlight(log.tradePartner, activeQuery)}</strong>
                {log.linkedTrade && (
                  <span className="muted" title="This Trade was with one of your own characters — editing or deleting it here won't update their matching log automatically">
                    {' '}🔗 linked
                  </span>
                )}
              </div>
            )}
            {(log.creationBackground || log.creationClass) && (
              <div className="log-line muted">
                {log.creationBackground && (
                  <>
                    Background:{' '}
                    <strong>
                      {highlight(creationPickLabel(log.creationBackground, 'background'), activeQuery)}
                    </strong>
                  </>
                )}
                {log.creationBackground && log.creationClass && ' · '}
                {log.creationClass && (
                  <>
                    Class:{' '}
                    <strong>{highlight(creationPickLabel(log.creationClass, 'class'), activeQuery)}</strong>
                  </>
                )}
              </div>
            )}
            {(log.dm || log.location) && (
              <div className="log-line muted">
                {log.dm && (
                  <>
                    DM: <strong>{highlight(log.dm, activeQuery)}</strong>
                  </>
                )}
                {log.dm && log.location && ' · '}
                {log.location && <>at {highlight(log.location, activeQuery)}</>}
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
                    + {highlight(item.name, activeQuery)}
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
                    − {highlight(loss.name, activeQuery)}
                    {loss.quantity > 1 ? ` ×${loss.quantity}` : ''}{' '}
                    <span className="muted">({LOSS_REASON_LABELS[loss.reason]})</span>
                  </li>
                ))}
              </ul>
            )}
            {log.notes && <div className="log-notes muted">{highlight(log.notes, activeQuery)}</div>}
          </div>
        </article>
        ),
      )}
      {pager}
      {deleteLinkedConfirm && (
        <Modal title="Delete linked Trade log?" onClose={() => setDeleteLinkedConfirm(null)}>
          <p>
            Delete log "{deleteLinkedConfirm.title || deleteLinkedConfirm.date}"? Derived stats
            will recompute.
          </p>
          <p className="warning">
            ⚠ This is one half of a Trade with{' '}
            <strong>{deleteLinkedConfirm.tradePartner ?? 'another character'}</strong> — deleting
            it here will NOT delete their matching log. Delete or update it there too if needed.
          </p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setDeleteLinkedConfirm(null)}>
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                onDeleteLog(deleteLinkedConfirm.id);
                setDeleteLinkedConfirm(null);
              }}
            >
              Delete anyway
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
