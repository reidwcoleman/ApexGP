// Mogul: boot, the title screen, wiring the city, the crowd, the economy and the HUD together, input,
// the frame loop and saving.
import { CITIES } from './cities.ts';
import { loadCity, type Building } from './city.ts';
import { World, OWN } from './world.ts';
import { Sim, money, type SaveState } from './sim.ts';
import { Peds } from './peds.ts';
import { Props } from './props.ts';
import { Sfx } from './audio.ts';
import { UI, type Tool } from './ui.ts';
import { FAC_BY, RIVALS, SURVEY_COST } from './data.ts';

const $ = (s: string) => document.querySelector(s) as HTMLElement;
const loading = $('#loading');
const step = (t: string, p: number) => { $('#loading .lstep').textContent = t; ($('#loading .lbar b') as HTMLElement).style.width = p * 100 + '%'; };
const KEY = (id: string) => 'mogul.v1.' + id;

function readSave(id: string): SaveState | null {
  try { const r = localStorage.getItem(KEY(id)); return r ? (JSON.parse(r) as SaveState) : null; } catch { return null; }
}

async function boot() {
  const ui = new UI($('#ui'));
  const sfx = new Sfx();
  ui.onSfx = (k) => (sfx as any)[k]?.();
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  loading.classList.add('done');

  const q = new URLSearchParams(location.search);
  let choice: { city: string; company: string };
  if (q.get('city')) choice = { city: q.get('city')!, company: readSave(q.get('city')!)?.company || 'Test Co.' };
  else {
    let baked: string[] = CITIES.map((c) => c.id);
    try { baked = await (await fetch(`${import.meta.env.BASE_URL}mogul/index.json`)).json(); } catch {}
    const list = CITIES.filter((c) => baked.includes(c.id)).map((c) => {
      const s = readSave(c.id);
      return { id: c.id, name: c.name, area: c.area, sky: c.sky, save: s ? { nw: (s as any).nwCache ?? s.cash, company: s.company, day: Math.floor(s.t / 24) + 1 } : null };
    });
    choice = await ui.title(list, localStorage.getItem('mogul.last'));
  }
  localStorage.setItem('mogul.last', choice.city);
  loading.classList.remove('done');
  step('Loading the streets', 0.2);
  const def = CITIES.find((c) => c.id === choice.city) ?? CITIES[0];
  const city = await loadCity(def);
  step('Raising the buildings', 0.5);
  await new Promise((r) => setTimeout(r, 30));
  const save = readSave(def.id);
  const sim = new Sim(city, save, choice.company);
  const world = new World($('#gl') as HTMLCanvasElement, city, RIVALS.map((r) => r.color));
  world.resize();
  addEventListener('resize', () => world.resize());
  step('Filling the sidewalks', 0.8);
  await new Promise((r) => setTimeout(r, 30));
  const props = new Props(world.scene, city, sim);
  const peds = new Peds(world.scene, city, sim, Math.round(2600 * Math.min(1.3, def.crowd)));
  ui.mount(sim, city);
  ui.lineOf = (k) => peds.lineLength(k);

  // ---------------------------------------------------------------- building tints
  const paintBuildings = () => {
    for (const b of city.buildings) world.setBuilding(b.id, 0, 1);
    for (const id of sim.s.forSale) world.setBuilding(id, OWN.sale);
    for (const [id, r] of Object.entries(sim.s.rivalOwn)) world.setBuilding(+id, OWN.rival + r);
    for (const id of sim.s.owned) world.setBuilding(id, OWN.me);
    for (const f of sim.s.facs) {
      const b = city.buildings[f.b];
      const tgt = FAC_BY[f.type].h / b.h;
      world.setBuilding(f.b, f.build < 1 ? OWN.build : OWN.me, f.build < 1 ? 0.04 + (tgt - 0.04) * f.build : tgt);
    }
  };
  const extraFoot = () => {
    peds.extra.clear();
    for (const f of sim.s.facs) if (f.type === 'apartments' && f.build >= 1) { const b = city.buildings[f.b]; peds.extra.set(b.edge, (peds.extra.get(b.edge) ?? 0) + 0.4 * f.lv); }
    peds.reweight();
  };

  sim.onChange = () => { props.sync(); peds.setSellers(); paintBuildings(); extraFoot(); ui.refresh(); };
  sim.onToast = (t, k) => { ui.toast(t, k); if (k === 'bad') sfx.bad(); };
  sim.onQuest = (i) => { ui.questDone(i); sfx.goal(); };
  sim.onMonth = (rank, rows) => { ui.monthEnd(rank, rows); sfx.goal(); };
  peds.onServed = (s, amt) => {
    const p = world.toScreen(s.x, 5, s.z);
    if (p) ui.pop(p.x, p.y, '+' + money(amt, amt < 100), amt >= 100 ? 'big' : '');
    sfx.coin(amt >= 100);
  };
  let lostT = 0;
  peds.onLost = (s) => {
    if (performance.now() - lostT < 1500) return;
    lostT = performance.now();
    const p = world.toScreen(s.x, 10, s.z);
    if (p) ui.pop(p.x, p.y - 24, 'Line full, someone walked off', 'miss');
  };

  // ---------------------------------------------------------------- catch up on time away
  if (save) {
    const away = sim.catchUp((Date.now() - save.savedAt) / 1000);
    if (away && away.earned > 1) ui.away(away);
  } else {
    sim.log(`${sim.s.company} arrives in ${def.name} with ${money(sim.s.cash)} and a dream`, 'me');
    sim.log(`Welcome to ${def.area}. Nine companies already run this town.`, 'city');
  }
  sim.onChange();
  ui.refresh();

  // ---------------------------------------------------------------- tools + input
  let tool: Tool = 'select';
  let moving = -1;
  const setTool = (t: Tool) => {
    tool = t;
    ui.setTool(t);
    world.heat.visible = ui.heatOn || t === 'cart' || t === 'move';
    if (t !== 'cart' && t !== 'move' && t !== 'survey') props.setGhost(false);
  };
  ui.onTool = (t) => { if (t === 'move') moving = ui.selCart()?.id ?? -1; setTool(t); };
  ui.onSel = (s) => {
    world.setSelected(s?.k === 'bld' ? s.id : s?.k === 'shop' ? sim.shop(s.id)?.b ?? -1 : -1);
  };
  ui.onFly = (x, z) => world.flyTo(x, z, 180);
  ui.onSpeed = (s) => { speed = s; };
  ui.onHeat = (on) => { world.heat.visible = on || tool === 'cart'; };
  ui.onMute = (m) => sfx.setMuted(m);
  let speed = 1;

  const canvas = $('#gl');
  let down: { x: number; y: number; t: number } | null = null;
  let mouse = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; hover(); });
  canvas.addEventListener('pointerleave', () => { ui.tip(0, 0, null); world.setHover(-1); });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.button !== 0) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 6) return;
    click(e.clientX, e.clientY);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  let combo = 0, comboT = 0;
  function click(cx: number, cy: number) {
    const g = world.groundAt(cx, cy);
    const pk = world.pick(cx, cy);
    if (tool === 'cart' && g) {
      const c = sim.placeCart(g.x, g.z);
      if (c) { sfx.buy(); setTool('select'); ui.select({ k: 'cart', id: c.id }); }
      return;
    }
    if (tool === 'move' && g) {
      const c = sim.cart(moving);
      if (c && sim.moveCart(c, g.x, g.z)) { sfx.buy(); setTool('select'); ui.renderPanel(); }
      return;
    }
    if (tool === 'survey' && g) {
      const before = sim.s.stats.surveys;
      const found = sim.survey(g.x, g.z);
      if (sim.s.stats.surveys > before) { props.surveyPulse(g.x, g.z); sfx.ping(); if (found.length) setTimeout(() => sfx.found(), 700); ui.setTool('survey'); }
      return;
    }
    // select: carts first (they're small), then ore, quarries, buildings
    if (g) {
      const c = props.cartAt(g.x, g.z, 5);
      if (c) {
        if (c.rival < 0 && peds.rush('c:' + c.id)) {
          combo = performance.now() - comboT < 900 ? combo + 1 : 1;
          comboT = performance.now();
          if (combo >= 3) { const p = world.toScreen(c.x, 8, c.z); if (p) ui.pop(p.x, p.y - 26, `Rush x${combo}!`, 'big'); }
        }
        if (ui.sel?.k !== 'cart' || ui.sel.id !== c.id) ui.select({ k: 'cart', id: c.id });
        return;
      }
      const m = props.markerAt(g.x, g.z, 8);
      if (m >= 0) { ui.select({ k: 'dep', id: m }); sfx.click(); return; }
      const qid = props.quarryAt(g.x, g.z, 12);
      if (qid >= 0) { ui.select({ k: 'quarry', id: qid }); sfx.click(); return; }
    }
    if (pk.b) {
      // a shop door? open the shop, else the building
      const shops = sim.shopsIn(pk.b.id);
      if (shops.length === 1 && Math.hypot(pk.x - pk.b.door.x, pk.z - pk.b.door.z) < 6) ui.select({ k: 'shop', id: shops[0].id });
      else ui.select({ k: 'bld', id: pk.b.id });
      sfx.click();
      return;
    }
    ui.select(null);
  }

  function hover() {
    const { x: cx, y: cy } = mouse;
    if (tool === 'cart' || tool === 'move') {
      const g = world.groundAt(cx, cy);
      if (!g) return;
      const sp = sim.sidewalk(g.x, g.z);
      const clash = sim.s.carts.some((c) => c.id !== moving && Math.hypot(c.x - sp.x, c.z - sp.z) < 6);
      props.setGhost(true, sp.x, sp.z, sp.ok && !clash, 16);
      const foot = city.footAt(sp.x, sp.z);
      const rivals = sim.s.carts.filter((c) => c.rival >= 0 && Math.hypot(c.x - sp.x, c.z - sp.z) < 40).length;
      const mine = sim.s.carts.filter((c) => c.rival < 0 && c.id !== moving && Math.hypot(c.x - sp.x, c.z - sp.z) < 40).length;
      ui.tip(cx, cy, `<b>${foot} people / hour</b><div class="tg">${sim.streetAt(sp.x, sp.z)}</div>${rivals ? `<div style="color:var(--red)">${rivals} rival cart${rivals > 1 ? 's' : ''} nearby</div>` : ''}${mine ? `<div style="color:var(--gold2)">Your other cart is close: you'll split customers</div>` : ''}${!sp.ok || clash ? '<div style="color:var(--red)">Can\'t park here</div>' : ''}`);
      world.setHover(-1);
      return;
    }
    if (tool === 'survey') {
      const g = world.groundAt(cx, cy);
      if (g) { props.setGhost(true, g.x, g.z, true, 140, '#7ff0e0'); props.ghost.children.forEach((o) => (o.visible = o.name === 'range')); }
      ui.tip(cx, cy, `<b>Survey here</b><div class="tg">${money(SURVEY_COST(sim.s.stats.surveys))} · scans 140 m</div>`);
      return;
    }
    props.ghost.children.forEach((o) => (o.visible = true));
    if (ui.modalOpen) return;
    const g = world.groundAt(cx, cy);
    const c = g ? props.cartAt(g.x, g.z, 5) : null;
    if (c) {
      world.setHover(-1);
      canvas.style.cursor = 'pointer';
      const line = peds.lineLength('c:' + c.id);
      ui.tip(cx, cy, c.rival >= 0 ? `<b>${sim.s.rivals[c.rival].name}</b><div class="tg">Rival cart</div>` : `<b>${c.name}</b><div class="tg">${money(c.today)} today · ${line} in line${line ? ' · click to serve!' : ''}</div>`);
      return;
    }
    const pk = world.pick(cx, cy);
    if (pk.b) {
      world.setHover(pk.b.id);
      canvas.style.cursor = 'pointer';
      ui.tip(cx, cy, buildingTip(pk.b));
    } else {
      world.setHover(-1);
      canvas.style.cursor = '';
      ui.tip(0, 0, null);
    }
  }
  function buildingTip(b: Building): string {
    const own = sim.ownerOf(b.id);
    const f = sim.fac(b.id);
    const who = own === -1 ? '<span style="color:var(--gold2)">Yours</span>' : own >= 0 ? sim.s.rivals[own].name : sim.s.forSale.includes(b.id) ? '<span style="color:var(--green)">For sale</span>' : 'Private owner';
    const free = b.units - sim.shopsIn(b.id).length;
    return `<b>${f ? FAC_BY[f.type].name : b.name || b.addr}</b><div class="tg">${b.name || f ? b.addr + ' · ' : ''}${who}</div><div>${own === -1 ? `Worth ${money(b.value * sim.s.propVal)}` : `Price ${money(sim.buildingPrice(b))}`} · ${b.traffic} people/h</div>${!f && free > 0 ? `<div class="tg">${free} room${free > 1 ? 's' : ''} for rent</div>` : ''}`;
  }

  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.code;
    if (k === 'Escape') { if (ui.modalOpen) ui.closeModal(); else if (tool !== 'select') setTool('select'); else ui.select(null); return; }
    if (k === 'KeyC') ui.onTool(tool === 'cart' ? 'select' : 'cart');
    else if (k === 'KeyV') ui.onTool(tool === 'survey' ? 'select' : 'survey');
    else if (k === 'KeyX') ui.modalOpen ? ui.closeModal() : ui.modal('exchange');
    else if (k === 'KeyL') ui.modalOpen ? ui.closeModal() : ui.modal('ranks');
    else if (k === 'KeyT') ui.modalOpen ? ui.closeModal() : ui.modal('trucks');
    else if (k === 'KeyR' || k === 'KeyB') (document.querySelector(`[data-act="${k === 'KeyR' ? 'rent' : 'buyb'}"]`) as HTMLElement)?.click();
    else if (k === 'KeyH') (document.querySelector('[data-act="heat"]') as HTMLElement)?.click();
    else if (k === 'KeyM') (document.querySelector('[data-act="mute"]') as HTMLElement)?.click();
    else if (k === 'Space') { e.preventDefault(); speed = speed ? 0 : 1; ui.setSpeed(speed); }
    else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { speed = +k.slice(5); ui.setSpeed(speed); }
    else if (k === 'KeyE' && e.shiftKey) ui.modal('empire');
  });
  // E rotates the camera, so Empire also lives on the dock and Shift+E

  // ---------------------------------------------------------------- save
  const save_ = () => { try { const s = JSON.parse(sim.serialize()); s.nwCache = sim.netWorth(); localStorage.setItem(KEY(def.id), JSON.stringify(s)); } catch {} };
  setInterval(save_, 10000);
  addEventListener('visibilitychange', () => { if (document.hidden) save_(); });
  addEventListener('beforeunload', save_);

  // ---------------------------------------------------------------- frame loop
  let last = performance.now();
  let uiT = 0, pitchT = 0, paintT = 0;
  let lastDay = sim.day;
  step('Open for business', 1);
  setTimeout(() => loading.classList.add('done'), 150);
  if (!save) { world.flyTo(0, 0, 560); setTimeout(() => ui.onTool('cart'), 900); }
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const sp = ui.modalKind === 'month' || ui.modalKind === 'away' ? 0 : speed;
    sim.step(dt, sp);
    peds.update(dt, sp);
    props.update(dt, sp || 0.0001);
    world.setHour(sim.hour);
    world.update(dt);
    sfx.setBed(sim.crowdMul());
    uiT += dt; pitchT += dt; paintT += dt;
    if (uiT > 0.25) {
      uiT = 0;
      ui.refresh();
      // line badges over my own carts/shops when there's a line
      const items: { x: number; y: number; n: number; full: boolean }[] = [];
      for (const s of peds.sellers) {
        if (!s.mine || s.line.length < 2) continue;
        const p = world.toScreen(s.x, 6.5, s.z);
        if (p) items.push({ x: p.x, y: p.y, n: s.line.length, full: s.line.length >= s.cap });
      }
      ui.lines(items);
    }
    if (pitchT > 1) { pitchT = 0; peds.refreshPitch(); }
    if (paintT > 0.5) {
      paintT = 0;
      if (sim.s.facs.some((f) => f.build < 1)) paintBuildings();
      if (sim.s.facs.some((f) => f.build >= 1 && !props.gear.has(f.b))) { props.sync(); extraFoot(); }
    }
    if (sim.day !== lastDay) { lastDay = sim.day; peds.reweight(); ui.refresh(); save_(); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as any).__mogul = { sim, world, peds, props, ui, city, save: save_ };
  (window as any).__ready = true;
}

boot().catch((e) => {
  console.error(e);
  $('#loading .lerr').textContent = String(e?.stack || e);
  loading.classList.remove('done');
});
