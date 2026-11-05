// Pine & Dandy: the cartridge. Owns the loop, the input, the HUD, every window and the year's ending.
import { C, canvas, hash, bayer, mix, Buf } from './pal';
import { Sim, money, short, MW, MH, PS, PW, TOOL_SAW, TOOL_PLANT, TOOL_SHEAR, TOOL_TANK, F_DEAD, type Block, type Fx, type Ticket, type Report } from './sim.ts';
import { SPECIES, NZ, SIZE_MIN, SIZE_NAME, VEHICLES, CREW, BUILDINGS, BUILD_ORDER, TIERS, GOALS, LETTERS, MONTHS, PERKS, ORNAMENTS, JOLLY_SECS, COMBO_TIERS, type Perk } from './data.ts';
import { Renderer, PLAYER_LOOK } from './render';
import { Chip } from './audio';
import { UI } from './ui';
import { Flyover } from './mode7';
import { text, bold, center, right, rimmed, textW, wrap, LINE } from './font';
import { treeSprite, paintTree, buildingSprite, machine, person, icon, VEH_TINT, holly, snowman, giftPile, lampPost, santaSleigh, glint, glow, moonSprite, logoWord, shadowBlob, ornament, giftBox, bellSprite } from './art';
import { paintTreeBuf } from './trees';

