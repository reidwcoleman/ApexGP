// City rules: tiers, building slots, the building catalogue, taxes, trade goods,
// construction queues and the income/order/growth breakdowns the city screen shows.
// DOM-free and independent of state.js (no circular imports).
import { FACTIONS } from '../data/factions.js';

export const DIFF = { easy: { ai: 0.8, player: 1.25 }, normal: { ai: 1.0, player: 1.0 }, hard: { ai: 1.5, player: 0.9 } };

// ------------------------------------------------------------- tiers
export const TIERS = [
  { name: 'Village', min: 0, slots: 4 },
  { name: 'Town', min: 8000, slots: 6 },
  { name: 'City', min: 20000, slots: 8 },
  { name: 'Metropolis', min: 45000, slots: 11 },
];
export function tierOf(pop) { let t = 0; for (let i = 0; i < TIERS.length; i++) if (pop >= TIERS[i].min) t = i; return t; }

// ------------------------------------------------------------- buildings
// lv[n] describes level n+1. need = minimum tier for that level.
export const BUILDINGS = {
  market: { name: 'Forum', icon: 'forum', max: 3, cost: [400, 850, 1500], turns: [1, 2, 3],
    lv: ['Market Square', 'Forum', 'Forum Magnum'], desc: 'The heart of commerce.', fx: (l) => `+${25 * l}% tax income · +${10 * l} trade` },
  farm: { name: 'Farms', icon: 'farm', max: 3, cost: [300, 650, 1100], turns: [1, 2, 2],
    lv: ['Farmsteads', 'Villae Rusticae', 'Latifundia'], desc: 'Feed the city and it grows.', fx: (l) => `+${(0.6 * l).toFixed(1)}% growth · +${40 * l}% population cap` },
  barracks: { name: 'Barracks', icon: 'barracks', max: 4, cost: [250, 600, 1200, 2000], turns: [1, 2, 2, 3],
    lv: ['Drill Field', 'Barracks', 'Castra', 'Legionary Fortress'], desc: 'Trains better soldiers.', fx: (l) => `Unlocks tier ${l} units` },
  walls: { name: 'Walls', icon: 'wall', max: 3, cost: [450, 950, 1600], turns: [1, 2, 3],
    lv: ['Palisade', 'Stone Walls', 'Great Walls'], desc: 'Hold what you have taken.', fx: (l) => `+${l} garrison units · +${18 * l}% defence` },
  temple: { name: 'Temple', icon: 'temple', max: 3, cost: [400, 800, 1350], turns: [1, 2, 3],
    lv: ['Shrine', 'Temple', 'Great Temple'], desc: 'The gods keep the peace.', fx: (l) => `+${12 * l} order${l >= 2 ? ' · recruits start Veteran' : ''}` },
  aqueduct: { name: 'Aqueduct', icon: 'aqueduct', max: 3, cost: [700, 1300, 2100], turns: [2, 2, 3], need: [1, 2, 3],
    lv: ['Cisterns', 'Aqueduct', 'Great Aqueduct'], desc: 'Clean water lets the city swell.', fx: (l) => `+${60 * l}% population cap · +${(0.4 * l).toFixed(1)}% growth · +${3 * l} order` },
  arena: { name: 'Arena', icon: 'arena', max: 3, cost: [600, 1200, 2400], turns: [1, 2, 3], need: [1, 1, 2],
    lv: ['Theatre', 'Amphitheatre', 'Colosseum'], desc: 'Bread and circuses.', fx: (l) => `+${10 * l} order · games cost ${[0, 25, 45, 65][l]}% less` },
  port: { name: 'Port', icon: 'port', max: 3, cost: [450, 900, 1600], turns: [1, 2, 2], coastal: true,
    lv: ['Harbour', 'Port', 'Great Harbour'], desc: 'Ships carry goods and legions.', fx: (l) => `+${45 * l} trade · trade goods +${50 * l}% · sea crossings cost 1 march` },
  smithy: { name: 'Smithy', icon: 'smithy', max: 3, cost: [500, 1000, 1700], turns: [1, 2, 2], need: [0, 1, 2],
    lv: ['Forge', 'Armourer', 'Fabrica'], desc: 'Better arms for every recruit.', fx: (l) => `Recruits get +${l} armour, +${(l * 0.5).toFixed(1)} attack` },
  stables: { name: 'Stables', icon: 'stables', max: 3, cost: [450, 900, 1500], turns: [1, 2, 2], need: [0, 1, 2],
    lv: ['Paddocks', 'Stables', 'Stud Farms'], desc: 'Horses bred for war.', fx: (l) => `Cavalry −${10 * l}% cost · +${l} veterancy` },
  academy: { name: 'Academy', icon: 'academy', max: 3, cost: [650, 1300, 2200], turns: [2, 2, 3], need: [1, 2, 2],
    lv: ['School', 'Library', 'Academy'], desc: 'Learning breeds commanders.', fx: (l) => `New generals start with ${l}★ · +${4 * l} order` },
  mine: { name: 'Mine', icon: 'mine', max: 3, cost: [500, 1000, 1700], turns: [1, 2, 2], metal: true,
    lv: ['Diggings', 'Mine', 'Deep Mine'], desc: 'Dig the province\'s metal.', fx: (l) => `+${l}× metal income` },
};
export const BLD_KEYS = Object.keys(BUILDINGS);

