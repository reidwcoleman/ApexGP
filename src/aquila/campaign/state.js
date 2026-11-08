// Campaign rules: economy, buildings, recruitment, movement, wars and battles.
// DOM-free so it can be reasoned about (and simulated) on its own.
import { FACTIONS, FACTION_IDS, RANKS, rankFor, generalName } from '../data/factions.js';
import { UNITS, ROSTERS, GENERAL_UNIT, GARRISON, unitPower } from '../data/units.js';

import { BUILDINGS, BLD_KEYS, DIFF, migrateProv, cityIncome, cityOrder, popCap, growthRate, tierOf, TIERS, goodsOf, resourceOf, RESOURCES,
  canBuild as cityCanBuild, build as cityBuild, tickConstruction } from './city.js';
export { BUILDINGS, BLD_KEYS };
export const MAX_UNITS = 12;
export const VICTORY_PROVINCES = 100;

export const warKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export function atWar(s, a, b) {
  if (a === b) return false;
  if (a === 'free' || b === 'free') return true;
  return !!s.wars[warKey(a, b)];
}

export function yearLabel(s) {
  const y = s.year;
  return y < 0 ? `${-y} BC` : `AD ${y + 1}`;
}

export function cultureOf(fac) { return FACTIONS[fac].culture; }

export function newGame(world, difficulty = 'normal', seed = Date.now() % 1e9) {
  const s = {
    v: 1, seed, turn: 1, year: -272, difficulty, player: 'rome',
    wars: {}, truce: {}, trade: {},
    factions: {}, provs: [], armies: [], nextArmy: 1,
    mission: null, log: [], offers: [], dipTried: {}, news: [], stats: { won: 0, lost: 0, taken: 0, killed: 0, lostMen: 0 },
    rank: 0, over: null,
  };
  for (const id of FACTION_IDS) {
    s.factions[id] = { gold: id === 'rome' ? 1500 : 1200, alive: true, capital: -1, peaceOffers: 0 };
  }
  world.provinces.forEach((p, i) => {
    const pr = {
      owner: p.owner, pop: p.pop,
      bld: { farm: p.pop > 15000 ? 1 : 0, market: p.pop > 20000 ? 1 : 0, barracks: p.pop > 9000 ? 1 : 0, walls: p.pop >= 14000 ? 1 : 0, temple: p.pop > 25000 ? 1 : 0 },
      queue: [], garrison: [], order: 70, unrest: 0, tax: 1, games: 0,
    };
    migrateProv(pr);
    s.provs.push(pr);
    if (FACTIONS[p.owner].capital === p.name) { s.factions[p.owner].capital = i; pr.bld.barracks = 2; pr.bld.walls = Math.max(1, pr.bld.walls); }
  });
  const R = world.provinces.find((p) => p.name === 'Roma').id;
  Object.assign(s.provs[R].bld, { farm: 1, market: 1, barracks: 1, walls: 1, temple: 1 });
  // starting wars of 272 BC
  for (const [a, b] of [['carthage', 'greeks'], ['seleucid', 'egypt'], ['macedon', 'greeks'], ['parthia', 'seleucid'], ['germans', 'gaul'], ['dacia', 'macedon'], ['numidia', 'carthage']]) s.wars[warKey(a, b)] = true;
  // garrisons everywhere
  s.provs.forEach((pr, i) => fillGarrison(s, world, i, true));
  // starting field armies
  const army = (owner, provName, types) => {
    const p = world.provinces.find((q) => q.name === provName);
    return createArmy(s, owner, p.id, types.map((t) => ({ t, n: UNITS[t].men, xp: 0 })));
  };
  army('rome', 'Roma', ['rom_hastati', 'rom_hastati', 'rom_principes', 'rom_triarii', 'rom_velites', 'rom_velites', 'rom_equites']);
  army('rome', 'Capua', ['rom_hastati', 'rom_principes', 'rom_velites']);
  army('carthage', 'Carthago', ['pun_libyan', 'pun_libyan', 'pun_merc', 'pun_slinger', 'pun_numcav', 'pun_elephant']);
  army('carthage', 'Lilybaeum', ['pun_libyan', 'pun_merc', 'pun_slinger']);
  army('carthage', 'Carthago Nova', ['pun_libyan', 'pun_merc', 'pun_numcav']);
  army('gaul', 'Gergovia', ['bar_warband', 'bar_warband', 'bar_spear', 'bar_skirm', 'bar_cav']);
  army('gaul', 'Mediolanum', ['bar_warband', 'bar_warband', 'bar_spear', 'bar_archer']);
  army('britons', 'Eboracum', ['bar_warband', 'bar_warband', 'bar_skirm']);
  army('germans', 'Semnonia', ['bar_warband', 'bar_warband', 'bar_spear', 'bar_archer']);
  army('germans', 'Colonia', ['bar_warband', 'bar_spear', 'bar_archer']);
  army('iberia', 'Numantia', ['bar_warband', 'ibr_scutarii', 'bar_skirm', 'bar_cav']);
  army('macedon', 'Pella', ['hel_phalangite', 'hel_phalangite', 'hel_hoplite', 'hel_peltast', 'hel_companion']);
  army('greeks', 'Athenae', ['hel_hoplite', 'hel_hoplite', 'hel_peltast', 'hel_archer']);
  army('greeks', 'Syracusae', ['hel_hoplite', 'hel_hoplite', 'hel_peltast', 'hel_cav']);
  army('greeks', 'Tarentum', ['hel_hoplite', 'hel_peltast', 'hel_cav']);
  army('seleucid', 'Antiochia', ['hel_phalangite', 'hel_phalangite', 'hel_hoplite', 'eas_archer', 'sel_cataphract', 'sel_elephant']);
  army('seleucid', 'Seleucia', ['hel_phalangite', 'eas_archer', 'hel_cav']);
  army('egypt', 'Alexandria', ['hel_phalangite', 'hel_phalangite', 'hel_archer', 'hel_peltast', 'hel_cav', 'sel_elephant']);
  army('egypt', 'Damascus', ['hel_hoplite', 'hel_phalangite', 'hel_archer']);
  army('parthia', 'Hecatompylos', ['eas_horsearcher', 'eas_horsearcher', 'eas_spear', 'eas_cav']);
  army('dacia', 'Sarmizegetusa', ['bar_warband', 'dac_falx', 'bar_archer', 'bar_cav']);
  army('numidia', 'Cirta', ['afr_spear', 'afr_skirm', 'afr_numcav', 'afr_numcav']);
  army('scythia', 'Gerrhus', ['eas_horsearcher', 'eas_horsearcher', 'eas_spear', 'eas_cav']);
  newMission(s, world);
  log(s, 'The Senate and People of Rome look beyond Latium. Conquer the known world.', 'gold');
  return s;
}

