import { MINOR_PROPERTIES } from './types';
import type { AlImportResult } from './importAlLog';
import { parseChatbotImportReply } from './importSheetChatbot';

/**
 * The AI-chatbot bridge for the free-form "Import CSV Log" path — same zero-key
 * pattern as the AL Log and log-sheet imports, but with NO offline engine at all:
 * the source is any CSV/spreadsheet export whose layout nobody has taught the app,
 * so heuristics can't exist and the chatbot is the only converter.
 *
 * That makes this the heaviest prompt in the app: it can't describe the source
 * format (unknown by definition), so instead it teaches the chatbot to reverse-
 * engineer the document's structure FIRST (column meanings, row grouping, ordering,
 * cumulative-vs-delta values) and then hands it the tracker's entire domain model —
 * every log type with detection heuristics that don't depend on any particular
 * layout, the full item-naming rulebook, and the same self-check the AL prompt uses.
 *
 * Reply validation/loss-matching is the shared parseChatbotImportReply — only the
 * prompt and the fallback character name are specific to this path.
 */

// ---- Prompt --------------------------------------------------------------------

export function buildCsvChatbotPrompt(csvText: string, fileName?: string): string {
  return `You are converting a D&D play log document — a character's whole play history, most likely Adventurers League bookkeeping exported from someone's personal spreadsheet — into JSON for a play tracker. The document between the <doc> tags below is in an UNKNOWN free-form layout: nobody has told you what its columns mean, how its rows are grouped, or what order it runs in. You must work all of that out yourself, then convert. Answer with ONE JSON object only — no explanation, no markdown code fences.

STEP 1 — REVERSE-ENGINEER THE DOCUMENT BEFORE CONVERTING ANYTHING:
- Find the character's identity: a name, species/race, class — often in a header row, a title, or the file name. Missing pieces are null.
- Work out what each column (or each part of a line) means: dates, titles, gold, downtime days, levels, DM, location, items, notes. Column headers may be abbreviated, misspelled, or absent — infer from the VALUES (a column of "yyyy-mm-dd"-ish strings is dates; small integers next to session rows are usually downtime or levels; big decimals are gold).
- Work out the row structure: one row per event, or a main row followed by continuation/detail rows (item lists, notes) that belong to the entry above them? Sub-rows with an empty first cell usually continue the previous entry.
- Work out the ordering: newest-first, oldest-first, or unsorted — check the date column's direction. Your OUTPUT is always oldest-first regardless.
- For every numeric column decide: is it a PER-ENTRY DELTA (+50 gold this session) or a RUNNING TOTAL (character now has 1,230 gold / is now level 7)? Running totals that only ever grow along the timeline, or a column literally named anything like "total"/"current"/"at end", are totals — convert them to per-log deltas along the chronological order. Level almost always needs this treatment: the tracker starts every character at level 1 and stores per-log levelGained deltas.
- Only after you can explain the whole document to yourself, start converting. Do not drop rows you don't understand — convert them as "free" logs with the row's text preserved in notes.

WHAT THE TRACKER MODELS (Adventurers League bookkeeping):
- A character's state is replayed from logs: level (1–20), gold (GP; 1 SP = 0.1, 1 CP = 0.01), downtime days, and every owned item. Each log records what ONE event changed.
- Sessions typically award gold, +10 downtime days and sometimes a level and/or magic items. Downtime is spent on catching up levels (10 days per level), trading magic items (5 days), and copying spells.
- Items live in the log that granted them; losing an item later references it by name.

Use exactly this shape:
{
  "character": { "name": "...", "species": "... or null", "class": "... or null" },
  "logs": [
    {
      "type": one of "session", "catchup", "transaction", "copy_spell", "purchase", "sell", "creation", "free",
      "date": "YYYY-MM-DD",
      "time": "HH:MM (24h) — or null when the document has no time of day",
      "title": "short; the entry's own title/name if it has one",
      "dm": "... or null (sessions only)",
      "location": "... or null (sessions only)",
      "tradePartner": "... or null (transactions only)",
      "gpGained": number >= 0,
      "gpLost": number >= 0,
      "downtimeGained": number >= 0,
      "downtimeSpent": number >= 0,
      "levelGained": number (negative allowed only in "free" logs),
      "itemsGained": [
        {
          "name": "plain item name ONLY — see the naming rules",
          "category": one of "magic_item", "consumable", "equipment", "story_award", "blessing", "charm", "boon", "copied_spell",
          "rarity": one of "common", "uncommon", "rare", "very rare", "legendary", "artifact" — or null,
          "quantity": number >= 1,
          "cost": per-unit GP paid — or null (purchases only),
          "description": "short, or null",
          "minorProperty": one of ${MINOR_PROPERTIES.map((p) => `"${p}"`).join(', ')} — or null,
          "spellLevel": 1–9 (copied_spell items only) — or null,
          "copiedFrom": {"source": "scroll" or "player", "partner": "who, for player source"} (copied_spell items only) — or null
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
      "notes": "the entry's own notes/free text, or null"
    }
  ]
}

CLASSIFYING THE ENTRIES (by what the entry DID, not by what the document calls it):
1. "session" — a played game: has a DM, a location, an adventure title, or session-style rewards (gold in + downtime in + maybe a level or loot). dm/location filled when known. This is the default for anything that looks like actual play.
2. "creation" — the character being made: usually the OLDEST entry; starting gold and/or starting equipment; words like "creation", "starting equipment", "starting gold", a class/background package. levelGained = starting level − 1 (usually 0). Starting gear is "equipment" itemsGained with no costs; gpGained = the starting gold.
3. "purchase" — gold OUT for equipment/consumables. Every bought item gets its per-unit "cost"; gpLost must equal the exact sum of cost × quantity.
4. "sell" — gold IN for gear the character already owned (words like "sell", "sold", "sell back"). The sold items go in itemsLost with reason "sold" and a per-unit "salePrice"; gpGained = the exact sum of salePrice × quantity. An entry that BUYS and SELLS at once becomes TWO logs — a "purchase" then a "sell" — with the same date+time; the document may only show the NET gold, so split it: price the sells from any explicit amounts, and give the purchase the remainder so the pair's net matches the document.
5. "transaction" — trading a magic item for ANOTHER magic item of the same rarity (an AL trade between players). itemsGained = the item received, itemsLost = the item given with reason "traded", tradePartner = who they traded with, downtimeSpent = 5 unless the document says otherwise. Title: "Traded <lost> for <gained>".
6. "catchup" — downtime spent to level up, exactly 10 downtime days per level ("catch up", "catching up", or an unexplained −10/−20/−30 downtime with +1/+2/+3 levels): downtimeSpent = 10 × levelGained, nothing else.
7. "copy_spell" — a Wizard copying spells into their spellbook. THIS IS RARE: most logs contain none at all, and a non-Wizard essentially never has one — only use it when the entry EXPLICITLY says spells were copied/scribed/transcribed into a spellbook (typical costs: 50 gp per spell level, 1–2 downtime days per spell). Buying a scroll is a purchase; scroll loot is a session item. Each copied spell is an itemsGained entry: category "copied_spell", name = the PLAIN spell name (never "Spell Scroll of X"), "spellLevel" 1–9 (cantrips can't be copied), "copiedFrom" = {"source":"scroll"} — adding an itemsLost row ("Spell Scroll of <spell>", reason "used") ONLY when the copy came from a scroll the character owned — or {"source":"player","partner":"<who>"}, or null when the document doesn't say. Title: "Copied <spell>, <spell>".
8. "free" — everything else: service awards, story rewards, DM rewards, corrections, downtime activities (body reforms…), and any row you can't confidently classify. The only type where levelGained may be negative. When in doubt between "free" and anything exotic, pick "free" and keep the row's text in notes.

ITEM NAMING — get this exactly right:
- "name" is ONLY the plain D&D item name. Quantity markers ("x3", "3x", "(x1)", a leading count) become "quantity"; prices ("= 5GP", "(10GP)", "- 45GP") become "cost"/"salePrice" (a listed price is usually the LINE TOTAL — divide by the quantity for the per-unit value); verbs ("Buy", "Sell", "Sold", "Found") drop off.
- Use canonical D&D 2024 names: "Studded Leather" → "Studded Leather Armor", "Alchemist Fire" → "Alchemist's Fire", "Potion of Greater Healing" → "Potion of Healing (Greater)", "Chain Shirt Armor" → "Chain Shirt".
- Categories: potions, elixirs, oils and scrolls are "consumable" (single-use magical goods — give their rarity; Potion of Healing and Potion of Climbing are "common"). Mundane gear is "equipment" — INCLUDING flasks of Acid, Alchemist's Fire, Antitoxin and Holy Water (adventuring gear, NOT consumables). Permanent magical gear is "magic_item" with its rarity. Names starting "[Boon]" or mentioning an epic boon are "boon" (drop the prefix); "Blessing of …" is "blessing" (no rarity); "Charm of …" is "charm"; certificates/story rewards are "story_award".
- Spell scrolls are consumables named "Spell Scroll of <Spell Name>" (never "Scroll of X" or "Spell Scroll (X)"), rarity by spell level: cantrip–1st "common", 2nd–3rd "uncommon", 4th–5th "rare", 6th–8th "very rare", 9th "legendary".
- A trailing parenthetical that names a DMG minor property ("Fish Suit (Temperate)") becomes the item's "minorProperty".
- itemsLost must reuse EXACTLY the name an earlier log gained the item under (after these naming rules), so it can be matched back. A negative item count, a strikethrough, or words like "used"/"consumed"/"traded away"/"lost" mean an item LOSS, not a gain.

GENERAL RULES:
- Output logs OLDEST FIRST by date (+time when present). Entries sharing a date keep the document's relative order among themselves. An undated entry happened between its neighbors — give it the date of the nearest OLDER entry.
- gpGained/gpLost/downtimeGained/downtimeSpent are all >= 0: split any signed value (a negative gold delta is gpLost, a negative downtime delta is downtimeSpent).
- Keep each entry's original notes/free text VERBATIM in "notes" (use \\n for line breaks). Data the schema has no field for (XP, renown, session numbers, spell slots learnt, DM's player number…) is appended as extra notes lines like "Renown gained: 2" — never dropped, never invented. Note that Adventurers League dropped XP long ago: in a modern log a large number on a session is almost certainly GOLD, not XP.
- FINAL CHECK, before answering: (a) replay your own output — starting from level 1, 0 gp, 0 downtime, the running totals after every log must match every running-total column the document has, and the final level/gold/downtime must match whatever the document's latest state says; (b) every entry's net gold (gpGained − gpLost, counting a purchase+sell pair together) and net downtime must equal what the document records for it; (c) every itemsLost name appears as an earlier itemsGained name. Fix anything that fails before you answer.
- If something is genuinely ambiguous, make your best guess: a person reviews everything in a preview before importing.

File name: ${fileName ? `"${fileName}"` : '(unknown)'} — it may hold the character's name.

<doc>
${csvText.trim()}
</doc>`;
}

// ---- Reply parsing -------------------------------------------------------------

/** Free-form documents have no reliable name location — the file name (minus its
 * extension) is the best available guess when the reply didn't carry one. */
function nameFromFileName(fileName: string | undefined, warnings: string[]): string {
  const base = fileName?.replace(/\.[^.]+$/, '').trim();
  if (base) {
    warnings.push(
      `The reply named no character — used the file name ("${base}"); rename the character if that's wrong.`,
    );
    return base;
  }
  warnings.push('The reply named no character — rename the character after importing.');
  return 'Imported Character';
}

export function parseCsvChatbotReply(reply: string, fileName?: string): AlImportResult {
  return parseChatbotImportReply(reply, {
    fallbackName: (warnings) => nameFromFileName(fileName, warnings),
    sourceNote: `Imported from a free-form CSV log via an AI chatbot on ${new Date().toISOString().slice(0, 10)}.`,
  });
}
