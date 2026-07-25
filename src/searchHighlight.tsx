import type { ReactNode } from 'react';

/** Shortest query that actually filters — a 1-character search would scan every
 * field of every row on each keystroke for almost no narrowing, so it's treated
 * as "not searching yet" on characters with a lot of history/inventory. Shared by
 * LogHistory and Inventory's search boxes. */
export const MIN_QUERY_LENGTH = 2;

/** Wraps the first case-insensitive match of `query` in `text` with a <mark> —
 * lightweight (one hit per field), just enough to show WHY a row matched. */
export function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