export function log(s, text, kind = 'minor') { s.log.push({ t: s.turn, text, kind }); if (s.log.length > 80) s.log.shift(); }

export function createArmy(s, owner, prov, units) {
  const cul = cultureOf(owner);
  const gen = { t: GENERAL_UNIT[cul], n: UNITS[GENERAL_UNIT[cul]].men, xp: 0 };
  const a = { id: s.nextArmy++, owner, prov, units: [gen, ...units], gen: { name: generalName(cul), stars: 0, xp: 0 }, mp: 2, from: prov };
  s.armies.push(a);
  return a;
}

export const armiesIn = (s, prov) => s.armies.filter((a) => a.prov === prov);
export const provsOf = (s, f) => s.provs.reduce((n, p) => n + (p.owner === f ? 1 : 0), 0);

export function unitsPower(units) { return units.reduce((t, u) => t + unitPower(UNITS[u.t], u.n) * (1 + (u.xp || 0) * 0.08 + (u.up || 0) * 0.06), 0); }
export function armyPower(a) { return unitsPower(a.units); }

export function defencePower(s, prov) {
  const pr = s.provs[prov];
  let p = unitsPower(pr.garrison) * (1 + pr.bld.walls * 0.18);
  for (const a of armiesIn(s, prov)) if (a.owner === pr.owner) p += armyPower(a);
  return p;
}

