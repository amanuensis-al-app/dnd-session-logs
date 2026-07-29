import { createPortal } from 'react-dom';
import type { Character, DerivedStats, InventoryItem, LogEntry } from '../types';
import {
  CATEGORY_LABELS_SINGULAR,
  EQUIPPABLE_CATEGORIES,
  LOG_TYPE_LABELS,
  LOSS_REASON_LABELS,
} from '../types';
import { formatGp, groupedLosses } from '../derive';
import { creationPickLabel } from '../catalog';
import {
  attunementCapFor,
  PREP_POOL_LABELS,
  prepLimit,
  prepPoolOf,
  tierForLevel,
  type PrepPool,
} from '../tiers';

interface Props {
  character: Character;
  derived: DerivedStats;
  /** This character's logs in replay (chronological) order — displayed reversed
   * (newest first), same as the Logs tab. */
  logs: LogEntry[];
  onClose: () => void;
}

/** Pool order for the Prepared section — Equipment last (owner call 2026-07-19).
 * The Prep tab uses PREP_POOL_ORDER (Equipment after Consumables). */
const REPORT_POOL_ORDER: PrepPool[] = [
  'magicItemUncommonPlus',
  'magicItemCommon',
  'consumable',
  'blessing',
  'charm',
  'boon',
  'equipment',
];

/**
 * Printable character report ("Export PDF" on the character sheet): Prepared items
 * and the full log history in one document, meant to be sent to the DM before big
 * events where the logs have to check out. Rendered as a paper-looking overlay on
 * screen; the @media print rules in index.css strip everything else off the page,
 * and the browser's "Save as PDF" makes the file — no PDF library involved.
 */
