// Unit types. Stats are per soldier; `men` is a full-strength unit.
// cls: inf | spear | pike | missile | cav | harcher | elephant
// look: how the battle renderer dresses the soldier (see battle/models.js)

const INF = { cls: 'inf', men: 80, hp: 10, atk: 8, def: 8, dmg: 7, armor: 4, shield: 0.35, charge: 8, walk: 1.6, run: 4.0, morale: 60, mass: 1, cost: 300, up: 35, bar: 1, rank: 0 };
const CAV = { cls: 'cav', men: 40, hp: 15, atk: 9, def: 7, dmg: 7, armor: 5, shield: 0.25, charge: 18, walk: 2.6, run: 8.5, morale: 65, mass: 4, cost: 480, up: 60, bar: 2, rank: 0 };
const MIS = { cls: 'missile', men: 60, hp: 8, atk: 5, def: 4, dmg: 5, armor: 1, shield: 0.0, charge: 2, walk: 1.7, run: 4.2, morale: 45, mass: 1, cost: 240, up: 30, bar: 1, rank: 0 };

function U(base, o) { return { ...base, ...o, look: { ...(o.look || {}) } }; }

export const UNITS = {
  // ---------------- Rome ----------------
  rom_hastati: U(INF, { name: 'Hastati', desc: 'Young legionaries. Hurl pila, then close with the gladius.', atk: 10, def: 9, armor: 5, shield: 0.5, morale: 66, pila: true, cost: 300, up: 35,
    look: { armor: 'bronze', helmet: 'montefortino', crest: 'black', shield: 'scutum', weapon: 'gladius' } }),
  rom_principes: U(INF, { name: 'Principes', desc: 'Seasoned men in mail, the backbone of the manipular legion.', hp: 12, atk: 12, def: 11, armor: 7, shield: 0.5, pila: true, morale: 75, cost: 420, up: 50, bar: 2,
    look: { armor: 'mail', helmet: 'montefortino', crest: 'red', shield: 'scutum', weapon: 'gladius' } }),
  rom_triarii: U(INF, { name: 'Triarii', desc: 'Veteran spearmen. "It has come to the triarii."', cls: 'spear', men: 60, hp: 12, atk: 10, def: 14, armor: 8, shield: 0.5, antiCav: 10, charge: 4, morale: 85, ability: 'phalanx', cost: 480, up: 55, bar: 2,
    look: { armor: 'mail', helmet: 'montefortino', crest: 'feathers', shield: 'round', weapon: 'spear' } }),
  rom_velites: U(MIS, { name: 'Velites', desc: 'Skirmishers who pepper the enemy with javelins.', range: 50, ammo: 8, mdmg: 9, missile: 'javelin', reload: 4.5, cost: 200, up: 22,
    look: { armor: 'none', helmet: 'wolf', shield: 'parma', weapon: 'javelin' } }),
  rom_equites: U(CAV, { name: 'Equites', desc: 'Roman citizen cavalry.', atk: 10, armor: 6, charge: 20, morale: 70, cost: 480,
    look: { armor: 'bronze', helmet: 'attic', crest: 'red', shield: 'round', weapon: 'lance' } }),
  rom_sagittarii: U(MIS, { name: 'Sagittarii', desc: 'Auxiliary archers from the eastern provinces.', range: 150, ammo: 20, mdmg: 6, missile: 'arrow', reload: 5.5, cost: 320, up: 35, bar: 2, rank: 1,
    look: { armor: 'linen', helmet: 'conical', weapon: 'bow' } }),
  rom_equites_leg: U(CAV, { name: 'Equites Legionis', desc: 'Heavy legionary cavalry in mail.', cls: 'cav', hp: 17, atk: 12, def: 10, armor: 8, charge: 22, morale: 80, cost: 700, up: 80, bar: 3, rank: 1,
    look: { armor: 'mail', helmet: 'imperial', crest: 'red', shield: 'oval', weapon: 'lance' } }),
  rom_legionaries: U(INF, { name: 'Legionaries', desc: 'Professional soldiers of the reformed legion. Can form Testudo.', hp: 12, atk: 13, def: 12, dmg: 8, armor: 9, shield: 0.55, charge: 10, morale: 80, pila: true, ability: 'testudo', cost: 600, up: 65, bar: 3, rank: 2,
    look: { armor: 'segmentata', helmet: 'imperial', crest: 'none', shield: 'scutum', weapon: 'gladius' } }),
  rom_praetorians: U(INF, { name: 'Praetorian Cohort', desc: 'The finest soldiers in the world.', hp: 13, atk: 15, def: 14, dmg: 9, armor: 11, shield: 0.6, charge: 12, morale: 95, pila: true, ability: 'testudo', cost: 900, up: 95, bar: 4, rank: 3,
    look: { armor: 'segmentata', helmet: 'imperial', crest: 'red', shield: 'scutum', weapon: 'gladius', cape: true } }),
  rom_general: U(CAV, { name: "General's Guard", desc: 'The general and his bodyguard.', men: 24, hp: 20, atk: 13, def: 12, dmg: 8, armor: 10, charge: 22, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'bronze', helmet: 'attic', crest: 'red', shield: 'round', weapon: 'lance', cape: true } }),

  // ---------------- Carthage ----------------
  pun_libyan: U(INF, { name: 'Libyan Spearmen', desc: 'Disciplined African spearmen in a shield wall.', cls: 'spear', atk: 8, def: 11, armor: 6, shield: 0.5, antiCav: 8, ability: 'phalanx', morale: 60, cost: 320,
    look: { armor: 'linen', helmet: 'pilos', shield: 'round', weapon: 'spear' } }),
  pun_merc: U(INF, { name: 'Celtiberian Mercenaries', desc: 'Hired swords from Hispania.', atk: 11, def: 7, dmg: 8, armor: 4, charge: 12, morale: 60, cost: 360,
    look: { armor: 'leather', helmet: 'montefortino', crest: 'red', shield: 'oval', weapon: 'sword' } }),
  pun_slinger: U(MIS, { name: 'Balearic Slingers', desc: 'Island slingers whose stones crack helmets.', range: 120, ammo: 20, mdmg: 6, missile: 'stone', reload: 4.5, cost: 270,
    look: { armor: 'none', helmet: 'none', weapon: 'sling' } }),
  pun_numcav: U(CAV, { name: 'Numidian Cavalry', desc: 'Swift javelin riders.', hp: 11, atk: 6, def: 5, armor: 2, charge: 8, run: 9.5, range: 42, ammo: 6, mdmg: 7, missile: 'javelin', reload: 4, morale: 50, cost: 380, bar: 1,
    look: { armor: 'none', helmet: 'none', shield: 'parma', weapon: 'javelin', horse: 'light' } }),
  pun_cav: U(CAV, { name: 'Punic Cavalry', desc: 'Noble Carthaginian horsemen.', hp: 15, atk: 10, armor: 7, charge: 18, morale: 70, cost: 520,
    look: { armor: 'bronze', helmet: 'attic', crest: 'white', shield: 'round', weapon: 'lance' } }),
  pun_elephant: U(CAV, { name: 'War Elephants', desc: 'Terrifying beasts that trample whole lines.', cls: 'elephant', men: 8, hp: 150, atk: 12, def: 6, dmg: 20, armor: 6, charge: 40, walk: 1.9, run: 4.6, morale: 70, mass: 14, cost: 1100, up: 120, bar: 3,
    look: { body: 'elephant' } }),
  pun_sacred: U(INF, { name: 'Sacred Band', desc: 'Elite citizen hoplites sworn to the gods of Carthage.', cls: 'spear', men: 60, hp: 13, atk: 13, def: 15, armor: 11, shield: 0.55, antiCav: 10, morale: 95, ability: 'phalanx', cost: 850, up: 90, bar: 3,
    look: { armor: 'bronze', helmet: 'corinthian', crest: 'white', shield: 'round', weapon: 'spear', cape: true } }),
  pun_general: U(CAV, { name: "General's Guard", desc: 'The general and his bodyguard.', men: 24, hp: 20, atk: 13, def: 12, armor: 10, charge: 22, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'bronze', helmet: 'corinthian', crest: 'white', shield: 'round', weapon: 'lance', cape: true } }),

  // ---------------- Barbarians (Gaul, Britons, Germans, Iberians, Dacians) ----------------
  bar_warband: U(INF, { name: 'Warband', desc: 'Fearless tribesmen who charge in a howling mass.', atk: 10, def: 5, dmg: 7, armor: 2, shield: 0.35, charge: 14, walk: 1.8, run: 4.5, morale: 50, cost: 240, up: 26,
    look: { armor: 'none', helmet: 'none', shield: 'oval', weapon: 'sword', hair: true } }),
  bar_spear: U(INF, { name: 'Spear Warriors', desc: 'Tribal spearmen who hold the line against horse.', cls: 'spear', atk: 7, def: 8, armor: 2, shield: 0.35, antiCav: 8, morale: 50, cost: 230, up: 26,
    look: { armor: 'none', helmet: 'none', shield: 'oval', weapon: 'spear', hair: true } }),
  bar_skirm: U(MIS, { name: 'Skirmishers', desc: 'Javelin throwers.', range: 42, ammo: 8, mdmg: 7, missile: 'javelin', reload: 4.5, cost: 170, up: 20,
    look: { armor: 'none', helmet: 'none', shield: 'parma', weapon: 'javelin', hair: true } }),
  bar_archer: U(MIS, { name: 'Hunters', desc: 'Woodland archers.', range: 130, ammo: 18, mdmg: 6, missile: 'arrow', reload: 5.5, cost: 240, up: 26,
    look: { armor: 'none', helmet: 'none', weapon: 'bow', hair: true } }),
  bar_cav: U(CAV, { name: 'Noble Horse', desc: 'Chieftains and their kin on horseback.', hp: 14, atk: 10, def: 6, armor: 5, charge: 18, morale: 65, cost: 460,
    look: { armor: 'mail', helmet: 'celtic', shield: 'oval', weapon: 'lance', hair: true } }),
  bar_chosen: U(INF, { name: 'Chosen Swordsmen', desc: 'Champions in mail with long swords.', men: 70, hp: 12, atk: 14, def: 9, dmg: 9, armor: 7, shield: 0.4, charge: 16, morale: 80, cost: 620, up: 70, bar: 3,
    look: { armor: 'mail', helmet: 'celtic', shield: 'oval', weapon: 'sword', hair: true } }),
  dac_falx: U(INF, { name: 'Falxmen', desc: 'Two-handed sickle-swords that split shields.', atk: 13, def: 4, dmg: 12, armor: 3, shield: 0, charge: 14, morale: 65, cost: 460, up: 50, bar: 2,
    look: { armor: 'none', helmet: 'phrygian', weapon: 'falx', hair: true } }),
  ibr_scutarii: U(INF, { name: 'Scutarii', desc: 'Hardy Iberian swordsmen with great shields.', atk: 11, def: 10, dmg: 8, armor: 5, shield: 0.5, charge: 10, morale: 65, pila: true, cost: 380, up: 42, bar: 2,
    look: { armor: 'leather', helmet: 'montefortino', crest: 'black', shield: 'oval', weapon: 'sword' } }),
  bar_general: U(CAV, { name: "Chieftain's Guard", desc: 'The warlord and his sworn men.', men: 24, hp: 19, atk: 13, def: 10, armor: 8, charge: 22, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'mail', helmet: 'celtic', shield: 'oval', weapon: 'lance', hair: true, cape: true } }),

  // ---------------- Hellenic (Macedon, Greeks, Seleucids, Ptolemies) ----------------
  hel_hoplite: U(INF, { name: 'Hoplites', desc: 'Citizen spearmen behind bronze shields.', cls: 'spear', hp: 11, atk: 8, def: 12, dmg: 6, armor: 7, shield: 0.55, antiCav: 8, morale: 65, ability: 'phalanx', cost: 330, up: 36,
    look: { armor: 'bronze', helmet: 'corinthian', crest: 'black', shield: 'round', weapon: 'spear' } }),
  hel_phalangite: U(INF, { name: 'Phalangites', desc: 'A hedge of sarissas. Unstoppable from the front, helpless in the flank.', cls: 'pike', men: 96, atk: 7, def: 13, dmg: 6, armor: 5, shield: 0.3, antiCav: 14, morale: 65, ability: 'phalanx', walk: 1.4, cost: 420, up: 44, bar: 2,
    look: { armor: 'linen', helmet: 'thracian', crest: 'white', shield: 'small', weapon: 'pike' } }),
  hel_peltast: U(MIS, { name: 'Peltasts', desc: 'Thracian-style javelinmen.', hp: 9, atk: 6, def: 5, range: 45, ammo: 8, mdmg: 8, missile: 'javelin', reload: 4.5, cost: 220, up: 24,
    look: { armor: 'none', helmet: 'thracian', shield: 'pelte', weapon: 'javelin' } }),
  hel_archer: U(MIS, { name: 'Cretan Archers', desc: 'The finest bowmen for hire.', range: 160, ammo: 20, mdmg: 7, missile: 'arrow', reload: 5, cost: 380, up: 40, bar: 2,
    look: { armor: 'linen', helmet: 'none', weapon: 'bow' } }),
  hel_cav: U(CAV, { name: 'Tarantine Cavalry', desc: 'Light javelin horsemen.', hp: 12, atk: 7, def: 6, armor: 3, charge: 10, run: 9.2, range: 42, ammo: 6, mdmg: 7, missile: 'javelin', reload: 4, cost: 400, bar: 1,
    look: { armor: 'linen', helmet: 'boeotian', shield: 'round', weapon: 'javelin', horse: 'light' } }),
  hel_companion: U(CAV, { name: 'Companion Cavalry', desc: 'The hammer of Alexander.', hp: 17, atk: 13, def: 9, armor: 9, charge: 24, morale: 85, cost: 780, up: 85, bar: 3,
    look: { armor: 'bronze', helmet: 'boeotian', crest: 'white', weapon: 'lance', cape: true } }),
  sel_cataphract: U(CAV, { name: 'Cataphracts', desc: 'Horse and rider sheathed in scale.', hp: 22, atk: 12, def: 11, armor: 14, charge: 24, run: 7, morale: 85, cost: 950, up: 100, bar: 3,
    look: { armor: 'scale', helmet: 'conical', weapon: 'lance', horse: 'armored' } }),
  sel_elephant: U(CAV, { name: 'War Elephants', desc: 'Indian elephants with tower and crew.', cls: 'elephant', men: 8, hp: 160, atk: 12, def: 6, dmg: 20, armor: 7, charge: 40, walk: 1.9, run: 4.6, morale: 70, mass: 14, cost: 1150, up: 120, bar: 3,
    look: { body: 'elephant' } }),
  hel_general: U(CAV, { name: "Strategos' Guard", desc: 'The general and his Companions.', men: 24, hp: 20, atk: 13, def: 12, armor: 10, charge: 24, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'bronze', helmet: 'boeotian', crest: 'white', weapon: 'lance', cape: true } }),

  // ---------------- East & Steppe (Parthia, Scythia) ----------------
  eas_spear: U(INF, { name: 'Levy Spearmen', desc: 'Peasant spearmen.', cls: 'spear', atk: 6, def: 8, armor: 3, shield: 0.4, antiCav: 7, morale: 45, cost: 190, up: 20,
    look: { armor: 'linen', helmet: 'phrygian', shield: 'round', weapon: 'spear' } }),
  eas_archer: U(MIS, { name: 'Foot Archers', desc: 'Eastern bowmen.', range: 140, ammo: 20, mdmg: 6, missile: 'arrow', reload: 5.5, cost: 230, up: 24,
    look: { armor: 'linen', helmet: 'phrygian', weapon: 'bow' } }),
  eas_horsearcher: U(CAV, { name: 'Horse Archers', desc: 'Shoot, wheel away, shoot again.', cls: 'harcher', hp: 12, atk: 5, def: 5, armor: 2, charge: 6, run: 9.5, range: 125, ammo: 18, mdmg: 6, missile: 'arrow', reload: 4.5, morale: 55, cost: 450, up: 50, bar: 1,
    look: { armor: 'leather', helmet: 'conical', weapon: 'bow', horse: 'light' } }),
  eas_cav: U(CAV, { name: 'Steppe Lancers', desc: 'Nobles with long kontos lances.', hp: 16, atk: 11, def: 7, armor: 7, charge: 20, morale: 70, cost: 560, bar: 2,
    look: { armor: 'scale', helmet: 'conical', weapon: 'lance' } }),
  eas_general: U(CAV, { name: "Satrap's Guard", desc: 'The general and his armoured nobles.', men: 24, hp: 22, atk: 13, def: 12, armor: 12, charge: 22, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'scale', helmet: 'conical', weapon: 'lance', horse: 'armored', cape: true } }),

  // ---------------- Africa ----------------
  afr_spear: U(INF, { name: 'Desert Spearmen', desc: 'Tribal spearmen of the Maghreb.', cls: 'spear', atk: 7, def: 8, armor: 2, shield: 0.4, antiCav: 7, morale: 50, cost: 210, up: 22,
    look: { armor: 'none', helmet: 'none', shield: 'round', weapon: 'spear', skin: 'dark' } }),
  afr_skirm: U(MIS, { name: 'Javelinmen', desc: 'Swift javelin throwers.', range: 42, ammo: 8, mdmg: 7, missile: 'javelin', reload: 4.5, cost: 170, up: 20,
    look: { armor: 'none', helmet: 'none', shield: 'parma', weapon: 'javelin', skin: 'dark' } }),
  afr_numcav: U(CAV, { name: 'Numidian Riders', desc: 'Peerless light horsemen.', hp: 11, atk: 6, def: 5, armor: 2, charge: 8, run: 9.8, range: 42, ammo: 6, mdmg: 7, missile: 'javelin', reload: 4, morale: 55, cost: 360, bar: 1,
    look: { armor: 'none', helmet: 'none', shield: 'parma', weapon: 'javelin', horse: 'light', skin: 'dark' } }),
  afr_general: U(CAV, { name: "King's Riders", desc: 'The king and his household.', men: 24, hp: 18, atk: 12, def: 10, armor: 7, charge: 20, morale: 100, general: true, cost: 0, up: 0,
    look: { armor: 'bronze', helmet: 'attic', shield: 'round', weapon: 'lance', cape: true, skin: 'dark' } }),

  // ---------------- Garrison militia ----------------
  militia: U(INF, { name: 'Town Militia', desc: 'Citizens with whatever they could grab.', cls: 'spear', men: 70, hp: 9, atk: 6, def: 7, dmg: 5, armor: 3, shield: 0.35, antiCav: 5, morale: 45, cost: 130, up: 12, bar: 0,
    look: { armor: 'none', helmet: 'pilos', shield: 'round', weapon: 'spear' } }),
};

