// Pine & Dandy: the cartridge. Owns the loop, the input, the HUD, every window and the year's ending.
import { C, canvas, hash, bayer, mix } from './pal';
import { Sim, money, short, MW, MH, PS, PW, TOOL_SAW, TOOL_PLANT, TOOL_SHEAR, TOOL_TANK, F_DEAD, type Block, type Fx, type Ticket, type Report } from './sim.ts';
import { SPECIES, NZ, SIZE_MIN, SIZE_NAME, VEHICLES, CREW, BUILDINGS, BUILD_ORDER, TIERS, GOALS, LETTERS, MONTHS, PERKS, type Perk } from './data.ts';
import { Renderer, PLAYER_LOOK } from './render';
import { Chip } from './audio';
import { UI } from './ui';
import { Flyover } from './mode7';
import { text, bold, center, right, textW, wrap, LINE } from './font';
import { treeSprite, paintTree, buildingSprite, machine, person, icon } from './art';

const SAVE = 'pine.save.v1', PREF = 'pine.prefs';
const ZOOMS = [16, 8, 4, 2];
type Mode = 'title' | 'letter' | 'play' | 'fly' | 'report' | 'buck' | 'perk' | 'end';
type Win = null | 'shop' | 'build' | 'crew' | 'ledger' | 'market' | 'bank' | 'help' | 'pause';
type Act = 'drive' | 'block' | 'build' | 'land' | 'road';
interface Toast { t: string; c: string; life: number }
const CUT_OPTS = [0, 4, 5, 6, 7, 8, 9, 10, 12, 15];
const SAW_OPTS = [2.5, 4, 5, 6, 7, 8, 9, 10, 12, 15];

export class App {
  cv = document.getElementById('gl') as HTMLCanvasElement; g = this.cv.getContext('2d', { alpha: false })!;
  W = 480; H = 300; S = 4; crt = true;
  chip = new Chip(); ui = new UI(this.chip); sim = new Sim(); r = new Renderer(this.sim);
  mode: Mode = 'title'; win: Win = null; act: Act = 'drive'; buildKind = 'depot'; paused = false;
  keys = new Set<string>(); tapped = new Set<string>(); t = 0; last = 0; fade = 0; fadeTo: (() => void) | null = null;
  toasts: Toast[] = []; big: { t: string; s: string; c: string; life: number } | null = null;
  block: Block | null = null; drag0: { x: number; y: number } | null = null; pan: { x: number; y: number; cx: number; cy: number } | null = null;
  selTicket = -1; shownMoney = 0; alert: { x: number; y: number; t: number } | null = null;
  fly: Flyover | null = null; report: Report | null = null; perks: Perk[] = []; roll = 0; letterT = 0; scroll = 0; shopTab = 0; speedIdx = 0;
  title = canvas(1, 1); wheelAcc = 0; hasSave = false; sawFirstEve = false; landZoom = 0; goalFlash = 0;

  constructor() {
    this.resize(); addEventListener('resize', () => this.resize());
    addEventListener('beforeunload', () => { if (this.mode === 'play') this.save(); });
    const pos = (e: PointerEvent) => { const b = this.cv.getBoundingClientRect(); this.ui.mx = Math.floor((e.clientX - b.left) / b.width * this.W); this.ui.my = Math.floor((e.clientY - b.top) / b.height * this.H); };
    addEventListener('pointermove', pos);
    addEventListener('pointerdown', (e) => { pos(e); this.chip.start(); if (e.button === 0 && !e.ctrlKey) { this.ui.down = true; this.ui.pressed = true; } else { this.ui.rdown = true; const r = this.r; this.pan = { x: this.ui.mx, y: this.ui.my, cx: r.cx, cy: r.cy }; } });
    addEventListener('pointerup', (e) => { if (e.button === 0 && this.ui.down) { this.ui.down = false; this.ui.released = true; } this.ui.rdown = false; this.pan = null; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { e.preventDefault(); this.ui.wheel += e.deltaY; }, { passive: false });
    addEventListener('keydown', (e) => { if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); this.chip.start(); if (!e.repeat) this.tapped.add(e.code); this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.ui.down = false; });
    try { const p = JSON.parse(localStorage.getItem(PREF) ?? '{}'); this.crt = p.crt ?? true; if (p.mute) this.chip.toggle(); this.hasSave = !!localStorage.getItem(SAVE); } catch { /* private mode: just no saves */ }
    this.applyCrt(); this.buildTitle();
    this.chip.play('title');
    const q = new URLSearchParams(location.search);
    if (q.has('skip')) { this.sim.newGame(+(q.get('seed') ?? 7)); this.enterPlay(); }
    requestAnimationFrame((n) => this.frame(n));
  }
  resize() {
    const dpr = devicePixelRatio || 1, w = innerWidth * dpr, h = innerHeight * dpr;
    this.S = Math.max(1, Math.round(Math.min(h / 300, w / 480)));
    this.W = Math.ceil(w / this.S); this.H = Math.ceil(h / this.S);
    this.cv.width = this.W; this.cv.height = this.H; this.cv.style.width = this.W * this.S / dpr + 'px'; this.cv.style.height = this.H * this.S / dpr + 'px';
    this.g.imageSmoothingEnabled = false; this.r.W = this.W; this.r.H = this.H;
    const crt = document.getElementById('crt'); if (crt) crt.style.setProperty('--px', this.S / dpr + 'px');
    if (this.title.c.width > 1) this.buildTitle();
  }
  applyCrt() { document.getElementById('crt')?.classList.toggle('on', this.crt); }
  savePrefs() { try { localStorage.setItem(PREF, JSON.stringify({ crt: this.crt, mute: this.chip.muted })); } catch { /* */ } }
  save() { try { localStorage.setItem(SAVE, this.sim.serialize()); this.hasSave = true; } catch { /* quota: keep playing */ } }

  frame(n: number) {
    requestAnimationFrame((m) => this.frame(m));
    const dt = Math.min(0.05, (n - this.last) / 1000 || 0.016); this.last = n; this.t += dt;
    const { g, ui } = this; ui.begin(g, this.W, this.H); this.r.setG(g);
    switch (this.mode) {
      case 'title': this.drawTitle(dt); break;
      case 'letter': this.drawLetter(dt); break;
      case 'play': this.play(dt); break;
      case 'fly': this.drawFly(dt); break;
      case 'report': case 'buck': case 'perk': case 'end': this.drawYearEnd(dt); break;
    }
    this.drawFade(dt); ui.end(); this.tapped.clear();
  }
  drawFade(dt: number) {
    if (this.fade === 0 && !this.fadeTo) return;
    if (this.fadeTo) { this.fade = Math.min(1, this.fade + dt * 2.8); if (this.fade >= 1) { const f = this.fadeTo; this.fadeTo = null; f(); } } else this.fade = Math.max(0, this.fade - dt * 2.8);
    const { g, W, H } = this; g.fillStyle = C.ink;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (bayer(x >> 1, y >> 1) < this.fade) g.fillRect(x, y, 2, 2);
  }
  to(f: () => void) { if (!this.fadeTo) this.fadeTo = f; }
  tap(c: string) { return this.tapped.has(c); }