export function factionPower(s, f) {
  let p = 0;
  for (const a of s.armies) if (a.owner === f) p += armyPower(a);
  s.provs.forEach((pr) => { if (pr.owner === f) p += unitsPower(pr.garrison) * 0.5; });
  return p;
}

export function garrisonTarget(s, i) {
  const pr = s.provs[i];
  return Math.min(8, 2 + Math.floor(pr.pop / 12000) + pr.bld.walls + (pr.owner === 'free' ? 1 : 0));
}

export function fillGarrison(s, world, i, full = false) {
  const pr = s.provs[i];
  const cul = FACTIONS[pr.owner].major ? cultureOf(pr.owner) : world.provinces[i].culture;
  const list = GARRISON[cul] || GARRISON.local;
  const target = garrisonTarget(s, i);
  for (const g of pr.garrison) g.n = Math.min(UNITS[g.t].men, Math.ceil(g.n + UNITS[g.t].men * (full ? 1 : 0.25)));
  let add = full ? target - pr.garrison.length : Math.min(1, target - pr.garrison.length);
  while (add-- > 0) { const t = list[pr.garrison.length % list.length]; pr.garrison.push({ t, n: full ? UNITS[t].men : Math.ceil(UNITS[t].men * 0.5), xp: 0 }); }
}

// ------------------------------------------------------------- economy
export function goodsBonus(s, world, f) { return goodsOf(s, world, f).size * 0.03; }
export function provinceIncome(s, world, i, gb = null) {
  return cityIncome(s, world, i, gb ?? goodsBonus(s, world, s.provs[i].owner)).total;
}

export function upkeep(s, f) {
  let u = 0;
  for (const a of s.armies) if (a.owner === f) for (const x of a.units) u += UNITS[x.t].up * (x.n / UNITS[x.t].men);
  return Math.round(u);
}

export function tradeIncome(s, f) {
  let t = 0;
  for (const k in s.trade) if (s.trade[k] && k.split('|').includes(f)) t += 90;
  return t;
}

export function factionIncome(s, world, f) {
  let inc = 0;
  const gb = goodsBonus(s, world, f);
  s.provs.forEach((pr, i) => { if (pr.owner === f) inc += provinceIncome(s, world, i, gb); });
  return inc + tradeIncome(s, f) - upkeep(s, f);
}

export function orderTarget(s, world, i) {
  const pr = s.provs[i];
  return cityOrder(s, world, i, provsOf(s, pr.owner), armiesIn(s, i).some((a) => a.owner === pr.owner)).total;
}

// ------------------------------------------------------------- recruitment
export function rosterFor(s, f) { return ROSTERS[cultureOf(f)] || ROSTERS.local; }

export function canRecruit(s, world, prov, t) {
  const pr = s.provs[prov];
  const u = UNITS[t];
  if (u.general) return { ok: false, why: 'General' };
  if (pr.owner === s.player && u.rank > s.rank) return { ok: false, why: `Requires rank: ${RANKS[u.rank].title}` };
  if (pr.bld.barracks < u.bar) return { ok: false, why: `Requires Barracks ${u.bar}` };
  if (s.factions[pr.owner].gold < unitCost(s, world, prov, t)) return { ok: false, why: 'Not enough denarii' };
  const here = armiesIn(s, prov).filter((a) => a.owner === pr.owner);
  if (here.length && here.every((a) => a.units.length >= MAX_UNITS + 1) && here.length >= 3) return { ok: false, why: 'Armies here are full' };
  return { ok: true };
}