export function CharacterReport({ character, derived, logs, onClose }: Props) {
  const tier = tierForLevel(derived.level);
  const attunementCap = attunementCapFor(character.attunementCap);

  // Prep pools, same bucketing as the Prep tab (equippable categories only).
  const pools = new Map<PrepPool, InventoryItem[]>();
  for (const pool of REPORT_POOL_ORDER) pools.set(pool, []);
  for (const item of derived.inventory) {
    if (!EQUIPPABLE_CATEGORIES.includes(item.category)) continue;
    const pool = prepPoolOf(item.category, item.rarity);
    if (!pool || !character.itemMarks?.[item.id]) continue;
    pools.get(pool)!.push(item);
  }
  const preparedOf = (item: InventoryItem) =>
    Math.min(character.equipQuantities?.[item.id] ?? item.remaining, item.remaining);
  const attunedCount = derived.inventory.filter(
    (i) =>
      i.category === 'magic_item' &&
      character.itemMarks?.[i.id] &&
      (i.requiresAttunement ?? true) &&
      character.attunement?.[i.id] === 'attuned',
  ).length;

  const itemNameById = new Map(derived.allItems.map((i) => [i.id, i.name]));
  // Level after each log is computed in REPLAY order (level starts at 1) even
  // though the report shows newest first, same as the Logs tab.
  const levelAfterByLogId = new Map<string, number>();
  let runningLevel = 1;
  for (const log of logs) {
    runningLevel += log.levelGained || 0;
    levelAfterByLogId.set(log.id, runningLevel);
  }
  const displayLogs = [...logs].reverse();

  const attunementLabel = (item: InventoryItem): string =>
    (item.requiresAttunement ?? true)
      ? character.attunement?.[item.id] === 'attuned'
        ? 'Attuned'
        : 'Not attuned'
      : 'Attunement not required';

  // Browsers print their own URL into the page header/footer, using the @page
  // margin as drawing space. From a hosted origin that's just the site's public
  // URL — fine. From the standalone offline build (opened via file://), that same
  // header would print the local file path, which embeds the OS username. Zeroing
  // the @page margin for this one print job is the standard way to make Chromium
  // browsers drop the header/footer outright (no margin space, nothing to draw
  // into) — not guaranteed on every browser's print engine, but it's the best
  // available mitigation short of asking the user to also uncheck "Headers and
  // footers" by hand, which the toolbar note below does too.
  const isLocalFile = window.location.protocol === 'file:';

  // Portaled to <body> so that in print the app root can be display:none'd and the
  // report printed as a normal static-flow document — absolutely-positioned overlays
  // don't paginate (they print as one giant page), static flow does.
  return createPortal(
    <div className="print-report">
      {isLocalFile && <style>{'@page { margin: 0 !important; }'}</style>}
      <div className="report-toolbar">
        <strong>Character report — {character.name}</strong>
        {isLocalFile && (
          <span className="report-toolbar-note">
            Double-check "Headers and footers" is unchecked in the print dialog — it can
            otherwise show this file's local path.
          </span>
        )}
        <span className="report-toolbar-actions">
          <button className="btn btn-primary" onClick={() => window.print()}>
            🖨️ Print / Save as PDF
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </span>
      </div>

      {/* Print-only watermark: fixed-position elements repeat on every printed page. */}
      <img
        className="report-watermark"
        src={`${import.meta.env.BASE_URL}ama-icon.png`}
        alt=""
        aria-hidden
      />

      <div className={`report-sheet${isLocalFile ? ' report-sheet-local-file' : ''}`}>
        <header className="report-header">
          {character.icon && <img className="report-icon" src={character.icon} alt="" />}
          <div>
            <h1>{character.name}</h1>
            <p>{[character.species, character.class].filter(Boolean).join(' · ') || '—'}</p>
            <p>
              Level {derived.level} (Tier {tier}) · {formatGp(derived.gp)} GP ·{' '}
              {derived.downtimeDays} downtime days · Attunement {attunedCount}/{attunementCap}
            </p>
            <p className="report-muted">Generated {new Date().toISOString().slice(0, 10)}</p>
          </div>
        </header>

        <section className="report-section">
          <h2>Prepared</h2>
          {REPORT_POOL_ORDER.map((pool) => {
            const equipped = pools.get(pool)!;
            const limit = prepLimit(tier, pool);
            if (limit === 0 && equipped.length === 0) return null;
            const used =
              pool === 'consumable' || pool === 'equipment'
                ? equipped.reduce((s, i) => s + preparedOf(i), 0)
                : equipped.length;
            return (
              <div key={pool} className="report-pool">
                <h3>
                  {PREP_POOL_LABELS[pool]} ({used}
                  {Number.isFinite(limit) ? `/${limit}` : ''})
                </h3>
                {equipped.length === 0 ? (
                  <p className="report-muted">—</p>
                ) : (
                  <ul>
                    {equipped.map((item) => (
                      <li key={item.id}>
                        {item.name}
                        {(pool === 'consumable' || pool === 'equipment') && item.remaining > 1 && (
                          <> ×{preparedOf(item)} (of {item.remaining})</>
                        )}
                        {item.rarity && <span className="report-muted"> — {item.rarity}</span>}
                        {item.category === 'magic_item' && (
                          <span className="report-muted"> · {attunementLabel(item)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <section className="report-section">
          <h2>Logs ({logs.length})</h2>
          {displayLogs.map((log) => (
            <div key={log.id} className="report-log">
              <div className="report-log-head">
                <strong>
                  {log.date}
                  {log.time ? ` ${log.time}` : ''}
                </strong>{' '}
                [{LOG_TYPE_LABELS[log.type]}] {log.title || '(untitled)'}
              </div>
              {(log.dm || log.location || log.tradePartner || log.creationBackground || log.creationClass) && (
                <div className="report-muted">
                  {log.tradePartner && <>Traded with {log.tradePartner}</>}
                  {log.creationBackground && (
                    <>
                      Background: {creationPickLabel(log.creationBackground, 'background')}
                      {log.creationClass ? ' · ' : ''}
                    </>
                  )}
                  {log.creationClass && <>Class: {creationPickLabel(log.creationClass, 'class')}</>}
                  {log.dm && (
                    <>
                      DM: {log.dm}
                      {log.location ? ' · ' : ''}
                    </>
                  )}
                  {log.location}
                </div>
              )}
              <div className="report-log-deltas">
                {log.levelGained !== 0 && (
                  <span>
                    {log.levelGained > 0 ? '+' : ''}
                    {log.levelGained} level{Math.abs(log.levelGained) !== 1 ? 's' : ''} →{' '}
                    {levelAfterByLogId.get(log.id)}
                  </span>
                )}
                {log.gpGained > 0 && <span>+{formatGp(log.gpGained)} gp</span>}
                {log.gpLost > 0 && <span>−{formatGp(log.gpLost)} gp</span>}
                {log.downtimeGained > 0 && <span>+{log.downtimeGained} downtime</span>}
                {log.downtimeSpent > 0 && <span>−{log.downtimeSpent} downtime</span>}
              </div>
              {log.itemsGained.length > 0 && (
                <ul>
                  {log.itemsGained.map((item) => (
                    <li key={item.id}>
                      + {item.name}
                      {item.quantity > 1 ? ` ×${item.quantity}` : ''}{' '}
                      <span className="report-muted">
                        ({CATEGORY_LABELS_SINGULAR[item.category]}
                        {item.rarity ? `, ${item.rarity}` : ''}
                        {item.minorProperty ? `, ${item.minorProperty}` : ''})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {log.itemsLost.length > 0 && (
                <ul>
                  {groupedLosses(log, itemNameById).map((loss) => (
                    <li key={`${loss.name}|${loss.reason}`}>
                      − {loss.name}
                      {loss.quantity > 1 ? ` ×${loss.quantity}` : ''}{' '}
                      <span className="report-muted">({LOSS_REASON_LABELS[loss.reason]})</span>
                    </li>
                  ))}
                </ul>
              )}
              {log.notes && <div className="report-muted report-log-notes">{log.notes}</div>}
            </div>
          ))}
        </section>
      </div>
    </div>,
    document.body
  );
}
