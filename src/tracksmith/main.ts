import '@fontsource/lilita-one/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/barlow-condensed/700-italic.css';
import './ui.css';
import { initPhysics } from './sim.ts';
import { loadKit } from './kit.ts';
import { Stage } from './render.ts';
import { Race } from './game.ts';
import { Editor, PALETTE, pieceThumbs } from './editor.ts';
import { Audio } from './audio.ts';
import { Controls } from './input.ts';
import { builtinTracks } from './builtin.ts';
import { THEMES } from './theme.ts';
import { PIECES } from './pieces.ts';
import { PAINTS, ACCENTS } from './car.ts';
import { decodeTrack, encodeTrack, validate, hash, type TrackData } from './track.ts';
import { loadProfile, saveProfile, loadMine, saveMine, fmt, dropGhost, type Profile } from './store.ts';

type Mode = 'menu' | 'race' | 'editor';

const $ = <E extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as E;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

function medalOf(ms: number | undefined, m?: [number, number, number, number]) {
  if (ms === undefined || !m || !m[0]) return 0;
  if (ms <= m[0]) return 4;
  if (ms <= m[1]) return 3;
  if (ms <= m[2]) return 2;
  if (ms <= m[3]) return 1;
  return 0;
}
const medalDots = (n: number) => `<div class="medals">${[1, 2, 3, 4].map((k) => `<span class="medal ${n >= k ? 'm' + k : ''}"></span>`).join('')}</div>`;
const MEDAL_NAMES = ['', 'Bronze', 'Silver', 'Gold', 'Author'];

class App {
  stage: Stage;
  audio = new Audio();
  controls = new Controls();
  profile: Profile = loadProfile();
  mine: TrackData[] = loadMine();
  builtins = builtinTracks();
  race: Race;
  editor: Editor;
  mode: Mode = 'menu';
  current: TrackData | null = null;
  fromEditor = false;
  private ui = $('#ui');
  private last = performance.now();
  private deltaT = 0;
  private toastT = 0;
  private thumbs: string[] = [];
  private finishShown = false;

  constructor() {
    this.stage = new Stage($<HTMLCanvasElement>('#gl'));
    this.race = new Race(this.stage, this.audio, this.controls, this.profile);
    this.editor = new Editor(this.stage, this.audio, this.controls, {
      changed: (td) => this.saveEdited(td),
      status: (s) => this.edStatus(s),
      test: () => this.testDrive(),
      exit: () => this.leaveEditor(),
    });
    this.buildDom();
    this.race.hooks = {
      onTime: (ms) => { $('#h-time').textContent = fmt(ms); },
      onSpeed: (k) => { $('#h-speed').textContent = String(Math.round(k)); },
      onStart: () => { $('#h-go').style.display = 'none'; },
      onReset: () => this.resetHud(),
      onCheck: (n, total, ms, delta) => this.hudCheck(n, total, ms, delta),
      onStyle: (text) => {
        const d = $('#h-delta');
        d.textContent = text;
        d.className = 'delta show style';
        this.deltaT = 1;
      },
      onFinish: (ms, pb, rec) => { $('#h-time').textContent = fmt(ms); this.finish(ms, pb, rec); },
      onRespawn: () => {},
    };
    window.addEventListener('pointerdown', () => this.audio.start(), { once: false });
    window.addEventListener('keydown', () => this.audio.start());
    this.audio.setVolume(this.profile.volume);
    this.race.setCam(this.profile.cam);

    // a shared link opens straight into the track
    const code = new URLSearchParams(location.search).get('track');
    const shared = code ? decodeTrack(code) : null;
    this.attract();
    if (shared) this.play(shared);
    else this.screen('menu');
    requestAnimationFrame(() => this.frame());
  }

  // ------------------------------------------------------------ dom

