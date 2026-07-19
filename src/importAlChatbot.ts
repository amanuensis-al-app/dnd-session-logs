import { MINOR_PROPERTIES } from './types';
import type { LogEntry } from './types';
import { parseCsv, parseDateTime, num } from './importAlLog';
import type { AlImportResult } from './importAlLog';
import { parseChatbotImportReply } from './importSheetChatbot';

/**
 * The AI-chatbot bridge for the (public) adventurersleaguelog.com CSV import — same
 * zero-key pattern as Add Log from Text and the log-sheet import: the app writes
 * self-contained instructions with the raw CSV embedded, the user pastes them into
 * any chatbot, and the JSON reply is pasted back and validated into the same
 * {character, logs, warnings} shape the offline importer (importAlLog.ts) produces.
 *
 * The prompt is deliberately exhaustive: the AL Log format buries purchases, sales
 * and starting gold in free-text notes bullets, which is exactly where the offline
 * heuristics have to guess (a gold-gaining "purchase" is really character creation;
 * "* Sell back X = 22.5GP" is a sale, not an item named that; "10 Parchment = 1GP"
 * is 10 units at 0.1 each, not an item called "10 Parchment = 1GP").
 *
 * Reply validation/loss-matching is shared with the log-sheet chatbot path
 * (parseChatbotImportReply) — only the prompt and the fallback character name are
 * specific to this source format.
 */

// ---- Prompt --------------------------------------------------------------------