export function migrateProv(pr) {
  for (const k of BLD_KEYS) if (pr.bld[k] === undefined) pr.bld[k] = 0;
  if (!Array.isArray(pr.queue)) pr.queue = pr.queue ? [pr.queue] : [];
  if (pr.tax === undefined) pr.tax = 1;
  if (pr.games === undefined) pr.games = 0;
}

// ------------------------------------------------------------- taxes
export const TAX = [
  { name: 'Light', mul: 0.65, order: 12, growth: 0.4, desc: 'The people bless your name.' },
  { name: 'Fair', mul: 1.0, order: 0, growth: 0, desc: 'The customary levy.' },
  { name: 'Heavy', mul: 1.3, order: -12, growth: -0.3, desc: 'Grumbling in the streets.' },
  { name: 'Crushing', mul: 1.6, order: -26, growth: -0.8, desc: 'Riots are only a matter of time.' },
];

// ------------------------------------------------------------- trade goods
export const RESOURCES = {
  iron: { name: 'Iron', kind: 'metal', value: 55, note: 'Mines yield iron · Smithy −30% cost' },
  tin: { name: 'Tin', kind: 'metal', value: 65, note: 'Mines yield tin' },
  silver: { name: 'Silver', kind: 'metal', value: 95, note: 'Mines yield silver' },
  gold: { name: 'Gold', kind: 'metal', value: 130, note: 'Mines yield gold' },
  grain: { name: 'Grain', kind: 'food', value: 25, note: 'Farms twice as effective' },
  horses: { name: 'Horses', kind: 'beast', value: 30, note: 'Cavalry −15% · Stables −25% cost' },
  marble: { name: 'Marble', kind: 'stone', value: 30, note: 'All buildings −20% cost' },
  timber: { name: 'Timber', kind: 'wood', value: 25, note: 'Buildings −10% · Port −30% cost' },
  wine: { name: 'Wine', kind: 'lux', value: 40, note: 'Traded through the forum and port' },
  olive: { name: 'Olive Oil', kind: 'lux', value: 38, note: 'Traded through the forum and port' },
  dye: { name: 'Purple Dye', kind: 'lux', value: 60, note: 'The colour of kings' },
  incense: { name: 'Incense', kind: 'lux', value: 58, note: 'Frankincense and myrrh' },
  spices: { name: 'Spices', kind: 'lux', value: 55, note: 'From the edge of India' },
  amber: { name: 'Amber', kind: 'lux', value: 45, note: 'Gold of the north' },
  furs: { name: 'Furs', kind: 'lux', value: 35, note: 'Pelts of the steppe and forest' },
  papyrus: { name: 'Papyrus', kind: 'lux', value: 45, note: 'The paper of the world' },
  fish: { name: 'Garum', kind: 'lux', value: 32, note: 'Fish sauce on every Roman table' },
  dates: { name: 'Dates', kind: 'lux', value: 28, note: 'Fruit of the oases' },
  salt: { name: 'Salt', kind: 'lux', value: 30, note: 'Worth its weight' },
};
const RES_BY_CITY = {
  Noreia: 'iron', Arretium: 'iron', Numantia: 'iron', Trapezus: 'iron', Deva: 'iron', Porolissum: 'iron', Lugia: 'iron', Iconium: 'iron',
  Isca: 'tin', Condate: 'tin', Bracara: 'tin',
  'Carthago Nova': 'silver', Athenae: 'silver', Seuthopolis: 'silver', Sardis: 'gold', Toletum: 'silver',
  Sarmizegetusa: 'gold', Asturica: 'gold', Bactra: 'gold', Napata: 'gold', Aquincum: 'gold', Maracanda: 'silver',
  Alexandria: 'papyrus', Memphis: 'grain', Thebae: 'grain', Syracusae: 'grain', Carthago: 'grain', Capua: 'wine', Seleucia: 'grain', Olbia: 'grain', Gerrhus: 'horses',
  Massilia: 'wine', Rhodus: 'wine', Tarentum: 'wine', Corinthus: 'marble', Narbo: 'wine', Gortyn: 'wine',
  Corduba: 'olive', Hadrumetum: 'olive', 'Leptis Magna': 'olive', Sparta: 'olive', Ambracia: 'olive', Halicarnassus: 'olive',
  Cirta: 'horses', Larissa: 'horses', Ecbatana: 'horses', Nisa: 'horses', Mazaca: 'horses', Tanais: 'horses', Merv: 'horses', Volubilis: 'horses', Getia: 'horses',
  Genua: 'marble', Pergamon: 'marble', Roma: 'marble', Salamis: 'marble',
  Pella: 'timber', Phasis: 'timber', Sinope: 'timber', Teutoburgium: 'timber', Mattium: 'timber', Semnonia: 'timber', Alesia: 'timber',
  Tyrus: 'dye', Mariba: 'incense', Omana: 'incense', Gerrha: 'incense', Petra: 'incense', Hegra: 'dates',
  Taxila: 'spices', Patala: 'spices', Kapisa: 'spices', Aestia: 'amber', Gothiscandza: 'amber', Thyssagetia: 'furs', Budinia: 'furs', Scandza: 'furs', Neuria: 'furs',
  Panticapaeum: 'fish', Chersonesus: 'fish', Byzantium: 'fish', Gades: 'fish', Lilybaeum: 'fish',
  Garama: 'salt', Palmyra: 'dates', Charax: 'dates', Persepolis: 'silver', Hierosolyma: 'olive', Damascus: 'dye',
};
export function resourceOf(p) {
  if (p.res) return p.res;
  p.res = RES_BY_CITY[p.name] || { temperate: 'timber', boreal: 'furs', med: 'olive', arid: 'dates', desert: 'salt', steppe: 'horses' }[p.biome] || 'grain';
  return p.res;
}
// distinct trade goods held by a faction: each adds 3% to all its tax
export function goodsOf(s, world, f) {
  const set = new Set();
  s.provs.forEach((pr, i) => { if (pr.owner === f) set.add(resourceOf(world.provinces[i])); });
  return set;
}