  private buildDom() {
    this.ui.innerHTML = `
      <div class="scr" id="s-menu">
        <div class="menu-side">
          <div class="logo">Track<b>smith</b><small>Build it · Drive it · Shave it</small></div>
          <div class="mlist">
            <button class="mbtn" data-go="campaign"><span class="ic">1</span><span class="t">Campaign</span><span class="s" id="m-camp"></span></button>
            <button class="mbtn" data-go="editor-new"><span class="ic">2</span><span class="t">Track editor</span><span class="s">Build your own</span></button>
            <button class="mbtn" data-go="mine"><span class="ic">3</span><span class="t">My tracks</span><span class="s" id="m-mine"></span></button>
            <button class="mbtn" data-go="import"><span class="ic">4</span><span class="t">Play a code</span><span class="s">From a friend</span></button>
            <button class="mbtn" data-go="garage"><span class="ic">5</span><span class="t">Garage</span><span class="s">Paint your car</span></button>
            <button class="mbtn" data-go="settings"><span class="ic">6</span><span class="t">Settings</span><span class="s">Sound, camera, keys</span></button>
          </div>
          <div class="menu-foot"><a href="index.html?pick">← All games</a><span>Arrow keys or WASD · R restarts</span></div>
        </div>
      </div>
      <div class="scr" id="s-campaign"><div class="panel pe"><div class="phead"><button class="back" data-go="menu">←</button><h2>Campaign</h2><span class="sub" id="c-sum"></span></div><div class="tgrid" id="c-grid"></div></div></div>
      <div class="scr" id="s-mine"><div class="panel pe"><div class="phead"><button class="back" data-go="menu">←</button><h2>My tracks</h2><span class="grow"></span><button class="chip hot" data-go="editor-new">New track</button></div><div class="rows" id="mine-rows"></div></div></div>
      <div class="scr" id="s-import"><div class="panel narrow pe"><div class="phead"><button class="back" data-go="menu">←</button><h2>Play a code</h2></div>
        <div class="field"><label>Track code or link</label><textarea class="tin" id="i-code" placeholder="TS1...."></textarea></div>
        <div style="display:flex;gap:8px"><button class="chip hot" id="i-play">Play</button><button class="chip" id="i-save">Save to my tracks</button><span class="grow"></span><span class="sub" id="i-msg" style="color:var(--dim)"></span></div></div></div>
      <div class="scr" id="s-garage"><div class="panel narrow pe"><div class="phead"><button class="back" data-go="menu">←</button><h2>Garage</h2></div>
        <div class="field"><label>Driver name</label><input class="tin" id="g-name" maxlength="18"></div>
        <div class="field"><label>Paint</label><div class="sw" id="g-paint"></div></div>
        <div class="field"><label>Wing and stripe</label><div class="sw" id="g-acc"></div></div></div></div>
      <div class="scr" id="s-settings"><div class="panel narrow pe"><div class="phead"><button class="back" data-go="menu">←</button><h2>Settings</h2></div>
        <div class="field"><label>Volume</label><input type="range" min="0" max="1" step="0.05" id="st-vol"></div>
        <div class="field"><label>Camera (C while driving)</label><div style="display:flex;gap:8px" id="st-cam"><button class="chip" data-cam="0">Chase</button><button class="chip" data-cam="1">Far chase</button><button class="chip" data-cam="2">Bonnet</button></div></div>
        <div class="field"><label>Ghost of your best run</label><div style="display:flex;gap:8px" id="st-ghost"><button class="chip" data-g="1">On</button><button class="chip" data-g="0">Off</button></div></div>
        <div class="field"><label>Keys</label><div class="keys">
          <b>W / ↑</b><span>Accelerate</span><b>S / ↓</b><span>Brake, then reverse</span><b>A D / ← →</b><span>Steer</span><b>Space</b><span>Drift: hold through a corner, let go for a boost</span><b>In the air</b><span>Steer to turn. Brake lifts the nose, Space drops it. Land straight for a speed kick</span>
          <b>R</b><span>Restart (instant)</span><b>Enter</b><span>Back to last checkpoint</span><b>C</b><span>Camera</span><b>Esc</b><span>Pause</span>
          <b>Pad</b><span>RT / LT, stick, Y restart, B checkpoint</span></div></div></div></div>

      <div class="scr" id="s-race">
        <div class="hud-name" id="h-name"></div>
        <div class="hud-time"><div class="big" id="h-time">0.000</div><div class="cp" id="h-cp"></div></div>
        <div class="delta" id="h-delta"></div>
        <div class="hud-target" id="h-target"></div>
        <div class="hud-speed"><div class="v" id="h-speed">0</div><div class="u">KM/H</div></div>
        <div class="hud-keys"><span><b>R</b>Restart</span><span><b>Enter</b>Checkpoint</span><span><b>C</b>Camera</span><span><b>Esc</b>Menu</span></div>
        <div class="hud-go" id="h-go">Hit the gas to start</div>
        <div id="h-finish"></div>
        <div class="pause" id="h-pause" style="display:none"><div class="box"><h2>Paused</h2>
          <button class="mbtn" data-p="resume"><span class="t">Resume</span><span class="s">Esc</span></button>
          <button class="mbtn" data-p="restart"><span class="t">Restart</span><span class="s">R</span></button>
          <button class="mbtn" data-p="exit"><span class="t" id="p-exit">Leave track</span></button></div></div>
      </div>

      <div class="scr" id="s-editor">
        <div class="ed-top">
          <button class="back" id="e-back" title="Back (Esc)">←</button>
          <input class="tin" id="e-name" maxlength="28" placeholder="Track name">
          <div class="th-dots" id="e-theme"></div>
          <span class="sep"></span>
          <button class="chip" id="e-undo">Undo</button><button class="chip" id="e-redo">Redo</button>
          <button class="chip warn" id="e-clear">Clear</button>
          <span class="grow"></span>
          <button class="chip" id="e-share">Copy code</button>
          <button class="chip hot" id="e-test">Test drive (T)</button>
        </div>
        <div class="ed-pal" id="e-pal"></div>
        <div class="ed-help"><span><b>Click</b> place</span><span><b>Drag</b> paint</span><span><b>Shift+click</b> erase</span><span><b>Alt+click / F</b> pick</span><span><b>R</b> rotate</span><span><b>Q E</b> level</span><span><b>Right-drag</b> orbit</span><span><b>Shift+right-drag</b> pan</span><span><b>WASD</b> move</span><span><b>Wheel</b> zoom</span><span><b>Ctrl+Z</b> undo</span></div>
        <div class="ed-status" id="e-status"></div>
      </div>
      <div class="toast" id="toast"></div>`;

    this.ui.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
      if (b) { this.audio.click(); this.go(b.dataset.go!); }
    });
    // garage
    const gp = $('#g-paint'), ga = $('#g-acc');
    gp.innerHTML = PAINTS.map((c) => `<button style="background:${hex(c)}" data-c="${c}"></button>`).join('');
    ga.innerHTML = ACCENTS.map((c) => `<button style="background:${hex(c)}" data-c="${c}"></button>`).join('');
    gp.addEventListener('click', (e) => { const c = (e.target as HTMLElement).dataset.c; if (c) { this.profile.paint = +c; this.applyLook(); } });
    ga.addEventListener('click', (e) => { const c = (e.target as HTMLElement).dataset.c; if (c) { this.profile.accent = +c; this.applyLook(); } });
    const nm = $<HTMLInputElement>('#g-name');
    nm.value = this.profile.name;
    nm.addEventListener('input', () => { this.profile.name = nm.value.trim() || 'Driver'; saveProfile(this.profile); });
    // settings
    const vol = $<HTMLInputElement>('#st-vol');
    vol.value = String(this.profile.volume);
    vol.addEventListener('input', () => { this.profile.volume = +vol.value; this.audio.setVolume(this.profile.volume); saveProfile(this.profile); });
    $('#st-cam').addEventListener('click', (e) => { const c = (e.target as HTMLElement).dataset.cam; if (c) { this.profile.cam = +c; this.race.setCam(+c); saveProfile(this.profile); this.syncSettings(); } });
    $('#st-ghost').addEventListener('click', (e) => { const g = (e.target as HTMLElement).dataset.g; if (g) { this.profile.ghost = g === '1'; saveProfile(this.profile); this.syncSettings(); } });
    // import
    $('#i-play').addEventListener('click', () => { const td = this.readCode(); if (td) this.play(td); });
    $('#i-save').addEventListener('click', () => {
      const td = this.readCode();
      if (!td) return;
      td.id = 'mine-' + Date.now().toString(36);
      this.mine.unshift(td);
      saveMine(this.mine);
      this.toast('Saved to My tracks');
    });
    // pause
    $('#h-pause').addEventListener('click', (e) => {
      const p = ((e.target as HTMLElement).closest('[data-p]') as HTMLElement | null)?.dataset.p;
      if (p === 'resume') this.pause(false);
      if (p === 'restart') { this.pause(false); this.race.restart(); }
      if (p === 'exit') { this.pause(false); this.leaveRace(); }
    });
    // editor
    $('#e-back').addEventListener('click', () => this.leaveEditor());
    $('#e-test').addEventListener('click', () => this.testDrive());
    $('#e-undo').addEventListener('click', () => this.editor.doUndo());
    $('#e-redo').addEventListener('click', () => this.editor.doRedo());
    $('#e-clear').addEventListener('click', () => { this.editor.clear(); this.toast('Cleared (Ctrl+Z to undo)'); });
    $('#e-share').addEventListener('click', () => this.share(this.editor.td));
    const en = $<HTMLInputElement>('#e-name');
    en.addEventListener('input', () => { this.editor.td.name = en.value || 'Untitled'; this.saveEdited(this.editor.td); });
    $('#e-theme').innerHTML = THEMES.map((t, i) => `<button title="${t.name}" data-th="${i}" style="background:linear-gradient(135deg, ${hex(t.skyTop)} 0 50%, ${hex(t.ground)} 50%)"></button>`).join('');
    $('#e-theme').addEventListener('click', (e) => { const t = (e.target as HTMLElement).dataset.th; if (t) { this.editor.setTheme(+t); this.syncEditorTop(); } });
    $('#e-pal').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('[data-pi]') as HTMLElement | null; if (b) { this.editor.select(+b.dataset.pi!); this.audio.click(); } });
    this.syncSettings();
    this.applyLook(false);
  }

  private syncSettings() {
    document.querySelectorAll<HTMLElement>('#st-cam [data-cam]').forEach((b) => b.classList.toggle('on', +b.dataset.cam! === this.profile.cam));
    document.querySelectorAll<HTMLElement>('#st-ghost [data-g]').forEach((b) => b.classList.toggle('on', (b.dataset.g === '1') === this.profile.ghost));
  }

  private applyLook(save = true) {
    this.race.car.setLook({ paint: this.profile.paint, accent: this.profile.accent });
    this.race.car.dispose();
    this.stage.scene.remove(this.race.car.root);
    // rebuild so the wing/stripe accent updates
    const C = this.race.car.constructor as new (l: { paint: number; accent: number }) => typeof this.race.car;
    this.race.car = new C({ paint: this.profile.paint, accent: this.profile.accent });
    this.stage.scene.add(this.race.car.root);
    document.querySelectorAll<HTMLElement>('#g-paint button').forEach((b) => b.classList.toggle('on', +b.dataset.c! === this.profile.paint));
    document.querySelectorAll<HTMLElement>('#g-acc button').forEach((b) => b.classList.toggle('on', +b.dataset.c! === this.profile.accent));
    if (save) saveProfile(this.profile);
  }

  private screen(id: string) {
    document.querySelectorAll('#ui .scr').forEach((s) => s.classList.toggle('on', s.id === 's-' + id));
    const first = $<HTMLElement>(`#s-${id} .mbtn, #s-${id} .tcard, #s-${id} .chip`);
    if (first && id !== 'race' && id !== 'editor') first.focus({ preventScroll: true });
  }

  private go(where: string) {
    if (where === 'menu') { this.screen('menu'); this.menuStats(); }
    if (where === 'campaign') { this.campaign(); this.screen('campaign'); }
    if (where === 'mine') { this.mineList(); this.screen('mine'); }
    if (where === 'import') { this.screen('import'); $<HTMLTextAreaElement>('#i-code').focus(); }
    if (where === 'garage') this.screen('garage');
    if (where === 'settings') this.screen('settings');
    if (where === 'editor-new') this.newTrack();
  }

  private menuStats() {
    const got = this.builtins.filter((t) => this.profile.pbs[t.id] !== undefined).length;
    const golds = this.builtins.filter((t) => medalOf(this.profile.pbs[t.id], t.medals) >= 3).length;
    $('#m-camp').textContent = `${got}/${this.builtins.length} driven · ${golds} gold`;
    $('#m-mine').textContent = this.mine.length ? `${this.mine.length} saved` : 'None yet';
  }

  private campaign() {
    const g = $('#c-grid');
    g.innerHTML = this.builtins.map((t, i) => {
      const pb = this.profile.pbs[t.id];
      const md = medalOf(pb, t.medals);
      const th = THEMES[t.theme];
      return `<button class="tcard" data-ti="${i}" style="--th:${hex(th.accent)}"><img class="shot" alt="" loading="lazy" src="tracksmith/cards/${t.id}.webp"><span class="no">${String(i + 1).padStart(2, '0')}</span><span class="nm">${esc(t.name)}</span><span class="thn">${th.name}</span>${medalDots(md)}<span class="tm ${pb === undefined ? 'none' : ''}">${pb === undefined ? 'Not driven yet' : fmt(pb)}</span></button>`;
    }).join('');
    g.querySelectorAll<HTMLElement>('[data-ti]').forEach((b) => b.addEventListener('click', () => { this.audio.click(); this.play(this.builtins[+b.dataset.ti!]); }));
    const all = this.builtins.reduce((a, t) => a + medalOf(this.profile.pbs[t.id], t.medals), 0);
    $('#c-sum').textContent = `${all} / ${this.builtins.length * 4} medals`;
  }

  private mineList() {
    const r = $('#mine-rows');
    if (!this.mine.length) { r.innerHTML = `<div class="empty">No tracks yet. Hit <b>New track</b> to build one.</div>`; return; }
    r.innerHTML = this.mine.map((t, i) => {
      const pb = this.profile.pbs[t.id];
      return `<div class="row"><div><div class="nm">${esc(t.name)}</div><div class="meta">${t.pieces.length} pieces · ${THEMES[t.theme].name}${t.medals ? ' · author ' + fmt(t.medals[0]) : ''}</div></div><span class="grow"></span>${medalDots(medalOf(pb, t.medals))}<span class="tm">${pb === undefined ? '—' : fmt(pb)}</span>
        <button class="chip hot" data-a="play" data-i="${i}">Play</button><button class="chip" data-a="edit" data-i="${i}">Edit</button><button class="chip" data-a="share" data-i="${i}">Code</button><button class="chip warn" data-a="del" data-i="${i}">Delete</button></div>`;
    }).join('');
    r.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const t = this.mine[+b.dataset.i!];
      const a = b.dataset.a;
      if (a === 'play') this.play(t);
      if (a === 'edit') this.openEditor(t);
      if (a === 'share') this.share(t);
      if (a === 'del') {
        if (b.textContent !== 'Sure?') { b.textContent = 'Sure?'; return; }
        this.mine.splice(+b.dataset.i!, 1);
        saveMine(this.mine);
        dropGhost(t.id);
        this.mineList();
      }
    }));
  }

  private readCode(): TrackData | null {
    let s = $<HTMLTextAreaElement>('#i-code').value.trim();
    const m = /[?&]track=([^&\s]+)/.exec(s);
    if (m) s = decodeURIComponent(m[1]);
    const td = decodeTrack(s);
    const msg = $('#i-msg');
    if (!td) { msg.textContent = 'That code is not a Tracksmith track'; return null; }
    const v = validate(td);
    if (v) { msg.textContent = v; return null; }
    msg.textContent = '';
    return td;
  }

  private share(td: TrackData) {
    const code = encodeTrack(td);
    const url = `${location.origin}${location.pathname}?track=${encodeURIComponent(code)}`;
    const done = () => this.toast('Link copied: send it to a friend');
    try { navigator.clipboard.writeText(url).then(done, () => { prompt('Copy this link', url); }); } catch { prompt('Copy this link', url); }
  }

  toast(s: string) {
    const t = $('#toast');
    t.textContent = s;
    t.classList.add('show');
    this.toastT = 2.4;
  }

  // ------------------------------------------------------------ race

  private attract() {
    this.mode = 'menu';
    this.current = null;
    const t = this.builtins[(Math.floor(Date.now() / 60000) % this.builtins.length)];
    this.race.load(t, { attract: true });
    this.race.setCam(1);
  }

  play(td: TrackData, testing = false) {
    const v = validate(td);
    if (v) { this.toast(v); return; }
    if (this.mode === 'editor') this.editor.close();
    this.mode = 'race';
    this.current = td;
    this.fromEditor = testing;
    this.race.load(td, { testing });
    this.race.setCam(this.profile.cam);
    this.profile.lastTrack = td.id;
    saveProfile(this.profile);
    this.screen('race');
    $('#h-name').innerHTML = `${esc(td.name)}<small>${testing ? 'Test drive · Esc back to the editor' : esc(td.author || '')}</small>`;
    $('#p-exit').textContent = testing ? 'Back to the editor' : 'Leave track';
    this.targets();
  }

  private targets() {
    const td = this.current!;
    const pb = this.profile.pbs[td.id];
    const rows: string[] = [];
    if (pb !== undefined) rows.push(`<div>Best ${fmt(pb)}</div>`);
    const md = medalOf(pb, td.medals);
    if (td.medals && md < 4) {
      const next = md + 1;
      rows.push(`<div><span class="medal m${next}"></span>${MEDAL_NAMES[next]} ${fmt(td.medals[4 - next])}</div>`);
    }
    $('#h-target').innerHTML = rows.join('');
  }

  private resetHud() {
    $('#h-go').style.display = this.mode === 'race' ? '' : 'none';
    $('#h-finish').innerHTML = '';
    $('#h-delta').className = 'delta';
    this.finishShown = false;
    const n = this.race.sim?.checks.length ?? 0;
    $('#h-cp').innerHTML = n ? `${Array.from({ length: n }, () => '<i></i>').join('')}<span>0/${n}</span>` : '';
    $('#h-cp').style.display = n ? '' : 'none';
  }

  private hudCheck(n: number, total: number, _ms: number, delta: number | null) {
    const cp = $('#h-cp');
    cp.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < n));
    const s = cp.querySelector('span');
    if (s) s.textContent = `${n}/${total}`;
    const d = $('#h-delta');
    if (delta === null) { d.textContent = `Checkpoint ${n}`; d.className = 'delta show neutral'; }
    else { d.textContent = fmt(delta, true); d.className = 'delta show ' + (delta <= 0 ? 'good' : 'bad'); }
    this.deltaT = 2;
  }

  private finish(ms: number, pb: number | null, record: boolean) {
    const td = this.current!;
    // the author of a home-made track sets its medals with their test drive
    if (this.fromEditor || td.id.startsWith('mine-')) {
      const own = this.mine.find((t) => t.id === td.id);
      if (own && this.fromEditor && (!own.medals || ms < own.medals[0])) {
        own.medals = [Math.round(ms), Math.round(ms * 1.06), Math.round(ms * 1.2), Math.round(ms * 1.45)];
        td.medals = own.medals;
        saveMine(this.mine);
      }
    }
    const md = medalOf(ms, td.medals);
    const delta = pb !== null ? ms - pb : null;
    const nextIdx = this.builtins.findIndex((t) => t.id === td.id);
    const next = nextIdx >= 0 && nextIdx < this.builtins.length - 1 ? this.builtins[nextIdx + 1] : null;
    $('#h-finish').innerHTML = `<div class="finish">
      <div class="ft">${esc(td.name)}</div>
      <div class="fbig">${fmt(ms)}</div>
      ${record ? `<span class="rec">${pb === null ? 'First finish' : 'New best'}</span>` : ''}
      ${delta !== null ? `<div class="fd ${delta <= 0 ? 'good' : 'bad'}">${fmt(delta, true)} vs best${record ? ' before' : ''}</div>` : ''}
      ${td.medals ? `<div class="fmed">${[4, 3, 2, 1].map((k) => `<div class="${md >= k ? 'got' : ''}"><span class="medal m${k}"></span>${MEDAL_NAMES[k]}<span>${fmt(td.medals![4 - k])}</span></div>`).join('')}</div>` : this.fromEditor ? `<div class="fd">Author time set: medals are now on this track</div>` : ''}
      <div class="fbtns"><button class="chip hot" id="f-retry">Retry (R)</button>${next && !this.fromEditor ? `<button class="chip" id="f-next">Next: ${esc(next.name)}</button>` : ''}<button class="chip" id="f-exit">${this.fromEditor ? 'Back to editor' : 'Menu'}</button></div>
    </div>`;
    this.finishShown = true;
    $('#f-retry').addEventListener('click', () => this.race.restart());
    $('#f-exit').addEventListener('click', () => this.leaveRace());
    const nb = document.getElementById('f-next');
    if (nb && next) nb.addEventListener('click', () => this.play(next));
    this.targets();
  }

  private pause(on: boolean) {
    this.race.paused = on;
    $('#h-pause').style.display = on ? '' : 'none';
    if (on) $<HTMLElement>('#h-pause .mbtn').focus();
  }

  private leaveRace() {
    this.race.paused = false;
    if (this.fromEditor && this.current) {
      this.openEditor(this.current, true);
      return;
    }
    this.attract();
    this.go(this.current && this.current.id.startsWith('mine-') ? 'mine' : 'campaign');
  }

  // ------------------------------------------------------------ editor

  private newTrack() {
    const td: TrackData = { id: 'mine-' + Date.now().toString(36), name: 'My track ' + (this.mine.length + 1), author: this.profile.name, theme: Math.floor(Math.random() * THEMES.length), pieces: [{ t: PIECES.findIndex((p) => p.id === 'start'), x: 0, z: 0, l: 0, r: 0 }] };
    this.mine.unshift(td);
    saveMine(this.mine);
    this.openEditor(td);
  }

  openEditor(td: TrackData, keepCam = false) {
    this.mode = 'editor';
    this.race.paused = false;
    // pieces live in the editor's copy; the saved list holds the same object
    let own = this.mine.find((t) => t.id === td.id);
    if (!own) {
      own = { ...td, id: 'mine-' + Date.now().toString(36), pieces: td.pieces.map((p) => ({ ...p })), route: undefined, medals: undefined, author: this.profile.name };
      this.mine.unshift(own);
      saveMine(this.mine);
    }
    this.race.car.root.visible = false;
    this.race.ghostCar.root.visible = false;
    this.race.view.group.visible = false;
    this.editor.open(own, keepCam);
    if (!this.thumbs.length) this.thumbs = pieceThumbs(this.stage);
    $('#e-pal').innerHTML = PALETTE.map((pi, n) => `<button data-pi="${pi}" title="${PIECES[pi].name}">${n < 10 ? `<em>${(n + 1) % 10}</em>` : ''}<img src="${this.thumbs[pi]}" alt=""><span>${PIECES[pi].name}</span></button>`).join('');
    this.syncEditorTop();
    this.screen('editor');
    this.edStatus({ level: this.editor.level, rot: this.editor.rot, sel: this.editor.sel, count: own.pieces.length, hover: '' });
  }

  private syncEditorTop() {
    $<HTMLInputElement>('#e-name').value = this.editor.td.name;
    document.querySelectorAll<HTMLElement>('#e-theme button').forEach((b) => b.classList.toggle('on', +b.dataset.th! === this.editor.td.theme));
  }

  private edStatus(s: { level: number; rot: number; sel: number; count: number; hover: string }) {
    document.querySelectorAll<HTMLElement>('#e-pal [data-pi]').forEach((b) => b.classList.toggle('on', +b.dataset.pi! === s.sel));
    const v = this.editor.td ? validate(this.editor.td) : null;
    $('#e-status').innerHTML = `<span>Level ${s.level}</span><span>Turn ${s.rot * 90}°</span><span>${s.count} pieces</span>${v ? `<span class="warn">${v}</span>` : '<span class="ok">Ready to drive</span>'}`;
  }

  private saveEdited(td: TrackData) {
    // edits change the track: old records and medals no longer apply
    td.medals = undefined;
    delete this.profile.pbs[td.id];
    delete this.profile.splits[td.id];
    dropGhost(td.id);
    saveMine(this.mine);
  }

  private testDrive() {
    const td = this.editor.td;
    const v = validate(td);
    if (v) { this.toast(v); return; }
    this.race.view.group.visible = true;
    this.race.car.root.visible = true;
    this.play(td, true);
  }

  private leaveEditor() {
    this.editor.close();
    this.race.view.group.visible = true;
    this.race.car.root.visible = true;
    this.attract();
    this.mineList();
    this.screen('mine');
  }

  // ------------------------------------------------------------ loop

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.controls.poll();
    const c = this.controls;
    const startMode = this.mode;

    if (this.mode === 'race') {
      if (c.hit('Escape')) {
        if (this.finishShown) this.leaveRace();
        else this.pause(!this.race.paused);
      }
      if (!this.race.paused) {
        if (c.hit('KeyR')) this.race.restart();
        if (c.hit('Enter', 'Backspace')) this.race.respawn();
        if (c.hit('KeyC')) { this.profile.cam = (this.profile.cam + 1) % 3; this.race.setCam(this.profile.cam); saveProfile(this.profile); this.syncSettings(); }
      }
    }
    if (this.mode === 'menu') {
      const scr = document.querySelector('#ui .scr.on')?.id;
      if (c.hit('Escape') && scr !== 's-menu') this.go('menu');
      if (scr === 's-menu') {
        for (let i = 1; i <= 6; i++) if (c.hit('Digit' + i)) { const b = document.querySelectorAll<HTMLElement>('#s-menu .mbtn')[i - 1]; b?.click(); }
      }
    }

    // a key that switched modes this frame must not also act in the new mode
    if (this.mode !== startMode) c.endFrame();
    if (this.mode === 'editor') {
      this.editor.update(dt);
      this.audio.drive(0, 0, 0, false, false, dt);
    } else {
      this.race.update(dt);
      if (this.mode === 'menu') this.audio.drive(0, 0, 0, false, false, dt);
    }

    if (this.deltaT > 0 && (this.deltaT -= dt) <= 0) $('#h-delta').classList.remove('show');
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) $('#toast').classList.remove('show');
    c.endFrame();
    this.stage.render();
  }
}

async function boot() {
  const bar = document.querySelector('#loading .lbar b') as HTMLElement | null;
  if (bar) bar.style.width = '40%';
  await Promise.all([initPhysics(), loadKit()]);
  if (bar) bar.style.width = '80%';
  const app = new App();
  (window as unknown as { __ts: App }).__ts = app;
  if (bar) bar.style.width = '100%';
  requestAnimationFrame(() => {
    document.getElementById('loading')?.classList.add('done');
    (window as unknown as { __ready: boolean }).__ready = true;
  });
}

boot().catch((e) => {
  const el = document.querySelector('#loading .lerr');
  if (el) el.textContent = String(e?.stack ?? e);
  console.error(e);
});

void hash;
