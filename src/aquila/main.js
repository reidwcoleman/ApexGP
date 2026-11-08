import './style.css';
import { createRenderer } from './engine/renderer.js';
import { buildWorld, battleGeo } from './map/geo.js';
import { CampaignView } from './campaign/view.js';
import { CampaignController } from './campaign/ui.js';
import { newGame, migrate } from './campaign/state.js';
import { startBattle } from './battle/battle.js';
import { FACTIONS, FACTION_IDS, generalName } from './data/factions.js';
import { UNITS, ROSTERS, GENERAL_UNIT } from './data/units.js';
import { ICONS } from './ui/icons.js';
import { audio } from './audio.js';
import { Q, setQuality } from './engine/quality.js';

const canvas = document.getElementById('gl');
const uiRoot = document.getElementById('ui');
const labelsRoot = document.getElementById('labels');
const renderer = createRenderer(canvas);
const params = new URLSearchParams(location.search);

let mode = 'loading', world = null, mapView = null, campaign = null, battle = null, menuEl = null, menuT = 0;

// ---------------------------------------------------------------- loading
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `<div class="lw"><div class="aquila-mark">${ICONS.eagle}</div><h1>AQUILA</h1><div class="bar"><i></i></div><div class="msg">Charting the coasts</div></div>`;
document.body.appendChild(loading);
const setProgress = (p, m) => { loading.querySelector('.bar i').style.width = `${p * 100}%`; loading.querySelector('.msg').textContent = m; };

addEventListener('pointerdown', () => audio.init(), { once: false });

async function boot() {
  world = await buildWorld(setProgress);
  const mapLabels = document.createElement('div');
  labelsRoot.appendChild(mapLabels);
  mapView = new CampaignView(renderer, world, mapLabels);
  const s0 = newGame(world, 'normal');
  mapView.syncOwners(s0); mapView.rebuildWalls(s0); mapView.syncArmies(s0, null);
  mapView.focus(-9, 1.5, 17); mapView.cam.x = -9; mapView.cam.z = 1.5; mapView.cam.dist = 22;
  setProgress(1, 'Ave, Imperator');
  window.__world = world; window.__mapView = mapView;
  if (params.get('test') === 'battle') { quickBattle(params.get('vs') || 'carthage'); return; }
  if (params.get('test') === 'campaign') return startCampaign(newGame(world, 'normal'));
  if (params.get('test') === 'city') { startCampaign(newGame(world, 'normal')); campaign.openCity(Number(params.get('prov') ?? campaign.s.factions.rome.capital)); return; }
  showMenu();
}

function hideLoading() { loading.classList.add('out'); setTimeout(() => loading.remove(), 900); }

