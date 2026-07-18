/* Sanity harness: loads the real import modules through Vite's SSR loader and
 * exercises the attunement wiring end to end. Run: node scripts/test-attunement.mjs */
import { createServer } from 'vite';

const vite = await createServer({ logLevel: 'silent' });
try {
  const { importAlLog } = await vite.ssrLoadModule('/src/importAlLog.ts');
  const { parseLogText, parseChatbotReply } = await vite.ssrLoadModule('/src/importText.ts');
  const { lookupKnownMagicItem } = await vite.ssrLoadModule('/src/magicItemLookup.ts');

  let failures = 0;
  const check = (label, actual, expected) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: requiresAttunement=${actual} (expected ${expected})`);
  };
  // Lookup-level check: attunement AND rarity.
  const checkLookup = (name, expectedAttune, expectedRarity) => {
    const m = lookupKnownMagicItem(name);
    const ok = m?.requiresAttunement === expectedAttune && m?.rarity === expectedRarity;
    if (!ok) failures++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  lookup "${name}": ${JSON.stringify(m ?? null)} (expected attune=${expectedAttune}, rarity=${expectedRarity})`,
    );
  };

  // ---- Generic variant resolution (user's examples) ----
  checkLookup('+2 Greatsword', false, 'rare'); // → "+2 Weapon"
  checkLookup('+1 Chain Mail', false, 'rare'); // → "+1 Armor"
  checkLookup('+1 Shield', false, 'uncommon'); // exact entry
  checkLookup('Shield +2', false, 'rare'); // reordered → "+2 Shield"
  checkLookup('Greatsword +2', false, 'rare'); // reordered → generic "+2 Weapon"
  checkLookup('Vicious Battleaxe', false, 'rare'); // → "Vicious Weapon"
  checkLookup('Berserker Halberd', true, 'rare'); // named base of "Berserker Axe"
  checkLookup('Berserker Longsword', undefined, undefined); // NOT a valid base → no match
  checkLookup('Moon-Touched Scimitar', false, 'common'); // sword base list
  checkLookup('Flame Tongue Dagger', true, 'rare'); // prefix == template name
  checkLookup('Mithral Chain Mail', false, 'uncommon'); // → "Mithral Armor"
  checkLookup('Oathbow', true, 'very rare'); // exact template name
  checkLookup('+1 Blunderbuss', false, undefined); // base outside catalog → static fallback
  checkLookup('Weapon of Warning', true, 'uncommon'); // exact
  checkLookup('Armor of Acid Resistance', true, 'rare'); // exact

  // ---- Import AL Log (CSV): MAGIC ITEM rows get attunement from the list ----
  const csv = [
    'name,race,class_and_levels,faction',
    'Test McTest,Human,Fighter 5,Harpers',
    'type,adventure_title,session_num,date_played,dm_name,location_played,gp_gained,downtime_gained,notes,date_dmed,campaign_id',
    'MAGIC ITEM,name,rarity,,,,,,,,',
    'CharacterLogEntry,DDAL Test,1,2026-07-01 12:00:00 UTC,DM Bob,Home,100,10,,,',
    'MAGIC ITEM,Cloak of Protection,uncommon,,,,,,,',
    'MAGIC ITEM,+1 Longsword,uncommon,,,,,,,',
    'MAGIC ITEM,Instrument of the Bards (Cli Lyre),rare,,,,,,,',
    'MAGIC ITEM,Homebrew Gizmo of Power,rare,,,,,,,',
  ].join('\n');
  const al = importAlLog(csv);
  const alItems = al.logs[0].itemsGained;
  check('AL: Cloak of Protection', alItems.find((i) => i.name === 'Cloak of Protection')?.requiresAttunement, true);
  check('AL: +1 Longsword (generic)', alItems.find((i) => i.name === '+1 Longsword')?.requiresAttunement, false);
  check('AL: Instrument (paren)', alItems.find((i) => i.name.startsWith('Instrument'))?.requiresAttunement, true);
  check('AL: Homebrew (unknown)', alItems.find((i) => i.name === 'Homebrew Gizmo of Power')?.requiresAttunement, undefined);

  // ---- Quick Fill (offline parser): DM states attunement; list fills the rest ----
  const recap = `DDAL Test Adventure
Date: 2026-07-10
Gold: 100 gp each

## Magic Items:
**Moonblade of Snuggles**
*Weapon, very rare*
This blade does not require attunement, surprisingly.

**Cloak of Protection**

**Homebrew Stick**

**Whisper Jar**
`;
  const text = parseLogText(recap, 'char1');
  const tItems = text.log.itemsGained;
  check('Text: stated "does not require"', tItems.find((i) => i.name === 'Moonblade of Snuggles')?.requiresAttunement, false);
  check('Text: list lookup', tItems.find((i) => i.name === 'Cloak of Protection')?.requiresAttunement, true);
  check('Text: unknown', tItems.find((i) => i.name === 'Homebrew Stick')?.requiresAttunement, undefined);
  // Whisper Jar is in the list (requires attunement) but rarity "varies" was dropped — must NOT match.
  check('Text: dropped rarity "varies" item', tItems.find((i) => i.name === 'Whisper Jar')?.requiresAttunement, undefined);

  // ---- Chatbot reply: explicit field wins; null falls back to the list ----
  const reply = JSON.stringify({
    date: '2026-07-10',
    title: 'Test',
    gpGained: 100,
    itemsGained: [
      { name: 'Dagger of Venom', category: 'magic_item', rarity: 'rare', quantity: 1, requiresAttunement: true },
      { name: 'Cloak of Protection', category: 'magic_item', rarity: 'uncommon', quantity: 1, requiresAttunement: null },
      { name: 'Staff of Power', category: 'magic_item', quantity: 1 },
    ],
  });
  const bot = parseChatbotReply(reply, 'char1');
  const bItems = bot.log.itemsGained;
  check('Chatbot: explicit true wins over list(false)', bItems.find((i) => i.name === 'Dagger of Venom')?.requiresAttunement, true);
  check('Chatbot: null falls back to list', bItems.find((i) => i.name === 'Cloak of Protection')?.requiresAttunement, true);
  check('Chatbot: absent falls back to list + rarity filled', bItems.find((i) => i.name === 'Staff of Power')?.requiresAttunement, true);
  console.log('       Staff of Power rarity:', bItems.find((i) => i.name === 'Staff of Power')?.rarity, '(expect very rare)');

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await vite.close();
}