export function unitCost(s, world, prov, t) {
  const pr = s.provs[prov], u = UNITS[t];
  let c = u.cost;
  if (['cav', 'harcher'].includes(u.cls)) c *= (1 - 0.1 * pr.bld.stables) * (resourceOf(world.provinces[prov]) === 'horses' ? 0.85 : 1);
  return Math.round(c);
}

export function recruit(s, world, prov, t) {
  const pr = s.provs[prov];
  const f = s.factions[pr.owner];
  const u = UNITS[t];
  f.gold -= unitCost(s, world, prov, t);
  const cav = ['cav', 'harcher'].includes(u.cls);
  const xp = Math.min(3, (pr.bld.temple >= 2 ? 1 : 0) + (cav ? pr.bld.stables : 0));
  const unit = { t, n: Math.round(u.men * (pr.owner === s.player ? 1 : 0.9)), xp, up: pr.bld.smithy };
  let a = armiesIn(s, prov).find((x) => x.owner === pr.owner && x.units.length < MAX_UNITS + 1);
  if (!a) { a = createArmy(s, pr.owner, prov, [unit]); a.mp = 0; if (pr.bld.academy) { a.gen.stars = pr.bld.academy; a.gen.xp = pr.bld.academy * 3; } }
  else a.units.push(unit);
  return a;
}

export function canBuild(s, world, prov, b) { return cityCanBuild(s, world, prov, b, (r) => RANKS[r].title); }
export function build(s, world, prov, b) { cityBuild(s, world, prov, b); }

export function migrate(s) {
  for (const pr of s.provs) migrateProv(pr);
  s.news = s.news || [];
  s.v = 2;
  return s;
}

// ------------------------------------------------------------- movement
export function linksOf(world, prov) {
  const p = world.provinces[prov];
  return [...p.neighbors.map((id) => ({ id, sea: false })), ...p.sea.map((id) => ({ id, sea: true }))];
}

export function armyMaxMp(a) {
  const allCav = a.units.every((u) => ['cav', 'harcher'].includes(UNITS[u.t].cls));
  return allCav ? 3 : 2;
}

// Dijkstra over provinces: own/allied land is passable, enemy land is a final step (attack)
export function reachable(s, world, a) {
  const res = new Map();
  const start = { id: a.prov, cost: 0, path: [a.prov] };
  const q = [start];
  const best = new Map([[a.prov, 0]]);
  while (q.length) {
    q.sort((x, y) => x.cost - y.cost);
    const cur = q.shift();
    for (const l of linksOf(world, cur.id)) {
      const port = s.provs[cur.id].owner === a.owner && s.provs[cur.id].bld.port > 0;
      const step = l.sea ? (port ? 1 : 2) : 1;
      const cost = cur.cost + step;
      if (cost > a.mp) continue;
      if (l.sea && cur.cost > 0 && !port) continue; // without a port a sea crossing must start the turn
      const owner = s.provs[l.id].owner;
      const path = [...cur.path, l.id];
      if (owner === a.owner) {
        if (!best.has(l.id) || best.get(l.id) > cost) { best.set(l.id, cost); res.set(l.id, { kind: 'move', cost, path }); q.push({ id: l.id, cost, path }); }
      } else {
        const prev = res.get(l.id);
        if (!prev || prev.cost > cost) res.set(l.id, { kind: atWar(s, a.owner, owner) ? 'attack' : 'war', cost, path });
      }
    }
  }
  return res;
}

export function moveArmy(s, a, path, cost) {
  a.from = path[path.length - 2] ?? a.prov;
  a.prov = path[path.length - 1];
  a.mp = Math.max(0, a.mp - cost);
}