export function buildAlChatbotPrompt(csvText: string): string {
  return `You are converting a D&D Adventurers League log (CSV exported from adventurersleaguelog.com) into JSON for a play tracker. Read the CSV between the <allog> tags below and answer with ONE JSON object only — no explanation, no markdown code fences.

THE CSV FORMAT (one character's whole history, oldest first):
- Row 1: character column header (name,race,class_and_levels,faction,background,...). Row 2: that character's values.
- Row 3: log-entry column header: type,adventure_title,session_num,date_played,session_length_hours,player_level,xp_gained,gp_gained,downtime_gained,renown_gained,num_secret_missions,location_played,dm_name,dm_dci_number,notes,date_dmed,campaign_id
- Row 4: a MAGIC ITEM column header (name,rarity,location_found,table,table_result,notes).
- Row 5 onward: log entries. An entry row's first cell is CharacterLogEntry, PurchaseLogEntry or TradeLogEntry, using the row-3 columns. Directly under each entry come its item rows: "MAGIC ITEM" (a magic item the entry GRANTED) or "TRADED MAGIC ITEM" (one it GAVE AWAY), using the row-4 columns. A MAGIC ITEM row with an empty name is a placeholder — ignore it.
- Fields are RFC 4180 quoted; the notes field often holds several lines (CRLF) of "* " bullets.
- gp_gained and downtime_gained are SIGNED: negative means gold spent / downtime spent.
- THERE IS NO XP. Adventurers League dropped XP long ago — the xp_gained column is an obsolete leftover and is ALWAYS empty in practice. A number in the hundreds or thousands in a session row is GOLD (gp_gained); sessions commonly award hundreds to tens of thousands of gp. Never write "XP" anywhere in your answer.
- COLUMN POSITIONS — READ THIS CAREFULLY, THIS IS WHERE CONVERSIONS GO WRONG: after date_played come session_length_hours, player_level and xp_gained, all empty in practice, then gp_gained, then downtime_gained. So a typical session row is
    CharacterLogEntry,Some Adventure,,2024-10-11 19:30:00 UTC,,,,2116.98,10.0,,,Some Cafe,Some DM,@dci,"",,
  and the ",,," after the timestamp means the number that follows (2116.98, right before the downtime value 10.0) is gp_gained.
- date_played looks like "2025-09-12 02:38:00 UTC" — copy date and time VERBATIM, no timezone conversion. Several entries may share one timestamp; keep their file order.

Use exactly this shape:
{
  "character": { "name": "...", "species": "the race value", "class": "the class_and_levels value, verbatim" },
  "logs": [
    {
      "type": one of "session", "catchup", "transaction", "purchase", "sell", "creation", "free",
      "date": "YYYY-MM-DD",
      "time": "HH:MM (24h) from date_played, or null",
      "title": "see per-type rules below",
      "dm": "... or null (sessions only)",
      "location": "... or null (sessions only)",
      "tradePartner": "... or null (transactions only)",
      "gpGained": number >= 0,
      "gpLost": number >= 0,
      "downtimeGained": number >= 0,
      "downtimeSpent": number >= 0,
      "levelGained": number >= 0,
      "itemsGained": [
        {
          "name": "plain item name ONLY — see the naming rules",
          "category": one of "magic_item", "consumable", "equipment", "story_award", "blessing", "charm", "boon",
          "rarity": one of "common", "uncommon", "rare", "very rare", "legendary", "artifact" — or null,
          "quantity": number >= 1,
          "cost": per-unit GP paid — or null (purchases only),
          "description": "short, or null",
          "minorProperty": one of ${MINOR_PROPERTIES.map((p) => `"${p}"`).join(', ')} — or null
        }
      ],
      "itemsLost": [
        {
          "name": "EXACTLY the name an earlier log gained the item under",
          "quantity": number >= 1,
          "reason": one of "traded", "used", "sold", "lost", "other",
          "salePrice": per-unit GP received — or null (sells only)
        }
      ],
      "notes": "the entry's notes text, or null"
    }
  ]
}

CLASSIFYING THE ENTRIES:
1. TradeLogEntry → "transaction" (trading a magic item for another of the same rarity). tradePartner = the entry's notes text. downtimeSpent = 5 (or the entry's own downtime delta if it has one). itemsGained = its MAGIC ITEM rows; itemsLost = its TRADED MAGIC ITEM rows with reason "traded". Title: "Traded <lost item> for <gained item>".
2. CharacterLogEntry with a dm_name, a location_played, or MAGIC ITEM rows → "session". gpGained and downtimeGained from the columns (a typical session: gold in, +10 downtime). The export never records level-ups: levelGained = 1 per session. dm = dm_name, location = location_played. Title = adventure_title. If dm_dci_number is filled, append a notes line "DM DCI: <value>".
3. CharacterLogEntry without DM/location/items whose only effect is NEGATIVE downtime in a multiple of 10 (e.g. a "Catch Up" entry with downtime_gained −10) → "catchup": downtimeSpent = 10 per level, levelGained = downtimeSpent / 10, nothing else. Title = adventure_title or "Catching Up".
4. PurchaseLogEntry → shopping recorded as free-text notes bullets. Each bullet is either a BUY or a SELL — they must NOT end up in the same log:
   - BUY bullets look like: "* Mirror = 5GP", "* 10 Parchment = 1GP", "* Buy Studded Leather (-45GP)", "+ Rope (1GP)", "- Rope (1GP)" when gold went OUT. They become the "purchase" log's itemsGained, each with its per-unit "cost". gpLost = the exact sum of cost × quantity over those items.
   - SELL bullets look like: "* Sell back Studded Leather = 22.5GP", "* Sold Chain Shirt = 25GP", "- Shield (5GP)" next to "+" buys (gold coming IN for gear the character already owned). They become a SEPARATE "sell" log with the same date+time, placed immediately AFTER the purchase log: the sold items go in itemsLost with reason "sold" and a per-unit "salePrice", gpGained = the exact sum of salePrice × quantity. Move the sell lines into the sell log's notes (out of the purchase log's notes).
   - The entry's gp_gained column is only the NET of both sides (sale proceeds − buy cost) — use it as a sanity check, never as the gp of either log. If the bullets carry no prices, fall back to it: sells-only entry → sell log with gpGained = the column value; buys-only entry with negative gp → purchase with gpLost = −gp_gained.
   - An entry that contains ONLY sells → just the sell log, no purchase log.
   - EXCEPTION, character creation: the character's FIRST entry, when its notes mention starting equipment or starting gold (the site writes these as "<Class> Starting Equipment: 55GP" or a background name), is NOT a purchase — make ONE "creation" log titled "Character Creation": gpGained = the column value, and any listed starting gear as equipment itemsGained (no costs).
   - Any other PurchaseLogEntry that GAINS gold → a "free" log (purchases can't gain gold).
5. CharacterLogEntry matching none of the above → "free" (title = adventure_title or "Free Log").
6. Titles: purchase → "Bought <item>, <item>" (or "Purchase"); sell → "Sold <item>, <item>"; creation → "Character Creation".

ITEM NAMING — get this exactly right:
- "name" is ONLY the plain D&D item name. Never leave quantities, prices or verbs in it — quantity markers ("(x1)", "x20", "2x", a leading count) become "quantity"; price notes ("= 5GP", "(10GP)", "- 10GP") become "cost"/"salePrice"; verbs like "Buy"/"Sell"/"Sold" drop off:
  - "* 10 Parchment = 1GP" → name "Parchment", quantity 10, cost 0.1 (a bullet's price is the LINE TOTAL: divide by the quantity).
  - "* Buy Studded Leather (-45GP)" → name "Studded Leather Armor", quantity 1, cost 45.
  - "* Scroll of Animate Dead (x1)" → name "Spell Scroll of Animate Dead", quantity 1.
- Use canonical D&D 2024 names: "Studded Leather" → "Studded Leather Armor", "Alchemist Fire" → "Alchemist’s Fire", "Potion of Greater Healing" → "Potion of Healing (Greater)", "Chain Shirt Armor" → "Chain Shirt".
- Categories: potions, elixirs and scrolls are "consumable" (single-use magical goods — give their rarity: Potion of Healing and Potion of Climbing are "common"). Mundane gear is "equipment" — INCLUDING flasks of Acid, Alchemist’s Fire, Antitoxin and Holy Water (adventuring gear, NOT consumables). The MAGIC ITEM rows are "magic_item" with the row's rarity and the row's own notes as "description".
- Spell scrolls are consumables named "Spell Scroll of <Spell Name>" (never "Scroll of X" or "Spell Scroll (X)"), rarity by spell level: cantrip–1st "common", 2nd–3rd "uncommon", 4th–5th "rare", 6th–8th "very rare", 9th "legendary". This applies to MAGIC ITEM rows that are scrolls too.
- itemsLost must reuse EXACTLY the name an earlier log gained the item under (after these naming rules), so it can be matched back.

GENERAL RULES:
- Output logs OLDEST FIRST by date+time — the file itself can be out of order (entries are listed by when they were typed in, not by date_played). Entries sharing a timestamp keep the file's relative order.
- gpGained/gpLost/downtimeGained/downtimeSpent are all >= 0 — split the signed columns: a negative gp_gained is gpLost, a negative downtime_gained is downtimeSpent.
- Keep each entry's notes text VERBATIM in "notes" (including bullets you parsed items from; use \\n for line breaks) — except sell lines, which move to the sell log's notes. Sessions also get the "DM DCI: ..." line. When session_num or renown_gained are non-empty/non-zero, append lines "Session #N" or "Renown gained: X". There is no "XP gained" line — XP is obsolete (see above); if a row looks like it has one, re-count its commas: you misread the GOLD column.
- A "purchase" log needs at least one itemsGained; a "sell" log at least one itemsLost.
- "cost" only on purchases, "salePrice" only on sells — both PER UNIT.
- FINAL CHECK, before answering: for every entry row, the net gold of the log(s) you made from it (gpGained − gpLost, counting a purchase+sell pair from one row together) must equal that row's gp_gained column exactly, and net downtime must equal downtime_gained. Re-read any row that fails — most likely you misread its gold (remember: there is no XP).
- If something is unclear, make your best guess: a person reviews everything in a preview before importing.

WORKED EXAMPLE — this PurchaseLogEntry:
  PurchaseLogEntry,,,2025-09-16 02:42:00 UTC,,,,14.45,,,,,,,"* Mirror = 5GP\\n* 10 Parchment = 1GP\\n\\n* Sell back Studded Leather = 22.5GP",,
becomes TWO logs: a "purchase" (date 2025-09-16, time 02:42, title "Bought Mirror, Parchment", gpLost 8.05, gpGained 0, notes "* Mirror = 5GP\\n* 10 Parchment = 1GP", itemsGained [{"name":"Mirror","category":"equipment","quantity":1,"cost":5},{"name":"Parchment","category":"equipment","quantity":10,"cost":0.1}]) and a "sell" right after it (title "Sold Studded Leather Armor", gpGained 22.5, gpLost 0, notes "* Sell back Studded Leather = 22.5GP", itemsLost [{"name":"Studded Leather Armor","quantity":1,"reason":"sold","salePrice":22.5}]). Check: 22.5 − 8.05 = 14.45, the column's net. And had the character's first entry read "Wizard Starting Equipment: 55GP" with gp_gained 105, that would be ONE "creation" log (gpGained 105), not a purchase and not a sale.

<allog>
${csvText.trim()}
</allog>`;
}