for (const [id, u] of Object.entries(UNITS)) {
  u.id = id;
  // missile balance: slower reloads and fewer volleys for bows and slings
  if (u.missile === 'arrow' || u.missile === 'stone') { u.reload *= 1.35; u.ammo = Math.min(u.ammo, 15); }
}

export const ROSTERS = {
  roman: ['rom_hastati', 'rom_principes', 'rom_triarii', 'rom_velites', 'rom_equites', 'rom_sagittarii', 'rom_equites_leg', 'rom_legionaries', 'rom_praetorians'],
  punic: ['pun_libyan', 'pun_merc', 'pun_slinger', 'pun_numcav', 'pun_cav', 'pun_elephant', 'pun_sacred'],
  gallic: ['bar_warband', 'bar_spear', 'bar_skirm', 'bar_archer', 'bar_cav', 'bar_chosen'],
  briton: ['bar_warband', 'bar_spear', 'bar_skirm', 'bar_archer', 'bar_cav', 'bar_chosen'],
  german: ['bar_warband', 'bar_spear', 'bar_skirm', 'bar_archer', 'bar_cav', 'bar_chosen'],
  iberian: ['bar_warband', 'ibr_scutarii', 'bar_skirm', 'pun_slinger', 'bar_cav', 'bar_chosen'],
  dacian: ['bar_warband', 'dac_falx', 'bar_skirm', 'bar_archer', 'bar_cav', 'bar_chosen'],
  hellenic: ['hel_hoplite', 'hel_phalangite', 'hel_peltast', 'hel_archer', 'hel_cav', 'hel_companion'],
  seleucid: ['hel_phalangite', 'hel_hoplite', 'hel_peltast', 'eas_archer', 'hel_cav', 'sel_cataphract', 'sel_elephant', 'hel_companion'],
  ptolemaic: ['hel_phalangite', 'hel_hoplite', 'hel_peltast', 'hel_archer', 'hel_cav', 'sel_elephant', 'hel_companion'],
  eastern: ['eas_spear', 'eas_archer', 'eas_horsearcher', 'eas_cav', 'sel_cataphract'],
  steppe: ['eas_spear', 'eas_archer', 'eas_horsearcher', 'eas_cav', 'sel_cataphract'],
  african: ['afr_spear', 'afr_skirm', 'afr_numcav', 'pun_slinger'],
  local: ['militia', 'hel_hoplite', 'bar_warband', 'bar_skirm', 'eas_archer', 'hel_cav'],
};