export function declareWar(s, a, b) {
  if (a === 'free' || b === 'free') return;
  s.wars[warKey(a, b)] = true;
  delete s.trade[warKey(a, b)];
  s.truce[warKey(a, b)] = 0;
  log(s, `${FACTIONS[a].name} declares war on ${FACTIONS[b].name}!`, a === s.player || b === s.player ? 'war' : 'minor');
}

export function makePeace(s, a, b) {
  delete s.wars[warKey(a, b)];
  s.truce[warKey(a, b)] = s.turn + 8;
  log(s, `${FACTIONS[a].name} and ${FACTIONS[b].name} make peace.`, a === s.player || b === s.player ? 'gold' : 'minor');
}

// ------------------------------------------------------------- battles
// Collect the sides for an attack on `prov` by army `att`
export function battleSides(s, world, att, prov) {
  const pr = s.provs[prov];
  const defArmies = armiesIn(s, prov).filter((x) => x.owner === pr.owner);
  return { attacker: att, defender: { owner: pr.owner, armies: defArmies, garrison: pr.garrison, walls: pr.bld.walls }, prov };
}

export function autoResolve(s, sides, rng = Math.random) {
  const att = sides.attacker.units;
  const defUnits = [...sides.defender.armies.flatMap((a) => a.units), ...sides.defender.garrison];
  const genA = 1 + sides.attacker.gen.stars * 0.05;
  const genD = 1 + Math.max(0, ...sides.defender.armies.map((a) => a.gen.stars)) * 0.05;
  let A = unitsPower(att) * genA * (0.85 + rng() * 0.3);
  let D = unitsPower(defUnits) * genD * (1 + sides.defender.walls * 0.15) * (0.85 + rng() * 0.3);
  if (sides.attacker.owner !== s.player && FACTIONS[sides.attacker.owner].major) A *= s.difficulty === 'hard' ? 1.1 : 1;
  const r = A / (A + D || 1);
  const attWins = r > 0.5;
  const w = attWins ? r : 1 - r; // winner share 0.5..1
  const winLoss = Math.max(0.04, (1 - w) * 0.85);
  const loseLoss = Math.min(1, 0.45 + w * 0.5);
  const cas = (units, frac) => units.map((u) => Math.round(u.n * Math.max(0, Math.min(1, frac * (0.7 + rng() * 0.6)))));
  const attCas = cas(att, attWins ? winLoss : loseLoss);
  const defCas = cas(defUnits, attWins ? loseLoss : winLoss);
  return { attackerWon: attWins, attCas, defCas, ratio: r };
}

