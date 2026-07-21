# AMAnuensis — D&D Session Logs

A local-first PWA for tracking D&D Adventurers League bookkeeping: characters, session logs,
gold, downtime, magic items, consumables, equipment, story awards, blessings, charms and boons.

## About the name

An *amanuensis* is a scribe — someone who takes dictation and copies what happened, which is
exactly what this app does for your adventures. It's also a classic D&D spell (*Amanuensis*,
of copying-text fame). And **AMA** for short is a nod our community will recognize: the
amethyst dragon Amaranthraxine, "Ama" to friends — who, like a grandma (*ama* in some Chinese
dialects), is always asking whether you've eaten and writing down everything you did.

All data lives in your browser (IndexedDB). No server, no accounts. Use **Backup / Restore**
(JSON) to back up or move data between devices. The app keeps track of changes made since
your last backup and shows a reminder until you back them up.

**New here?** See [USER_GUIDE.md](USER_GUIDE.md) for a walkthrough of creating a character
and logging your first few sessions.

## How it works

Characters store only what you type in: **name, species, class**. Everything else —
**level, GP, downtime days, and the full inventory** — is derived by replaying the
character's logs in date order. Fix a mistake by deleting the log; totals recompute.

### Log types

| Type | Effect |
| --- | --- |
| **Session** | Gain GP / downtime / level / items of any category; may also lose GP and items (e.g. potions drunk mid-session). |
| **Catch Up** | Spend 10 downtime days, gain 1 level. |
| **Trade** | Trade a magic item for another of the same rarity, spend 5 downtime days; records the trading partner. |
| **Purchase** | Spend GP, gain equipment. |
| **Sell** | Sell equipment for GP. The sale price prefills at half of what you paid for it (from your purchase logs), else half the list price, else 0. |
| **Starting Log** | Character creation: starting gold and equipment, with 2024 PHB background/class package prefills — the picked background/class (and option) is kept on the log. |
| **Free Log** | Anything else: DM rewards, corrections, higher starting levels. |

Notes:
- New characters start at level 1 — use a Free Log to record a higher starting level and equipment.
- The tracker records what is *available* to the character; what is currently equipped or
  active (e.g. which blessing) is managed elsewhere (e.g. D&D Beyond).
- Consumables, charms and story awards have a one-click **Use** button that records the use as a Free Log.
- Boons are tracked as their own category (they count against the AL boon feat limit, unlike blessings).

## Importing from adventurersleaguelog.com

**Import AL Log** on the character screen reads a CSV export from
[adventurersleaguelog.com](https://www.adventurersleaguelog.com) (one character per file) and
creates the character with all their logs. You get a preview — derived level/GP/downtime and
any caveats — before anything is saved.

The AL Log format doesn't record everything, so the import is best-effort:

- **Levels aren't in the export.** Every DM'd session imports as +1 level (the usual AL rule);
  edit any session where you chose not to level.
- **Consumables and equipment live as free text** in the AL Log notes. Bullet lines
  (`* Potion of Healing`, `* Club 2x`, `* Shield (10GP)`) are parsed into real items with
  quantity and cost where possible; the original notes are kept on the log so nothing is lost.
  `*`, `•` and `+ ` bullets are items gained. `- ` bullets next to `+` bullets are items
  **sold** — the entry splits into a Purchase log and a Sell log, each with its own gold math.
  A purchase entry written *only* with dashes is ambiguous (some people just use `-` as their
  bullet style), so the entry's gold decides: gold going out = a normal purchase of the listed
  items, gold coming in = a sale of them. In session/free entries, `- ` bullets are items
  used/lost.
- Session entries with no DM, no location and no magic items import as **Free Logs**
  (or **Catch Up** when they just spend a multiple of 10 downtime days).
- Trade entries match the traded-away item by name against earlier logs; purchases that *gain*
  gold (e.g. "starting equipment" logs) become Free Logs.

## Development

```
npm install
npm run dev               # dev server
npm run build              # production build (dist/) with PWA service worker — serve it (e.g. npm run preview), don't open dist/index.html directly
npm run build:standalone   # single-file offline build (dist-standalone/index.html) — double-click it, no server or internet needed
```

Built with Vite + React + TypeScript. PWA via vite-plugin-pwa (installable, works offline;
only in the regular `npm run build`, since a plain `npm run build` served over `http(s)`
needs a service worker to work offline, while the standalone build already needs no
network at all). The standalone build inlines everything (JS, CSS) into one `index.html`
via vite-plugin-singlefile so it runs straight from disk with no server — a normal
`npm run build`'s `index.html` uses `<script type="module">`, which browsers refuse to
load over `file://` at all (unrelated to hosting/subpath — it fails identically no matter
where the repo lives), so opening it directly always fails; that's what `build:standalone`
is for.
`base: './'` in vite.config.ts so the built site works from any subpath (e.g. GitHub Pages).