export const GENERAL_UNIT = {
  roman: 'rom_general', punic: 'pun_general', gallic: 'bar_general', briton: 'bar_general', german: 'bar_general', iberian: 'bar_general', dacian: 'bar_general',
  hellenic: 'hel_general', seleucid: 'hel_general', ptolemaic: 'hel_general', eastern: 'eas_general', steppe: 'eas_general', african: 'afr_general', local: 'hel_general',
};

// Garrison composition by local culture (cheap defenders for every settlement)
export const GARRISON = {
  roman: ['militia', 'rom_hastati', 'rom_velites'],
  punic: ['militia', 'pun_libyan', 'pun_slinger'],
  gallic: ['bar_spear', 'bar_warband', 'bar_skirm'],
  briton: ['bar_spear', 'bar_warband', 'bar_skirm'],
  german: ['bar_spear', 'bar_warband', 'bar_archer'],
  iberian: ['bar_spear', 'ibr_scutarii', 'pun_slinger'],
  dacian: ['bar_spear', 'bar_warband', 'bar_archer'],
  hellenic: ['militia', 'hel_hoplite', 'hel_peltast'],
  seleucid: ['militia', 'hel_hoplite', 'eas_archer'],
  ptolemaic: ['militia', 'hel_hoplite', 'hel_archer'],
  eastern: ['eas_spear', 'eas_archer', 'eas_spear'],
  steppe: ['eas_spear', 'eas_horsearcher', 'eas_archer'],
  african: ['afr_spear', 'afr_skirm', 'afr_spear'],
  local: ['militia', 'militia', 'bar_skirm'],
};

// Rough fighting value of a unit for auto-resolve and AI planning
export function unitPower(u, n = u.men) {
  const melee = u.atk * 1.0 + u.def * 0.8 + u.dmg * 0.6 + u.armor * 0.7 + u.charge * 0.25 + (u.antiCav || 0) * 0.2;
  const ranged = u.range ? (u.mdmg * Math.min(u.ammo, 20) * 0.12 + u.range * 0.02) : 0;
  const per = (melee + ranged) * (u.hp / 10) * (0.6 + u.morale / 150);
  return per * n * (u.cls === 'cav' || u.cls === 'harcher' ? 1.15 : 1);
}