// Apply a result (from auto-resolve or a fought battle) to the campaign
// result: { attackerWon, attCas[], defCas[] (aligned with defender armies' units then garrison), kills }
export function applyBattle(s, world, sides, result) {
  const att = sides.attacker;
  const def = sides.defender;
  const prov = sides.prov;
  att.units.forEach((u, i) => (u.n -= result.attCas[i] || 0));
  let k = 0;
  for (const a of def.armies) for (const u of a.units) u.n -= result.defCas[k++] || 0;
  for (const u of def.garrison) u.n -= result.defCas[k++] || 0;
  const alive = (u) => u.n >= 3;
  att.units = att.units.filter(alive);
  for (const a of def.armies) a.units = a.units.filter(alive);
  s.provs[prov].garrison = s.provs[prov].garrison.filter(alive);
  const name = world.provinces[prov].name;
  const totalAttCas = result.attCas.reduce((a, b) => a + b, 0);
  const totalDefCas = result.defCas.reduce((a, b) => a + b, 0);
  if (att.owner === s.player) { s.stats.killed += totalDefCas; s.stats.lostMen += totalAttCas; }
  if (def.owner === s.player) { s.stats.killed += totalAttCas; s.stats.lostMen += totalDefCas; }
  const xpGain = (units, n) => units.forEach((u) => { u.xp = Math.min(3, (u.xp || 0) + n); });
  let captured = false;
  if (result.attackerWon) {
    xpGain(att.units, 0.5);
    att.gen.xp += 2; att.gen.stars = Math.min(5, Math.floor(att.gen.xp / 3));
    // defenders retreat or are destroyed
    for (const a of def.armies) {
      const back = linksOf(world, prov).map((l) => l.id).find((id) => s.provs[id].owner === a.owner && !armiesIn(s, id).some((x) => x.owner !== a.owner));
      if (back !== undefined && a.units.length && a.units.some((u) => !UNITS[u.t].general || a.units.length > 1)) { a.prov = back; a.mp = 0; }
      else a.units = [];
    }
    s.provs[prov].garrison = [];
    captured = true;
    if (att.units.length) { att.mp = 0; }
    if (att.owner === s.player) s.stats.won++;
    if (def.owner === s.player) s.stats.lost++;
  } else {
    for (const a of def.armies) { xpGain(a.units, 0.5); a.gen.xp += 2; a.gen.stars = Math.min(5, Math.floor(a.gen.xp / 3)); }
    att.prov = att.from !== undefined && s.provs[att.from].owner === att.owner ? att.from : att.prov;
    if (s.provs[att.prov].owner !== att.owner) att.units = [];
    att.mp = 0;
    if (att.owner === s.player) s.stats.lost++;
    if (def.owner === s.player) s.stats.won++;
  }
  s.armies = s.armies.filter((a) => a.units.length > 0 && !(a.units.length === 1 && UNITS[a.units[0].t].general && a.owner !== s.player));
  const verb = result.attackerWon ? 'takes' : 'is repulsed at';
  log(s, `${FACTIONS[att.owner].adj} army ${verb} ${name}.`, att.owner === s.player || def.owner === s.player ? (att.owner === s.player) === result.attackerWon ? 'win' : 'loss' : 'minor');
  if (captured && att.units.length) {
    att.prov = prov;
    transferProvince(s, world, prov, att.owner);
  }
  return captured;
}

export function transferProvince(s, world, prov, owner) {
  const pr = s.provs[prov];
  const old = pr.owner;
  pr.owner = owner;
  pr.unrest = 30;
  pr.order = Math.min(pr.order, 45);
  pr.queue = [];
  pr.garrison = [];
  if (old !== owner && owner === s.player) s.stats.taken++;
  if (s.factions[old] && s.factions[old].capital === prov) {
    // a fallen capital moves to the largest remaining city
    let best = -1, bp = -1;
    s.provs.forEach((p, i) => { if (p.owner === old && p.pop > bp) { bp = p.pop; best = i; } });
    s.factions[old].capital = best;
  }
  if (old !== 'free' && provsOf(s, old) === 0 && s.factions[old].alive) {
    s.factions[old].alive = false;
    s.armies = s.armies.filter((a) => a.owner !== old);
    log(s, `${FACTIONS[old].name} has been destroyed!`, old === s.player ? 'loss' : 'gold');
    for (const k of Object.keys(s.wars)) if (k.split('|').includes(old)) delete s.wars[k];
  }
  if (s.mission && s.mission.target === prov && owner === s.player) {
    s.factions[s.player].gold += s.mission.reward;
    log(s, `The Senate rejoices: ${world.provinces[prov].name} is ours. +${s.mission.reward} denarii.`, 'gold');
    s.mission = null;
  }
}

export function sack(s, world, prov) {
  const pr = s.provs[prov];
  const loot = Math.round(pr.pop * 0.06 + 150);
  s.factions[s.player].gold += loot;
  pr.pop = Math.round(pr.pop * 0.7);
  pr.unrest = 55;
  pr.order = 20;
  for (const b of BLD_KEYS) if (b !== 'barracks' && pr.bld[b] > 0 && Math.random() < 0.5) pr.bld[b]--;
  return loot;
}

