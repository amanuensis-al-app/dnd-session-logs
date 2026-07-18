#!/usr/bin/env node
/**
 * Regenerates the known-magic-items data files from the 5e.tools dataset:
 *
 *   node scripts/build-magic-items.mjs
 *
 * Source: https://5e.tools/items.html renders from `data/items.json`, which is
 * Cloudflare-protected on the site itself — so this fetches the same file from the
 * 5etools GitHub mirror (5etools-mirror-3/5etools-src, the dataset 5e.tools ships).
 *
 * Output (both committed to the repo — do not hand-edit):
 *   src/data/magicItems.ts        — magic items the app uses (name, rarity, attunement)
 *   src/data/magicItemsSkipped.ts — ammunition/potion/scroll items, kept aside for a
 *                                   future consumables catalog; nothing imports it yet.
 *
 * 5e.tools schema notes (verified 2026-07-19):
 *   - `type` is source-namespaced ("RD|DMG", "M|XPHB"); the real code is before the "|".
 *     Wondrous items have no `type` at all. Skip codes: A/AF (ammunition), P (potion),
 *     SC (scroll).
 *   - `rarity` keeps only the six the app models; "none"/"unknown"/"unknown (magic)"/
 *     "varies"/absent entries are dropped entirely (mundane gear, trade goods, etc.).
 *   - `reqAttune` is true/false, or a CONDITION STRING ("by a bard") — any truthy value
 *     means the item requires attunement.
 *   - Many items print in both the 2014 and 2024 DMG ("DMG" and "XDMG" sources) —
 *     dedupe by name preferring XDMG (2024 rules, what this app tracks), then DMG.
 *   - GENERIC VARIANTS ("+1 Weapon", "Vicious Weapon", "Berserker Axe"…) are not in
 *     items.json — the site generates specific variants at render time. They live in
 *     data/magicvariants.json with `requires` conditions saying which base items they
 *     apply to; this script classifies those into whole classes (weapon/armor/shield)
 *     or named base items, so the app's lookup can resolve "+2 Greatsword" → "+2
 *     Weapon". Variants land in the same output list flagged `generic`, so they are
 *     also pickable in the UI as-is ("+1 Weapon" — the user renames it afterwards).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE_URL = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data';
const ITEMS_URL = `${BASE_URL}/items.json`;
const VARIANTS_URL = `${BASE_URL}/magicvariants.json`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_KIND_LABEL = { A: 'ammunition', AF: 'ammunition', P: 'potion', SC: 'scroll' };

/** The app's Rarity union — everything else gets dropped. */
const KEPT_RARITIES = new Set(['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact']);

/** What `requires: [{"sword": true}]` / `[{"axe": true}]` mean, as 2024 PHB base items. */
const SWORDS = ['Shortsword', 'Longsword', 'Greatsword', 'Rapier', 'Scimitar'];
const AXES = ['Handaxe', 'Battleaxe', 'Greataxe', 'Halberd'];

/** Loose identity for dedupe: case, spaces and punctuation ignored (mirrors normalizeKey). */
function normalizeKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Newer rules win: XDMG (2024 DMG) > DMG (2014) > everything else. */
function sourceRank(source) {
  if (source === 'XDMG') return 0;
  if (source === 'DMG') return 1;
  return 2;
}

/**
 * Classify a generic variant's `requires` conditions into whole base-item classes
 * (weapon/armor/shield) and/or named base items. `ammoOnly` marks ammunition-only
 * variants (they go to the skipped file).
 */
function classifyRequires(requires) {
  const classes = new Set();
  const bases = new Set();
  let ammoOnly = Array.isArray(requires) && requires.length > 0;
  for (const r of requires ?? []) {
    if (r.armor) { classes.add('armor'); classes.add('shield'); ammoOnly = false; continue; }
    if (r.weapon || r.weaponCategory) { classes.add('weapon'); ammoOnly = false; continue; }
    if (r.sword) { SWORDS.forEach((b) => bases.add(b)); ammoOnly = false; continue; }
    if (r.axe) { AXES.forEach((b) => bases.add(b)); ammoOnly = false; continue; }
    if (r.arrow || r.bolt) continue; // ammunition — keeps ammoOnly as-is
    if (r.net) { bases.add('Net'); ammoOnly = false; continue; }
    if (r.name) { bases.add(r.name); ammoOnly = false; continue; }
    if (r.type) {
      const code = r.type.split('|')[0];
      if (code === 'M' || code === 'R') { classes.add('weapon'); ammoOnly = false; }
      else if (code === 'LA' || code === 'MA' || code === 'HA') { classes.add('armor'); ammoOnly = false; }
      else if (code === 'S') { classes.add('shield'); ammoOnly = false; }
      // A / AF stay ammunition (keeps ammoOnly as-is)
    }
  }
  return { classes: [...classes], bases: [...bases], ammoOnly };
}

const HEADER = `// GENERATED FILE — do not edit. Regenerate with: node scripts/build-magic-items.mjs
// Source: 5e.tools items dataset (see the script for details).

`;

