import type { Rarity } from './types';
import { ITEM_CATALOG } from './catalog';
import { KNOWN_MAGIC_ITEMS, type KnownMagicItem } from './data/magicItems';

/** Same loose identity as importAlLog's normalizeKey (case, spaces, punctuation
 * ignored). Duplicated here on purpose: the importers all use this module, so
 * importing theirs back would make an import cycle. */
function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const BY_NAME: Map<string, KnownMagicItem> = new Map(KNOWN_MAGIC_ITEMS.map((i) => [key(i.name), i]));

export interface MagicItemMatch {
  requiresAttunement: boolean;
  /** Undefined for generic "+N"-style matches where only the template is known
   * (a base item outside the equipment catalog — see the fallback at the bottom). */
  rarity?: Rarity;
  /** The list's own spelling — undefined for template matches, which keep the
   * imported name as-is ("+2 Greatsword" stays "+2 Greatsword"). */
  canonicalName?: string;
}

// ---- Generic variant resolution ---------------------------------------------------

type BaseClass = 'weapon' | 'armor' | 'shield';

/** Base items a generic variant can be named with, classified from the app's own
 * equipment catalog (2024 PHB): "Greatsword" → weapon, "Chain Mail" → armor,
 * "Shield" → shield. Sorted longest-name-first so "Greatclub" beats "Club". */
const BASE_ITEMS: { key: string; name: string; cls: BaseClass }[] = (ITEM_CATALOG.equipment ?? [])
  .map((e) => {
    const cls: BaseClass | undefined = e.group?.endsWith('Weapons')
      ? 'weapon'
      : e.group?.endsWith('Armor')
        ? 'armor'
        : e.group === 'Shield'
          ? 'shield'
          : undefined;
    return cls ? { key: key(e.name), name: e.name, cls } : undefined;
  })
  .filter((x): x is NonNullable<typeof x> => x !== undefined)
  .sort((a, b) => b.name.length - a.name.length);

const GENERIC_VARIANTS = KNOWN_MAGIC_ITEMS.filter((i) => i.generic);

/**
 * "+2 Greatsword" / "Vicious Battleaxe" / "Berserker Halberd": a generic variant
 * template named with a specific base item. Splits the name into template prefix +
 * base item (from the equipment catalog), then finds a generic variant that starts
 * with the prefix AND covers the base item — by named base list when the variant has
 * one ("Berserker Axe" → Battleaxe/Greataxe/Halberd only), else by class. Matches on
 * named bases win over class matches (the precise variant beats the catch-all).
 */
function resolveGeneric(name: string): MagicItemMatch | undefined {
  const trimmed = name.trim();
  const nameKey = key(trimmed);
  for (const base of BASE_ITEMS) {
    if (nameKey === base.key || !nameKey.endsWith(base.key)) continue;
    const prefix = trimmed.slice(0, trimmed.length - base.name.length).trim();
    if (!prefix) continue;
    const p = prefix.toLowerCase();
    const classMatches: KnownMagicItem[] = [];
    for (const v of GENERIC_VARIANTS) {
      const vName = v.name.toLowerCase();
      if (vName !== p && !vName.startsWith(`${p} `)) continue;
      const g = v.generic!;
      if (g.bases) {
        // Named-base variants are exact answers — return immediately.
        if (g.bases.some((b) => key(b) === base.key)) {
          return { requiresAttunement: v.requiresAttunement, rarity: v.rarity };
        }
        continue;
      }
      if ((g.classes ?? []).includes(base.cls)) classMatches.push(v);
    }
    if (classMatches.length > 0) {
      // The plainest template wins: exact prefix first, then the fewest extra words
      // ("Mithral Armor", not "Mithral +1 Armor", for a "Mithral …" prefix).
      classMatches.sort(
        (a, b) =>
          Number(b.name.toLowerCase() === p) - Number(a.name.toLowerCase() === p) ||
          a.name.length - b.name.length,
      );
      const v = classMatches[0];
      return { requiresAttunement: v.requiresAttunement, rarity: v.rarity };
    }
  }
  return undefined;
}

/** "+1 Longsword" / "Longsword +1" / "+ 2 armor" → the bonus and the base name. */
function splitPlusBonus(name: string): { bonus: string; base: string } | null {
  const head = name.trim().match(/^\+\s*([123])\s+(.+)$/);
  if (head) return { bonus: head[1], base: head[2] };
  const tail = name.trim().match(/^(.+?)\s*\+\s*([123])\s*$/);
  if (tail) return { bonus: tail[2], base: tail[1] };
  return null;
}

/**
 * Best-effort match for a magic item name from free text (imports, session recaps).
 * Tries, in order:
 *
 *  1. exact (normalized) — "Cloak of Protection", or a generic template named
 *     verbatim ("+1 Weapon", "Vicious Weapon")
 *  2. "A (B)" → "A, B": 5e.tools names variants with a comma ("Ioun Stone, Absorption",
 *     "Instrument of the Bards, Cli Lyre"), people write them with parentheses
 *  3. "A (B)" → bare "A": a parenthetical variant the list doesn't know still answers
 *     for the family ("Ioun Stone (Vitality)" → no entry → move on)
 *  4. the "+N" moved front↔back ("Dragonhide Belt +3" → "+3 Dragonhide Belt") — real
 *     entries must win over the template resolution below
 *  5. generic template resolution ("+2 Greatsword" → "+2 Weapon", "Berserker Halberd"
 *     → "Berserker Axe") via the equipment catalog, on both the original and the
 *     "+N"-reordered name ("Greatsword +2")
 *  6. generic "+N" fallback with NO rarity: a +1/+2/+3 name whose base isn't even in
 *     the equipment catalog (a firearm, a homebrew base) — plain plus items never
 *     require attunement in either DMG edition, so attunement is still safely known.
 *
 * Returns undefined when nothing matches; the caller's default then applies (absent
 * requiresAttunement reads as "requires attunement" — the app's conservative default).
 */
export function lookupKnownMagicItem(name: string): MagicItemMatch | undefined {
  const exact = BY_NAME.get(key(name));
  if (exact) {
    return {
      requiresAttunement: exact.requiresAttunement,
      rarity: exact.rarity,
      canonicalName: exact.name,
    };
  }

  const paren = name.trim().match(/^(.*\S)\s*\(([^()]+)\)$/);
  if (paren) {
    const comma = BY_NAME.get(key(`${paren[1]}, ${paren[2]}`));
    if (comma) {
      return {
        requiresAttunement: comma.requiresAttunement,
        rarity: comma.rarity,
        canonicalName: comma.name,
      };
    }
    const bare = BY_NAME.get(key(paren[1]));
    if (bare) {
      return {
        requiresAttunement: bare.requiresAttunement,
        rarity: bare.rarity,
        canonicalName: bare.name,
      };
    }
  }

  const plus = splitPlusBonus(name);
  if (plus) {
    const reordered = BY_NAME.get(key(`+${plus.bonus} ${plus.base}`));
    if (reordered) {
      return {
        requiresAttunement: reordered.requiresAttunement,
        rarity: reordered.rarity,
        canonicalName: reordered.name,
      };
    }
  }

  const generic = resolveGeneric(name) ?? (plus ? resolveGeneric(`+${plus.bonus} ${plus.base}`) : undefined);
  if (generic) return generic;

  if (plus) {
    // "+N <something not in the equipment catalog>" — still a plain plus item.
    return { requiresAttunement: false };
  }

  return undefined;
}