// ---------------------------------------------------------------- menu
function showMenu() {
  mode = 'menu';
  hideLoading();
  audio.setMode('menu');
  mapView.labelsEl.style.display = 'none';
  mapView.setHighlights({});
  const hasSave = !!localStorage.getItem('aquila.save.v1');
  let diff = localStorage.getItem('aquila.diff') || 'normal';
  menuEl = document.createElement('div');
  menuEl.className = 'menu';
  menuEl.innerHTML = `<div class="mc">
    <div class="kicker">Senatus Populusque Romanus</div>
    <h1>AQUILA</h1>
    <p class="tag">Carry the eagle from the seven hills to the ends of the earth. Raise legions, outwit kings, and win the battles yourself.</p>
    <div class="mb">
      ${hasSave ? `<button class="btn gold" data-m="continue">Continue <small>${saveLabel()}</small></button>` : ''}
      <button class="btn ${hasSave ? '' : 'gold'}" data-m="new">New Campaign <small>272 BC · Rome</small></button>
      <div class="diff">${['easy', 'normal', 'hard'].map((d) => `<button class="btn small ${d === diff ? 'on' : ''}" data-d="${d}">${d}</button>`).join('')}</div>
      <button class="btn" data-m="quick">Quick Battle <small>Straight to the field</small></button>
      <button class="btn ghost" data-m="help">How to Play</button>
      <button class="btn ghost small" data-m="quality">Graphics: <span class="ql">${Q.level === 'high' ? 'High' : 'Balanced'}</span></button>
    </div>
    <div class="foot">${location.pathname.endsWith('aquila.html') ? '<a class="allgames" href="index.html?pick">← All games</a> · ' : ''}Drag to command. Every soldier fights his own fight.</div></div>`;
  uiRoot.appendChild(menuEl);
  menuEl.addEventListener('click', async (e) => {
    audio.init();
    const d = e.target.closest('[data-d]');
    if (d) { diff = d.dataset.d; localStorage.setItem('aquila.diff', diff); menuEl.querySelectorAll('[data-d]').forEach((b) => b.classList.toggle('on', b === d)); audio.sfx('click'); return; }
    const b = e.target.closest('[data-m]');
    if (!b) return;
    audio.sfx('click');
    const m = b.dataset.m;
    if (m === 'continue') { try { const s = migrate(JSON.parse(localStorage.getItem('aquila.save.v1'))); s.offers = s.offers || []; closeMenu(); startCampaign(s); } catch { localStorage.removeItem('aquila.save.v1'); } }
    if (m === 'new') {
      if (hasSave && !(await confirmBox('Begin a new campaign?', 'Your saved campaign will be overwritten.'))) return;
      closeMenu(); startCampaign(newGame(world, diff)); audio.sfx('horn');
    }
    if (m === 'quick') quickBattleMenu();
    if (m === 'help') helpBox();
    if (m === 'quality') { setQuality(Q.level === 'high' ? 'balanced' : 'high', renderer); b.querySelector('.ql').textContent = Q.level === 'high' ? 'High' : 'Balanced'; if (mapView.composer.ao) mapView.composer.ao.enabled = Q.level === 'high'; }
  });
}
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function saveLabel() {
  try { const s = JSON.parse(localStorage.getItem('aquila.save.v1')); const y = s.year; return `${y < 0 ? -y + ' BC' : 'AD ' + (y + 1)} · ${s.provs.filter((p) => p.owner === s.player).length} provinces`; } catch { return ''; }
}

function modal(html, cls = '') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${cls}">${html}</div>`;
    uiRoot.appendChild(wrap);
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; audio.sfx('click'); wrap.remove(); resolve(b.dataset.c); });
  });
}
async function confirmBox(t, m) { return (await modal(`<h1>${t}</h1><p class="m-sub">${m}</p><div class="m-actions"><button class="btn gold" data-c="y">Yes</button><button class="btn ghost" data-c="n">Cancel</button></div>`)) === 'y'; }
function helpBox() {
  modal(`<div class="m-kicker">Commentarii</div><h1>How to Play</h1><div class="help-grid">
    <h3>Campaign</h3>
    <div><b>Goal</b> — Rome begins with three provinces in Italy. Hold 100 provinces or destroy every rival power.</div>
    <div><b>Armies</b> — left-click to select, right-click a glowing province to march or attack.</div>
    <div><b>Cities</b> — double-click a city to walk its streets: build and upgrade, set taxes, hold games and recruit. Cities grow from Village to Metropolis.</div>
    <div><b>End turn</b> — the gold eagle (or Enter). Rivals move, fight one another, and may come for you.</div>
    <h3>Battle</h3>
    <div><b>Select</b> — click, drag a box, or use the unit cards. Ctrl+A selects all.</div>
    <div><b>Command</b> — right-click to move or attack; right-drag to draw a line. Double right-click to run.</div>
    <div><b>Win</b> — break their morale. Charges, flanks and rear attacks are how battles are won.</div>
    <div><b>Camera</b> — WASD to pan, Q/E to rotate, wheel to zoom, middle-drag to orbit.</div>
  </div><div class="m-actions"><button class="btn gold" data-c="ok">Understood</button></div>`, 'wide');
}

// ---------------------------------------------------------------- campaign
function startCampaign(state) {
  mode = 'campaign';
  hideLoading();
  mapView.labelsEl.style.display = '';
  campaign = new CampaignController({
    renderer, world, state, uiRoot, labelsRoot, view: mapView,
    fight: (cfg, title) => fight(cfg, title),
    onQuit: () => { campaign = null; showMenu(); },
  });
  window.__campaign = campaign;
}

async function fight(cfg, title) {
  const prev = mode;
  mode = 'battle';
  battle = startBattle({ renderer, uiRoot, labelsRoot, cfg, title });
  const res = await battle.done;
  battle = null;
  mode = prev;
  return res;
}

