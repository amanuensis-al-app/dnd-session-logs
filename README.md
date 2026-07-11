# AL Tracker — D&D Session Logs

A local-first PWA for tracking D&D Adventurers League bookkeeping: characters, session logs,
gold, downtime, magic items, consumables, equipment, story awards, blessings, charms and boons.

All data lives in your browser (IndexedDB). No server, no accounts. Use **Backup / Restore**
(JSON) to back up or move data between devices. The app keeps track of changes made since
your last backup and shows a reminder until you back them up.

## How it works

Characters store only what you type in: **name, species, class**. Everything else —
**level, GP, downtime days, and the full inventory** — is derived by replaying the
character's logs in date order. Fix a mistake by deleting the log; totals recompute.

### Log types

| Type | Effect |
| --- | --- |
| **Session** | Gain GP / downtime / level / items of any category; may also lose GP and items (e.g. potions drunk mid-session). |
| **Catch Up** | Spend 10 downtime days, gain 1 level. |
| **Transaction** | Trade a magic item for another of the same rarity, spend 5 downtime days; records the trading partner. |
| **Purchase** | Spend GP, gain equipment. |
| **Free Log** | Anything else: character creation (starting level/gear), DM rewards, corrections. |

Notes:
- New characters start at level 1 — use a Free Log to record a higher starting level and equipment.
- The tracker records what is *available* to the character; what is currently equipped or
  active (e.g. which blessing) is managed elsewhere (e.g. D&D Beyond).
- Consumables, charms and story awards have a one-click **Use** button that records the use as a Free Log.
- Boons are tracked as their own category (they count against the AL boon feat limit, unlike blessings).

## Development

```
npm install
npm run dev      # dev server
npm run build    # production build (dist/) with PWA service worker
```

Built with Vite + React + TypeScript. PWA via vite-plugin-pwa (installable, works offline).
`base: './'` in vite.config.ts so the built site works from any subpath (e.g. GitHub Pages).