// ------------------------------------------------------------- missions
export function newMission(s, world) {
  const mine = new Set(s.provs.map((p, i) => (p.owner === s.player ? i : -1)).filter((i) => i >= 0));
  const cand = new Set();
  for (const i of mine) for (const l of linksOf(world, i)) if (!mine.has(l.id)) cand.add(l.id);
  const list = [...cand];
  if (!list.length) { s.mission = null; return; }
  list.sort((a, b) => defencePower(s, a) - defencePower(s, b));
  const t = list[Math.floor(Math.random() * Math.min(3, list.length))];
  const reward = Math.round(500 + defencePower(s, t) / 25);
  s.mission = { target: t, deadline: s.turn + 10, reward };
  log(s, `The Senate demands the capture of ${world.provinces[t].name} within 10 years. Reward: ${reward} denarii.`, 'senate');
}

// ------------------------------------------------------------- start of a faction's turn
export function factionUpkeepTurn(s, world, f) {
  const fac = s.factions[f];
  if (!fac || !fac.alive) return;
  fac.gold += factionIncome(s, world, f);
  if (fac.gold < 0 && f !== 'free') {
    // bankrupt: the worst unit deserts
    const as = s.armies.filter((a) => a.owner === f && a.units.length > 1);
    if (as.length) { const a = as[0]; a.units.pop(); if (f === s.player) log(s, 'Unpaid troops have deserted!', 'loss'); }
  }
  s.provs.forEach((pr, i) => {
    if (pr.owner !== f) return;
    // growth
    const tier0 = tierOf(pr.pop);
    pr.pop = Math.min(Math.max(pr.pop, popCap(world, i, pr)), Math.round(pr.pop * (1 + growthRate(world, i, pr) / 100)));
    const tier1 = tierOf(pr.pop);
    if (tier1 > tier0 && f === s.player) {
      log(s, `${world.provinces[i].name} has grown into a ${TIERS[tier1].name}! New building slots and levels are open.`, 'gold');
      (s.news = s.news || []).push({ kind: 'tier', prov: i, tier: tier1 });
    }
    pr.games = (pr.games || 0) * 0.55; if (pr.games < 1) pr.games = 0;
    // construction
    const done = tickConstruction(pr);
    if (done && f === s.player) {
      log(s, `${BUILDINGS[done].lv[pr.bld[done] - 1]} completed in ${world.provinces[i].name}.`, 'build');
      (s.news = s.news || []).push({ kind: 'built', prov: i, b: done });
    }
    pr.unrest = Math.max(0, pr.unrest - 4);
    const t = orderTarget(s, world, i);
    pr.order += (t - pr.order) * 0.35;
    fillGarrison(s, world, i);
    // revolt
    if (pr.order < 12 && !armiesIn(s, i).some((a) => a.owner === f) && Math.random() < 0.3 && provsOf(s, f) > 1) {
      log(s, `${world.provinces[i].name} revolts against ${FACTIONS[f].name}!`, f === s.player ? 'loss' : 'minor');
      transferProvince(s, world, i, 'free');
      pr.order = 60; pr.unrest = 0;
      fillGarrison(s, world, i, true);
    }
  });
  // replenish armies in friendly territory
  for (const a of s.armies) {
    if (a.owner !== f) continue;
    a.mp = armyMaxMp(a);
    if (s.provs[a.prov].owner === f) for (const u of a.units) u.n = Math.min(UNITS[u.t].men, Math.ceil(u.n + UNITS[u.t].men * 0.15));
  }
}

export function updateRank(s) {
  const r = rankFor(provsOf(s, s.player));
  if (r > s.rank) { s.rank = r; return RANKS[r]; }
  return null;
}

export function checkEnd(s) {
  const n = provsOf(s, s.player);
  if (n === 0) return 'defeat';
  const majorsLeft = Object.entries(s.factions).filter(([id, f]) => id !== s.player && id !== 'free' && f.alive).length;
  if (n >= VICTORY_PROVINCES || majorsLeft === 0) return 'victory';
  return null;
}
