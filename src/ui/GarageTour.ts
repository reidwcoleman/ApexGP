import * as THREE from 'three';
import { SPOT_ORDER, type Spot, type SpotId } from '../game/GarageDressing.ts';

/**
 * The garage tour's controls: glass buttons floating in the 3D garage that fly the
 * camera to another viewpoint, and a bar at the bottom (back to the overview, the place
 * you are, previous / next, and chips for the places whose buttons are out of shot).
 * In the overview a single pill starts the tour. Q / E and the gamepad's shoulder
 * buttons step through the places (Y starts or ends the tour); the menu routes the
 * arrows and Esc / B here while touring.
 */

export interface TourCallbacks {
  go(id: SpotId): void;
  exit(): void;
  step(dir: 1 | -1): void;
  enter(): void;
}

export interface TourState {
  /** the garage menu is on screen */
  visible: boolean;
  /** where the tour is (null = the overview) */
  at: SpotId | null;
  spots: Record<SpotId, Spot> | null;
  camera: THREE.Camera;
  /** buttons in the overview (not in the set-up tab: that has its hotspots) */
  overviewMarkers: boolean;
  /** screen x beyond which the hub panel covers the picture */
  panelLeft: number;
  flying: boolean;
}

const OVERVIEW: SpotId[] = ['cockpit', 'frontWing', 'gantry', 'chests', 'wall', 'desk', 'tyres', 'mate', 'door'];

const chevron = (dir: 'l' | 'r') => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${dir === 'l' ? 'M10 3 5 8l5 5' : 'M6 3l5 5-5 5'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class GarageTourUI {
  readonly root: HTMLDivElement;
  private readonly markers = new Map<SpotId, HTMLButtonElement>();
  private readonly bar: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly chips: HTMLDivElement;
  private readonly pill: HTMLButtonElement;
  private lastAt: SpotId | null | undefined = undefined;
  private chipKey = '';
  private readonly v = new THREE.Vector3();
  private pad: boolean[] = [];
  private visible = false;
  private at: SpotId | null = null;

  constructor(parent: HTMLElement, private readonly cb: TourCallbacks) {
    const root = (this.root = document.createElement('div'));
    root.className = 'tour';
    parent.appendChild(root);
    const layer = document.createElement('div');
    layer.className = 'tour-markers';
    root.appendChild(layer);
    for (const id of SPOT_ORDER) {
      const b = document.createElement('button');
      b.className = 'wp';
      b.dataset.id = id;
      b.innerHTML = `<i class="wp-dot"></i><span class="wp-label"></span>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.go(id);
      });
      layer.appendChild(b);
      this.markers.set(id, b);
    }
    // the bar while touring
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'tour-bar';
    bar.innerHTML =
      `<button class="tour-back">${chevron('l')}<span>Overview</span><kbd>Esc</kbd></button>` +
      `<div class="tour-nav"><button class="tour-step" data-d="-1" aria-label="Previous place">${chevron('l')}</button>` +
      `<div class="tour-title"><b></b><span></span></div>` +
      `<button class="tour-step" data-d="1" aria-label="Next place">${chevron('r')}</button></div>` +
      `<div class="tour-chips"></div>`;
    root.appendChild(bar);
    this.title = bar.querySelector('.tour-title b')!;
    this.sub = bar.querySelector('.tour-title span')!;
    this.chips = bar.querySelector('.tour-chips')!;
    bar.querySelector('.tour-back')!.addEventListener('click', () => this.cb.exit());
    for (const s of Array.from(bar.querySelectorAll<HTMLElement>('.tour-step'))) s.addEventListener('click', () => this.cb.step(Number(s.dataset.d) as 1 | -1));
    this.chips.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id as SpotId | undefined;
      if (id) this.cb.go(id);
    });
    // the way in, from the overview
    const pill = (this.pill = document.createElement('button'));
    pill.className = 'tour-pill';
    pill.innerHTML = `<i class="wp-dot"></i><span>Explore the garage</span><kbd>E</kbd>`;
    pill.addEventListener('click', () => this.cb.enter());
    root.appendChild(pill);
    addEventListener('keydown', (e) => {
      if (!this.visible || e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'e') this.at ? this.cb.step(1) : this.cb.enter();
      else if (k === 'q' && this.at) this.cb.step(-1);
    });
  }

  sync(s: TourState) {
    this.visible = s.visible;
    this.at = s.at;
    this.root.classList.toggle('on', s.visible && !!s.spots);
    this.root.classList.toggle('touring', !!s.at);
    this.pollPad(s);
    if (!s.visible || !s.spots) return;
    const spots = s.spots;
    // the bar: where you are
    if (s.at !== this.lastAt) {
      this.lastAt = s.at;
      if (s.at) {
        const i = SPOT_ORDER.indexOf(s.at);
        this.title.textContent = spots[s.at].label;
        this.sub.textContent = spots[s.at].orbit ? 'Drag to walk around the car' : 'Drag to look around';
        this.bar.style.setProperty('--n', String(i));
      }
    }
    // the buttons: the places reachable from here, where they are in the picture
    const list = s.at ? spots[s.at].near : s.overviewMarkers ? OVERVIEW : [];
    const W = innerWidth, H = innerHeight;
    const camPos = s.camera.getWorldPosition(this.v.clone());
    const off: SpotId[] = [];
    for (const [id, b] of this.markers) {
      const want = list.includes(id) && !s.flying;
      let vis = false;
      if (want) {
        const sp = spots[id];
        const d = sp.marker.distanceTo(camPos);
        this.v.copy(sp.marker).project(s.camera);
        const x = ((this.v.x + 1) / 2) * W, y = ((1 - this.v.y) / 2) * H;
        vis = this.v.z < 1 && x > 24 && x < s.panelLeft - 24 && y > 80 && y < H - 150 && d > 0.6;
        if (vis) {
          b.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
          b.classList.toggle('far', d > 9);
        } else if (s.at) off.push(id);
        const label = b.querySelector('.wp-label')!;
        if (label.textContent !== sp.label) label.textContent = sp.label;
      }
      b.classList.toggle('show', vis);
    }
    // chips for the places whose buttons are out of shot
    const key = s.at ? off.join(',') : '';
    if (key !== this.chipKey) {
      this.chipKey = key;
      this.chips.innerHTML = off.map((id) => `<button data-id="${id}">${spots[id].label}${chevron('r')}</button>`).join('');
    }
  }

  /** gamepad: LB / RB step, Y starts or ends the tour */
  private pollPad(s: TourState) {
    const gp = navigator.getGamepads?.().find((p) => p && p.connected);
    if (!gp) return;
    const now = gp.buttons.map((b) => b.pressed);
    const edge = (i: number) => now[i] && !this.pad[i];
    if (s.visible) {
      if (edge(3)) s.at ? this.cb.exit() : this.cb.enter();
      if (s.at && edge(4)) this.cb.step(-1);
      if (s.at && edge(5)) this.cb.step(1);
    }
    this.pad = now;
  }
}