// ------------------------------------------------------------- breakdowns
const isPlayer = (s, pr) => pr.owner === s.player;
function diffMul(s, pr) { return isPlayer(s, pr) ? DIFF[s.difficulty].player : FACTIONS[pr.owner].major ? DIFF[s.difficulty].ai : 1; }

export function cityIncome(s, world, i, goodsBonus = null) {
  const pr = s.provs[i], p = world.provinces[i], B = pr.bld;
  const res = RESOURCES[resourceOf(p)];
  const tax = TAX[pr.tax ?? 1];
  const lines = [];
  let taxV = pr.pop * 0.0105 * tax.mul * (1 + 0.25 * B.market + 0.08 * B.farm);
  if (goodsBonus) taxV *= 1 + goodsBonus;
  lines.push(['Tax', taxV]);
  let trade = 20 + (p.coastal ? 18 : 0) + B.market * 10 + B.port * 45;
  if (res.kind === 'lux') trade += res.value * (1 + 0.5 * B.port + 0.25 * B.market);
  lines.push(['Trade', trade]);
  if (res.kind === 'metal' && B.mine) lines.push([`${res.name} mine`, res.value * B.mine]);
  const gross = lines.reduce((t, l) => t + l[1], 0);
  const orderMul = 0.45 + (pr.order / 100) * 0.55;
  const total = gross * orderMul * diffMul(s, pr);
  if (orderMul < 0.99) lines.push(['Unrest losses', -(gross - gross * orderMul)]);
  return { lines, total: Math.round(total) };
}

export function cityOrder(s, world, i, nProvs, garrisoned) {
  const pr = s.provs[i], B = pr.bld, p = world.provinces[i];
  const lines = [['Base', 62]];
  if (B.temple) lines.push(['Temple', 12 * B.temple]);
  if (B.arena) lines.push(['Arena', 10 * B.arena]);
  if (B.aqueduct) lines.push(['Aqueduct', 3 * B.aqueduct]);
  if (B.academy) lines.push(['Academy', 4 * B.academy]);
  const tax = TAX[pr.tax ?? 1];
  if (tax.order) lines.push([`${tax.name} taxes`, tax.order]);
  if (FACTIONS[pr.owner].major && p.culture !== 'local') {
    const own = FACTIONS[pr.owner].culture;
    if (own !== p.culture) lines.push(['Foreign culture', -14]);
  }
  if (garrisoned) lines.push(['Army garrisoned', 12]);
  if (pr.games > 0) lines.push(['Games', Math.round(pr.games)]);
  if (pr.unrest) lines.push(['Recent conquest', -Math.min(30, Math.round(pr.unrest))]);
  const sprawl = Math.max(0, nProvs - 12) * 0.35;
  if (sprawl >= 1) lines.push(['Size of empire', -Math.round(sprawl)]);
  const tier = tierOf(pr.pop);
  if (tier >= 2) lines.push(['Crowding', -4 * (tier - 1)]);
  const total = Math.max(0, Math.min(100, lines.reduce((t, l) => t + l[1], 0)));
  return { lines, total };
}

