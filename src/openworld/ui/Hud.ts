import * as THREE from 'three';
import { LANDS, WORLD, type P2 } from '../geo.ts';
import type { Network } from '../roads.ts';
import type { HudInfo } from '../vehicles/drivable.ts';

/**
 * The HUD: speed and the vehicle's gauges (bottom right), the wanted stars (top right), a minimap
 * that turns with the camera (bottom left), the district name as you cross into it (top left, the
 * way GTA does it), interaction prompts, toasts, the BUSTED / WASTED card, and the pause menu.
 */

export interface MenuState {
  car: string;
  paint: number;
  time: string;
  weather: string;
  traffic: number;
  quality: string;
}

export interface MenuActions {
  onResume(): void;
  onSpawnCar(model: string, paint: number): void;
  onSpawnVehicle(kind: string): void;
  onTime(t: string): void;
  onWeather(w: string): void;
  onTraffic(n: number): void;
  onQuality(q: string): void;
  onRefill(): void;
  onExit(): void;
}

/** the garage's paints: Miami colours */
export const SPORT_PAINTS: [string, number][] = [
  ['Flamingo', 0xff3f8e],
  ['Lagoon', 0x12c6d6],
  ['Sunset Orange', 0xff6a1a],
  ['Lime Squeeze', 0x9be22a],
  ['Electric Violet', 0x7b3cff],
  ['Rosso', 0xc40d16],
  ['Gold Leaf', 0xe0b21d],
  ['Pearl White', 0xf1efe9],
  ['Gloss Black', 0x0b0c0e],
];

/** the sports cars the garage delivers */
export const SPORT_CARS: [string, string, string][] = [
  ['super', 'Vespera GT-R', 'Mid-engine V10 · 470 kW · the fastest thing in Miami'],
  ['muscle', 'Bravado Stallion', 'Front V8 · 360 kW · rear-drive, loves to slide'],
  ['coupe', 'Kestrel S', 'Twin-turbo six · 330 kW · grippy and sharp'],
];

