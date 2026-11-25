// On-screen display: stats, minimap, speedometer, objectives, messages, title screen and pause map.
import { WORLD } from '../world/map';
import { MAP_SCALE, buildMapCanvas, drawDistrictLabels } from './mapCanvas';
import { MISSIONS, type Blip } from '../game/missions';
import { WEAPONS } from '../game/weapons';
import type { Game } from '../game/game';

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.1 5.9 20.6l1.5-6.8L2.2 9.2l6.9-.7z"/></svg>';

function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstElementChild as T;
}

export class Hud {
  root: HTMLElement;
  mapImg: HTMLCanvasElement;
  mini: HTMLCanvasElement;
  private mctx: CanvasRenderingContext2D;
  private q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
  private starsEl: HTMLElement;
  private subT = 0;
  private promptText = '';
  private bigT = 0;
  private titleEl: HTMLElement;
  private pauseEl: HTMLElement;
  private pctx: CanvasRenderingContext2D;
  private fpsT = 0;
  private frames = 0;
  waypoint: { x: number; z: number } | null = null;
  hitT = 0;
  drawn = { health: false, cash: false, minimap: false, stars: false, speedo: false };

  constructor(private game: Game) {
    this.mapImg = buildMapCanvas(game.map);
    this.root = el(`
<div id="hud" class="hidden">
  <div id="stats">
    <div id="clock" class="clock">12:00 PM</div>
    <div id="cash">$0</div>
    <div id="stars">${STAR.repeat(5)}</div>
    <div id="weapon" class="panel"><span class="name">Fists</span><span class="ammo"></span></div>
  </div>
  <div id="toasts"></div>
  <div id="mini"><canvas width="440" height="440"></canvas><div id="hp" class="bar"><div style="width:100%"></div></div><div id="vhp" class="bar hidden"><div style="width:100%"></div></div></div>
  <div id="speedo" class="panel hidden"><div><span class="num">0</span><span class="unit">MPH</span></div><div class="rpm"><div style="width:0%"></div></div><div class="car"></div></div>
  <div id="objective" class="panel hidden"><div class="t"></div><div class="o"></div><div class="timer"></div></div>
  <div id="subtitle"></div>
  <div id="prompt" class="panel hidden"></div>
  <div id="crosshair" class="hidden"></div>
  <div id="big"><div class="h"></div><div class="s"></div></div>
  <div id="fps"></div>
</div>`);
    document.body.appendChild(this.root);
    this.mini = this.q<HTMLCanvasElement>('#mini canvas');
    this.mctx = this.mini.getContext('2d')!;
    this.starsEl = this.q('#stars');
    // title screen
    this.titleEl = el(`
<div id="title" class="overlay">
  <div class="logo">PALMERA</div>
  <div class="tag">Port Palmera &middot; Sun, Sand &amp; Bad Decisions</div>
  <button class="play" id="play">PLAY</button>
  <div class="controls">
    <div><b>WASD</b>Move / Drive</div><div><b>Mouse</b>Look</div><div><b>Shift</b>Sprint</div><div><b>Space</b>Jump / Handbrake</div>
    <div><b>F</b>Enter / Exit car</div><div><b>LMB</b>Punch / Shoot</div><div><b>RMB</b>Aim</div><div><b>R</b>Reload</div>
    <div><b>Q / E</b>Switch weapon</div><div><b>H</b>Horn</div><div><b>M</b>Map</div><div><b>Esc</b>Pause</div>
  </div>
  <div class="foot">An original open-world sandbox. Everything you see is generated in code.</div>
</div>`);
    document.body.appendChild(this.titleEl);
    this.pauseEl = el(`
<div id="pause" class="overlay hidden">
  <canvas></canvas>
  <div class="side panel">
    <h2>PAUSED</h2>
    <div class="hint">Click the map to set a waypoint. Scroll to zoom.</div>
    <div class="legend">
      <div><i style="background:#fff4e0"></i>You</div>
      <div><i style="background:#ff6fa5"></i>Job: Bayline Exit</div>
      <div><i style="background:#5fd3ff"></i>Job: Loose Lips</div>
      <div><i style="background:#7dff9a"></i>Job: Cold Chain</div>
      <div><i style="background:#ffd23f"></i>Objective</div>
      <div><i style="background:#ff3b3b"></i>Police</div>
      <div><i style="background:#c77dff"></i>Waypoint</div>
    </div>
    <div id="jobs"></div>
    <button id="resume">RESUME</button>
    <button id="mute" class="alt">SOUND: ON</button>
    <button id="clearwp" class="alt">CLEAR WAYPOINT</button>
  </div>
</div>`);
    document.body.appendChild(this.pauseEl);
    const pc = this.pauseEl.querySelector('canvas') as HTMLCanvasElement;
    this.pctx = pc.getContext('2d')!;
    pc.addEventListener('click', (e) => {
      const [x, z] = this.fullMapInverse(e.clientX, e.clientY);
      this.waypoint = { x, z };
      this.drawFullMap();
    });
    pc.addEventListener('wheel', (e) => {
      this.mapZoom = Math.max(0.6, Math.min(4, this.mapZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      this.drawFullMap();
    });
    (this.pauseEl.querySelector('#resume') as HTMLElement).onclick = () => game.setPaused(false);
    const mute = this.pauseEl.querySelector('#mute') as HTMLElement;
    mute.onclick = () => {
      game.audio.setMuted(!game.audio.muted);
      mute.textContent = game.audio.muted ? 'SOUND: OFF' : 'SOUND: ON';
    };
    (this.pauseEl.querySelector('#clearwp') as HTMLElement).onclick = () => {
      this.waypoint = null;
      this.drawFullMap();
    };
  }

  onPlay(cb: () => void) {
    (this.titleEl.querySelector('#play') as HTMLElement).onclick = cb;
  }

  showTitle(v: boolean) {
    this.titleEl.classList.toggle('hidden', !v);
    this.root.classList.toggle('hidden', v);
  }

  showPause(v: boolean) {
    this.pauseEl.classList.toggle('hidden', !v);
    if (v) {
      const p = this.game.player;
      const ref = p.vehicle ? p.vehicle.pos : p.pos;
      this.mapCenter = { x: ref.x, z: ref.z };
      this.drawFullMap();
      const jobs = this.pauseEl.querySelector('#jobs') as HTMLElement;
      jobs.innerHTML = MISSIONS.map((m) => `<div>${this.game.missions.done.has(m.id) ? '✔' : '○'} ${m.title} <span style="opacity:.6">· $${m.reward.toLocaleString()}</span></div>`).join('');
    }
  }

  // ---------------------------------------------------------------- messages
  toast(msg: string) {
    const t = el(`<div class="toast panel">${msg}</div>`);
    this.q('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  subtitle(text: string, secs = 4.5) {
    const s = this.q('#subtitle');
    s.textContent = text;
    s.style.opacity = '1';
    this.subT = secs;
  }

  prompt(html: string) {
    this.promptText = html;
  }

  bigMessage(h: string, s: string, color = '#fff4e0') {
    const b = this.q('#big');
    (b.querySelector('.h') as HTMLElement).textContent = h;
    (b.querySelector('.h') as HTMLElement).style.color = color;
    (b.querySelector('.s') as HTMLElement).textContent = s;
    b.classList.add('show');
    this.bigT = 3.5;
  }

  flashStars() {
    this.starsEl.classList.remove('pop');
    void this.starsEl.offsetWidth;
    this.starsEl.classList.add('pop');
  }

  // ---------------------------------------------------------------- per frame
  private lastStars = -1;
  private textCache = new Map<string, string>();
  private setText(sel: string, v: string) {
    if (this.textCache.get(sel) === v) return;
    this.textCache.set(sel, v);
    this.q(sel).textContent = v;
  }
  private setHtml(sel: string, v: string) {
    const k = 'html:' + sel;
    if (this.textCache.get(k) === v) return;
    this.textCache.set(k, v);
    this.q(sel).innerHTML = v;
  }
  private setWidth(sel: string, pct: number) {
    const v = `${Math.max(0, Math.round(pct * 10) / 10)}%`;
    const k = 'w:' + sel;
    if (this.textCache.get(k) === v) return;
    this.textCache.set(k, v);
    (this.q(sel) as HTMLElement).style.width = v;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.setText('#clock', g.sky.clockString());
    this.setText('#cash', '$' + Math.floor(g.displayCash).toLocaleString());
    this.drawn.cash = true;
    // stars (only touch the DOM when something changed)
    const starKey = g.wanted.level * 2 + (g.wanted.flash ? 1 : 0);
    if (starKey !== this.lastStars) {
      this.lastStars = starKey;
      const stars = this.starsEl.querySelectorAll('svg');
      stars.forEach((s, i) => {
        const on = i < g.wanted.level;
        s.classList.toggle('on', on);
        s.style.fill = on ? '#ffd23f' : 'rgba(255,255,255,0.18)';
        s.style.stroke = on ? '#7a3a00' : 'rgba(255,255,255,0.5)';
        s.style.strokeWidth = '1.2';
      });
      this.starsEl.classList.toggle('flash', g.wanted.flash);
    }
    this.drawn.stars = true;
    // weapon
    const w = p.weapon;
    if (w === 'fist') {
      this.setText('#weapon .name', 'Fists');
      this.setHtml('#weapon .ammo', '');
    } else {
      this.setText('#weapon .name', WEAPONS[w].name);
      this.setHtml('#weapon .ammo', g.loadout.reloadT > 0 ? '<small>RELOADING</small>' : `${g.loadout.clip[w]} <small>/ ${g.loadout.reserve[w]}</small>`);
    }
    // health
    this.setWidth('#hp > div', (p.health / p.maxHealth) * 100);
    this.drawn.health = true;
    const v = p.vehicle;
    this.q('#vhp').classList.toggle('hidden', !v);
    this.q('#speedo').classList.toggle('hidden', !v);
    if (v) {
      this.setWidth('#vhp > div', (v.health / v.spec.health) * 100);
      this.setText('#speedo .num', String(Math.round(v.speed * 2.237)));
      this.setWidth('#speedo .rpm > div', Math.round(v.rpm * 50) * 2);
      this.setText('#speedo .car', `${v.spec.label}${v.isBoat ? '' : ' · gear ' + v.gear}`);
      this.drawn.speedo = true;
    }
    // objective
    const obj = this.q('#objective');
    const m = g.missions;
    obj.classList.toggle('hidden', !m.active);
    if (m.active) {
      this.setText('#objective .t', m.title);
      this.setText('#objective .o', m.objective);
      const t = m.timer;
      this.setText('#objective .timer', t !== null ? `${Math.floor(Math.max(0, t) / 60)}:${Math.floor(Math.max(0, t) % 60).toString().padStart(2, '0')}` : '');
    }
    // subtitle / prompt / big
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.q('#subtitle').style.opacity = '0';
    }
    const pr = this.q('#prompt');
    pr.classList.toggle('hidden', !this.promptText);
    if (this.promptText && pr.innerHTML !== this.promptText) pr.innerHTML = this.promptText;
    this.promptText = '';
    if (this.bigT > 0) {
      this.bigT -= dt;
      if (this.bigT <= 0) this.q('#big').classList.remove('show');
    }
    // crosshair
    const ch = this.q('#crosshair');
    ch.classList.toggle('hidden', !(g.playerCtl.aiming || (p.weapon !== 'fist' && !p.vehicle)) || p.dead);
    if (this.hitT > 0) this.hitT -= dt;
    ch.classList.toggle('hit', this.hitT > 0);
    // fps
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      this.q('#fps').textContent = `${Math.round(this.frames / this.fpsT)} fps · ${g.renderer.info.render.calls} draws`;
      this.frames = 0;
      this.fpsT = 0;
    }
    this.drawMinimap();
  }

  private blipList(): Blip[] {
    const g = this.game;
    const out = [...g.missions.blips];
    for (const v of g.vehicles) if (v.police && v.siren) out.push({ x: v.pos.x, z: v.pos.z, color: Math.floor(g.elapsed * 4) % 2 ? '#ff3b3b' : '#3b7bff', label: '', kind: 'target' });
    for (const h of g.npcs) if (h.kind === 'cop' && !h.dead && g.wanted.level > 0) out.push({ x: h.pos.x, z: h.pos.z, color: '#ff3b3b', label: '', kind: 'target' });
    if (this.waypoint) out.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#c77dff', label: '', kind: 'dest' });
    return out;
  }

  private drawMinimap() {
    const g = this.game;
    const ctx = this.mctx;
    const S = this.mini.width;
    const R = S / 2;
    const p = g.player;
    const ref = p.vehicle ? p.vehicle.pos : p.pos;
    const yaw = g.playerCtl.camYaw;
    const speed = p.vehicle ? p.vehicle.speed : 0;
    const zoom = (p.vehicle ? 2.2 - Math.min(1, speed / 40) * 0.8 : 2.6) * (S / 220) * 0.5;
    const rot = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#14506e';
    ctx.fillRect(0, 0, S, S);
    ctx.translate(R, R);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.mapImg, -(ref.x - WORLD.x0) * MAP_SCALE, -(ref.z - WORLD.z0) * MAP_SCALE);
    ctx.restore();
    // blips
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const toMini = (x: number, z: number): [number, number, boolean] => {
      const dx = (x - ref.x) * zoom, dz = (z - ref.z) * zoom;
      let sx = dx * cr - dz * sr, sy = dx * sr + dz * cr;
      const d = Math.hypot(sx, sy);
      const lim = R - 14;
      let edge = false;
      if (d > lim) {
        sx = (sx / d) * lim;
        sy = (sy / d) * lim;
        edge = true;
      }
      return [R + sx, R + sy, edge];
    };
    for (const b of this.blipList()) {
      const [sx, sy, edge] = toMini(b.x, b.z);
      ctx.beginPath();
      const r = b.kind === 'mission' ? 13 : b.kind === 'dest' ? 11 : 8;
      ctx.arc(sx, sy, edge ? r * 0.8 : r, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0a1424';
      ctx.stroke();
      if (b.label && b.label.length <= 2) {
        ctx.fillStyle = '#0a1424';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label, sx, sy + 1);
      }
    }
    // player arrow
    const facing = p.vehicle ? p.vehicle.heading : p.yaw;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    const ax = fx * cr - fz * sr, ay = fx * sr + fz * cr;
    const ang = Math.atan2(ay, ax);
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(ang + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(12, 13);
    ctx.lineTo(0, 6);
    ctx.lineTo(-12, 13);
    ctx.closePath();
    ctx.fillStyle = '#fff4e0';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0a1424';
    ctx.stroke();
    ctx.restore();
    // north marker
    const [nx, ny] = toMini(ref.x, ref.z - 10000);
    ctx.fillStyle = '#ff6f61';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);
    this.drawn.minimap = true;
  }