// ---- Reply parsing -------------------------------------------------------------

/** Best-effort character-name fallback straight from the source CSV (row 2, "name"
 * column) for when the chatbot's reply didn't carry one. */
function nameFromCsv(csvText: string | undefined, warnings: string[]): string {
  if (csvText) {
    try {
      const rows = parseCsv(csvText);
      const nameCol = rows[0]?.findIndex((h) => h.trim() === 'name') ?? -1;
      const name = nameCol >= 0 ? (rows[1]?.[nameCol] ?? '').trim() : '';
      if (name) return name;
    } catch {
      // fall through to the generic fallback
    }
  }
  warnings.push(
    'The reply named no character and none could be read from the CSV — rename the character after importing.',
  );
  return 'Imported Character';
}

export function parseAlChatbotReply(reply: string, csvText?: string): AlImportResult {
  const result = parseChatbotImportReply(reply, {
    fallbackName: (warnings) => nameFromCsv(csvText, warnings),
    sourceNote: `Imported from Adventurers League Log via an AI chatbot on ${new Date().toISOString().slice(0, 10)}.`,
  });
  if (csvText) crossCheckGoldAndDowntime(csvText, result.logs, result.warnings);
  return result;
}

/**
 * Defense against the classic chatbot failure: filing a session's GOLD as XP — the
 * xp_gained column sits between two usually-empty columns right before gp_gained, so
 * models miscount the empty fields (observed 2026-07-19 with Gemini: every session's
 * gp ended up as an "XP gained:" notes line and the character's GP went negative).
 * The CSV columns are authoritative per entry: each timestamp's NET gold and
 * downtime (a purchase+sell pair shares one timestamp) must equal the columns.
 * Best-effort: any parse oddity just skips the check.
 */
