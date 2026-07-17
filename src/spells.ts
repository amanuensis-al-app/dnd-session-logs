import type { Rarity } from './types';

/**
 * Known spells, keyed to their level so a spell scroll's rarity can be derived (2024
 * DMG table: a scroll's rarity is set by its spell's level, not chosen freely). Extend
 * this list as more spells come up in play — an unlisted spell just leaves whatever
 * rarity the source already had (see `resolveSpellScroll`).
 */
export interface SpellDefinition {
  name: string;
  /** 0 = cantrip. */
  level: number;
}

export const SPELL_LIST: SpellDefinition[] = [{ name: 'Ice Knife', level: 1 }];

function normalizeSpellKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const spellByKey = new Map(SPELL_LIST.map((s) => [normalizeSpellKey(s.name), s] as const));

export function lookupSpell(name: string): SpellDefinition | undefined {
  return spellByKey.get(normalizeSpellKey(name));
}

/** 2024 DMG spell scroll rarity table (Cantrip/1st common → 9th legendary). */
export function rarityForSpellLevel(level: number): Rarity {
  if (level <= 1) return 'common';
  if (level <= 3) return 'uncommon';
  if (level <= 5) return 'rare';
  if (level <= 8) return 'very rare';
  return 'legendary';
}

// "Spell Scroll of Ice Knife" or "Spell Scroll (Ice Knife)" (plural/case-insensitive).
const SPELL_SCROLL_RE = /^spell\s*scrolls?\s*(?:of\s+(.+?)|\(\s*([^()]+?)\s*\))\s*$/i;

// The catalog's generic, non-spell-specific placeholders ("Spell Scroll (Cantrip)",
// "Spell Scroll (Level 1)") aren't spells — leave them alone rather than mangling them
// into "Spell Scroll of Cantrip".
const GENERIC_PLACEHOLDER_RE = /^(cantrip|level\s*\d+)$/i;

export interface ResolvedSpellScroll {
  /** Canonical "Spell Scroll of <Spell>" name. */
  name: string;
  /** Only set when the spell is in SPELL_LIST. */
  rarity?: Rarity;
  spellKnown: boolean;
}

/** Recognizes a spell-scroll name in either written form and returns the unified name
 * plus (when the spell is known) its level-derived rarity. Not a spell scroll (or a
 * generic catalog placeholder) → undefined. */
export function resolveSpellScroll(rawName: string): ResolvedSpellScroll | undefined {
  const m = rawName.trim().match(SPELL_SCROLL_RE);
  const spellRaw = (m?.[1] ?? m?.[2])?.trim();
  if (!spellRaw || GENERIC_PLACEHOLDER_RE.test(spellRaw)) return undefined;
  const known = lookupSpell(spellRaw);
  return {
    name: `Spell Scroll of ${known ? known.name : spellRaw}`,
    rarity: known ? rarityForSpellLevel(known.level) : undefined,
    spellKnown: known !== undefined,
  };
}

export interface ScrollCanonicalization {
  name: string;
  rarity: Rarity | undefined;
  /** Category should be forced to 'consumable' when true. */
  isSpellScroll: boolean;
}

function canonicalize(rawName: string, rarity: Rarity | undefined, preferSpellRarity: boolean): ScrollCanonicalization {
  const resolved = resolveSpellScroll(rawName);
  if (!resolved) return { name: rawName, rarity, isSpellScroll: false };
  const finalRarity = preferSpellRarity
    ? (resolved.spellKnown ? resolved.rarity : rarity)
    : (rarity ?? resolved.rarity);
  return { name: resolved.name, rarity: finalRarity, isSpellScroll: true };
}

/** Import paths (AL Log, Log Sheet): the spell-level rarity overrides whatever rarity
 * the source file recorded, whenever the spell is known. */
export function canonicalizeSpellScrollForImport(name: string, rarity?: Rarity): ScrollCanonicalization {
  return canonicalize(name, rarity, true);
}

/** Add Log from Text (Quick Fill + AI chatbot): an explicit rarity found in the text
 * wins; the spell-level rarity only fills in when none was given. */
export function canonicalizeSpellScrollForText(name: string, rarity?: Rarity): ScrollCanonicalization {
  return canonicalize(name, rarity, false);
}