// ---------------------------------------------------------------- quick battle
async function quickBattleMenu() {
  const foes = FACTION_IDS.filter((f) => f !== 'rome' && f !== 'free');
  const c = await modal(`<div class="m-kicker">Quick Battle</div><h1>Choose your enemy</h1><div class="dip-list">${foes.map((f) => `<div class="dip" style="--c:${FACTIONS[f].color}"><span class="sw"></span><div class="nm">${FACTIONS[f].name}<small>${FACTIONS[f].adj} army · ${UNITS[ROSTERS[FACTIONS[f].culture][0]].name}, ${UNITS[ROSTERS[FACTIONS[f].culture][2]].name}…</small></div><span></span><div class="ac"><button class="btn small gold" data-c="${f}">Fight</button></div></div>`).join('')}</div><div class="m-actions"><button class="btn ghost" data-c="cancel">Back</button></div>`, 'wide');
  if (c && c !== 'cancel') quickBattle(c);
}

const BIOME_OF = { carthage: 'arid', gaul: 'temperate', britons: 'boreal', germans: 'boreal', iberia: 'med', macedon: 'med', greeks: 'med', seleucid: 'arid', egypt: 'desert', parthia: 'steppe', dacia: 'temperate', numidia: 'desert', scythia: 'steppe' };

async function quickBattle(foe) {
  closeMenu();
  hideLoading();
  const pick = (cul, n) => {
    const r = ROSTERS[cul];
    const out = [];
    const line = r.filter((t) => ['inf', 'spear', 'pike'].includes(UNITS[t].cls));
    const mis = r.filter((t) => UNITS[t].cls === 'missile');
    const cav = r.filter((t) => ['cav', 'harcher', 'elephant'].includes(UNITS[t].cls));
    for (let i = 0; i < n; i++) {
      const k = i % 6;
      const pool = k < 3 ? line : k === 3 || k === 5 ? (mis.length ? mis : line) : (cav.length ? cav : line);
      out.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    return out;
  };
  const rome = ['rom_hastati', 'rom_hastati', 'rom_principes', 'rom_principes', 'rom_triarii', 'rom_velites', 'rom_velites', 'rom_equites', 'rom_equites', 'rom_sagittarii'];
  const cul = FACTIONS[foe].culture;
  const mkSide = (owner, types, player) => ({
    owner, culture: FACTIONS[owner].culture, name: FACTIONS[owner].name, color: FACTIONS[owner].color, player,
    units: [{ t: GENERAL_UNIT[FACTIONS[owner].culture], n: UNITS[GENERAL_UNIT[FACTIONS[owner].culture]].men, xp: 1 }, ...types.map((t) => ({ t, n: UNITS[t].men, xp: 0 }))],
    gen: { name: generalName(FACTIONS[owner].culture), stars: 2 },
  });
  const capId = world.provinces.findIndex((p) => p.name === FACTIONS[foe].capital);
  const cfg = { sides: [mkSide('rome', rome, true), mkSide(foe, pick(cul, 10), false)], biome: capId >= 0 ? world.provinces[capId].biome : BIOME_OF[foe] || 'temperate', seed: Math.floor(Math.random() * 99999), attacker: 0, walls: 0, geo: capId >= 0 ? battleGeo(world, capId) : null };
  mapView.labelsEl.style.display = 'none';
  await fight(cfg, `A field battle against ${FACTIONS[foe].name}`);
  showMenu();
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  if (mode === 'battle' && battle) battle.frame(dt);
  else if (mode === 'campaign' && campaign) campaign.frame(dt);
  else if ((mode === 'menu' || mode === 'loading') && mapView) {
    menuT += dt;
    mapView.cam.tx = -9 + Math.sin(menuT * 0.03) * 7;
    mapView.cam.tz = -1.5 + Math.cos(menuT * 0.025) * 3;
    mapView.cam.tdist = 17 + Math.sin(menuT * 0.05) * 3;
    mapView.render(dt, null);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  mapView?.resize(); battle?.resize(); campaign?.city?.resize();
});

boot().then(() => setTimeout(() => (window.__ready = true), 1200));