const el = (tag: string, cls: string, parent?: HTMLElement, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

export class Hud {
  readonly root: HTMLElement;
  private speed: HTMLElement;
  private unit: HTMLElement;
  private vname: HTMLElement;
  private gear: HTMLElement;
  private gauges: HTMLElement;
  private alt: HTMLElement;
  private mode: HTMLElement;
  private stars: HTMLElement[] = [];
  private starsBox: HTMLElement;
  private place: HTMLElement;
  private placeSub: HTMLElement;
  private prompt: HTMLElement;
  private toastBox: HTMLElement;
  private card: HTMLElement;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private help: HTMLElement;
  private menu: HTMLElement | null = null;
  private cross: HTMLElement;
  private marker: HTMLElement;
  private weapon: HTMLElement;
  private wName: HTMLElement;
  private wAmmo: HTMLElement;
  private wSpare: HTMLElement;
  private wList: HTMLElement;
  private hpBar: HTMLElement;
  private arBar: HTMLElement;
  private hurtEl: HTMLElement;
  private radioEl: HTMLElement;
  private scope: HTMLElement;
  private listT = 0;
  private radioT = 0;
  private lastPlace = '';
  private placeT = 0;
  menuOpen = false;
  bigMap = false;

  constructor(
    ui: HTMLElement,
    private readonly net: Network,
  ) {
    this.root = el('div', 'ow-hud', ui);
    // speed panel
    const sp = el('div', 'ow-speed', this.root);
    this.vname = el('div', 'ow-vname', sp, '');
    const row = el('div', 'ow-speed-row', sp);
    this.speed = el('div', 'ow-speed-num', row, '0');
    const side = el('div', 'ow-speed-side', row);
    this.unit = el('div', 'ow-speed-unit', side, 'MPH');
    this.gear = el('div', 'ow-gear', side, 'D');
    this.mode = el('div', 'ow-mode', sp, '');
    this.alt = el('div', 'ow-alt', sp, '');
    this.gauges = el('div', 'ow-gauges', sp);
    // wanted
    this.starsBox = el('div', 'ow-stars', this.root);
    for (let i = 0; i < 5; i++) this.stars.push(el('div', 'ow-star', this.starsBox, '★'));
    // place
    const pl = el('div', 'ow-place', this.root);
    this.place = el('div', 'ow-place-name', pl, '');
    this.placeSub = el('div', 'ow-place-sub', pl, '');
    // prompt + toasts + card
    this.prompt = el('div', 'ow-prompt', this.root);
    this.toastBox = el('div', 'ow-toasts', this.root);
    this.card = el('div', 'ow-card', this.root);
    // minimap
    const mm = el('div', 'ow-map', this.root);
    this.map = el('canvas', '', mm) as HTMLCanvasElement;
    this.map.width = 440;
    this.map.height = 440;
    this.mapCtx = this.map.getContext('2d')!;
    // combat: the crosshair and hit marker, the gun and its rounds, health / armour under the map,
    // the red edge when hit, the police radio, the scope
    this.hurtEl = el('div', 'ow-hurt', this.root);
    this.scope = el('div', 'ow-scope', this.root);
    this.cross = el('div', 'ow-cross', this.root);
    for (const k of ['t', 'b', 'l', 'r']) el('i', k, this.cross);
    el('i', 'dot', this.cross);
    this.marker = el('div', 'ow-marker', this.root);
    for (const k of ['a', 'b', 'c', 'd']) el('i', k, this.marker);
    this.weapon = el('div', 'ow-weapon', this.root);
    this.wName = el('div', 'w-name', this.weapon, '');
    const wr = el('div', 'w-row', this.weapon);
    this.wAmmo = el('div', 'w-ammo', wr, '');
    this.wSpare = el('div', 'w-spare', wr, '');
    this.wList = el('div', 'ow-wlist', this.root);
    const hb = el('div', 'ow-health', this.root);
    this.hpBar = el('b', 'hp', el('div', 'bar', hb));
    this.arBar = el('b', 'ar', el('div', 'bar', hb));
    this.radioEl = el('div', 'ow-radio', this.root);
    // controls help (first visit)
    this.help = el('div', 'ow-help', this.root);
    this.help.innerHTML = `
      <div class="h-title">Miami · controls</div>
      <div class="h-grid">
        <b>W A S D</b><span>drive · steer</span>
        <b>Space</b><span>handbrake</span>
        <b>Shift</b><span>sprint on foot</span>
        <b>Space · X</b><span>helicopter up · down</span>
        <b>Q · E</b><span>helicopter bank</span>
        <b>F</b><span>get in / out · steal a car</span>
        <b>H</b><span>horn · siren in a cruiser</span>
        <b>C</b><span>camera</span>
        <b>R</b><span>recover · reload on foot</span>
        <b>Click</b><span>lock the mouse · fire</span>
        <b>Right mouse</b><span>aim</span>
        <b>1 – 6 · wheel</b><span>weapons (0 holsters)</span>
        <b>M</b><span>map</span>
        <b>Esc</b><span>menu</span>
      </div>
      <div class="h-foot">Click to lock the mouse and look around · gamepad supported (RT fire, LT aim)</div>`;
    let seen = false;
    try {
      seen = localStorage.getItem('apexgp.miami.help') === '1';
    } catch {
      /* private mode */
    }
    if (seen) this.help.classList.add('hide');
    else
      setTimeout(() => {
        this.help.classList.add('hide');
        try {
          localStorage.setItem('apexgp.miami.help', '1');
        } catch {
          /* private mode */
        }
      }, 14000);
  }

  setVehicle(info: HudInfo | null, onFoot: boolean) {
    this.root.classList.toggle('on-foot', onFoot);
    if (!info) return;
    this.vname.textContent = info.name;
    this.speed.textContent = String(Math.round(info.speed * 2.23694));
    this.gear.textContent = info.gear ?? '';
    this.mode.textContent = info.mode ?? '';
    this.mode.classList.toggle('on', !!info.mode);
    this.alt.textContent = info.altitude !== undefined ? `ALT ${Math.round(info.altitude * 3.28084)} ft` : '';
    // gauges
    while (this.gauges.children.length < info.gauges.length) {
      const g = el('div', 'ow-gauge', this.gauges);
      el('div', 'g-label', g);
      const bar = el('div', 'g-bar', g);
      el('b', '', bar);
    }
    while (this.gauges.children.length > info.gauges.length) this.gauges.lastChild!.remove();
    info.gauges.forEach((gg, i) => {
      const g = this.gauges.children[i] as HTMLElement;
      (g.children[0] as HTMLElement).textContent = `${gg.label} ${Math.round(gg.value * 100)}%`;
      const b = g.children[1].children[0] as HTMLElement;
      b.style.width = `${Math.max(0, Math.min(1, gg.value)) * 100}%`;
      b.style.background = gg.value < 0.15 ? '#ff4d4d' : gg.color;
    });
  }

  /** the combat layer: what's in hand, rounds, health, the crosshair */
  setCombat(c: {
    show: boolean; cross: boolean; aim: number; spread: number; weapon: string; mag: number; spare: number; reloading: number;
    hp: number; armor: number; hurt: number; marker: number; kill: boolean; scope: boolean; list: { name: string; on: boolean; ammo: number }[]; listShow: boolean; dt: number;
  }) {
    this.weapon.classList.toggle('show', c.show && !!c.weapon);
    this.wName.textContent = c.reloading > 0 ? `${c.weapon} · reloading` : c.weapon;
    this.wAmmo.textContent = c.weapon ? String(c.mag) : '';
    this.wSpare.textContent = c.weapon ? `/ ${c.spare}` : '';
    this.wAmmo.classList.toggle('low', c.mag <= 3);
    this.cross.classList.toggle('show', c.cross && !c.scope);
    const g = 6 + c.spread * 420;
    this.cross.style.setProperty('--gap', `${g.toFixed(1)}px`);
    this.cross.style.opacity = String(0.55 + 0.45 * c.aim);
    this.marker.classList.toggle('show', c.marker > 0);
    this.marker.classList.toggle('kill', c.kill);
    this.scope.classList.toggle('show', c.scope);
    this.hpBar.style.width = `${Math.max(0, c.hp)}%`;
    this.arBar.style.width = `${Math.max(0, c.armor)}%`;
    this.hpBar.classList.toggle('low', c.hp < 30);
    this.hurtEl.style.opacity = String(Math.min(1, c.hurt + (c.hp < 30 ? 0.25 + 0.15 * Math.sin(performance.now() / 180) : 0)));
    // the weapon strip, for a moment after switching
    if (c.listShow) {
      this.listT = 1.6;
      this.wList.innerHTML = c.list.map((w) => `<div class="wi${w.on ? ' on' : ''}"><span>${w.name}</span><em>${w.ammo}</em></div>`).join('');
    }
    this.listT -= c.dt;
    this.wList.classList.toggle('show', this.listT > 0);
    this.radioT -= c.dt;
    this.radioEl.classList.toggle('show', this.radioT > 0);
  }

  /** a line of police radio */
  radio(text: string, tag = 'DISPATCH') {
    this.radioEl.innerHTML = `<span class="r-tag">${tag}</span> ${text}`;
    this.radioT = 4.5;
  }

  setWanted(level: number, flashing: boolean, t: number) {
    this.starsBox.classList.toggle('active', level > 0);
    this.stars.forEach((s, i) => {
      const on = i < level;
      s.classList.toggle('on', on);
      s.style.opacity = on && flashing ? (Math.floor(t * 3) % 2 ? '0.35' : '1') : '';
    });
  }

  setPlace(name: string, sub: string, dt: number) {
    if (name !== this.lastPlace) {
      this.lastPlace = name;
      this.place.textContent = name;
      this.placeSub.textContent = sub;
      this.placeT = 4.5;
    }
    this.placeT -= dt;
    this.place.parentElement!.classList.toggle('show', this.placeT > 0);
  }

  setPrompt(text: string) {
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.classList.toggle('show', !!text);
  }

  toast(text: string, kind = '') {
    const t = el('div', 'ow-toast ' + kind, this.toastBox, text);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  showCard(title: string, sub: string) {
    this.card.innerHTML = `<div class="c-title">${title}</div><div class="c-sub">${sub}</div>`;
    this.card.classList.add('show');
    setTimeout(() => this.card.classList.remove('show'), 3800);
  }

  // ---------------------------------------------------------------- the minimap

  private landPaths: Path2D[] | null = null;
  drawMap(px: number, pz: number, heading: number, blips: { x: number; z: number; color: string; size?: number; shape?: 'dot' | 'heli' | 'plane' | 'square' | 'ring' }[], waypoint: P2 | null) {
    const c = this.mapCtx;
    const W = this.map.width;
    const big = this.bigMap;
    const scale = big ? 0.085 : 0.55; // px per metre
    c.save();
    c.clearRect(0, 0, W, W);
    c.fillStyle = '#123b52';
    c.fillRect(0, 0, W, W);
    c.translate(W / 2, W / 2);
    if (!big) c.rotate(heading - Math.PI);
    c.scale(scale, scale);
    c.translate(-px, -pz);
    if (!this.landPaths) {
      this.landPaths = LANDS.map((L) => {
        const p = new Path2D();
        L.outline.forEach((q, i) => (i ? p.lineTo(q.x, q.z) : p.moveTo(q.x, q.z)));
        p.closePath();
        return p;
      });
    }
    c.fillStyle = '#2a3330';
    for (const p of this.landPaths) c.fill(p);
    // roads near the view (all of them on the big map)
    const R = big ? 1e9 : W / 2 / scale + 60;
    c.lineCap = 'round';
    for (const e of this.net.edges) {
      const mx = (e.px[0] + e.px[e.px.length - 1]) / 2, mz = (e.pz[0] + e.pz[e.pz.length - 1]) / 2;
      if (!big && Math.abs(mx - px) > R + e.len / 2 && Math.abs(mz - pz) > R + e.len / 2) continue;
      if (!big && Math.hypot(mx - px, mz - pz) > R + e.len / 2) continue;
      const hw = e.hw;
      c.strokeStyle = e.kind === 'highway' || e.kind === 'causeway' ? '#e3c26b' : e.kind === 'boulevard' || e.kind === 'avenue' ? '#c9cdd2' : '#8d949b';
      c.lineWidth = Math.max(hw * 2, (big ? 2.2 : 1.3) / scale);
      c.beginPath();
      for (let i = 0; i < e.px.length; i++) (i ? c.lineTo(e.px[i], e.pz[i]) : c.moveTo(e.px[i], e.pz[i]));
      c.stroke();
    }
    if (waypoint) {
      c.fillStyle = '#ff3f8e';
      c.beginPath();
      c.arc(waypoint.x, waypoint.z, 7 / scale, 0, Math.PI * 2);
      c.fill();
    }
    for (const b of blips) {
      if (b.shape === 'ring') {
        // the police search area: a pulsing red / blue disc
        c.fillStyle = b.color;
        c.beginPath();
        c.arc(b.x, b.z, b.size ?? 80, 0, Math.PI * 2);
        c.fill();
        continue;
      }
      c.fillStyle = b.color;
      const r = (b.size ?? 4) / scale;
      c.beginPath();
      if (b.shape === 'square') c.rect(b.x - r, b.z - r, r * 2, r * 2);
      else c.arc(b.x, b.z, r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // the player arrow
    c.save();
    c.translate(W / 2, W / 2);
    if (big) {
      // the big map is north-up: the arrow turns, placed where the player is on it
      c.rotate(Math.PI - heading);
    }
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, -16);
    c.lineTo(11, 12);
    c.lineTo(0, 6);
    c.lineTo(-11, 12);
    c.closePath();
    c.stroke();
    c.fill();
    c.restore();
    this.map.parentElement!.classList.toggle('big', big);
    void WORLD;
  }

  // ---------------------------------------------------------------- menu

  openMenu(state: MenuState, act: MenuActions) {
    this.menuOpen = true;
    this.menu?.remove();
    const m = el('div', 'ow-menu', this.root);
    this.menu = m;
    const panel = el('div', 'ow-menu-panel', m);
    el('div', 'm-eyebrow', panel, 'Apex GP · Open world');
    el('div', 'm-title', panel, 'Miami');
    const tabs = el('div', 'm-tabs', panel);
    const body = el('div', 'm-body', panel);
    const tabDefs: [string, () => void][] = [
      ['Garage', () => garage()],
      ['Vehicles', () => vehicles()],
      ['Weapons', () => weapons()],
      ['World', () => world()],
      ['Controls', () => controls()],
    ];
    const setTab = (i: number) => {
      [...tabs.children].forEach((t, k) => t.classList.toggle('on', k === i));
      body.innerHTML = '';
      tabDefs[i][1]();
    };
    tabDefs.forEach(([n], i) => el('div', 'm-tab', tabs, n).addEventListener('click', () => setTab(i)));
    const btnRow = (parent: HTMLElement, items: [string, string][], cur: string, on: (v: string) => void) => {
      const r = el('div', 'm-row', parent);
      for (const [v, label] of items) {
        const b = el('div', 'm-chip' + (v === cur ? ' on' : ''), r, label);
        b.addEventListener('click', () => {
          [...r.children].forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          on(v);
        });
      }
    };
    const garage = () => {
      el('div', 'm-h', body, 'Car');
      const tr = el('div', 'm-cards', body);
      for (const [id, name, sub] of SPORT_CARS) {
        const c = el('div', 'm-card' + (id === state.car ? ' on' : ''), tr);
        el('div', 'mc-name', c, name);
        el('div', 'mc-sub', c, sub);
        c.addEventListener('click', () => {
          state.car = id;
          [...tr.children].forEach((x) => x.classList.remove('on'));
          c.classList.add('on');
        });
      }
      el('div', 'm-h', body, 'Paint');
      const pr = el('div', 'm-paints', body);
      SPORT_PAINTS.forEach(([name, hex], i) => {
        const sw = el('div', 'm-swatch' + (i === state.paint ? ' on' : ''), pr);
        sw.style.background = '#' + hex.toString(16).padStart(6, '0');
        sw.title = name;
        sw.addEventListener('click', () => {
          state.paint = i;
          [...pr.children].forEach((x) => x.classList.remove('on'));
          sw.classList.add('on');
        });
      });
      const go = el('div', 'm-cta', body, 'Deliver it');
      go.addEventListener('click', () => {
        act.onSpawnCar(state.car, state.paint);
        this.closeMenu();
        act.onResume();
      });
    };
    const vehicles = () => {
      el('div', 'm-h', body, 'Spawn beside you');
      const items: [string, string, string][] = [
        ['heli', 'Helicopter', 'Bell-style light helicopter'],
        ['plane', 'Seaplane', 'Amphibious single-prop · takes off from the bay'],
        ['bike', 'Motorcycle', 'Superbike'],
        ['gwagon', 'Off-roader', 'The Brickell valet favourite'],
        ['police', 'Police cruiser', 'Miami PD'],
        ['policeSuv', 'Police interceptor', 'Miami PD SUV'],
        ['boat', 'Speedboat', 'Go-fast boat · from the nearest water'],
      ];
      const tr = el('div', 'm-cards', body);
      for (const [id, name, sub] of items) {
        const c = el('div', 'm-card', tr);
        el('div', 'mc-name', c, name);
        el('div', 'mc-sub', c, sub);
        c.addEventListener('click', () => {
          act.onSpawnVehicle(id);
          this.closeMenu();
          act.onResume();
        });
      }
    };
    const weapons = () => {
      el('div', 'm-h', body, 'Your guns');
      const tr = el('div', 'm-cards', body);
      const list: [string, string, string][] = [
        ['1', 'Pistol', '17-round polymer pistol · drive-by'],
        ['2', 'SMG', 'Compact, 900 rounds a minute · drive-by'],
        ['3', 'Carbine', 'Optic, 30-round mag · long range'],
        ['4', 'Shotgun', 'Pump action, nine pellets'],
        ['5', 'Marksman rifle', 'Bolt action · aim for the scope'],
        ['6', 'Rocket launcher', 'Shoulder-fired · it blows things up'],
      ];
      for (const [k, name, sub] of list) {
        const c = el('div', 'm-card', tr);
        el('div', 'mc-name', c, `${k} · ${name}`);
        el('div', 'mc-sub', c, sub);
      }
      const go = el('div', 'm-cta', body, 'Refill ammo and armour');
      go.addEventListener('click', () => {
        act.onRefill();
        this.closeMenu();
        act.onResume();
      });
    };
    const world = () => {
      el('div', 'm-h', body, 'Time of day');
      btnRow(body, [['dawn', 'Dawn'], ['morning', 'Morning'], ['midday', 'Midday'], ['afternoon', 'Afternoon'], ['golden', 'Golden hour'], ['sunset', 'Sunset'], ['dusk', 'Dusk'], ['night', 'Night']], state.time, (v) => {
        state.time = v;
        act.onTime(v);
      });
      el('div', 'm-h', body, 'Weather');
      btnRow(body, [['clear', 'Clear'], ['haze', 'Hazy'], ['cloudy', 'Cloudy'], ['overcast', 'Overcast'], ['sunshower', 'Sun shower'], ['rain', 'Rain'], ['thunderstorm', 'Thunderstorm']], state.weather, (v) => {
        state.weather = v;
        act.onWeather(v);
      });
      el('div', 'm-h', body, 'Traffic');
      btnRow(body, [['20', 'Light'], ['50', 'Normal'], ['80', 'Busy'], ['110', 'Rush hour']], String(state.traffic), (v) => {
        state.traffic = Number(v);
        act.onTraffic(Number(v));
      });
      el('div', 'm-h', body, 'Graphics');
      btnRow(body, [['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], state.quality, (v) => {
        state.quality = v;
        act.onQuality(v);
      });
    };
    const controls = () => {
      const h = this.help.cloneNode(true) as HTMLElement;
      h.className = 'ow-help inmenu';
      body.appendChild(h);
    };
    setTab(0);
    const foot = el('div', 'm-foot', panel);
    const res = el('div', 'm-btn', foot, 'Resume');
    res.addEventListener('click', () => {
      this.closeMenu();
      act.onResume();
    });
    const ex = el('div', 'm-btn ghost', foot, 'Back to the garage');
    ex.addEventListener('click', () => act.onExit());
  }

  closeMenu() {
    this.menuOpen = false;
    this.menu?.remove();
    this.menu = null;
  }
}

export const tmpV = new THREE.Vector3();