async function fetchJson(url) {
  console.log(`Fetching ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const [itemsData, variantsData] = await Promise.all([
    fetchJson(ITEMS_URL),
    fetchJson(VARIANTS_URL),
  ]);
  const items = itemsData.item;
  if (!Array.isArray(items)) throw new Error('Unexpected items.json shape: no "item" array.');
  const variants = variantsData.magicvariant;
  if (!Array.isArray(variants)) throw new Error('Unexpected magicvariants.json shape: no "magicvariant" array.');

  const kept = new Map(); // normalizeKey(name) -> entry
  const skipped = new Map();
  let dropped = 0;

  for (const it of items) {
    if (!KEPT_RARITIES.has(it.rarity)) {
      dropped++;
      continue;
    }
    const typeCode = (it.type ?? '').split('|')[0];
    const skipKind = SKIP_KIND_LABEL[typeCode];
    const entry = {
      name: it.name,
      rarity: it.rarity,
      requiresAttunement: Boolean(it.reqAttune),
      ...(skipKind ? { kind: skipKind } : {}),
    };
    const map = skipKind ? skipped : kept;
    const key = normalizeKey(it.name);
    const prev = map.get(key);
    if (!prev || sourceRank(it.source) < sourceRank(prev.source)) map.set(key, { ...entry, source: it.source });
  }

  // Generic variants ("+1 Weapon", "Vicious Weapon", …). Prefer the 2024 (XDMG)
  // printing, same as specific items. The " (*)" suffix is 5e.tools' own
  // name-collision marker — stripped. Specific items win name collisions.
  let genericCount = 0;
  for (const v of variants) {
    const rarity = v.inherits?.rarity;
    if (!KEPT_RARITIES.has(rarity)) continue;
    const { classes, bases, ammoOnly } = classifyRequires(v.requires);
    if (v.ammo || ammoOnly) {
      const key = normalizeKey(v.name);
      if (!skipped.has(key)) {
        skipped.set(key, {
          name: v.name.replace(/\s*\(\*\)$/, ''),
          rarity,
          requiresAttunement: Boolean(v.inherits?.reqAttune ?? v.reqAttune),
          kind: 'ammunition',
          source: v.type === 'GV|XDMG' ? 'XDMG' : 'DMG',
        });
      }
      continue;
    }
    const name = v.name.replace(/\s*\(\*\)$/, '');
    const key = normalizeKey(name);
    const rank = v.type === 'GV|XDMG' ? 0 : 1;
    const prev = kept.get(key);
    // Real items always win; between variant printings prefer XDMG.
    if (prev && (prev.generic === undefined || prev.variantRank <= rank)) continue;
    kept.set(key, {
      name,
      rarity,
      requiresAttunement: Boolean(v.inherits?.reqAttune ?? v.reqAttune),
      generic: {
        ...(classes.length ? { classes } : {}),
        ...(bases.length ? { bases: bases.sort() } : {}),
      },
      variantRank: rank,
      source: v.type === 'GV|XDMG' ? 'XDMG' : 'DMG',
    });
    genericCount++;
  }

  const sortByName = (a, b) => a.name.localeCompare(b.name);
  const keptList = [...kept.values()].sort(sortByName);
  const skippedList = [...skipped.values()].sort(sortByName);
  // Some names print in both editions — count unique generic entries, not writes.
  genericCount = keptList.filter((e) => e.generic).length;

  const keptBody = keptList
    .map((e) => {
      const generic = e.generic
        ? `, generic: ${JSON.stringify(e.generic).replace(/"([^"]+)":/g, '$1:')}`
        : '';
      return `  { name: ${JSON.stringify(e.name)}, rarity: '${e.rarity}', requiresAttunement: ${e.requiresAttunement}${generic} },`;
    })
    .join('\n');
  const skippedBody = skippedList
    .map(
      (e) =>
        `  { name: ${JSON.stringify(e.name)}, rarity: '${e.rarity}', requiresAttunement: ${e.requiresAttunement}, kind: '${e.kind}' },`,
    )
    .join('\n');

  mkdirSync(join(ROOT, 'src/data'), { recursive: true });
  writeFileSync(
    join(ROOT, 'src/data/magicItems.ts'),
    `${HEADER}import type { Rarity } from '../types';

/** A magic item from the 5e.tools dataset (see scripts/build-magic-items.mjs). */
export interface KnownMagicItem {
  name: string;
  rarity: Rarity;
  /** 5e.tools "A" column: reqAttune true or a condition string both mean required. */
  requiresAttunement: boolean;
  /** Generic variant template ("+1 Weapon", "Vicious Weapon") — \`classes\`: whole
   * base-item categories it covers, \`bases\`: specific named base items (2024 PHB
   * names, matching the app's equipment catalog). Absent on specific items. */
  generic?: {
    classes?: ('weapon' | 'armor' | 'shield')[];
    bases?: string[];
  };
}

/** All known magic items, alphabetically. Lookup helpers live in src/magicItemLookup.ts. */
export const KNOWN_MAGIC_ITEMS: KnownMagicItem[] = [
${keptBody}
];
`,
  );

  writeFileSync(
    join(ROOT, 'src/data/magicItemsSkipped.ts'),
    `${HEADER}import type { Rarity } from '../types';

/** Ammunition / potion / scroll items from the 5e.tools dataset, set aside when
 * building magicItems.ts (owner call 2026-07-19: not used by the app yet — kept for a
 * future consumables catalog). */
export interface SkippedMagicItem {
  name: string;
  rarity: Rarity;
  requiresAttunement: boolean;
  kind: 'ammunition' | 'potion' | 'scroll';
}

export const SKIPPED_MAGIC_ITEMS: SkippedMagicItem[] = [
${skippedBody}
];
`,
  );

  console.log(`Wrote ${keptList.length} magic items (${genericCount} generic variants) → src/data/magicItems.ts`);
  console.log(`Wrote ${skippedList.length} ammunition/potion/scroll items → src/data/magicItemsSkipped.ts`);
  console.log(`Dropped ${dropped} entries with unusable rarity (none/unknown/varies/absent).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