  // ---- title ------------------------------------------------------------------------------------------
  buildTitle() {
    const { W, H } = this, r = canvas(W, H), g = r.g; this.title = r;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x += 1) { const k = y / (H * 0.8) + (bayer(x, y) - 0.5) * 0.09, b = Math.floor(Math.min(0.999, k) * 5); g.fillStyle = ['#0e1230', '#161c44', '#20295c', '#2f3a76', '#4a4e8e'][b]; g.fillRect(x, y, 1, 1); }
    for (let i = 0; i < 110; i++) { g.fillStyle = i % 5 ? C.sky : C.white; g.fillRect(hash(i, 1) * W | 0, hash(i, 2) * H * 0.55 | 0, 1, 1); }
    const mx = W * 0.8, my = H * 0.2; g.fillStyle = C.lemon; g.beginPath(); g.arc(mx, my, 20, 0, 7); g.fill(); g.fillStyle = '#ecd67a'; g.fillRect(mx - 8, my - 6, 6, 4); g.fillRect(mx + 4, my + 5, 7, 4); g.fillRect(mx - 3, my + 9, 3, 3);
    const ridge = (base: number, amp: number, col: string, f: number) => { g.fillStyle = col; for (let x = 0; x < W; x++) { const h = base + Math.sin(x * f) * amp + Math.sin(x * f * 2.7 + 1) * amp * 0.4; g.fillRect(x, H - h, 1, h); } };
    ridge(H * 0.42, 16, '#2a3468', 0.011); ridge(H * 0.34, 12, '#384684', 0.019);
    for (let x = -8; x < W; x += 11) { const px = 24 + (hash(x, 3) * 14 | 0), base = H - H * 0.3 + Math.sin(x * 0.03) * 5; paintTree(g, x, base, { sp: 1, px, shape: 1, snow: 0.8, sway: 0, seed: x }); }
    ridge(H * 0.25, 5, '#cfe0ee', 0.014); ridge(H * 0.2, 4, '#e8f0f4', 0.01);
    const hs = buildingSprite('house', true, true), bs = buildingSprite('barn', true, true), gy = H - H * 0.2 - hs.height + 8;
    g.drawImage(hs, W * 0.03, gy); g.drawImage(bs, W * 0.03 + 86, gy + 2);
    g.globalCompositeOperation = 'lighter'; const gr = g.createRadialGradient(W * 0.03 + 40, gy + 56, 4, W * 0.03 + 40, gy + 56, 90); gr.addColorStop(0, 'rgba(244,197,66,.28)'); gr.addColorStop(1, 'rgba(244,197,66,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 9; i++) { const x = W * 0.56 + i * 26 + (hash(i, 4) * 8), base = H - 22 + hash(i, 7) * 14, px = 43 + (i % 3) * 8; paintTree(g, x, base, { sp: [3, 1, 4, 5][i % 4], px, shape: 2, snow: 1, sway: 0, seed: i + 3 }); for (let k = 0; k < 9; k++) { g.fillStyle = [C.red, C.gold, C.aqua, C.pink][k % 4]; const v = hash(i, k, 2); g.fillRect(x + (hash(i, k) - 0.5) * px * 0.5 * v, base - px * (1 - v * 0.9), 2, 2); } }
    for (let y = H - 22; y < H; y++) { g.globalAlpha = 0.3; g.fillStyle = '#e8f0f4'; g.fillRect(0, y, W, 1); g.globalAlpha = 1; }
    // logo
    const lw = Math.min(6, Math.floor(W / 66)), cx = W / 2, ly = Math.round(H * 0.11);
    const logo = (t: string, y: number, sc: number, top: string, low: string, sh: string) => {
      const w = textW(t, sc), x = Math.round(cx - w / 2);
      const fat = Math.max(1, Math.round(sc / 3)), body = (col: string, ox: number, oy: number, gg: CanvasRenderingContext2D = g) => { for (let k = 0; k <= fat; k++) { text(gg, t, ox + k, oy, col, sc); text(gg, t, ox + k, oy + 1, col, sc); } };
      for (let d = 1; d <= sc; d++) body(sh, x + (d >> 1), y + d + 1);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) body(C.ink, x + dx, y + dy);
      body(low, x, y);
      const tmp = canvas(w + 8, 9 * sc); body(top, 0, 0, tmp.g); g.drawImage(tmp.c, 0, 0, w + 8, Math.round(3 * sc), x, y, w + 8, Math.round(3 * sc));
    };
    logo('PINE &', ly, lw, C.lemon, C.gold, C.dred);
    logo('DANDY', ly + lw * 8 + 3, lw, C.white, C.pink, C.dred);
    center(g, 'A CHRISTMAS TREE FARM SIMULATOR', cx, ly + lw * 17 + 6, C.ice, 1, C.ink);
  }
  flakes = Array.from({ length: 90 }, (_, i) => ({ x: hash(i, 8), y: hash(i, 9), s: 0.5 + hash(i, 10) }));
  drawTitle(dt: number) {
    const { g, W, H, ui } = this; g.drawImage(this.title.c, 0, 0);
    for (const f of this.flakes) { f.y += dt * f.s * 0.09; f.x += Math.sin(this.t + f.s * 9) * dt * 0.012; if (f.y > 1) f.y -= 1; g.fillStyle = C.white; g.fillRect((f.x * W) | 0, (f.y * H) | 0, f.s > 1.1 ? 2 : 1, f.s > 1.1 ? 2 : 1); }
    const bw = 120, x = Math.round((W - bw) / 2 + 14); let y = Math.round(H * 0.6);
    if (this.hasSave) { if (ui.button(x, y, bw, 18, 'CONTINUE FARM', { primary: true }) || this.tap('Enter')) this.load(); y += 22; }
    if (ui.button(x, y, bw, 18, 'NEW FARM', { primary: !this.hasSave }) || (!this.hasSave && this.tap('Enter'))) this.newGame();
    y += 22;
    if (ui.button(x, y, bw, 14, 'HOW TO PLAY', {})) this.win = 'help';
    if (ui.button(4, H - 16, 72, 13, 'GAME PICKER', { dark: true })) location.href = 'index.html?pick';
    if (((this.t * 1.6) | 0) % 2 === 0 && !this.win) center(g, 'PRESS ENTER', x + bw / 2, y + 20, C.gold, 1, C.ink);
    if (this.win === 'help') this.helpWin();
  }
  newGame() { this.to(() => { this.sim.newGame(); this.mode = 'letter'; this.letterT = 0; this.chip.play('winter'); }); }
  load() {
    try { this.sim.deserialize(localStorage.getItem(SAVE)!); this.to(() => this.enterPlay()); } catch { this.hasSave = false; this.toast('That save would not load.', C.pink); }
  }
  enterPlay() { const p = this.sim.s.p; this.r.cx = p.x; this.r.cy = p.y; this.mode = 'play'; this.shownMoney = this.sim.s.money; this.pickMusic(); }
  pickMusic() { const m = this.sim.s.month; this.chip.play(m < 2 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : m < 10 ? 'fall' : m === 10 ? 'harvest' : 'rush'); }
  drawLetter(dt: number) {
    const { g, W, H, ui } = this; g.fillStyle = C.night; g.fillRect(0, 0, W, H);
    this.letterT += dt * 34; const w = 300, h = 170, x = (W - w) / 2, y = (H - h) / 2; ui.paper(x, y, w, h);
    const lines = ['Dear kiddo,', '', 'The farm is yours now. Barn, grove, the lot by the road,', 'all of it. The firs by the side road are ready to cut,', 'and folks will want them by Christmas.', '', 'Cut them. Haul them to the barn. Sell them. Plant more.', "Then do it again, bigger. Don't you sell to that Hemlock man.", '', 'Love, Mabel', '', 'P.S. Sing while you work. The trees like it.'];
    let left = this.letterT, yy = y + 10;
    for (const l of lines) { if (left <= 0) break; const n = Math.min(l.length, Math.floor(left)); text(g, l.slice(0, n), x + 12, yy, C.ink); left -= l.length; yy += LINE + 1; if (left > 0 && left < 2) this.chip.sfx('blip'); }
    if (this.letterT > 40) { if (ui.button(x + w - 92, y + h - 22, 84, 16, 'START FARMING', { primary: true }) || this.tap('Enter') || this.tap('Space')) this.to(() => this.enterPlay()); }
    else if (this.tap('Enter') || this.tap('Space') || ui.pressed) this.letterT = 999;
  }

  // ---- playing ----------------------------------------------------------------------------------------
  play(dt: number) {
    const { sim, r, ui } = this, s = sim.s;
    const open = !!this.win;
    if (s.phase === 'play' && !open && !this.paused) {
      let ix = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      let iy = (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) - (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0);
      let act = this.keys.has('Space');
      if (ix || iy) r.free = false;
      if (ui.down && !ui.over && this.act === 'drive' && this.pointerDrive) {
        const m = r.screenToTile(ui.mx, ui.my), dx = m.x - s.p.x, dy = m.y - s.p.y, d = Math.hypot(dx, dy);
        act = true; r.free = false; if (d > 0.6) { ix = dx / d; iy = dy / d; }
      }
      sim.step(dt, ix, iy, act);
    }
    if (!ui.down) this.pointerDrive = false;
    this.hotkeys();
    this.drainFx(dt);
    r.stepCars(open ? 0 : dt * sim.speed);
    if (ui.wheel) this.zoomWheel();
    if (this.pan) { const z = r.z; r.free = true; r.cx = this.pan.cx - (ui.mx - this.pan.x) / z; r.cy = this.pan.cy - (ui.my - this.pan.y) / z; }
    this.mapInput();
    const t = s.tickets.find((q) => q.id === this.selTicket); r.ticketHi = t ? { sp: t.sp, minZ: t.minZ } : null; r.focusBlock = this.block;
    r.draw(this.g, dt);
    this.goalMarker();
    this.hud(dt);
    if (this.win) this.drawWin();
    if (s.phase === 'eve' && !this.fadeTo) this.startEve();
  }
  pointerDrive = false;
  hotkeys() {
    const { sim, r } = this, s = sim.s;
    if (this.tap('Escape')) { if (this.win) this.win = null; else if (this.act !== 'drive') this.setAct('drive'); else if (this.block) this.block = null; else this.win = 'pause'; }
    if (this.tap('KeyM')) { this.chip.toggle(); this.savePrefs(); }
    if (this.win) return;
    const tool = (t: number) => { s.p.tool = t; this.setAct('drive'); this.chip.sfx('click'); };
    if (this.tap('Digit1')) tool(TOOL_SAW); if (this.tap('Digit2')) tool(TOOL_PLANT); if (this.tap('Digit3')) tool(TOOL_SHEAR); if (this.tap('Digit4')) tool(TOOL_TANK);
    if (this.tap('KeyB')) this.setAct(this.act === 'block' ? 'drive' : 'block');
    if (this.tap('KeyG')) this.win = 'build';
    if (this.tap('KeyL')) this.setAct(this.act === 'land' ? 'drive' : 'land');
    if (this.tap('KeyR')) this.win = 'shop'; if (this.tap('KeyC')) this.win = 'crew'; if (this.tap('KeyT')) this.win = 'ledger'; if (this.tap('KeyK')) this.win = 'market'; if (this.tap('KeyN')) this.win = 'bank';
    if (this.tap('KeyQ') || this.tap('Minus')) this.zoom(1); if (this.tap('KeyE') || this.tap('Equal')) this.zoom(-1);
    if (this.tap('Tab')) { r.overlay = (r.overlay + 1) % 3; this.toast(['Overlay off', 'Overlay: tree height', 'Overlay: species'][r.overlay], C.ice); }
    if (this.tap('KeyF')) this.cycleSpeed();
    if (this.tap('KeyP')) this.paused = !this.paused;
    if (this.tap('BracketLeft')) { if (s.p.tool === TOOL_SAW) this.cycleCut(-1); else this.cycleSpecies(-1); }
    if (this.tap('BracketRight')) { if (s.p.tool === TOOL_SAW) this.cycleCut(1); else this.cycleSpecies(1); }
  }
  cycleSpeed() { this.speedIdx = (this.speedIdx + 1) % 3; this.sim.speed = [1, 2.5, 5][this.speedIdx]; this.chip.sfx('click'); }
  cycleCut(d: number) { const p = this.sim.s.p, i = Math.max(0, SAW_OPTS.indexOf(p.cutAt)); p.cutAt = SAW_OPTS[Math.max(0, Math.min(SAW_OPTS.length - 1, i + d))]; this.chip.sfx('click'); }
  cycleSpecies(d: number) { const s = this.sim.s; let i = s.p.sel; for (let k = 0; k < SPECIES.length; k++) { i = (i + d + SPECIES.length) % SPECIES.length; if (s.unlocked[i]) break; } s.p.sel = i; this.chip.sfx('click'); }
  setAct(a: Act) {
    const r = this.r;
    if (this.act === 'land' && a !== 'land' && this.landZoom) { r.z = this.landZoom; this.landZoom = 0; r.free = false; }
    if (a === 'land') { this.landZoom = r.z; r.z = Math.min(r.z, 4); r.free = true; }
    r.landMode = a === 'land'; r.ghost = null; r.drag = null; this.act = a; this.drag0 = null;
  }
  zoom(d: number) { const r = this.r, i = ZOOMS.indexOf(r.z), n = Math.max(0, Math.min(ZOOMS.length - 1, i + d)); if (n !== i) { r.z = ZOOMS[n]; this.chip.sfx('blip'); } }
  zoomWheel() { this.wheelAcc += this.ui.wheel; if (Math.abs(this.wheelAcc) > 60) { this.zoom(this.wheelAcc > 0 ? 1 : -1); this.wheelAcc = 0; } }
  toast(t: string, c: string = C.cream) { this.toasts.push({ t, c, life: 4.5 }); if (this.toasts.length > 4) this.toasts.shift(); }

  mapInput() {
    const { ui, r, sim } = this, s = sim.s; if (this.win) return;
    const over = ui.over, m = r.screenToTile(ui.mx, ui.my), tx = Math.floor(m.x), ty = Math.floor(m.y);
    if (this.act === 'drive') { if (ui.pressed && !over) { this.pointerDrive = true; ui.pressed = false; } return; }
    if (this.ui.rdown && !this.pan) this.setAct('drive');
    if (this.act === 'block') {
      if (ui.pressed && !over) {
        const hit = s.blocks.find((b) => tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h);
        if (hit) { this.block = hit; this.setAct('drive'); ui.pressed = false; return; }
        this.drag0 = { x: tx, y: ty }; ui.pressed = false;
      }
      if (this.drag0) r.drag = { x0: this.drag0.x, y0: this.drag0.y, x1: Math.max(0, Math.min(MW - 1, tx)), y1: Math.max(0, Math.min(MH - 1, ty)) };
      if (ui.released && this.drag0 && r.drag) {
        const d = r.drag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0) + 1, h = Math.abs(d.y1 - d.y0) + 1;
        r.drag = null; this.drag0 = null;
        if (w * h >= 4) { this.block = sim.addBlock(x, y, w, h); this.chip.sfx('build'); this.setAct('drive'); } else this.toast('Drag out a bigger rectangle.');
      }
    } else if (this.act === 'build') {
      const k = this.buildKind, d = BUILDINGS[k], bx = tx - (d.w >> 1), by = ty - (d.h >> 1);
      r.ghost = { k, x: bx, y: by, ok: sim.canBuild(k, bx, by) };
      if (ui.pressed && !over) { ui.pressed = false; if (sim.build(k, bx, by)) { this.setAct('drive'); } }
    } else if (this.act === 'road') {
      r.ghost = { k: '', x: tx, y: ty, ok: sim.ownedAt(tx, ty) };
      if (ui.down && !over) sim.layRoad(tx, ty);
    } else if (this.act === 'land') {
      if (ui.pressed && !over) { ui.pressed = false; const px = Math.floor(tx / PS), py = Math.floor(ty / PS); if (sim.canBuyParcel(px, py) && sim.buyParcel(px, py)) { this.toast(`Parcel bought. ${sim.parcels} parcels now.`, C.gold); } }
    }
  }
  drainFx(dt: number) {
    const { r, chip, sim } = this; let cuts = 0;
    const visible = (x: number, y: number) => { const a = r.screenToTile(0, 0), b = r.screenToTile(this.W, this.H); return x >= a.x && y >= a.y && x <= b.x && y <= b.y; };
    for (const f of sim.fx as Fx[]) switch (f.k) {
      case 'chop': if (f.mine || visible(f.x, f.y)) { r.chop(f.x, f.y, f.sp, f.h, f.mine); if (cuts++ < 3) chip.sfx('chop'); chip.work(f.mine); } break;
      case 'plant': if (f.mine || visible(f.x, f.y)) { r.burst(f.x + 0.5, f.y + 0.7, 3, [C.bark, C.tan, C.lime], 2); chip.sfx('plant'); chip.work(f.mine); } break;
      case 'shear': if (f.mine || visible(f.x, f.y)) { r.burst(f.x + 0.5, f.y, 4, [C.lime, C.grass, C.leaf], 3); chip.sfx('shear'); chip.work(f.mine); } break;
      case 'spray': r.burst(f.x + 0.5, f.y + 0.3, 5, [C.sky, C.ice, C.white], 2); chip.sfx('spray'); break;
      case 'clear': r.burst(f.x + 0.5, f.y + 0.5, 5, [C.bark, C.brown, C.tan], 3); chip.sfx('chop'); break;
      case 'dead': break;
      case 'cash': r.float(f.x, f.y, '+' + money(f.n)); chip.sfx('cash'); break;
      case 'toast': this.toast(f.t, f.c === 'gold' ? C.gold : C.cream); break;
      case 'big': this.big = { t: f.t, s: f.s ?? '', c: f.c === 'red' ? C.red : f.c === 'ice' ? C.sky : C.gold, life: 2.6 }; chip.sfx('fanfare'); break;
      case 'unload': r.float(f.x, f.y - 1, `+${f.n} trees`, C.lime); chip.sfx('unload'); break;
      case 'cust': if (f.happy) { for (let i = 0; i < Math.min(2, f.n); i++) r.spawnFamily(); } break;
      case 'order': if (f.ok) { this.toast(`${f.t.buyer}: order filled. +${money(f.paid)}`, C.gold); chip.sfx('order'); r.shake = 2; this.bump = 1; const b = sim.nearestUnload(sim.s.p.x, sim.s.p.y); r.float(b.x + 2, b.y - 1, '+' + money(f.paid), C.gold, true); } else { this.toast(`${f.t.buyer} gave up. ${f.t.filled ? 'Half pay for ' + f.t.filled + '.' : ''}`, C.pink); chip.sfx('miss'); } if (this.selTicket === f.t.id) this.selTicket = -1; break;
      case 'newticket': chip.sfx('ticket'); break;
      case 'goal': this.toast(`STAMP: ${f.t}${f.cash ? '  +' + money(f.cash) : ''}`, C.lime); chip.sfx('goal'); this.goalFlash = 1; break;
      case 'alarm': this.toast(f.t, C.pink); chip.sfx('alarm'); r.ping(f.x, f.y); this.alert = { x: f.x, y: f.y, t: 12 }; break;
      case 'ram': r.float(f.x, f.y - 1, f.t, C.white, true); r.shake = 4; chip.sfx('ram'); break;
      case 'full': chip.sfx('full'); if (this.t - this.fullT > 1) { this.fullT = this.t; r.float(sim.s.p.x, sim.s.p.y - 2, 'FULL! BACK TO THE BARN', C.pink); } break;
      case 'month': chip.sfx('month'); this.pickMusic(); break;
      case 'season': break;
      case 'build': chip.sfx('build'); break; case 'buy': chip.sfx('buy'); break; case 'deny': chip.sfx('deny'); break;
      case 'saved': this.save(); break;
    }
    sim.fx.length = 0;
    for (const t of this.toasts) t.life -= dt; this.toasts = this.toasts.filter((t) => t.life > 0);
    if (this.big) { this.big.life -= dt; if (this.big.life <= 0) this.big = null; }
    if (this.alert) { this.alert.t -= dt; if (this.alert.t <= 0) this.alert = null; }
    this.bump = Math.max(0, this.bump - dt * 3); this.goalFlash = Math.max(0, this.goalFlash - dt * 1.5);
  }
  bump = 0; fullT = 0;

  goalMarker() {
    const { sim, r, g } = this, s = sim.s; let tx = -1, ty = -1;
    if (s.goal === 0 && s.p.x < 129) { tx = 131; ty = 69; }
    else if (s.goal === 1) { tx = 122.5; ty = 66; }
    if (tx < 0) return;
    const x = tx * r.z - r.camX(), y = ty * r.z - r.camY() + Math.sin(this.t * 6) * 3;
    g.fillStyle = C.ink; g.fillRect(x - 4, y - 13, 9, 7); g.fillRect(x - 6, y - 7, 13, 2); g.fillRect(x - 4, y - 5, 9, 2); g.fillRect(x - 2, y - 3, 5, 2);
    g.fillStyle = C.gold; g.fillRect(x - 3, y - 12, 7, 6); g.fillRect(x - 5, y - 6, 11, 1); g.fillRect(x - 3, y - 5, 7, 1); g.fillRect(x - 1, y - 4, 3, 1); g.fillRect(x, y - 3, 1, 1);
  }

  hud(dt: number) {
    const { g, W, H, ui, sim, r } = this, s = sim.s;
    // top bar: when it is, and how rich you are
    ui.bar(0, 0, W, 21);
    const season = ['WINTER', 'SPRING', 'SUMMER', 'FALL'][sim.season()], seasonCol = [C.ice, C.lime, C.gold, C.orange][sim.season()];
    bold(g, sim.dateText(), 6, 6, C.white); let x = 8 + textW(sim.dateText()) + 6;
    text(g, `${season}  YEAR ${s.year}`, x, 6, seasonCol); x += textW(`${season}  YEAR ${s.year}`) + 8;
    const paused = this.paused;
    if (ui.button(x, 3, 15, 14, '', { icon: paused ? 'play' : 'pause', dark: true, flat: true, sel: paused, tip: 'Pause (P)' })) this.paused = !paused; x += 16;
    if (ui.button(x, 3, 22, 14, ['1x', '2x', '5x'][this.speedIdx], { dark: true, flat: true, sel: this.speedIdx > 0, tip: 'Game speed (F)' })) this.cycleSpeed(); x += 26;
    // money rolls up like a cash register
    this.shownMoney += (s.money - this.shownMoney) * Math.min(1, dt * 9); if (Math.abs(s.money - this.shownMoney) < 1) this.shownMoney = s.money;
    const mtxt = money(this.shownMoney), mcol = s.money < 0 ? C.pink : C.gold;
    const mw = textW(mtxt, 2); text(g, mtxt, W - 6 - mw, 3, mcol, 2, C.ink); let rx = W - 14 - mw;
    const cap = sim.capacity, st = `${short(s.stockN)}/${short(cap)}`; right(g, st, rx, 6, s.stockN >= cap ? C.pink : C.cream); rx -= textW(st) + 14; g.drawImage(icon('tree'), rx, 4);
    const dx = sim.daysToXmas();
    if (dx >= 0) {
      const lbl = `${dx} DAY${dx === 1 ? '' : 'S'} TO XMAS`, cw = textW(lbl), cx = Math.min(rx - cw - 8, Math.max(x + 4, W / 2 - cw / 2));
      if (rx - x > cw + 16) text(g, lbl, cx, 6, ((this.t * 2) | 0) % 2 && dx < 6 ? C.pink : C.white);
    }
    this.tickets();
    this.goalLine();
    if (s.streak > 0 && (s.month >= 10)) {
      const lbl = `CHEER x${sim.cheer.toFixed(2)}`, cw = textW(lbl, 1), bx = W - 124 - cw;
      ui.rect(C.dred, bx - 6, 23, cw + 12, 13); ui.rect(this.bump > 0 ? C.gold : C.red, bx - 5, 24, cw + 10, 11); text(g, lbl, bx, 25, this.bump > 0 ? C.ink : C.white);
    }
    this.toolbar();
    // toasts sit just above the toolbar
    let ty = H - 44;
    for (let i = this.toasts.length - 1; i >= 0; i--) { const t = this.toasts[i], w = textW(t.t) + 8; g.globalAlpha = Math.min(1, t.life * 2); ui.rect('rgba(16,20,34,.86)', 4, ty, w, 12); text(g, t.t, 8, ty + 2, t.c); g.globalAlpha = 1; ty -= 13; }
    if (this.alert) { const a = this.alert; if (ui.button(W / 2 - 40, H - 58, 80, 14, 'SHOW ME', { primary: true })) { r.free = true; r.cx = a.x; r.cy = a.y; r.z = Math.min(r.z, 8); this.alert = null; } }
    if (this.big) {
      const b = this.big, a = Math.min(1, b.life * 2.5, (2.6 - b.life) * 8), w = Math.max(textW(b.t, 3), textW(b.s)) + 30, y = H * 0.27;
      g.globalAlpha = a; ui.rect(C.ink, W / 2 - w / 2 - 1, y - 1, w + 2, 46); ui.rect(b.c, W / 2 - w / 2, y, w, 2); ui.rect(b.c, W / 2 - w / 2, y + 41, w, 2); ui.rect(C.night, W / 2 - w / 2, y + 2, w, 39);
      center(g, b.t, W / 2, y + 6, C.white, 3, b.c); center(g, b.s, W / 2, y + 30, C.cream); g.globalAlpha = 1;
    }
    if (this.paused && !this.win) { center(g, 'PAUSED', W / 2, H * 0.4, C.white, 3, C.ink); }
    if (this.act === 'land') this.landHud();
    if (this.act === 'block') this.hint('Drag a rectangle to mark a block. Click a block to open it. Esc to cancel.');
    if (this.act === 'build') this.hint(`Click to build ${BUILDINGS[this.buildKind].name} (${money(BUILDINGS[this.buildKind].price)}). Esc to cancel.`);
    if (this.act === 'road') this.hint('Hold and drag to lay road ($6 a tile). Roads are faster and stop pests. Esc when done.');
    if (this.block) this.blockPanel(this.block);
  }
  hint(t: string) { const { ui, g, W } = this, w = textW(t) + 12; ui.rect('rgba(16,20,34,.9)', W / 2 - w / 2, 52, w, 13); center(g, t, W / 2, 54, C.lemon); }
  landHud() {
    const { ui, g, r, sim } = this; if (ui.over) { this.hint('Click a gold parcel to buy it. Esc when done.'); return; }
    const m = r.screenToTile(ui.mx, ui.my), px = Math.floor(m.x / PS), py = Math.floor(m.y / PS);
    if (!sim.canBuyParcel(px, py)) { this.hint('Click a gold parcel to buy it. Esc when done.'); return; }
    const c = sim.landPrice(px, py), soil = sim.parcelFert(px, py), clear = sim.parcelClear(px, py), w = 108, x = Math.min(this.W - w - 2, ui.mx + 8), y = Math.max(20, ui.my - 34);
    ui.rect(C.ink, x - 1, y - 1, w + 2, 34); ui.rect(C.deep, x, y, w, 32); bold(g, money(c), x + 4, y + 3, sim.s.money >= c ? C.gold : C.pink);
    text(g, `Soil ${soil > 1.12 ? 'rich' : soil > 0.94 ? 'fair' : 'poor'} ${Math.round(soil * 100)}%`, x + 4, y + 12, soil > 1.12 ? C.lime : soil > 0.94 ? C.cream : C.tan); text(g, `Plantable ${Math.round(clear * 100)}%`, x + 4, y + 21, C.cream);
  }
  goalLine() {
    const { g, ui, sim } = this, s = sim.s; if (s.goal >= GOALS.length) return;
    const go = GOALS[s.goal], v = sim.metric(go.check), n = go.n ?? 1;
    const prog = go.check === 'rank' ? `rank #${-v > 8 ? '-' : -v}` : go.check === 'veh' || go.check === 'year' || go.check === 'species' ? '' : `${short(Math.max(0, v))}/${short(n)}`;
    const line = `NEXT: ${go.text}`, w = Math.max(textW(line) + textW(prog) + 16, s.goal < 12 ? textW(go.hint) + 10 : 0), h = s.goal < 12 ? 24 : 13;
    ui.rect('rgba(16,20,34,.82)', 4, 24, w, h);
    if (this.goalFlash > 0) ui.rect(C.lime, 4, 24, w, 1);
    text(g, line, 8, 26, C.lemon); if (prog) right(g, prog, 4 + w - 4, 26, C.white);
    if (s.goal < 12) text(g, go.hint, 8, 37, C.ice);
  }
  tickets() {
    const { g, W, ui, sim, r } = this, s = sim.s; if (!s.tickets.length) return;
    const w = 112, h = 33, x = W - w - 4; let y = 24;
    const list = s.tickets.slice().sort((a, b) => a.days - b.days);
    for (const t of list.slice(0, 6)) {
      const hov = ui.inside(x, y, w, h), sel = this.selTicket === t.id, pri = s.priority === t.id; ui.block(x, y, w, h);
      ui.rect(t.hero ? C.gold : sel ? C.white : C.ink, x - 1, y - 1, w + 2, h + 2); ui.rect(hov ? C.pine : C.forest, x, y, w, h);
      if (t.sp >= 0) { const im = treeSprite(t.sp, 19, 2, 0, 0, 0, 0); g.drawImage(im, x + 11 - (im.width >> 1), y + 26 - im.height); }
      text(g, t.buyer, x + 22, y + 2, C.white);
      const left = t.qty - t.filled;
      text(g, `${left} ${t.sp >= 0 ? SPECIES[t.sp].short : 'Any'} ${SIZE_MIN[t.minZ]}ft+`, x + 22, y + 12, C.lime);
      text(g, money(t.pay * t.qty * sim.cheer), x + 22, y + 22, C.gold);
      const dcol = t.days <= 3 ? C.pink : C.cream; right(g, `${t.days}d`, x + w - 3, y + 22, ((this.t * 3) | 0) % 2 && t.days <= 3 ? C.white : dcol);
      ui.meter(x + 1, y + h - 2, w - 2, 1, t.filled / t.qty, C.lime);
      if (s.crew.length && ui.button(x + w - 25, y + 11, 23, 10, pri ? 'ON' : 'CREW', { dark: true, flat: true, sel: pri, tip: 'Send every free crew after this order' })) sim.setPriority(t.id);
      if (hov && ui.pressed) { ui.pressed = false; this.chip.sfx('click'); this.selTicket = sel ? -1 : t.id; if (!sel) this.jumpTo(t); }
      y += h + 3;
    }
    if (list.length > 6) right(g, `+${list.length - 6} more`, x + w, y, C.cream);
    void r;
  }
  jumpTo(t: Ticket) {
    const { sim, r } = this, p = sim.s.p; let bd = 1e9, bi = -1;
    for (let i = 0; i < sim.N; i++) { const q = sim.sp[i]; if (!q || sim.flag[i] & F_DEAD || !sim.ownedTile(i) || (t.sp >= 0 && q - 1 !== t.sp) || sim.h[i] < SIZE_MIN[t.minZ]) continue; const d = Math.hypot(i % MW - p.x, ((i / MW) | 0) - p.y); if (d < bd) { bd = d; bi = i; } }
    if (bi >= 0) { r.free = true; r.cx = bi % MW; r.cy = (bi / MW) | 0; } else this.toast("Nothing standing fits that order.", C.pink);
  }
  toolbar() {
    const { g, W, H, ui, sim } = this, s = sim.s, y = H - 31; ui.bar(0, y, W, 31);
    const tools = [['saw', 'Saw', '1'], ['plant', 'Planter', '2'], ['shear', 'Shears', '3'], ['tank', 'Tank', '4']];
    let x = 3;
    tools.forEach(([ic, nm, k], i) => {
      if (ui.button(x, y + 3, 24, 25, '', { icon: ic, dark: true, sel: s.p.tool === i && this.act === 'drive', tip: `${nm} (${k})`, key: k })) { s.p.tool = i; this.setAct('drive'); }
      x += 25;
    });
    // what the planter holds, or what you're hauling
    x += 3;
    const sp = SPECIES[s.p.sel];
    if (s.p.tool === TOOL_PLANT) {
      if (ui.button(x, y + 3, 11, 25, '<', { dark: true })) this.cycleSpecies(-1);
      const im = treeSprite(s.p.sel, 19, 2, 0, 0, 0, 0); g.drawImage(im, x + 19 - (im.width >> 1), y + 25 - im.height);
      text(g, sp.short, x + 29, y + 5, C.white); text(g, money(sim.seedPrice(s.p.sel)), x + 29, y + 16, C.gold);
      if (ui.button(x + 70, y + 3, 11, 25, '>', { dark: true })) this.cycleSpecies(1);
    } else if (s.p.tool === TOOL_SAW) {
      // the saw's height floor: what stops a 15-row machine eating next year's crop
      const cap = sim.hopCap();
      if (ui.button(x, y + 3, 11, 25, '<', { dark: true, tip: 'Cut shorter trees too ([)' })) this.cycleCut(-1);
      center(g, `${s.p.cutAt} ft+`, x + 41, y + 5, C.white); center(g, `${s.p.hop.n}/${cap}`, x + 41, y + 15, s.p.hop.n >= cap ? C.pink : C.cream);
      ui.meter(x + 14, y + 25, 54, 2, s.p.hop.n / cap, s.p.hop.n >= cap ? C.red : C.lime);
      if (ui.button(x + 70, y + 3, 11, 25, '>', { dark: true, tip: 'Only cut taller trees (])' })) this.cycleCut(1);
    } else {
      const cap = sim.hopCap(); text(g, VEHICLES[s.veh].name, x + 2, y + 5, C.white); text(g, `${s.p.hop.n}/${cap}`, x + 2, y + 16, s.p.hop.n >= cap ? C.pink : C.cream);
      ui.meter(x + 2, y + 26, 76, 2, s.p.hop.n / cap, s.p.hop.n >= cap ? C.red : C.lime);
    }
    x += 85;
    const btn = (ic: string, lbl: string, k: string, on: boolean, f: () => void) => { if (ui.button(x, y + 3, 24, 25, '', { icon: ic, dark: true, sel: on, tip: `${lbl} (${k})`, key: k })) f(); x += 25; };
    btn('block', 'Blocks', 'B', this.act === 'block', () => this.setAct(this.act === 'block' ? 'drive' : 'block'));
    btn('build', 'Build', 'G', this.act === 'build' || this.act === 'road', () => { this.win = 'build'; });
    btn('land', 'Land', 'L', this.act === 'land', () => this.setAct(this.act === 'land' ? 'drive' : 'land'));
    x += 4;
    btn('shop', 'Shop', 'R', false, () => { this.win = 'shop'; });
    btn('crew', 'Crew', 'C', false, () => { this.win = 'crew'; });
    btn('ledger', 'Ledger', 'T', false, () => { this.win = 'ledger'; });
    btn('market', 'Market', 'K', false, () => { this.win = 'market'; });
    btn('bank', 'Bank', 'N', false, () => { this.win = 'bank'; });
    // zoom stack on the far right
    const zx = W - 16;
    if (x + 14 < zx) { if (ui.button(zx, y + 3, 13, 12, '+', { dark: true, flat: true, tip: 'Zoom in (E)' })) this.zoom(-1); if (ui.button(zx, y + 16, 13, 12, '-', { dark: true, flat: true, tip: 'Zoom out (Q)' })) this.zoom(1); }
  }
  blockPanel(b: Block) {
    const { g, ui, sim } = this, s = sim.s, w = 132, h = 138, x = 6, y = 54;
    ui.paper(x, y, w, h); ui.rect(C.pine, x, y, w, 13); bold(g, b.name, x + 5, y + 3, C.white);
    if (ui.button(x + w - 14, y + 1, 12, 11, 'X', { dark: true, flat: true })) { this.block = null; return; }
    let n = 0, sum = 0, ready = 0, val = 0;
    for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) { const t = sim.idx(b.x + i, b.y + j); if (sim.sp[t] && !(sim.flag[t] & F_DEAD)) { n++; sum += sim.h[t]; if (b.cut && sim.h[t] >= b.cut) ready++; val += sim.treeValue(t); } }
    text(g, `${n} of ${b.w * b.h} planted`, x + 5, y + 16, C.ink); text(g, n ? `avg ${(sum / n).toFixed(1)} ft   worth ${money(val)}` : 'empty', x + 5, y + 26, C.bark);
    let yy = y + 38; const row = (lbl: string) => { text(g, lbl, x + 5, yy + 2, C.ink); };
    row('Plant');
    if (ui.button(x + 42, yy, 11, 12, '<', {})) { let i = b.sp; for (let k = 0; k < 8; k++) { i = (i - 1 + SPECIES.length) % SPECIES.length; if (s.unlocked[i]) break; } b.sp = i; b.passNext = 0; }
    center(g, SPECIES[b.sp].short, x + 80, yy + 2, C.dred);
    if (ui.button(x + 108, yy, 11, 12, '>', {})) { let i = b.sp; for (let k = 0; k < 8; k++) { i = (i + 1) % SPECIES.length; if (s.unlocked[i]) break; } b.sp = i; b.passNext = 0; }
    yy += 16; row('Cut at');
    const ci = Math.max(0, CUT_OPTS.indexOf(b.cut));
    if (ui.button(x + 42, yy, 11, 12, '<', {})) { b.cut = CUT_OPTS[(ci - 1 + CUT_OPTS.length) % CUT_OPTS.length]; b.passNext = 0; }
    center(g, b.cut ? `${b.cut} ft` : 'never', x + 80, yy + 2, C.dred);
    if (ui.button(x + 108, yy, 11, 12, '>', {})) { b.cut = CUT_OPTS[(ci + 1) % CUT_OPTS.length]; b.passNext = 0; }
    yy += 16;
    if (ui.button(x + 5, yy, 58, 13, b.replant ? 'Replant ON' : 'Replant off', { sel: b.replant })) b.replant = !b.replant;
    if (ui.button(x + 67, yy, 58, 13, b.shear ? 'Shear ON' : 'Shear off', { sel: b.shear })) b.shear = !b.shear;
    yy += 18;
    text(g, b.cut ? `${ready} ready to cut` : 'Crews leave these alone', x + 5, yy, C.bark); yy += 11;
    text(g, s.crew.length ? `${s.crew.length} crew on the job board` : 'No crew hired yet', x + 5, yy, s.crew.length ? C.bark : C.dred);
    if (ui.button(x + w - 36, y + h - 15, 32, 12, 'Delete', { tip: 'Trees stay; crews stop working here.' })) { s.blocks = s.blocks.filter((q) => q !== b); this.block = null; }
  }

  // ---- windows ----------------------------------------------------------------------------------------
  drawWin() {
    switch (this.win) {
      case 'shop': this.shopWin(); break; case 'build': this.buildWin(); break; case 'crew': this.crewWin(); break; case 'ledger': this.ledgerWin(); break;
      case 'market': this.marketWin(); break; case 'bank': this.bankWin(); break; case 'help': this.helpWin(); break; case 'pause': this.pauseWin(); break;
    }
  }
  shopWin() {
    const { g, ui, sim } = this, s = sim.s, w = 340, h = 216, { x, y, closed } = ui.window(w, h, 'MACHINE SHED'); if (closed) this.win = null;
    let yy = y + 20;
    VEHICLES.forEach((v, i) => {
      if (i === 0) return;
      const own = s.veh >= i, can = sim.tier >= v.tier && i === s.veh + 1;
      ui.rect(own ? '#dcd8a6' : '#e8d9ae', x + 6, yy, w - 12, 44); ui.rect(C.tan, x + 6, yy + 43, w - 12, 1);
      const im = machine(i, 1, 0, ['', C.blue, C.red, C.leaf, C.orange][i], 3), sc = i >= 3 ? 0.62 : 1; g.drawImage(im, x + 34 - im.width * sc / 2, yy + 40 - im.height * sc, im.width * sc, im.height * sc);
      bold(g, v.name, x + 70, yy + 4, C.ink); text(g, v.blurb, x + 70, yy + 15, C.bark); text(g, `${v.w} rows wide  ${v.speed} mph  carries ${v.cap}`, x + 70, yy + 27, C.brown);
      if (own) { right(g, s.veh === i ? 'DRIVING' : 'OWNED', x + w - 12, yy + 16, C.pine); }
      else if (sim.tier < v.tier) { right(g, 'needs', x + w - 12, yy + 10, C.brown); right(g, TIERS[v.tier].name, x + w - 12, yy + 21, C.brown); }
      else { if (ui.button(x + w - 80, yy + 9, 68, 16, money(v.price), { primary: can && s.money >= v.price, disabled: !can || s.money < v.price })) { if (sim.buyVehicle(i)) { this.r.z = Math.min(this.r.z, VEHICLES[i].zoom); this.win = null; } } }
      yy += 47;
    });
  }
  buildWin() {
    const { g, ui, sim } = this, s = sim.s, w = 380, h = 232, { x, y, closed } = ui.window(w, h, 'BUILD'); if (closed) this.win = null;
    const cols = 2, cw = (w - 16) / cols, rh = 32; let i = 0;
    for (const k of [...BUILD_ORDER, '_road']) {
      const cx = x + 6 + (i % cols) * (cw + 4), cy = y + 20 + Math.floor(i / cols) * (rh + 2); i++;
      if (k === '_road') {
        if (ui.button(cx, cy, cw, rh, '', { disabled: false })) { this.win = null; this.setAct('road'); }
        bold(g, 'Farm Road', cx + 44, cy + 4, C.ink); text(g, 'Faster driving, stops pests.', cx + 44, cy + 14, C.bark); text(g, '$6 a tile', cx + 44, cy + 23, C.dred); continue;
      }
      const d = BUILDINGS[k], locked = sim.tier < d.tier, poor = s.money < d.price;
      if (ui.button(cx, cy, cw, rh, '', { disabled: locked || poor })) { this.buildKind = k; this.setAct('build'); this.win = null; }
      const im = buildingSprite(k, false, false), sc = Math.min(1, 30 / im.width, 28 / im.height); g.drawImage(im, cx + 21 - im.width * sc / 2, cy + rh - 2 - im.height * sc, im.width * sc, im.height * sc);
      bold(g, d.name, cx + 44, cy + 4, locked ? C.brown : C.ink); text(g, locked ? `Needs ${TIERS[d.tier].name}` : d.blurb, cx + 44, cy + 14, C.bark); text(g, `${money(d.price)}   have ${sim.bcount(k)}`, cx + 44, cy + 23, poor ? C.red : C.dred);
    }
  }
  crewWin() {
    const { g, ui, sim } = this, s = sim.s, w = 372, h = 232, { x, y, closed } = ui.window(w, h, `CREW  (${s.crew.length})`); if (closed) this.win = null;
    const wages = s.crew.reduce((a, c) => a + sim.wage(c), 0); right(g, `${money(wages)} a month`, x + w - 20, y + 3, C.white);
    let yy = y + 20; const bw = (w - 18) / 4;
    CREW.forEach((c, i) => {
      const bx = x + 6 + i * (bw + 2), locked = sim.tier < c.tier;
      if (ui.button(bx, yy, bw, 36, '', { disabled: locked || s.money < c.hire })) sim.hire(i);
      center(g, c.name, bx + bw / 2, yy + 3, locked ? C.brown : C.ink); center(g, locked ? 'locked' : `Hire ${money(c.hire)}`, bx + bw / 2, yy + 13, C.dred); center(g, `${money(c.wage)} a month`, bx + bw / 2, yy + 23, C.bark);
    });
    yy += 42;
    if (!s.crew.length) { text(g, 'Nobody hired yet. Crews work your BLOCKS: draw a block (press B), set', x + 10, yy + 8, C.bark); text(g, 'what to plant and when to cut, and they take the jobs by themselves.', x + 10, yy + 19, C.bark); return; }
    text(g, 'Name', x + 10, yy, C.brown); text(g, 'Rank', x + 66, yy, C.brown); text(g, 'Doing', x + 150, yy, C.brown); yy += 11;
    const rows = 12, max = Math.max(0, s.crew.length - rows); if (ui.wheel) { this.scroll = Math.max(0, Math.min(max, this.scroll + Math.sign(ui.wheel))); ui.wheel = 0; } this.scroll = Math.min(this.scroll, max);
    for (const a of s.crew.slice(this.scroll, this.scroll + rows)) {
      const doing = a.mode === 'unload' ? 'hauling to barn' : a.strip ? { cut: 'cutting', plant: 'planting', shear: 'shearing' }[a.strip.job] : a.mode === 'goal' ? (a.gk === 1 ? 'spraying pests' : a.gk === 2 ? 'on your order' : 'heading in') : 'waiting for work';
      text(g, a.name, x + 10, yy, C.ink); text(g, CREW[a.rank].name, x + 66, yy, C.bark); text(g, doing, x + 150, yy, doing === 'waiting for work' ? C.brown : C.pine);
      const nx = CREW[a.rank + 1];
      if (nx && sim.tier >= nx.tier && ui.button(x + w - 84, yy - 1, 50, 10, `Up ${short(nx.hire)}`, { flat: true, disabled: s.money < nx.hire })) sim.promote(a.id);
      if (ui.button(x + w - 32, yy - 1, 24, 10, 'Fire', { flat: true })) sim.fire(a.id);
      yy += 11;
    }
    if (max) right(g, `scroll for ${s.crew.length - rows} more`, x + w - 8, y + h - 11, C.brown);
  }
  ledgerWin() {
    const { g, ui, sim } = this, s = sim.s, w = 400, h = 244, { x, y, closed } = ui.window(w, h, 'THE LEDGER'); if (closed) this.win = null;
    const Y = s.yr, left = (l: string, v: string, yy: number, c: string = C.ink) => { text(g, l, x + 8, yy, C.bark); right(g, v, x + 148, yy, c); };
    let yy = y + 20; bold(g, `Year ${s.year} so far`, x + 8, yy, C.dred); yy += 12;
    left('Trees sold', short(Y.sold), yy); yy += 10; left('Walk-ins', money(Y.retail), yy); yy += 10; left('Orders', money(Y.orders), yy); yy += 10; left('Wholesale', money(Y.wholesale), yy); yy += 10;
    left('Wages', money(-Y.wages), yy, C.dred); yy += 10; left('Seedlings', money(-Y.seeds), yy, C.dred); yy += 10; left('Land + build', money(-Y.bills), yy, C.dred); yy += 14;
    left('Standing trees', short(sim.standing), yy); yy += 10; left('Parcels owned', String(sim.parcels), yy); yy += 10; left('Standing', TIERS[sim.tier].name, yy, C.pine); yy += 10;
    const nt = TIERS[sim.tier + 1]; if (nt) { left('Next rank at', `${short(nt.sold)} sold`, yy); yy += 9; ui.meter(x + 8, yy + 1, 140, 3, s.lifeSold / nt.sold, C.leaf, C.tan); yy += 8; }
    // revenue by year, the shape of the whole game
    const hist = s.history.slice(-14), gx = x + 8, gy = y + h - 40, gw = 140, gh = 32;
    if (hist.length > 1) { const mx = Math.max(...hist.map((q) => q.revenue), 1), bw = Math.floor(gw / hist.length); hist.forEach((q, i) => { const bh = Math.max(1, q.revenue / mx * gh); ui.rect(i === hist.length - 1 ? C.red : C.leaf, gx + i * bw, gy + gh - bh, bw - 1, bh); }); text(g, `Revenue, best ${money(mx)}`, gx, gy + gh + 2, C.brown); }
    // blocks
    const bx = x + 158, cols = [0, 48, 94, 124, 158];
    bold(g, 'Blocks', bx, y + 20, C.dred);
    ['', 'Species', 'Trees', 'Ready', 'Worth'].forEach((t, i) => text(g, t, bx + cols[i], y + 32, C.brown));
    if (!s.blocks.length) { text(g, 'No blocks yet. Press B and drag', bx, y + 46, C.bark); text(g, 'across a field to give crews work.', bx, y + 57, C.bark); return; }
    const rows = 17, max = Math.max(0, s.blocks.length - rows); if (ui.wheel) { this.scroll = Math.max(0, Math.min(max, this.scroll + Math.sign(ui.wheel))); ui.wheel = 0; } this.scroll = Math.min(this.scroll, max);
    let ry = y + 43;
    for (const b of s.blocks.slice(this.scroll, this.scroll + rows)) {
      let n = 0, ready = 0, val = 0;
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) { const t = sim.idx(b.x + i, b.y + j); if (sim.sp[t] && !(sim.flag[t] & F_DEAD)) { n++; if (b.cut && sim.h[t] >= b.cut) ready++; val += sim.treeValue(t); } }
      if (ui.inside(bx - 2, ry - 1, w - 164, 11)) { ui.rect(C.white, bx - 2, ry - 1, w - 164, 11); if (ui.pressed) { ui.pressed = false; this.block = b; this.win = null; this.r.cx = b.x + b.w / 2; this.r.cy = b.y + b.h / 2; this.r.free = true; this.chip.sfx('click'); } }
      text(g, b.name, bx, ry, C.ink); text(g, SPECIES[b.sp].short, bx + cols[1], ry, C.bark); text(g, short(n), bx + cols[2], ry, C.ink); text(g, short(ready), bx + cols[3], ry, ready ? C.pine : C.brown); text(g, money(val), bx + cols[4], ry, C.dred);
      ry += 11;
    }
  }
  marketWin() {
    const { g, ui, sim } = this, s = sim.s, w = 392, h = 236, { x, y, closed } = ui.window(w, h, 'MARKET AND SEED CATALOG'); if (closed) this.win = null;
    const c = [28, 100, 150, 190, 300];
    ['Species', 'Classic', 'Grows', 'Next 4 years', 'Standing'].forEach((t, i) => text(g, t, x + c[i], y + 19, C.brown));
    let yy = y + 30;
    SPECIES.forEach((S, i) => {
      const un = s.unlocked[i], im = treeSprite(i, 19, 2, 0, 0, 0, 0); g.drawImage(im, x + 15 - (im.width >> 1), yy + 21 - im.height);
      bold(g, S.short, x + c[0], yy + 2, C.ink); text(g, `${Math.round(7 / S.rate * 10) / 10} yrs`, x + c[2], yy + 2, C.bark); text(g, S.blurb, x + c[0], yy + 12, C.brown);
      if (un) {
        const m = sim.market(i); text(g, money(sim.priceOf(i, 2, 70)), x + c[1], yy + 2, m > 1.15 ? C.pine : m < 0.85 ? C.red : C.ink);
        for (let k = 0; k < 4; k++) { const v = sim.forecast(i, k + 1); text(g, `${Math.round(v * 100)}`, x + c[3] + k * 24, yy + 2, v > 1.15 ? C.pine : v < 0.85 ? C.red : C.bark); }
        let n = 0; for (let z = 0; z < NZ; z++) n += sim.census[i * NZ + z]; right(g, short(n), x + w - 40, yy + 2, C.ink);
      } else if (sim.tier < S.tier) { text(g, `Needs ${TIERS[S.tier].name}`, x + c[3], yy + 2, C.brown); }
      else if (ui.button(x + c[3], yy - 1, 96, 12, `Unlock ${money(S.unlock)}`, { primary: s.money >= S.unlock, disabled: s.money < S.unlock })) sim.unlockSpecies(i);
      yy += 25;
    });
    const can = (s.month >= 10) && s.stockN > 0, by = y + h - 18;
    if (ui.button(x + 6, by, 170, 14, `Sell barn stock wholesale (${short(s.stockN)})`, { disabled: !can, tip: 'Pays about half of retail, less the more you dump.' })) sim.sellSurplus(1);
    text(g, s.month >= 10 ? `Wholesale pays ${Math.round(sim.wholesaleRate() * 100)}% today` : 'Wholesale opens in November', x + 184, by + 3, C.bark);
  }
  bankWin() {
    const { g, ui, sim } = this, s = sim.s, w = 260, h = 136, { x, y, closed } = ui.window(w, h, 'COUNTY SAVINGS BANK'); if (closed) this.win = null;
    let yy = y + 22; const room = Math.max(0, sim.loanLimit() - s.debt);
    text(g, 'Owed', x + 12, yy, C.bark); right(g, money(s.debt), x + w - 12, yy, C.dred); yy += 12; text(g, 'They will lend you', x + 12, yy, C.bark); right(g, money(room), x + w - 12, yy, C.pine); yy += 12; text(g, 'Interest, paid each January', x + 12, yy, C.bark); right(g, '8%', x + w - 12, yy, C.ink); yy += 18;
    const step = Math.max(500, Math.round(sim.loanLimit() / 8 / 500) * 500);
    if (ui.button(x + 12, yy, 112, 16, `Borrow ${money(step)}`, { disabled: room <= 0 })) sim.borrow(step);
    if (ui.button(x + w - 124, yy, 112, 16, `Repay ${money(step)}`, { disabled: s.debt <= 0 || s.money <= 0 })) sim.repay(step);
    yy += 20; if (ui.button(x + w - 124, yy, 112, 14, 'Repay it all', { disabled: s.debt <= 0 || s.money < s.debt })) sim.repay(s.debt);
    text(g, 'Trees take years.', x + 12, yy + 3, C.brown);
  }
  helpWin() {
    const { g, ui } = this, w = 340, h = 232, { x, y, closed } = ui.window(w, h, 'HOW TO FARM'); if (closed) this.win = this.mode === 'title' ? null : 'pause';
    const L: [string, string][] = [['WASD / arrows', 'Drive'], ['SPACE or hold mouse', 'Work (mouse also drives)'], ['1 2 3 4', 'Saw, Planter, Shears, Tank'], ['[ ]', 'Saw height, or seedling species'], ['B', 'Draw a block for crews'], ['G  L  R', 'Build, Land, Shop'], ['C  T  K  N', 'Crew, Ledger, Market, Bank'], ['Q  E or wheel', 'Zoom out and in'], ['Right drag', 'Look around'], ['TAB', 'Height and species overlays'], ['F  P', 'Game speed, pause'], ['M', 'Sound on or off']];
    let yy = y + 21; for (const [a, b] of L) { bold(g, a, x + 12, yy, C.dred); text(g, b, x + 126, yy, C.ink); yy += 11; }
    yy += 4; for (const l of ['Spring: plant. Summer: shear. Mid October on: cut.', 'The lot opens late November. Fill orders on time to build Cheer.', 'Keep species mixed: pests race through one big field.', 'Unsold trees go to the wholesaler for peanuts at Christmas.']) { text(g, l, x + 12, yy, C.bark); yy += 10; }
  }
  pauseWin() {
    const { ui, g } = this, w = 170, h = 128, { x, y, closed } = ui.window(w, h, 'PAUSED'); if (closed) this.win = null;
    let yy = y + 22; const b = (t: string) => { const r = ui.button(x + 14, yy, w - 28, 15, t, {}); yy += 18; return r; };
    if (b('Back to the farm')) this.win = null; if (b('How to farm')) this.win = 'help';
    if (b(this.chip.muted ? 'Sound: OFF' : 'Sound: ON')) { this.chip.toggle(); this.savePrefs(); }
    if (b(this.crt ? 'CRT filter: ON' : 'CRT filter: OFF')) { this.crt = !this.crt; this.applyCrt(); this.savePrefs(); }
    if (b('Save and quit')) { this.save(); this.win = null; this.to(() => { this.mode = 'title'; this.chip.play('title'); }); }
    void g;
  }

  // ---- christmas eve and the year-end books -----------------------------------------------------------
  startEve() {
    this.selTicket = -1; this.block = null; this.setAct('drive');
    this.to(() => { this.fly = new Flyover(this.r.farmImage().c, this.sim); this.mode = 'fly'; this.chip.play('eve'); this.flyT = 0; });
  }
  flyT = 0;
  drawFly(dt: number) {
    const { g, W, H, sim, ui } = this; this.fly!.draw(g, W, H, dt); this.flyT += dt;
    const a = Math.min(1, this.flyT / 1.5);
    g.globalAlpha = a; center(g, `CHRISTMAS EVE, YEAR ${sim.s.year}`, W / 2, H * 0.08, C.white, 2, C.ink);
    center(g, `${sim.standing.toLocaleString('en-US')} trees still growing. ${sim.s.yr.sold.toLocaleString('en-US')} in living rooms tonight.`, W / 2, H * 0.08 + 22, C.lemon, 1, C.ink); g.globalAlpha = 1;
    if (this.flyT > 1.2 && ((this.t * 1.6) | 0) % 2 === 0) center(g, 'CLICK TO OPEN THE BOOKS', W / 2, H - 16, C.ice, 1, C.ink);
    if ((this.flyT > 1.2 && (ui.pressed || this.tap('Enter') || this.tap('Space'))) || this.flyT > 26) { ui.pressed = false; this.to(() => { this.report = this.sim.makeReport(); this.roll = 0; this.mode = 'report'; this.chip.play('winter'); this.fly = null; }); }
  }
  drawYearEnd(dt: number) {
    const { g, W, H } = this; g.fillStyle = C.night; g.fillRect(0, 0, W, H);
    for (const f of this.flakes) { f.y += dt * f.s * 0.05; if (f.y > 1) f.y -= 1; g.fillStyle = C.dusk; g.fillRect((f.x * W) | 0, (f.y * H) | 0, 2, 2); }
    if (this.mode === 'report') this.reportWin(dt); else if (this.mode === 'buck') this.buckWin(); else if (this.mode === 'perk') this.perkWin();
  }
  reportWin(dt: number) {
    const { g, ui } = this, R = this.report!, Y = R.y, w = 400, h = 244, x = Math.round((this.W - w) / 2), y = Math.round((this.H - h) / 2);
    this.roll = Math.min(1, this.roll + dt * 0.7); const k = 1 - Math.pow(1 - this.roll, 3); if (this.roll < 1 && Math.random() < 0.4) this.chip.sfx('blip');
    ui.paper(x, y, w, h); ui.rect(C.pine, x, y, w, 18); bold(g, `YEAR ${R.year}: THE BOOKS`, x + 8, y + 5, C.white, 1, C.forest);
    right(g, R.tierUp ? `NOW A ${R.tierUp.toUpperCase()}!` : TIERS[this.sim.tier].name, x + w - 8, y + 5, C.lemon);
    let yy = y + 26; const line = (l: string, v: number, c: string = C.ink, isN = false) => { text(g, l, x + 12, yy, C.bark); right(g, isN ? Math.round(v * k).toLocaleString('en-US') : money(v * k), x + 186, yy, c); yy += 11; };
    line('Trees sold', Y.sold, C.ink, true); yy += 3; line('Walk-in sales', Y.retail); line(`Orders (${Y.ordersN} of ${Y.ordersN + Y.missed})`, Y.orders); line('Wholesale', Y.wholesale); line('Bonuses', Y.bonus); ui.rect(C.tan, x + 12, yy, 174, 1); yy += 3; line('Revenue', Y.revenue, C.pine); yy += 3; line('Wages', -Y.wages, C.dred); line('Seedlings', -Y.seeds, C.dred); line('Land, buildings, gear', -Y.bills, C.dred); yy += 3;
    bold(g, 'Cash in hand', x + 12, yy, C.ink); right(g, money(R.net * k), x + 186, yy, R.net >= 0 ? C.pine : C.red); yy += 14;
    text(g, `Best Cheer streak ${Y.bestStreak}`, x + 12, yy, C.bark); yy += 11; if (Y.lostSales) { text(g, `${Y.lostSales.toLocaleString('en-US')} families left with no tree`, x + 12, yy, C.dred); yy += 11; } if (Y.lost) text(g, `${Y.lost} trees lost to pests, deer and drought`, x + 12, yy, C.dred);
    const rx = x + 204, rw = w - 214; let ry = y + 26; bold(g, 'Top tree farms this year', rx, ry, C.dred); ry += 14;
    R.rivals.forEach((f, i) => { if (f.me) ui.rect(C.gold, rx - 3, ry - 2, rw + 6, 12); text(g, `${i + 1}.`, rx, ry, C.ink); text(g, f.name, rx + 14, ry, f.me ? C.ink : C.bark); right(g, f.sold.toLocaleString('en-US'), rx + rw, ry, C.ink); ry += 13; });
    ry += 8; const hist = this.sim.s.history.slice(-12), mx = Math.max(...hist.map((q) => q.sold), 1), bw = Math.floor(rw / Math.max(6, hist.length));
    hist.forEach((q, i) => { const bh = Math.max(1, q.sold / mx * 44 * k); ui.rect(i === hist.length - 1 ? C.red : C.leaf, rx + i * bw, ry + 46 - bh, bw - 1, bh); }); text(g, 'Trees sold by year', rx, ry + 49, C.brown);
    if (ui.button(x + w - 104, y + h - 22, 96, 16, 'NEXT', { primary: true }) || this.tap('Enter')) {
      if (this.roll < 1) { this.roll = 1; return; }
      if (R.letter) this.mode = 'buck'; else this.toPerks();
    }
  }
  buckWin() {
    const { g, ui, W, H } = this, L = LETTERS[this.report!.letter], w = 280, h = 120, x = (W - w) / 2, y = (H - h) / 2;
    ui.paper(x, y, w, h); ui.rect(C.ink, x, y, w, 15); bold(g, 'MEGAPINE CORP.  OFFICE OF THE PRESIDENT', x + 8, y + 4, C.lgrey);
    let yy = y + 24; for (const l of L) { text(g, l, x + 14, yy, C.ink); yy += 11; }
    if (ui.button(x + w - 84, y + h - 20, 76, 15, 'BIN IT', { primary: true }) || this.tap('Enter')) this.toPerks();
  }
  toPerks() { this.perks = this.sim.perkChoices(); this.mode = 'perk'; }
  perkWin() {
    const { g, ui, W, H, sim } = this, cw = 132, gap = 8, tw = cw * 3 + gap * 2, x0 = (W - tw) / 2, y = H / 2 - 70;
    center(g, "MABEL'S ALMANAC", W / 2, y - 34, C.gold, 2, C.ink); center(g, `Pick one page for Year ${sim.s.year + 1}. They stack.`, W / 2, y - 12, C.cream);
    this.perks.forEach((p, i) => {
      const x = x0 + i * (cw + gap), hov = ui.inside(x, y, cw, 96); ui.paper(x, y + (hov ? -2 : 0), cw, 96);
      const yy = y + (hov ? -2 : 0), lvl = sim.pk(p.id); ui.rect(hov ? C.red : C.pine, x, yy, cw, 16); center(g, p.name, x + cw / 2, yy + 4, C.white);
      g.drawImage(icon(['tree', 'star', 'bell'][i]), x + cw / 2 - 6, yy + 24);
      let ly = yy + 44; for (const l of wrap(p.text, cw - 16)) { center(g, l, x + cw / 2, ly, C.ink); ly += 11; }
      if (lvl) center(g, `You have ${lvl}`, x + cw / 2, yy + 72, C.brown);
      if (hov && ui.pressed) { ui.pressed = false; this.chip.sfx('goal'); this.to(() => { sim.startNewYear(p.id); this.mode = 'play'; this.shownMoney = sim.s.money; this.pickMusic(); this.save(); }); }
      center(g, String(i + 1), x + cw / 2, yy + 84, C.brown); if (this.tap('Digit' + (i + 1))) { this.chip.sfx('goal'); this.to(() => { sim.startNewYear(p.id); this.mode = 'play'; this.shownMoney = sim.s.money; this.pickMusic(); this.save(); }); }
    });
  }
}
void MONTHS; void SIZE_NAME; void PERKS; void PW; void mix; void person; void PLAYER_LOOK;