const SAVE = 'pine.save.v1', PREF = 'pine.prefs', ORN = 'pine.orn';
const ZOOMS = [16, 8, 4, 2];
type Mode = 'title' | 'letter' | 'play' | 'fly' | 'report' | 'buck' | 'perk' | 'end';
type Win = null | 'shop' | 'build' | 'crew' | 'ledger' | 'market' | 'bank' | 'help' | 'pause' | 'album';
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
  wheelAcc = 0; hasSave = false; sawFirstEve = false; landZoom = 0; goalFlash = 0;

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
    try { const p = JSON.parse(localStorage.getItem(PREF) ?? '{}'); this.crt = p.crt ?? true; if (p.mute) this.chip.toggle(); this.hasSave = !!localStorage.getItem(SAVE); this.titleOrn = JSON.parse(localStorage.getItem(ORN) ?? '[]'); } catch { /* private mode: just no saves */ }
    this.applyCrt(); this.buildTitle(); this.r.onSleigh = () => { this.chip.sfx('sleigh'); this.sim.santaDrop(); };
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
    if (this.back.c.width > 1) this.buildTitle();
  }
  applyCrt() { document.getElementById('crt')?.classList.toggle('on', this.crt); }
  savePrefs() { try { localStorage.setItem(PREF, JSON.stringify({ crt: this.crt, mute: this.chip.muted })); } catch { /* */ } }
  save() { try { localStorage.setItem(SAVE, this.sim.serialize()); localStorage.setItem(ORN, JSON.stringify(this.sim.s.fun.orn)); this.titleOrn = this.sim.s.fun.orn; this.hasSave = true; } catch { /* quota: keep playing */ } }
  titleOrn: boolean[] = []; ornPop: { i: number; life: number } | null = null; comboPop = 0;

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
    const { W, H } = this, r = canvas(W, H), g = r.g; this.back = r;
    const SKY = ['#0a0a30', '#10104a', '#181a64', '#23247e', '#352f96', '#5240a8', '#7c52b4'];
    for (let y = 0; y < H * 0.72; y++) for (let x = 0; x < W; x++) { const k = Math.pow(y / (H * 0.72), 1.15) * (SKY.length - 1) + (bayer(x, y) - 0.5) * 0.5, b = Math.max(0, Math.min(SKY.length - 1, Math.round(k))); g.fillStyle = SKY[b]; g.fillRect(x, y, 1, 1); }
    // the aurora: curtains of light, dithered so it stays pixels
    for (const [yb, ph, col, amp] of [[0.3, 0, '#46e0a8', 0.09], [0.21, 2.1, '#58c8ff', 0.06], [0.37, 4.4, '#d060e0', 0.05]] as [number, number, string, number][]) {
      g.fillStyle = col;
      for (let x = 0; x < W; x++) {
        const yc = H * (yb + Math.sin(x * 0.012 + ph) * amp + Math.sin(x * 0.031 + ph * 2) * amp * 0.4), L = H * (0.12 + 0.09 * Math.sin(x * 0.05 + ph) ** 2), st = 0.55 + 0.45 * Math.sin(x * 0.21 + ph);
        for (let y = 0; y < L; y++) { const a = (1 - y / L) * st + (bayer(x, y) - 0.5) * 0.14; if (a < 0.1) continue; g.globalAlpha = a > 0.66 ? 0.26 : a > 0.4 ? 0.17 : a > 0.2 ? 0.1 : 0.05; g.fillRect(x, (yc - y) | 0, 1, 1); }
      }
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 200; i++) { const x = hash(i, 1) * W | 0, y = hash(i, 2) * H * 0.6 | 0; g.fillStyle = i % 6 ? C.sky : C.white; g.fillRect(x, y, 1, 1); if (i % 37 === 0) g.drawImage(glint(2), x - 3, y - 3); }
    const mx = W * 0.15, my = H * 0.17; g.globalCompositeOperation = 'lighter'; g.drawImage(glow(64, '#8080e0'), mx - 64, my - 64); g.globalCompositeOperation = 'source-over'; g.drawImage(moonSprite(24), mx - 25, my - 25);
    const ridge = (base: number, amp: number, col: string, top: string, f: number, ph: number) => { for (let x = 0; x < W; x++) { const h = Math.round(H * base + Math.sin(x * f + ph) * amp + Math.sin(x * f * 2.7 + 1 + ph) * amp * 0.4); g.fillStyle = col; g.fillRect(x, H - h, 1, h); g.fillStyle = top; g.fillRect(x, H - h, 1, 2 + (hash(x >> 2, 1) * 3 | 0)); } };
    ridge(0.47, 14, '#3c3a90', '#8a8ad8', 0.011, 0); ridge(0.41, 12, '#454aa8', '#b4bcec', 0.017, 2);
    // the village on the far ridge
    for (let i = 0; i < 16; i++) { const x = W * 0.3 + i * W * 0.03 + hash(i, 5) * 8, y = H * 0.6 + hash(i, 6) * 6 + Math.sin(x * 0.03) * 3; g.fillStyle = '#2a2a78'; g.fillRect(x, y - 6, 9, 7); g.fillRect(x + 2, y - 8, 5, 2); g.fillStyle = C.gold; g.fillRect(x + 2, y - 4, 2, 2); if (i % 3) g.fillRect(x + 6, y - 4, 1, 2); }
    for (let x = -10; x < W + 10; x += 9) { const px = 26 + (hash(x, 3) * 18 | 0), base = H * 0.72 + Math.sin(x * 0.03) * 5 + hash(x, 9) * 5; paintTree(g, x, base, { sp: 1, ramp: x % 2 ? ['#0e1c52', '#142c6a', '#1e4480', '#4a78ae'] : ['#0a1848', '#102860', '#183c78', '#3e6aa4'], px, shape: 1, snow: 2, sway: 0, seed: x & 7 }); }
    for (let y = Math.round(H * 0.7); y < H; y++) for (let x = 0; x < W; x++) { const u = (y - H * 0.7) / (H * 0.3), hgt = Math.sin(x * 0.02 + 1) * 5 + Math.sin(x * 0.007) * 7, yy = y - H * 0.7 - hgt; if (yy < 0) continue; const v = u + Math.sin(x * 0.05 + y * 0.09) * 0.1 + (bayer(x, y) - 0.5) * 0.14; g.fillStyle = v < 0.2 ? '#a6b6ee' : v < 0.5 ? '#c2d2f6' : v < 0.8 ? '#dae6fb' : '#eef5fe'; g.fillRect(x, y, 1, 1); }
    const gy = Math.round(H * 0.8), hs = buildingSprite('house', true, true), bs = buildingSprite('barn', true, true), hx = Math.round(W * 0.03);
    g.globalCompositeOperation = 'lighter'; g.drawImage(glow(64, '#ffb84a'), hx - 28, gy - 74, 240, 150); g.globalCompositeOperation = 'source-over';
    g.drawImage(shadowBlob(84), hx, gy - 4); g.drawImage(shadowBlob(84), hx + 84, gy - 4); g.drawImage(hs, hx, gy - hs.height + 2); g.drawImage(bs, hx + 84, gy - bs.height + 2);
    this.titleHouse = { x: hx, y: gy - hs.height + 2, bx: hx + 84, by: gy - bs.height + 2 };
    // the big tree
    const tx = Math.round(W - Math.min(78, W * 0.17)), tb = Math.round(H * 0.93), tp = Math.round(H * 0.74), tree = new Buf(Math.round(tp * 0.95), tp + 8), ccx = tree.w >> 1;
    paintTreeBuf(tree, ccx, tp + 4, { sp: 1, px: tp, shape: 2, snow: 2, sway: 0, seed: 2, deco: 2 }); tree.outline(mix(C.sn5, C.ink, 0.5));
    g.drawImage(shadowBlob(120), tx - 60, tb - 8); g.globalCompositeOperation = 'lighter'; g.drawImage(glow(64, '#ffb84a'), tx - 90, tb - tp * 0.72, 180, tp * 0.9); g.globalCompositeOperation = 'source-over'; g.drawImage(tree.bake(), tx - ccx, tb - tp - 4);
    this.titleTree = { x: tx, y: tb - tp, h: tp, half: tp * 0.34 };
    for (let i = 0; i < 5; i++) { const im = giftPile(i); g.drawImage(im, tx - 52 + i * 22 - (im.width >> 1) + 8, tb - 13 + (i % 2) * 7); }
    const sm = snowman(1); g.drawImage(shadowBlob(18), W * 0.53, H * 0.88 + 19); g.drawImage(sm, W * 0.53, H * 0.88 - 3);
    const lp = lampPost(true), lx = Math.round(W * 0.645); g.drawImage(lp, lx, H * 0.85 - 8); g.globalCompositeOperation = 'lighter'; g.drawImage(glow(32, '#ffd27a'), lx - 26, H * 0.85 - 36); g.globalCompositeOperation = 'source-over';
    // logo
    const L = canvas(W, H); this.logo = L;
    const cell = Math.max(3, Math.min(6, Math.floor(W / 74))), word = (t: string, y: number, fill: 'candy' | 'gold' | 'green') => {
      const w = textW(t), tmp = canvas(w + 2, 9); text(tmp.g, t, 0, 0, '#ffffff'); const d = tmp.g.getImageData(0, 0, w + 2, 9).data, im = logoWord((x, yy) => x >= 0 && yy >= 0 && x < w + 2 && yy < 9 && d[(yy * (w + 2) + x) * 4 + 3] > 128, w, 8, cell, fill);
      L.g.drawImage(im.bake(), Math.round(W / 2 - im.w / 2), y); return im;
    };
    const ly = Math.round(H * 0.02), a = word('PINE', ly, 'candy');
    const amp = word('&', ly + a.h - cell * 3 - 12, 'gold'); void amp;
    word('DANDY', ly + a.h + cell * 2 - 3, 'green');
    const sub = 'A CHRISTMAS TREE FARM SIMULATOR', sw = textW(sub) + 26, sx = Math.round(W / 2 - sw / 2), sy = ly + a.h * 2 + cell * 2 - 2;
    L.g.fillStyle = C.ink; L.g.fillRect(sx - 1, sy - 1, sw + 2, 15); L.g.fillStyle = C.red; L.g.fillRect(sx, sy, sw, 13); L.g.fillStyle = C.pink; L.g.fillRect(sx, sy, sw, 1); L.g.fillStyle = C.dred; L.g.fillRect(sx, sy + 11, sw, 2); center(L.g, sub, W / 2, sy + 3, C.white); L.g.drawImage(holly(), sx - 9, sy - 2); L.g.drawImage(holly(true), sx + sw - 10, sy - 2);
    this.titleBtnY = sy + 22;
  }
  back = canvas(1, 1); logo = canvas(1, 1); titleBtnY = 180; titleTree = { x: 0, y: 0, h: 1, half: 1 }; titleHouse = { x: 0, y: 0, bx: 0, by: 0 };
  flakes = Array.from({ length: 150 }, (_, i) => ({ x: hash(i, 8), y: hash(i, 9), s: 0.4 + hash(i, 10) * 1.1 }));
  snowfall(dt: number, k = 1) { const { g, W, H } = this; for (const f of this.flakes) { f.y += dt * f.s * 0.09 * k; f.x += Math.sin(this.t * 0.9 + f.s * 9) * dt * 0.012; if (f.y > 1) f.y -= 1; const X = (f.x * W) | 0, Y = (f.y * H) | 0; if (f.s > 1.25) { g.fillStyle = C.white; g.fillRect(X - 1, Y, 3, 1); g.fillRect(X, Y - 1, 1, 3); } else { g.fillStyle = f.s > 0.8 ? C.white : C.sky; const q = f.s > 0.8 ? 2 : 1; g.fillRect(X, Y, q, q); } } }
  drawTitle(dt: number) {
    const { g, W, H, ui, t } = this; g.drawImage(this.back.c, 0, 0);
    // santa crosses the moon now and then
    const sc = (t * 26) % (W + 620) - 160; if (sc < W + 40) { const fr = ((t * 6) | 0) % 2; g.drawImage(santaSleigh(fr, true), Math.round(sc), Math.round(H * 0.13 + Math.sin(t * 1.2) * 4)); }
    const h = this.titleHouse, ph = (t * 2.2) | 0; g.drawImage(buildingSprite('house', true, true, ph), h.x, h.y); g.drawImage(buildingSprite('barn', true, true, ph), h.bx, h.by);
    // the big tree's lights
    const T = this.titleTree, BC = [C.red, C.gold, '#46b0ff', '#ff6ac8', C.lime];
    for (let i = 0; i < 90; i++) {
      const v = (i + 0.5) / 90, y = T.y + 6 + v * T.h * 0.86, w = T.half * Math.pow(v, 0.9) * 1.05, x = T.x + (hash(i, 3) - 0.5) * 2 * w;
      if (Math.sin(t * (1.2 + hash(i, 4) * 2) + i) < -0.3) continue;
      g.fillStyle = BC[i % 5]; g.fillRect(x | 0, y | 0, 2, 2); g.fillStyle = C.white; g.fillRect(x | 0, y | 0, 1, 1);
    }
    this.titleOrn.forEach((on, i) => { if (!on) return; const v = 0.1 + hash(i, 21) * 0.82, y = T.y + v * T.h * 0.88, w = T.half * Math.pow(v, 0.9) * 0.95, x = T.x + (hash(i, 22) - 0.5) * 2 * w; g.drawImage(ornament(i, ORNAMENTS[i]), (x | 0) - 8, (y | 0) - 6); });
    const sx = T.x, sy = T.y - 3, pulse = Math.sin(t * 2.4) * 0.5 + 0.5; g.globalCompositeOperation = 'lighter'; g.drawImage(glow(32, '#ffd27a'), sx - 32, sy - 32); g.globalCompositeOperation = 'source-over';
    g.fillStyle = C.gold; g.fillRect(sx - 4, sy - 1, 9, 3); g.fillRect(sx - 1, sy - 4, 3, 9); g.fillRect(sx - 2, sy - 2, 5, 5); g.fillStyle = C.lemon; g.fillRect(sx - 1, sy - 1, 3, 3); g.drawImage(glint(1 + Math.round(pulse * 2)), sx - 3, sy - 3);
    this.smokeT -= dt; if (this.smokeT <= 0) { this.smokeT = 0.3; this.smoke.push({ x: h.x + 61, y: h.y + 4, l: 3 }); }
    for (const q of this.smoke) { q.l -= dt; q.y -= dt * 9; q.x += dt * (5 + (3 - q.l) * 3); g.fillStyle = q.l > 1.5 ? C.lgrey : '#8a90c8'; const s2 = q.l > 2 ? 2 : 3; g.fillRect(q.x | 0, q.y | 0, s2, s2); } this.smoke = this.smoke.filter((q) => q.l > 0);
    g.drawImage(this.logo.c, 0, 0);
    this.snowfall(dt);
    const bw = 120, x = Math.round((W - bw) / 2); let y = this.titleBtnY;
    if (this.hasSave) { if (ui.button(x, y, bw, 18, 'CONTINUE FARM', { primary: true }) || this.tap('Enter')) this.load(); y += 22; }
    if (ui.button(x, y, bw, 18, 'NEW FARM', { primary: !this.hasSave }) || (!this.hasSave && this.tap('Enter'))) this.newGame();
    y += 22;
    if (ui.button(x, y, bw, 14, 'HOW TO PLAY', {})) this.win = 'help';
    if (ui.button(4, H - 16, 72, 13, 'GAME PICKER', { dark: true })) location.href = 'index.html?pick';
    if (((this.t * 1.6) | 0) % 2 === 0 && !this.win) center(g, 'PRESS ENTER', x + bw / 2, y + 19, C.lemon, 1, C.ink);
    if (this.win === 'help') this.helpWin();
  }
  smoke: { x: number; y: number; l: number }[] = []; smokeT = 0;
  newGame() { this.to(() => { this.sim.newGame(); this.mode = 'letter'; this.letterT = 0; this.chip.play('winter'); }); }
  load() {
    try { this.sim.deserialize(localStorage.getItem(SAVE)!); this.to(() => this.enterPlay()); } catch { this.hasSave = false; this.toast('That save would not load.', C.pink); }
  }
  enterPlay() { const p = this.sim.s.p; this.r.cx = p.x; this.r.cy = p.y; this.mode = 'play'; this.shownMoney = this.sim.s.money; this.pickMusic(); }
  pickMusic() { const m = this.sim.s.month; this.chip.play(this.sim.julySale() ? 'harvest' : m < 2 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : m < 10 ? 'fall' : m === 10 ? 'harvest' : 'rush'); }
  drawLetter(dt: number) {
    const { g, W, H, ui } = this; g.drawImage(this.back.c, 0, 0); g.fillStyle = 'rgba(16,14,52,.5)'; g.fillRect(0, 0, W, H); this.snowfall(dt, 0.7);
    this.letterT += dt * 34; const w = 300, h = 170, x = (W - w) / 2, y = (H - h) / 2; ui.paper(x, y, w, h); g.drawImage(holly(), x - 7, y - 6); g.drawImage(holly(true), x + w - 12, y - 6);
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
    if (!open && !this.paused) { r.stepLife(dt); if (s.fun.frenzy > 0) this.chip.work(true); }
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
    if (this.tap('KeyJ')) this.jolly();
    if (this.tap('KeyO')) this.win = 'album';
    if (this.tap('BracketLeft')) { if (s.p.tool === TOOL_SAW) this.cycleCut(-1); else this.cycleSpecies(-1); }
    if (this.tap('BracketRight')) { if (s.p.tool === TOOL_SAW) this.cycleCut(1); else this.cycleSpecies(1); }
  }
  jolly() { if (!this.sim.goJolly()) this.chip.sfx('deny'); }
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
      case 'chop': if (f.mine || visible(f.x, f.y)) { r.chop(f.x, f.y, f.sp, f.h, f.mine); if (cuts++ < 3) chip.sfx('chop'); chip.work(f.mine); if (f.mine) chip.chime(sim.s.fun.combo); } break;
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
      case 'full': chip.sfx('full'); if (this.t - this.fullT > 1) { this.fullT = this.t; r.float(sim.s.p.x, sim.s.p.y - 2, 'FULL! BACK TO THE BARN', C.lemon); } break;
      case 'combo': { this.comboPop = 1; chip.sfx('combo'); const p = sim.s.p; r.float(p.x, p.y - 2.2, '+' + money(f.cash), C.gold); r.burst(p.x, p.y - 0.5, 10 + f.tier * 4, [C.gold, C.red, C.white, C.lime], 5); if (f.tier >= 4) r.shake = Math.min(5, r.shake + 2); break; }
      case 'comboEnd': r.float(sim.s.p.x, sim.s.p.y - 2.2, `${f.n} IN A ROW`, C.lemon); break;
      case 'jollyReady': chip.sfx('ready'); if (f.first) this.big = { t: 'JOLLY MODE READY', s: 'Press J: faster, wider, no hauling, free seedlings', c: C.gold, life: 3.2 }; else this.toast('Jolly Mode is ready. Press J!', C.gold); break;
      case 'frenzy': chip.sfx('frenzy'); chip.rate = 1.2; this.big = { t: 'JOLLY MODE!', s: 'The elves are hauling. Go, go, go', c: C.red, life: 0.9 }; r.shake = 5; { const p = sim.s.p; r.burst(p.x, p.y - 0.5, 40, [C.gold, C.red, C.white, C.lime, C.aqua], 8); } break;
      case 'frenzyEnd': chip.sfx('frenzyEnd'); chip.rate = 1; break;
      case 'haul': if (f.n > 0) { const p = sim.s.p; r.float(p.x, p.y - 1.4, `+${f.n} home`, C.lime); } break;
      case 'drop': chip.sfx('drop'); break;
      case 'gift': { chip.sfx(f.c === 'coal' ? 'coal' : 'gift'); r.burst(f.x, f.y - 0.4, 22, f.c === 'coal' ? [C.dgrey, C.ink, C.grey] : [C.gold, C.red, C.white, C.lime, C.aqua], 7); r.shake = Math.min(4, r.shake + 1.2); r.float(f.x, f.y - 1.4, f.t, f.c === 'coal' ? C.lgrey : C.gold, true); if (f.s) this.toast(f.s, f.c === 'coal' ? C.lgrey : C.lemon); break; }
      case 'orn': chip.sfx('orn'); this.ornPop = { i: f.i, life: 4 }; this.save(); break;
      case 'bellStart': chip.sfx('trail'); break;
      case 'bell': chip.note(f.note); r.burst(f.x, f.y - 0.6, 8, [C.gold, C.lemon, C.white], 4); r.float(f.x, f.y - 1.5, `${f.i + 1}/${f.n}`, C.lemon); break;
      case 'bellFail': chip.sfx('trailFail'); this.toast('The bells went quiet.', C.ice); break;
      case 'bellDone': chip.sfx('trailDone'); r.shake = 4; r.burst(f.x, f.y, 40, [C.gold, C.red, C.white, C.lime], 8); r.float(f.x, f.y - 2.4, 'TRAIL COMPLETE +' + money(f.cash), C.gold, false); break;
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
    ui.bar(0, 0, W, 21); ui.topTrim(W, 19, (this.t * 1.5) | 0);
    const season = ['WINTER', 'SPRING', 'SUMMER', 'FALL'][sim.season()], seasonCol = [C.ice, C.lime, C.lemon, C.orange][sim.season()];
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
    const dx = this.xmasIn();
    { const lbl = dx === 0 ? 'MERRY CHRISTMAS' : `${dx} DAY${dx === 1 ? '' : 'S'} TO CHRISTMAS`, cw = textW(lbl) + 18, cx = Math.round(Math.min(rx - cw - 8, Math.max(x + 4, W / 2 - cw / 2)));
      if (rx - x > cw + 14) { ui.rect(C.ink, cx - 1, 3, cw + 2, 15); ui.rect(dx < 6 && ((this.t * 2) | 0) % 2 ? C.dred : C.red, cx, 4, cw, 13); ui.rect(C.pink, cx, 4, cw, 1); ui.rect(C.dred, cx, 15, cw, 2); g.drawImage(icon('wreath'), cx + 2, 4); text(g, lbl, cx + 16, 6, C.white); } }
    this.tickets();
    this.goalLine();
    if (s.streak > 0 && (s.month >= 10)) {
      const lbl = `CHEER x${sim.cheer.toFixed(2)}`, cw = textW(lbl, 1), bx = W - 132 - cw;
      const cy = bx - 8 < this.goalR ? 56 : 29; ui.rect(C.ink, bx - 6, cy - 1, cw + 12, 13); ui.rect(this.bump > 0 ? C.gold : C.red, bx - 5, cy, cw + 10, 11); text(g, lbl, bx, cy + 1, this.bump > 0 ? C.ink : C.white);
    }
    this.toolbar();
    this.jollyBar();
    this.lootArrows();
    if (this.ornPop) this.ornCard(dt);
    // toasts sit just above the toolbar
    let ty = H - 46;
    for (let i = this.toasts.length - 1; i >= 0; i--) { const t = this.toasts[i], w = textW(t.t) + 14; g.globalAlpha = Math.min(1, t.life * 2); ui.rect(C.ink, 3, ty - 1, w + 2, 14); ui.rect('#123c3e', 4, ty, w, 12); ui.rect(C.red, 4, ty, 3, 12); ui.rect(C.gold, 7, ty, 1, 12); text(g, t.t, 11, ty + 2, t.c); g.globalAlpha = 1; ty -= 15; }
    if (this.alert) { const a = this.alert; if (ui.button(W / 2 - 40, H - 58, 80, 14, 'SHOW ME', { primary: true })) { r.free = true; r.cx = a.x; r.cy = a.y; r.z = Math.min(r.z, 8); this.alert = null; } }
    if (this.big) {
      const b = this.big, a = Math.min(1, b.life * 2.5, (2.6 - b.life) * 8), w = Math.max(textW(b.t, 3), textW(b.s)) + 30, y = H * 0.27;
      g.globalAlpha = a; ui.rect(C.ink, W / 2 - w / 2 - 2, y - 2, w + 4, 48); ui.rect(C.dred, W / 2 - w / 2, y, w, 44); ui.candy(W / 2 - w / 2, y, w, 3, this.t * 8); ui.candy(W / 2 - w / 2, y + 41, w, 3, -this.t * 8); g.drawImage(holly(), W / 2 - w / 2 - 8, y - 6); g.drawImage(holly(true), W / 2 + w / 2 - 12, y - 6);
      center(g, b.t, W / 2, y + 6, C.white, 3, b.c); center(g, b.s, W / 2, y + 30, C.cream); g.globalAlpha = 1;
    }
    if (this.paused && !this.win) { center(g, 'PAUSED', W / 2, H * 0.4, C.white, 3, C.ink); }
    if (this.act === 'land') this.landHud();
    if (this.act === 'block') this.hint('Drag a rectangle to mark a block. Click a block to open it. Esc to cancel.');
    if (this.act === 'build') this.hint(`Click to build ${BUILDINGS[this.buildKind].name} (${money(BUILDINGS[this.buildKind].price)}). Esc to cancel.`);
    if (this.act === 'road') this.hint('Hold and drag to lay road ($6 a tile). Roads are faster and stop pests. Esc when done.');
    if (this.block) this.blockPanel(this.block);
  }
  xmasIn() { const s = this.sim.s; return s.month === 11 && s.day > 24 ? 0 : (11 - s.month) * 30 + 24 - s.day; }
  /** the Jolly meter: a candy-cane gauge over the toolbar, and the combo word above it */
  jollyBar() {
    const { g, ui, W, H, sim, t } = this, f = sim.s.fun, w = 116, x = W - w - 6, y = H - 45, mid = x + (w >> 1);
    const on = f.frenzy > 0, full = f.jolly >= 1 && !on, v = on ? f.frenzy / JOLLY_SECS : f.jolly;
    ui.block(x, y, w, 11); ui.rect(C.ink, x - 1, y - 1, w + 2, 12); ui.rect('#123c3e', x, y, w, 10);
    const fw = Math.round((w - 2) * v); if (fw > 0) { g.save(); g.beginPath(); g.rect(x + 1, y + 1, fw, 8); g.clip(); ui.candy(x + 1, y + 1, w, 8, t * (on ? 40 : full ? 16 : 6)); g.restore(); }
    if (on) rimmed(g, 'JOLLY MODE', mid, y + 1, C.gold, C.ink); else if (full) { if (((t * 4) | 0) % 2) ui.rect('rgba(255,240,154,.45)', x, y, w, 10); rimmed(g, 'PRESS J', mid, y + 1, C.white, C.dred); } else rimmed(g, 'JOLLY', mid, y + 1, C.white, C.ink);
    if (ui.inside(x, y, w, 11)) { ui.tip = full ? 'Jolly Mode (J)' : 'Work fast, open gifts and run bell trails to fill this'; ui.tipX = x; ui.tipY = y; if (ui.pressed && full) { ui.pressed = false; this.jolly(); } }
    let lx = mid; if (f.boost > 0) { rimmed(g, `COCOA ${Math.ceil(f.boost)}`, lx, y - 12, C.orange, C.ink); lx -= 62; } if (f.free > 0) rimmed(g, `${f.free} free seedlings`, lx - (lx === mid ? 0 : 30), y - 12, C.lime, C.ink);
    if (f.combo >= 3) {
      this.comboPop = Math.max(0, this.comboPop - 1 / 30);
      const sc = this.comboPop > 0 || f.tier >= 3 ? 2 : 1, word = f.tier ? COMBO_TIERS[f.tier - 1][1] : '', txt = `x${f.combo} ${word}`, col = [C.white, C.lemon, C.gold, C.orange, C.pink, C.aqua, C.lime][f.tier];
      const cy = Math.round(H / 2 + 24 - this.comboPop * 3); rimmed(g, txt, W / 2, cy, col, C.ink, sc);
      ui.meter(W / 2 - 24, cy + sc * 9 + 1, 48, 2, f.comboT / 3, col, C.ink);
    }
    // the screen itself goes Christmas while the mode lasts
    if (on) { const n = Math.ceil(W / 12), cols = [C.red, C.gold, C.lime, C.white, '#46b0ff'], k = (t * 10) | 0; for (let i = 0; i < n; i++) { g.fillStyle = cols[(i + k) % 5]; g.fillRect(i * 12 + 4, 22, 3, 3); g.fillRect(i * 12 + 4, H - 35, 3, 3); } for (let j = 2; j < H / 12 - 3; j++) { g.fillStyle = cols[(j + k) % 5]; g.fillRect(1, j * 12, 3, 3); g.fillRect(W - 4, j * 12, 3, 3); } }
  }
  /** an arrow at the edge of the screen for anything worth driving to */
  lootArrows() {
    const { g, W, H, r, sim, t } = this, f = sim.s.fun, arrow = (wx: number, wy: number, im: HTMLCanvasElement) => {
      const sx = wx * r.z - r.camX(), sy = wy * r.z - r.camY(), m = 16; if (sx > m && sy > 28 && sx < W - m && sy < H - 40) return;
      const cx = W / 2, cy = H / 2, dx = sx - cx, dy = sy - cy, k = Math.min((W / 2 - 22) / Math.abs(dx || 1), (dy > 0 ? H - cy - 62 : cy - 72) / Math.abs(dy || 1)), x = Math.round(cx + dx * k), y = Math.round(cy + dy * k), a = Math.atan2(dy, dx), b = Math.round(Math.sin(t * 7) * 2);
      g.fillStyle = C.ink; g.fillRect(x - 10, y - 10, 21, 21); g.fillStyle = '#123c3e'; g.fillRect(x - 9, y - 9, 19, 19); g.drawImage(im, x - (im.width >> 1), y - (im.height >> 1));
      g.fillStyle = C.gold; const px = x + Math.cos(a) * (14 + b), py = y + Math.sin(a) * (14 + b); g.fillRect(Math.round(px) - 2, Math.round(py) - 2, 5, 5); g.fillStyle = C.lemon; g.fillRect(Math.round(px + Math.cos(a) * 3) - 1, Math.round(py + Math.sin(a) * 3) - 1, 3, 3);
    };
    f.gifts.forEach((q, i) => { if (q.fall <= 0) arrow(q.x, q.y, giftBox(i)); });
    if (f.trail) {
      const q = f.trail, x = q.pts[q.i * 2], y = q.pts[q.i * 2 + 1]; arrow(x, y, bellSprite(((t * 5) | 0)));
      const w = 90, bx = Math.round(W / 2 - w / 2), by = 62; this.ui.rect(C.ink, bx - 1, by - 1, w + 2, 6); this.ui.meter(bx, by, w, 4, q.t / Math.max(q.t, q.i ? 3.4 : 9, q.step / VEHICLES[sim.s.veh].speed * 3.4), q.t < 1.4 ? C.red : C.gold, '#123c3e'); rimmed(g, `BELL TRAIL ${q.i}/${q.pts.length / 2}`, W / 2, by + 7, C.lemon, C.ink);
    }
  }
  ornCard(dt: number) {
    const { g, ui, W, H } = this, p = this.ornPop!, o = ORNAMENTS[p.i], w = 190, h = 56, x = 8, y = 72; p.life -= dt; if (p.life <= 0) { this.ornPop = null; return; }
    ui.paper(x, y, w, h); ui.ribbon(x, y, w, 12); center(g, 'NEW ORNAMENT', x + w / 2, y + 2, C.white); const im = ornament(p.i, o); g.drawImage(im, x + 8, y + 15, im.width * 2, im.height * 2);
    const n = this.sim.s.fun.orn.filter(Boolean).length; bold(g, o.name, x + 46, y + 16, C.dred); let ly = y + 27; for (const l of wrap(o.note, w - 54).slice(0, 2)) { text(g, l, x + 46, ly, C.ink); ly += 10; } right(g, `${n} of 24`, x + w - 6, y + h - 10, C.brown);
  }
  albumWin() {
    const { g, ui, sim } = this, f = sim.s.fun, w = 356, h = 244, { x, y, closed } = ui.window(w, h, 'ADVENT ALBUM'); if (closed) this.win = null;
    const n = f.orn.filter(Boolean).length; right(g, `${n} of 24`, x + w - 22, y + 3, C.white);
    const cw = 52, ch = 42, x0 = x + 14, y0 = y + 22; let tipI = -1;
    for (let i = 0; i < 24; i++) {
      const c = i % 6, r = (i / 6) | 0, dx = x0 + c * (cw + 3), dy = y0 + r * (ch + 3), on = f.orn[i], hov = ui.inside(dx, dy, cw, ch); if (hov) tipI = i;
      ui.rect(C.ink, dx - 1, dy - 1, cw + 2, ch + 2); ui.rect(on ? '#fff6dc' : (i + r) % 2 ? C.pine : C.dred, dx, dy, cw, ch); ui.rect(C.gold, dx, dy, cw, 1);
      if (on) { const im = ornament(i, ORNAMENTS[i]); g.drawImage(im, dx + (cw >> 1) - 8, dy + 6, 16, 18); g.drawImage(im, dx + (cw >> 1) - 8, dy + 7, 16, 18); center(g, String(i + 1), dx + (cw >> 1), dy + ch - 11, C.brown); }
      else { center(g, String(i + 1), dx + (cw >> 1), dy + 12, C.gold, 2, C.ink); ui.rect(C.gold, dx + cw - 7, dy + (ch >> 1) - 1, 3, 3); }
    }
    for (let r = 0; r < 4; r++) if (f.rows[r]) g.drawImage(icon('star'), x0 + 6 * (cw + 3) - 2, y0 + r * (ch + 3) + 14);
    const ty = y0 + 4 * (ch + 3) + 1;
    if (tipI >= 0 && f.orn[tipI]) { bold(g, ORNAMENTS[tipI].name, x + 14, ty, C.dred); text(g, ORNAMENTS[tipI].note, x + 14, ty + 10, C.ink); }
    else { text(g, 'Gifts hold ornaments, and hidden gift piles hold more.', x + 14, ty, C.bark); text(g, 'Finish a row for a free Almanac page.', x + 14, ty + 10, C.bark); text(g, `Best combo ${f.best}   Gifts opened ${f.opens}   Trails run ${f.trails}`, x + 14, ty + 20, C.brown); }
  }
  hint(t: string) { const { ui, g, W } = this, w = textW(t) + 12; ui.rect(C.ink, W / 2 - w / 2 - 1, 49, w + 2, 15); ui.rect('#123c3e', W / 2 - w / 2, 50, w, 13); center(g, t, W / 2, 52, C.lemon); }
  landHud() {
    const { ui, g, r, sim } = this; if (ui.over) { this.hint('Click a gold parcel to buy it. Esc when done.'); return; }
    const m = r.screenToTile(ui.mx, ui.my), px = Math.floor(m.x / PS), py = Math.floor(m.y / PS);
    if (!sim.canBuyParcel(px, py)) { this.hint('Click a gold parcel to buy it. Esc when done.'); return; }
    const c = sim.landPrice(px, py), soil = sim.parcelFert(px, py), clear = sim.parcelClear(px, py), w = 108, x = Math.min(this.W - w - 2, ui.mx + 8), y = Math.max(20, ui.my - 34);
    ui.rect(C.ink, x - 1, y - 1, w + 2, 34); ui.rect(C.deep, x, y, w, 32); bold(g, money(c), x + 4, y + 3, sim.s.money >= c ? C.gold : C.pink);
    text(g, `Soil ${soil > 1.12 ? 'rich' : soil > 0.94 ? 'fair' : 'poor'} ${Math.round(soil * 100)}%`, x + 4, y + 12, soil > 1.12 ? C.lime : soil > 0.94 ? C.cream : C.tan); text(g, `Plantable ${Math.round(clear * 100)}%`, x + 4, y + 21, C.cream);
  }
  goalR = 0;
  goalLine() {
    const { g, ui, sim } = this, s = sim.s; if (s.goal >= GOALS.length) return;
    const go = GOALS[s.goal], v = sim.metric(go.check), n = go.n ?? 1;
    const prog = go.check === 'rank' ? `rank #${-v > 8 ? '-' : -v}` : go.check === 'veh' || go.check === 'year' || go.check === 'species' ? '' : `${short(Math.max(0, v))}/${short(n)}`;
    const line = `NEXT: ${go.text}`, w = Math.max(textW(line) + textW(prog) + 16, s.goal < 12 ? textW(go.hint) + 10 : 0), h = s.goal < 12 ? 24 : 13; this.goalR = w + 4;
    const y0 = 29; ui.rect(C.ink, 3, y0 - 1, w + 2, h + 2); ui.rect('#123c3e', 4, y0, w, h); ui.rect(C.gold, 4, y0, w, 1);
    if (this.goalFlash > 0) ui.rect(C.lime, 4, y0, w, 2);
    text(g, line, 8, y0 + 3, C.lemon); if (prog) right(g, prog, 4 + w - 4, y0 + 3, C.white);
    if (s.goal < 12) text(g, go.hint, 8, y0 + 13, C.ice);
  }
  tickets() {
    const { g, W, ui, sim, r } = this, s = sim.s; if (!s.tickets.length) return;
    const w = 120, h = 33, x = W - w - 4; let y = 30;
    const list = s.tickets.slice().sort((a, b) => a.days - b.days);
    for (const t of list.slice(0, 6)) {
      const hov = ui.inside(x, y, w, h), sel = this.selTicket === t.id, pri = s.priority === t.id; ui.block(x, y, w, h);
      ui.rect(t.hero ? C.gold : sel ? C.white : C.ink, x - 1, y - 1, w + 2, h + 2); ui.rect(hov ? '#1a5a4a' : '#123c3e', x, y, w, h); ui.rect(t.hero ? C.gold : C.red, x, y, w, 1); ui.rect(C.ink, x + 3, y + 2, 2, 2);
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
    const { g, W, H, ui, sim } = this, s = sim.s, y = H - 31; ui.bar(0, y, W, 31); ui.bottomTrim(W, y - 3);
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
    btn('gift', 'Advent Album', 'O', false, () => { this.win = 'album'; });
    // zoom stack on the far right
    const zx = W - 16;
    if (x + 14 < zx) { if (ui.button(zx, y + 3, 13, 12, '+', { dark: true, flat: true, tip: 'Zoom in (E)' })) this.zoom(-1); if (ui.button(zx, y + 16, 13, 12, '-', { dark: true, flat: true, tip: 'Zoom out (Q)' })) this.zoom(1); }
  }
  blockPanel(b: Block) {
    const { g, ui, sim } = this, s = sim.s, w = 132, h = 138, x = 6, y = 60;
    ui.paper(x, y, w, h); ui.ribbon(x, y, w, 13, C.pine); bold(g, b.name, x + 5, y + 3, C.white);
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
      case 'market': this.marketWin(); break; case 'bank': this.bankWin(); break; case 'help': this.helpWin(); break; case 'pause': this.pauseWin(); break; case 'album': this.albumWin(); break;
    }
  }
  shopWin() {
    const { g, ui, sim } = this, s = sim.s, w = 340, h = 216, { x, y, closed } = ui.window(w, h, 'MACHINE SHED'); if (closed) this.win = null;
    let yy = y + 20;
    VEHICLES.forEach((v, i) => {
      if (i === 0) return;
      const own = s.veh >= i, can = sim.tier >= v.tier && i === s.veh + 1;
      ui.rect(own ? '#dcd8a6' : '#e8d9ae', x + 6, yy, w - 12, 44); ui.rect(C.tan, x + 6, yy + 43, w - 12, 1);
      const im = machine(i, 1, 0, VEH_TINT[i], 3), sc = i >= 3 ? 0.62 : 1; g.drawImage(im, x + 34 - im.width * sc / 2, yy + 40 - im.height * sc, im.width * sc, im.height * sc);
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
        bold(g, 'Farm Road', cx + 44, cy + 4, C.ink); text(g, 'Faster, and stops pests.', cx + 44, cy + 14, C.bark); text(g, '$6 a tile', cx + 44, cy + 23, C.dred); continue;
      }
      const d = BUILDINGS[k], locked = sim.tier < d.tier, poor = s.money < d.price;
      if (ui.button(cx, cy, cw, rh, '', { disabled: locked || poor })) { this.buildKind = k; this.setAct('build'); this.win = null; }
      const im = buildingSprite(k, true, false), sc = Math.min(1, 30 / im.width, 28 / im.height); g.drawImage(im, cx + 21 - im.width * sc / 2, cy + rh - 2 - im.height * sc, im.width * sc, im.height * sc);
      if (locked) text(g, d.name, cx + 44, cy + 4, C.bark); else bold(g, d.name, cx + 44, cy + 4, C.ink); text(g, locked ? `Needs ${TIERS[d.tier].name}` : d.blurb, cx + 44, cy + 14, C.bark); text(g, `${money(d.price)}   have ${sim.bcount(k)}`, cx + 44, cy + 23, poor ? C.red : C.dred);
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
    const { g, ui } = this, w = 340, h = 258, { x, y, closed } = ui.window(w, h, 'HOW TO FARM'); if (closed) this.win = this.mode === 'title' ? null : 'pause';
    const L: [string, string][] = [['WASD / arrows', 'Drive'], ['SPACE or hold mouse', 'Work (mouse also drives)'], ['1 2 3 4', 'Saw, Planter, Shears, Tank'], ['[ ]', 'Saw height, or seedling species'], ['B', 'Draw a block for crews'], ['G  L  R', 'Build, Land, Shop'], ['C  T  K  N', 'Crew, Ledger, Market, Bank'], ['Q  E or wheel', 'Zoom out and in'], ['Right drag', 'Look around'], ['TAB', 'Height and species overlays'], ['F  P', 'Game speed, pause'], ['M', 'Sound on or off'], ['J', 'Jolly Mode, when the meter is full'], ['O', 'Advent Album']];
    let yy = y + 21; for (const [a, b] of L) { bold(g, a, x + 12, yy, C.dred); text(g, b, x + 126, yy, C.ink); yy += 11; }
    yy += 4; for (const l of ['Spring: plant. Summer: shear. Mid October on: cut.', 'The lot opens late November. Fill orders on time to build Cheer.', 'Keep species mixed: pests race through one big field.', 'Unsold trees go to the wholesaler for peanuts at Christmas.', 'Keep working without stopping to build a combo. Chase gifts and bells.']) { text(g, l, x + 12, yy, C.bark); yy += 10; }
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
    const { g, W, H } = this; g.drawImage(this.back.c, 0, 0); g.fillStyle = 'rgba(16,14,52,.6)'; g.fillRect(0, 0, W, H); this.snowfall(dt, 0.6);
    if (this.mode === 'report') this.reportWin(dt); else if (this.mode === 'buck') this.buckWin(); else if (this.mode === 'perk') this.perkWin();
  }
  reportWin(dt: number) {
    const { g, ui } = this, R = this.report!, Y = R.y, w = 400, h = 244, x = Math.round((this.W - w) / 2), y = Math.round((this.H - h) / 2);
    this.roll = Math.min(1, this.roll + dt * 0.7); const k = 1 - Math.pow(1 - this.roll, 3); if (this.roll < 1 && Math.random() < 0.4) this.chip.sfx('blip');
    ui.paper(x, y, w, h); ui.ribbon(x, y, w, 18); g.drawImage(holly(), x - 7, y - 6); bold(g, `YEAR ${R.year}: THE BOOKS`, x + 18, y + 5, C.white, 1, C.dred);
    right(g, R.tierUp ? `NOW A ${R.tierUp.toUpperCase()}!` : TIERS[this.sim.tier].name, x + w - 8, y + 5, C.lemon);
    let yy = y + 26; const line = (l: string, v: number, c: string = C.ink, isN = false) => { text(g, l, x + 12, yy, C.bark); right(g, isN ? Math.round(v * k).toLocaleString('en-US') : money(v * k), x + 186, yy, c); yy += 11; };
    line('Trees sold', Y.sold, C.ink, true); yy += 3; line('Walk-in sales', Y.retail); line(`Orders (${Y.ordersN} of ${Y.ordersN + Y.missed})`, Y.orders); line('Wholesale', Y.wholesale); line('Bonuses', Y.bonus); ui.rect(C.tan, x + 12, yy, 174, 1); yy += 3; line('Revenue', Y.revenue, C.pine); yy += 3; line('Wages', -Y.wages, C.dred); line('Seedlings', -Y.seeds, C.dred); line('Land, buildings, gear', -Y.bills, C.dred); yy += 3;
    bold(g, 'Cash in hand', x + 12, yy, C.ink); right(g, money(R.net * k), x + 186, yy, R.net >= 0 ? C.pine : C.red); yy += 14;
    text(g, `Best Cheer streak ${Y.bestStreak}. Best combo ${this.sim.s.fun.best}`, x + 12, yy, C.bark); yy += 11; if (Y.lostSales) { text(g, `${Y.lostSales.toLocaleString('en-US')} families left with no tree`, x + 12, yy, C.dred); yy += 11; } if (Y.lost) text(g, `${Y.lost} trees lost to pests, deer and drought`, x + 12, yy, C.dred);
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
      const yy = y + (hov ? -2 : 0), lvl = sim.pk(p.id); ui.ribbon(x, yy, cw, 16, hov ? C.red : C.pine); center(g, p.name, x + cw / 2, yy + 4, C.white);
      g.drawImage(icon(['wreath', 'star', 'gift'][i]), x + cw / 2 - 6, yy + 24);
      let ly = yy + 44; for (const l of wrap(p.text, cw - 16)) { center(g, l, x + cw / 2, ly, C.ink); ly += 11; }
      if (lvl) center(g, `You have ${lvl}`, x + cw / 2, yy + 72, C.brown);
      if (hov && ui.pressed) { ui.pressed = false; this.chip.sfx('goal'); this.to(() => { sim.startNewYear(p.id); this.mode = 'play'; this.shownMoney = sim.s.money; this.pickMusic(); this.save(); }); }
      center(g, String(i + 1), x + cw / 2, yy + 84, C.brown); if (this.tap('Digit' + (i + 1))) { this.chip.sfx('goal'); this.to(() => { sim.startNewYear(p.id); this.mode = 'play'; this.shownMoney = sim.s.money; this.pickMusic(); this.save(); }); }
    });
  }
}
void MONTHS; void SIZE_NAME; void PERKS; void PW; void mix; void person; void PLAYER_LOOK;