  // ---------------------------------------------------------------- full map
  mapZoom = 1;
  mapCenter = { x: 50, z: 0 };
  private fullMapTransform() {
    const c = this.pctx.canvas;
    const W = c.width, H = c.height;
    const base = Math.min(W / (WORLD.x1 - WORLD.x0), H / (WORLD.z1 - WORLD.z0)) * 1.05;
    const s = base * this.mapZoom;
    const cx = this.mapZoom <= 1.01 ? (WORLD.x0 + WORLD.x1) / 2 : this.mapCenter.x;
    const cz = this.mapZoom <= 1.01 ? (WORLD.z0 + WORLD.z1) / 2 : this.mapCenter.z;
    return { s, ox: W / 2 - cx * s, oz: H / 2 - cz * s };
  }
  private fullMapInverse(px: number, py: number): [number, number] {
    const c = this.pctx.canvas;
    const k = c.width / c.clientWidth;
    const t = this.fullMapTransform();
    return [(px * k - t.ox) / t.s, (py * k - t.oz) / t.s];
  }

  drawFullMap() {
    const c = this.pctx.canvas;
    const dpr = Math.min(window.devicePixelRatio, 2);
    c.width = Math.floor(c.clientWidth * dpr);
    c.height = Math.floor(c.clientHeight * dpr);
    const ctx = this.pctx;
    const g = this.game;
    const t = this.fullMapTransform();
    ctx.fillStyle = '#0f3d55';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(t.ox, t.oz);
    ctx.scale(t.s, t.s);
    ctx.drawImage(this.mapImg, WORLD.x0, WORLD.z0, (WORLD.x1 - WORLD.x0), (WORLD.z1 - WORLD.z0));
    ctx.restore();
    const toS = (x: number, z: number): [number, number] => [t.ox + x * t.s, t.oz + z * t.s];
    drawDistrictLabels(ctx, toS, 13 * dpr);
    const blips = [...g.missions.blips];
    if (this.waypoint) blips.push({ x: this.waypoint.x, z: this.waypoint.z, color: '#c77dff', label: '', kind: 'dest' });
    for (const v of g.vehicles) if (v.police && v.siren) blips.push({ x: v.pos.x, z: v.pos.z, color: '#ff3b3b', label: '', kind: 'target' });
    for (const b of blips) {
      const [sx, sy] = toS(b.x, b.z);
      ctx.beginPath();
      ctx.arc(sx, sy, (b.kind === 'mission' ? 11 : 8) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = '#0a1424';
      ctx.stroke();
      if (b.label) {
        ctx.fillStyle = '#0a1424';
        ctx.font = `bold ${13 * dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.label.slice(0, 2), sx, sy + 1);
      }
    }
    const p = g.player;
    const ref = p.vehicle ? p.vehicle.pos : p.pos;
    const facing = p.vehicle ? p.vehicle.heading : p.yaw;
    const [px, py] = toS(ref.x, ref.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.cos(facing), Math.sin(facing)) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -14 * dpr);
    ctx.lineTo(10 * dpr, 10 * dpr);
    ctx.lineTo(0, 5 * dpr);
    ctx.lineTo(-10 * dpr, 10 * dpr);
    ctx.closePath();
    ctx.fillStyle = '#fff4e0';
    ctx.fill();
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = '#0a1424';
    ctx.stroke();
    ctx.restore();
  }
}