function crossCheckGoldAndDowntime(csvText: string, logs: LogEntry[], warnings: string[]) {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch {
    return;
  }
  if (rows.length < 4 || rows[0]?.[0]?.trim() !== 'name' || rows[2]?.[0]?.trim() !== 'type') {
    return;
  }
  const logCol = new Map(rows[2].map((h, i) => [h.trim(), i] as const));
  const col = (cols: string[], name: string) => (cols[logCol.get(name) ?? -1] ?? '').trim();

  // Net gp/downtime per timestamp, from the CSV's own columns.
  const csvNet = new Map<string, { gp: number; dt: number; titles: string[] }>();
  for (const row of rows.slice(3)) {
    const kind = row[0]?.trim();
    if (kind !== 'CharacterLogEntry' && kind !== 'PurchaseLogEntry' && kind !== 'TradeLogEntry') {
      continue;
    }
    const when = parseDateTime(col(row, 'date_played')) ?? parseDateTime(col(row, 'date_dmed'));
    if (!when) continue;
    const key = `${when.date}|${when.time ?? ''}`;
    const bucket = csvNet.get(key) ?? { gp: 0, dt: 0, titles: [] };
    bucket.gp += num(col(row, 'gp_gained'));
    bucket.dt += num(col(row, 'downtime_gained'));
    const title = col(row, 'adventure_title');
    if (title) bucket.titles.push(title);
    csvNet.set(key, bucket);
  }

  // Net gp/downtime per timestamp, from the converted logs.
  const logNet = new Map<string, { gp: number; dt: number }>();
  for (const log of logs) {
    const key = `${log.date}|${log.time ?? ''}`;
    const bucket = logNet.get(key) ?? { gp: 0, dt: 0 };
    bucket.gp += log.gpGained - log.gpLost;
    bucket.dt += log.downtimeGained - log.downtimeSpent;
    logNet.set(key, bucket);
  }

  const EPS = 0.005;
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const mismatches: string[] = [];
  for (const [key, want] of csvNet) {
    if (Math.abs(want.gp) < EPS && Math.abs(want.dt) < EPS) continue; // nothing to misread
    const got = logNet.get(key) ?? { gp: 0, dt: 0 };
    if (Math.abs(want.gp - got.gp) <= EPS && Math.abs(want.dt - got.dt) <= EPS) continue;
    const [date, time] = key.split('|');
    const label = want.titles[0] ? `"${want.titles[0]}" ` : '';
    mismatches.push(
      `${label}(${date}${time ? ` ${time}` : ''}): the CSV columns net to ${fmt(want.gp)} gp / ${fmt(want.dt)} downtime, but the converted logs net to ${fmt(got.gp)} gp / ${fmt(got.dt)} downtime — the chatbot may have filed gold as XP; fix these logs after importing.`,
    );
  }
  const SHOWN = 5;
  for (const m of mismatches.slice(0, SHOWN)) warnings.push(m);
  if (mismatches.length > SHOWN) {
    warnings.push(`…and ${mismatches.length - SHOWN} more gold/downtime mismatches.`);
  }
}