export function popCap(world, i, pr) {
  const base = world.provinces[i].pop;
  const grain = resourceOf(world.provinces[i]) === 'grain' ? 2 : 1;
  return Math.round(base * (2.2 + 0.4 * pr.bld.farm * grain + 0.6 * pr.bld.aqueduct));
}
export function growthRate(world, i, pr) {
  const grain = resourceOf(world.provinces[i]) === 'grain' ? 2 : 1;
  const tax = TAX[pr.tax ?? 1];
  let g = 1.0 + 0.6 * pr.bld.farm * grain + 0.4 * pr.bld.aqueduct + tax.growth;
  if (pr.order < 30) g -= 0.6;
  const cap = popCap(world, i, pr);
  g *= Math.max(0, Math.min(1, (cap - pr.pop) / (cap * 0.25)));
  return g; // percent per year
}

export function orderLabel(o) { return o >= 80 ? 'Jubilant' : o >= 60 ? 'Content' : o >= 40 ? 'Restless' : o >= 20 ? 'Unruly' : 'Rioting'; }

// ------------------------------------------------------------- construction
export function usedSlots(pr) { let n = 0; for (const k of BLD_KEYS) if (pr.bld[k] > 0) n++; for (const q of pr.queue) if (!pr.bld[q.b] && !pr.queue.slice(0, pr.queue.indexOf(q)).some((x) => x.b === q.b)) n++; return n; }

export function plannedLevel(pr, b) { return pr.bld[b] + pr.queue.filter((q) => q.b === b).length; }

export function buildCost(s, world, i, b) {
  const pr = s.provs[i], B = BUILDINGS[b];
  const lvl = plannedLevel(pr, b);
  if (lvl >= B.max) return 0;
  const res = resourceOf(world.provinces[i]);
  let c = B.cost[lvl];
  if (res === 'marble') c *= 0.8;
  if (res === 'timber') c *= b === 'port' ? 0.7 : 0.9;
  if (res === 'iron' && b === 'smithy') c *= 0.7;
  if (res === 'horses' && b === 'stables') c *= 0.75;
  return Math.round(c);
}

export function canBuild(s, world, i, b, rankTitleFor) {
  const pr = s.provs[i], B = BUILDINGS[b], p = world.provinces[i];
  const lvl = plannedLevel(pr, b);
  if (lvl >= B.max) return { ok: false, why: 'Fully built', done: true };
  if (B.coastal && !p.coastal) return { ok: false, why: 'Needs a coastline', locked: true };
  if (B.metal && RESOURCES[resourceOf(p)].kind !== 'metal') return { ok: false, why: 'No metal here', locked: true };
  const tier = tierOf(pr.pop);
  const need = (B.need || [0, 1, 2, 3])[lvl] ?? lvl;
  if (tier < need) return { ok: false, why: `Needs a ${TIERS[need].name}`, locked: true };
  if (pr.queue.length >= 3) return { ok: false, why: 'Queue is full' };
  if (lvl === 0 && usedSlots(pr) >= TIERS[tier].slots) return { ok: false, why: `No free building slots (${TIERS[tier].name})` };
  if (b === 'barracks' && pr.owner === s.player && lvl + 1 >= 3 && s.rank < lvl - 1) return { ok: false, why: rankTitleFor ? `Requires rank: ${rankTitleFor(lvl - 1)}` : 'Requires higher rank', locked: true };
  const cost = buildCost(s, world, i, b);
  if (s.factions[pr.owner].gold < cost) return { ok: false, why: 'Not enough denarii', cost };
  return { ok: true, cost };
}

export function build(s, world, i, b) {
  const pr = s.provs[i];
  const lvl = plannedLevel(pr, b);
  const cost = buildCost(s, world, i, b);
  s.factions[pr.owner].gold -= cost;
  const turns = BUILDINGS[b].turns[lvl] ?? 2;
  pr.queue.push({ b, turns, total: turns, cost });
}

export function cancelBuild(s, i, idx) {
  const pr = s.provs[i];
  const q = pr.queue[idx];
  if (!q) return;
  // later queued levels of the same building go too
  const drop = pr.queue.filter((x, k) => k >= idx && x.b === q.b);
  for (const d of drop) s.factions[pr.owner].gold += d.cost ?? 0;
  pr.queue = pr.queue.filter((x) => !drop.includes(x));
}

// one year of building: returns the key that completed, if any
export function tickConstruction(pr) {
  const q = pr.queue[0];
  if (!q) return null;
  q.turns--;
  if (q.turns > 0) return null;
  pr.bld[q.b]++;
  pr.queue.shift();
  return q.b;
}

export function gamesCost(pr) { return Math.round((150 + pr.pop * 0.012) * (1 - [0, 0.25, 0.45, 0.65][pr.bld.arena])); }
