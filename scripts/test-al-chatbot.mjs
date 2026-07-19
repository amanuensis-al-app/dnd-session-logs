/* Sanity harness for the AL Log AI-chatbot import path: feeds a simulated "ideal"
 * chatbot reply for the owner's real export (ebilun_al_log.csv) through
 * parseAlChatbotReply and checks the result against the hand-fixed target
 * (ebilun_correct.json) — plus the name-based sell matching that target file got
 * wrong by hand. Run: node scripts/test-al-chatbot.mjs */
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';

const vite = await createServer({ logLevel: 'silent' });
try {
  const { parseAlChatbotReply, buildAlChatbotPrompt } =
    await vite.ssrLoadModule('/src/importAlChatbot.ts');

  const csv = readFileSync('/Users/aurelia.halim/Downloads/ebilun_al_log.csv', 'utf8');
  const correct = JSON.parse(readFileSync('/Users/aurelia.halim/Downloads/ebilun_correct.json', 'utf8'));

  let failures = 0;
  const check = (label, ok, detail = '') => {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${detail}`}`);
  };

  // ---- The reply a chatbot should produce when following buildAlChatbotPrompt ----
  const reply = JSON.stringify({
    character: { name: 'Ebilun', species: 'Harengon', class: 'Scribe Wizard' },
    logs: [
      {
        type: 'creation', date: '2025-09-12', time: '02:38', title: 'Character Creation',
        gpGained: 105,
        notes: 'Wizard Starting Equipment: 55GP\n\nCustom Background Starting Equipment:\n50 GP',
      },
      {
        type: 'purchase', date: '2025-09-12', time: '02:45', title: 'Bought Studded Leather Armor',
        gpLost: 45,
        itemsGained: [
          { name: 'Studded Leather Armor', category: 'equipment', quantity: 1, cost: 45 },
        ],
        notes: '* Buy Studded Leather (-45GP)',
      },
      {
        type: 'session', date: '2025-09-13', time: '19:00', title: 'DDL4-02 The Beast',
        location: 'Games Haven @ Chinatown', dm: 'Ash | Paramnesiagirl',
        gpGained: 96.4, downtimeGained: 10, levelGained: 1,
        itemsGained: [
          { name: 'Whip of Warning', category: 'magic_item', rarity: 'uncommon', quantity: 1 },
          { name: 'Spell Scroll of Create Bonfire', category: 'consumable', rarity: 'common', quantity: 1 },
        ],
        notes: '* Scroll of Create Bonfire\nDM DCI: paramnesiagirl',
      },
      {
        type: 'catchup', date: '2025-09-16', time: '02:41', title: 'Catch Up',
        downtimeSpent: 10, levelGained: 1,
      },
      {
        type: 'purchase', date: '2025-09-16', time: '02:42',
        title: 'Bought Mirror, Signal Whistle, Backpack, Parchment',
        gpLost: 8.05,
        itemsGained: [
          { name: 'Mirror', category: 'equipment', quantity: 1, cost: 5 },
          { name: 'Signal Whistle', category: 'equipment', quantity: 1, cost: 0.05 },
          { name: 'Backpack', category: 'equipment', quantity: 1, cost: 2 },
          { name: 'Parchment', category: 'equipment', quantity: 10, cost: 0.1 },
        ],
        notes: '* Mirror = 5GP\n* Signal Whistle = 0.05GP\n* Backpack = 2GP\n* 10 Parchment = 1GP',
      },
      {
        type: 'sell', date: '2025-09-16', time: '02:42', title: 'Sold Studded Leather Armor',
        gpGained: 22.5,
        itemsLost: [
          { name: 'Studded Leather Armor', quantity: 1, reason: 'sold', salePrice: 22.5 },
        ],
        notes: '* Sell back Studded Leather = 22.5GP',
      },
      {
        type: 'session', date: '2025-10-12', time: '19:00', title: 'DDAL4-04 The Marionette',
        location: 'Xclusive Games', dm: 'Ash | Paramnesiagirl',
        gpGained: 178, downtimeGained: 10, levelGained: 1,
        itemsGained: [
          { name: 'Eyes of Charming', category: 'magic_item', rarity: 'uncommon', quantity: 1 },
          { name: 'Spell Scroll of Animate Dead', category: 'consumable', rarity: 'uncommon', quantity: 1 },
          { name: 'Acid', category: 'equipment', quantity: 1 },
          // Straight apostrophe on purpose — the parser should snap to the catalog's curly one.
          { name: "Alchemist's Fire", category: 'equipment', quantity: 1 },
          { name: 'Potion of Climbing', category: 'consumable', rarity: 'common', quantity: 1 },
          { name: 'Potion of Healing', category: 'consumable', rarity: 'common', quantity: 1 },
        ],
        notes: '* Scroll of Animate Dead (x1)\n* Acid (Vial x1)\n* Alchemist Fire (x1)\n* Potion of Climbing (x1)\n* Potion of Healing (x1)\nDM DCI: paramnesiagirl',
      },
    ],
  });

  const result = parseAlChatbotReply(reply, csv);
  const { character, logs, warnings } = result;

  // ---- Character -----------------------------------------------------------------
  check('character name', character.name === 'Ebilun', character.name);
  check('character species', character.species === 'Harengon', character.species);
  check('character class', character.class === 'Scribe Wizard', character.class);

  // ---- Log count + chronological order (the CSV itself is out of order) ----------
  check('log count', logs.length === 7, `got ${logs.length}`);
  const order = logs.map((l) => `${l.date} ${l.time ?? ''} ${l.type}`).join(' | ');
  check(
    'chronological types',
    logs.map((l) => l.type).join(',') ===
      'creation,purchase,session,catchup,purchase,sell,session',
    order,
  );

  const byType = (type, n = 0) => logs.filter((l) => l.type === type)[n];

  // ---- Creation (the offline importer files this as a Free Log) -------------------
  const creation = byType('creation');
  check('creation gp', creation.gpGained === 105 && creation.gpLost === 0, JSON.stringify({ g: creation.gpGained, l: creation.gpLost }));
  check('creation title', creation.title === 'Character Creation', creation.title);

  // ---- Purchases ------------------------------------------------------------------
  const leather = byType('purchase', 0);
  const leatherItem = leather.itemsGained[0];
  check(
    'leather purchase',
    leather.gpLost === 45 &&
      leather.itemsGained.length === 1 &&
      leatherItem.name === 'Studded Leather Armor' &&
      leatherItem.category === 'equipment' &&
      leatherItem.cost === 45,
    JSON.stringify(leather.itemsGained),
  );
  check(
    'leather stack id',
    leatherItem.id === 'stk:equipment|studded leather armor|',
    leatherItem.id,
  );

  const mixed = byType('purchase', 1);
  const mixedTotal = mixed.itemsGained.reduce((s, i) => s + i.cost * i.quantity, 0);
  check(
    'mixed purchase gpLost = Σ cost×qty',
    mixed.gpLost === 8.05 && Math.abs(mixedTotal - 8.05) < 0.001,
    `gpLost=${mixed.gpLost} Σ=${mixedTotal}`,
  );
  check(
    'mixed purchase items (names/qty/costs)',
    JSON.stringify(mixed.itemsGained.map((i) => [i.name, i.quantity, i.cost])) ===
      JSON.stringify([
        ['Mirror', 1, 5],
        ['Signal Whistle', 1, 0.05],
        ['Backpack', 1, 2],
        ['Parchment', 10, 0.1],
      ]),
    JSON.stringify(mixed.itemsGained),
  );

  // ---- Sell: the headline case -----------------------------------------------------
  const sell = byType('sell');
  const sellLoss = sell.itemsLost[0];
  check('sell gp', sell.gpGained === 22.5 && sell.gpLost === 0, `gpGained=${sell.gpGained}`);
  check(
    'sell loss shape',
    sell.itemsLost.length === 1 && sellLoss.quantity === 1 && sellLoss.reason === 'sold' && sellLoss.salePrice === 22.5,
    JSON.stringify(sell.itemsLost),
  );
  // The hand-fixed ebilun_correct.json points this at the pre-rename stack id and
  // dangles; name-based matching must land on the actual gained stack.
  check(
    'sell loss resolves to the real stack (not dangling)',
    sellLoss.itemId === leatherItem.id,
    `loss=${sellLoss.itemId} gained=${leatherItem.id}`,
  );
  check(
    'sell sorts right after its purchase (same timestamp)',
    logs.indexOf(sell) === logs.indexOf(mixed) + 1,
    order,
  );

  // ---- Sessions --------------------------------------------------------------------
  const s1 = byType('session', 0);
  check(
    'session 1 fields',
    s1.gpGained === 96.4 && s1.downtimeGained === 10 && s1.levelGained === 1 &&
      s1.location === 'Games Haven @ Chinatown' && s1.dm === 'Ash | Paramnesiagirl',
    JSON.stringify({ gp: s1.gpGained, dt: s1.downtimeGained, lv: s1.levelGained, loc: s1.location, dm: s1.dm }),
  );
  const scroll1 = s1.itemsGained.find((i) => i.name.includes('Bonfire'));
  check(
    'session 1 scroll canonicalized',
    scroll1?.name === 'Spell Scroll of Create Bonfire' && scroll1?.category === 'consumable' && scroll1?.rarity === 'common',
    JSON.stringify(scroll1),
  );
  const whip = s1.itemsGained.find((i) => i.category === 'magic_item');
  check('whip kept as magic_item, uncommon', whip?.name === 'Whip of Warning' && whip?.rarity === 'uncommon', JSON.stringify(whip));

  const s2 = byType('session', 1);
  const s2names = s2.itemsGained.map((i) => `${i.name}|${i.category}|${i.rarity ?? ''}`);
  const expectedS2 = [
    'Eyes of Charming|magic_item|uncommon',
    'Spell Scroll of Animate Dead|consumable|uncommon',
    'Acid|equipment|',
    'Alchemist’s Fire|equipment|', // catalog's curly apostrophe
    'Potion of Climbing|consumable|common',
    'Potion of Healing|consumable|common',
  ];
  check(
    'session 2 items canonicalized',
    JSON.stringify(s2names) === JSON.stringify(expectedS2),
    JSON.stringify(s2names),
  );
  const eyes = s2.itemsGained.find((i) => i.name === 'Eyes of Charming');
  check('eyes attunement filled from item list', eyes?.requiresAttunement === true, JSON.stringify(eyes));

  // ---- Catchup ---------------------------------------------------------------------
  const catchup = byType('catchup');
  check('catchup', catchup.downtimeSpent === 10 && catchup.levelGained === 1 && catchup.gpGained === 0, JSON.stringify(catchup));

  // ---- Derived totals match the hand-fixed target ----------------------------------
  const sum = (key) => logs.reduce((s, l) => s + (l[key] || 0), 0);
  const targetSum = (key) => correct.logs.reduce((s, l) => s + (l[key] || 0), 0);
  for (const key of ['gpGained', 'gpLost', 'downtimeGained', 'downtimeSpent', 'levelGained']) {
    check(`totals match correct file: ${key}`, sum(key) === targetSum(key), `${sum(key)} vs ${targetSum(key)}`);
  }

  // ---- Warnings: no unmatched-loss warning expected --------------------------------
  check(
    'no unmatched-loss warnings',
    !warnings.some((w) => w.includes('no earlier log gained')),
    warnings.filter((w) => w.includes('no earlier log gained')).join(' / '),
  );
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);

  // ---- Gold/XP cross-check: the 2026-07-19 Gemini failure mode ----------------------
  // A session's gp_gained (preceded by three EMPTY columns) got filed as "XP gained"
  // notes lines, leaving gpGained 0. The cross-check must flag exactly that entry —
  // and stay quiet for a correct reply, including a purchase+sell split (same
  // timestamp) and a catchup (negative downtime).
  const miniCsv = [
    'name,race,class_and_levels,faction,background,lifestyle,portrait_url,publicly_visible',
    'Melfyn,Eladrin,Bard,,"",,,',
    'type,adventure_title,session_num,date_played,session_length_hours,player_level,xp_gained,gp_gained,downtime_gained,renown_gained,num_secret_missions,location_played,dm_name,dm_dci_number,notes,date_dmed,campaign_id',
    'MAGIC ITEM,name,rarity,location_found,table,table_result,notes',
    'CharacterLogEntry,Big Reward,,2024-10-11 19:30:00 UTC,,,,2116.98,10.0,,,Cafe,Kaith,@dm,"",,',
    'MAGIC ITEM,,common,,,,""',
    'PurchaseLogEntry,,,2024-10-12 10:00:00 UTC,,,,-5.0,,,,,,,* Shield - 10GP; * Sell back Longsword = 5GP,,',
    'MAGIC ITEM,,common,,,,""',
    'CharacterLogEntry,Catch Up,,2024-10-13 01:04:00 UTC,,,,,-30.0,,,"","","","",,',
  ].join('\n');

  const purchaseSellLogs = [
    {
      type: 'purchase', date: '2024-10-12', time: '10:00', title: 'Bought Shield',
      gpLost: 10,
      itemsGained: [{ name: 'Shield', category: 'equipment', quantity: 1, cost: 10 }],
    },
    {
      type: 'sell', date: '2024-10-12', time: '10:00', title: 'Sold Longsword',
      gpGained: 5,
      itemsLost: [{ name: 'Longsword', quantity: 1, reason: 'sold', salePrice: 5 }],
    },
  ];
  const catchupLog = {
    type: 'catchup', date: '2024-10-13', time: '01:04', title: 'Catch Up',
    downtimeSpent: 30, levelGained: 3,
  };

  const geminiStyle = parseAlChatbotReply(
    JSON.stringify({
      character: { name: 'Melfyn' },
      logs: [
        {
          type: 'session', date: '2024-10-11', time: '19:30', title: 'Big Reward',
          location: 'Cafe', dm: 'Kaith', downtimeGained: 10, levelGained: 1,
          notes: 'DM DCI: @dm\nXP gained: 2116.98',
        },
        ...purchaseSellLogs,
        catchupLog,
      ],
    }),
    miniCsv,
  );
  const gpWarnings = (w) => w.filter((x) => x.includes('net to'));
  check(
    'GP-as-XP reply flagged (exactly the session, with both amounts)',
    gpWarnings(geminiStyle.warnings).length === 1 &&
      gpWarnings(geminiStyle.warnings)[0].includes('2116.98') &&
      gpWarnings(geminiStyle.warnings)[0].includes('Big Reward'),
    gpWarnings(geminiStyle.warnings).join(' / ') || '(none)',
  );

  const correctReply = parseAlChatbotReply(
    JSON.stringify({
      character: { name: 'Melfyn' },
      logs: [
        {
          type: 'session', date: '2024-10-11', time: '19:30', title: 'Big Reward',
          location: 'Cafe', dm: 'Kaith', gpGained: 2116.98, downtimeGained: 10, levelGained: 1,
        },
        ...purchaseSellLogs,
        catchupLog,
      ],
    }),
    miniCsv,
  );
  check(
    'correct reply: no gold/downtime warnings (split + catchup tolerated)',
    gpWarnings(correctReply.warnings).length === 0,
    gpWarnings(correctReply.warnings).join(' / '),
  );

  // ---- Misc: prompt builds and embeds the CSV; fallback name from CSV --------------
  check('prompt embeds the CSV', buildAlChatbotPrompt(csv).includes('DDL4-02 The Beast'));
  const nameless = parseAlChatbotReply('{"character": {}, "logs": []}', csv);
  check('fallback name comes from the CSV', nameless.character.name === 'Ebilun', nameless.character.name);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await vite.close();
}
