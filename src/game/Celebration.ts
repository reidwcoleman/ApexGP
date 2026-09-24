import * as THREE from 'three';
import type { Entry } from '../race/Teams.ts';
import type { Track } from '../world/Track.ts';
import { EVENT } from '../world/event.ts';

/**
 * Post-race celebration: the top three on a podium beside the start/finish line,
 * in their team race suits and caps — waving, lifting the trophies, spraying
 * champagne at each other under a fall of confetti — filmed as a short sequence
 * of broadcast shots. `update` returns true when the sequence is over.
 */

const DURATION = 19;

interface Limb {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
}
interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  armL: Limb;
  armR: Limb;
  legL: THREE.Group;
  legR: THREE.Group;
  trophy: THREE.Object3D;
  bottle: THREE.Object3D;
  baseY: number;
  phase: number;
  place: number;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** a race suit texture: team primary with accent side stripes, a sponsor chest band and the driver's number */
function suitTexture(e: Entry): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = e.team.primary;
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = e.team.secondary;
    g.fillRect(0, 150, 256, 26);
    g.fillStyle = e.team.accent;
    g.fillRect(0, 176, 256, 8);
    g.fillRect(58, 0, 10, 256);
    g.fillRect(188, 0, 10, 256);
    g.fillStyle = e.team.ink;
    g.font = '900 38px "Titillium Web", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(e.team.sponsor.toUpperCase().slice(0, 10), 128, 96);
    g.font = '900 30px "Titillium Web", Arial, sans-serif';
    g.fillText(String(e.driver.number), 128, 214);
  });
}

function capsule(r: number, len: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeTrophy(): THREE.Object3D {
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 1, roughness: 0.22 });
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [
    [0.0, 0], [0.07, 0], [0.07, 0.03], [0.03, 0.05], [0.022, 0.16], [0.03, 0.2], [0.1, 0.26], [0.12, 0.34], [0.115, 0.4], [0.105, 0.41], [0.0, 0.41],
  ];
  for (const [x, y] of prof) pts.push(new THREE.Vector2(x, y));
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), gold);
  cup.castShadow = true;
  const g = new THREE.Group();
  g.add(cup);
  // handles
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 14, Math.PI), gold);
    h.position.set(s * 0.12, 0.32, 0);
    h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(h);
  }
  return g;
}

function makeBottle(): THREE.Object3D {
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1f4d24, metalness: 0, roughness: 0.08, clearcoat: 1, transmission: 0 });
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a23c, metalness: 1, roughness: 0.3 });
  const label = new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.6 });
  const prof: [number, number][] = [[0, 0], [0.045, 0], [0.047, 0.02], [0.047, 0.2], [0.04, 0.24], [0.017, 0.29], [0.015, 0.34], [0.0, 0.34]];
  const b = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 18), glass);
  const f = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.07, 12), foil);
  f.position.y = 0.3;
  const l = new THREE.Mesh(new THREE.CylinderGeometry(0.0485, 0.0485, 0.08, 18, 1, true), label);
  l.position.y = 0.1;
  const g = new THREE.Group();
  g.add(b, f, l);
  return g;
}

function makeFigure(e: Entry, place: number): Figure {
  const suit = new THREE.MeshStandardMaterial({ map: suitTexture(e), roughness: 0.62 });
  const plain = new THREE.MeshStandardMaterial({ color: e.team.primary, roughness: 0.62 });
  const skin = new THREE.MeshStandardMaterial({ color: [0xe8b890, 0xc68d63, 0xf1c9a5, 0x8d5a3b][place % 4], roughness: 0.55 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4 });
  const cap = new THREE.MeshStandardMaterial({ color: e.team.primary, roughness: 0.7 });
  const brim = new THREE.MeshStandardMaterial({ color: e.team.accent, roughness: 0.6 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.9 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.92; // hips
  root.add(body);
  // legs from the hips
  const leg = (s: number) => {
    const g = new THREE.Group();
    g.position.set(0.1 * s, 0, 0);
    const thigh = capsule(0.085, 0.36, plain);
    thigh.position.y = -0.24;
    const shin = capsule(0.07, 0.36, plain);
    shin.position.y = -0.66;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), shoe);
    foot.position.set(0, -0.88, 0.05);
    foot.castShadow = true;
    g.add(thigh, shin, foot);
    body.add(g);
    return g;
  };
  const legL = leg(1);
  const legR = leg(-1);
  // torso
  const torso = capsule(0.17, 0.36, suit);
  torso.scale.set(1.12, 1, 0.74);
  torso.position.y = 0.32;
  body.add(torso);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16), new THREE.MeshStandardMaterial({ color: e.team.accent, roughness: 0.5 }));
  belt.scale.set(1.08, 1, 0.74);
  belt.position.y = 0.06;
  body.add(belt);
  // head with a team cap
  const head = new THREE.Group();
  head.position.y = 0.72;
  body.add(head);
  const neck = capsule(0.05, 0.06, skin);
  neck.position.y = -0.06;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
  skull.scale.set(0.92, 1.05, 1);
  skull.position.y = 0.08;
  skull.castShadow = true;
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.108, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
  hairM.position.set(0, 0.085, -0.01);
  const capM = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), cap);
  capM.position.y = 0.1;
  const brimM = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), brim);
  brimM.position.set(0, 0.14, 0.07);
  brimM.scale.set(1, 1, 0.8);
  // a grin (eyes + mouth), simple but it reads at podium distance
  const dark = new THREE.MeshBasicMaterial({ color: 0x1a1210 });
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 6), dark);
    eye.position.set(0.035 * s, 0.1, 0.095);
    head.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 4, 10, Math.PI), dark);
  mouth.position.set(0, 0.045, 0.098);
  mouth.rotation.z = Math.PI;
  head.add(neck, skull, hairM, capM, brimM, mouth);
  // arms from the shoulders (hanging along −y)
  const arm = (s: number): Limb => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.24 * s, 0.56, 0);
    const upper = capsule(0.058, 0.22, plain);
    upper.position.y = -0.15;
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const fore = capsule(0.052, 0.2, plain);
    fore.position.y = -0.13;
    const hand = new THREE.Group();
    hand.position.y = -0.28;
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), skin);
    glove.scale.set(0.9, 1.2, 0.7);
    hand.add(glove);
    elbow.add(fore, hand);
    shoulder.add(upper, elbow);
    body.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const armL = arm(1);
  const armR = arm(-1);
  const trophy = makeTrophy();
  trophy.rotation.x = Math.PI; // hangs from the hand, upright when the arm is raised
  trophy.position.y = -0.02;
  armR.hand.add(trophy);
  const bottle = makeBottle();
  bottle.rotation.x = Math.PI;
  bottle.visible = false;
  armL.hand.add(bottle);
  return { root, body, head, armL, armR, legL, legR, trophy, bottle, baseY: 0, phase: place * 1.7, place };
}

let _dot: THREE.Texture | null = null;
/** soft round droplet */
function dotTexture(): THREE.Texture {
  return (_dot ??= canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }));
}

/** pooled particles (champagne spray, confetti) */
class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private col: Float32Array;
  private next = 0;
  constructor(n: number, size: number, private gravity: number, private drag: number, colours: THREE.Color[], private flutter = 0) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = colours[i % colours.length];
      this.col.set([c.r, c.g, c.b], i * 3);
      this.pos[i * 3 + 1] = -1e4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, map: dotTexture(), alphaTest: 0.05 });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, spread: number, life: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.life.length;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x + (Math.random() - 0.5) * spread, v.y + (Math.random() - 0.5) * spread, v.z + (Math.random() - 0.5) * spread], i * 3);
    this.life[i] = life * (0.7 + Math.random() * 0.6);
  }
  update(dt: number, t: number) {
    const P = this.pos, V = this.vel;
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        P[i * 3 + 1] = -1e4;
        continue;
      }
      V[i * 3] *= k;
      V[i * 3 + 2] *= k;
      V[i * 3 + 1] = V[i * 3 + 1] * k - this.gravity * dt;
      P[i * 3] += (V[i * 3] + Math.sin(t * 5 + i) * this.flutter) * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += (V[i * 3 + 2] + Math.cos(t * 4 + i * 1.3) * this.flutter) * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

const lerp = THREE.MathUtils.lerp;
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export class Celebration {
  readonly group = new THREE.Group();
  /** where the shadows should focus */
  readonly center = new THREE.Vector3();
  private figures: Figure[] = [];
  private champagne = new Spray(1600, 0.045, 7, 0.6, [new THREE.Color(1, 0.97, 0.82), new THREE.Color(1, 1, 0.92), new THREE.Color(0.95, 0.9, 0.7)]);
  private confetti = new Spray(2200, 0.07, 0.9, 1.4, ['#ffd400', '#ffffff', '#c8102e', '#1f5fbf', '#2e7d32', '#ff7b00'].map((h) => new THREE.Color(h)), 0.6);
  private t = 0;
  private fwd = new THREE.Vector3();
  private side = new THREE.Vector3();
  private title: HTMLDivElement;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(track: Track, groundAt: (x: number, z: number) => number, podium: Entry[], uiRoot: HTMLElement) {
    this.group.name = 'Celebration';
    // on the track itself just past the line, backed onto the pit wall and facing the main
    // grandstand, the way the crowd gathers under the podium after the race
    // (short of the line: the pit building's own podium balcony overhangs the track just past it)
    const s = track.wrap(track.startS - 45);
    const side = track.pit.side;
    const lat = side * (track.halfWidthAt(s) - 2.2);
    const base = track.point(s, lat, 0);
    const toTrack = track.point(s, -side * 20, 0).sub(base).setY(0).normalize();
    this.fwd.copy(toTrack);
    this.side.set(toTrack.z, 0, -toTrack.x);
    void groundAt;
    const y0 = base.y;
    this.center.set(base.x, y0, base.z);
    this.group.position.copy(this.center);
    this.group.rotation.y = Math.atan2(toTrack.x, toTrack.z);

    // podium steps (local: +z faces the track, +x to the right of the drivers)
    const stepMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 });
    const numTex = (n: string) =>
      canvasTex(256, 256, (g) => {
        g.fillStyle = '#16181d';
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = '#d8b04a';
        g.fillRect(0, 216, 256, 14);
        g.fillStyle = '#ffffff';
        g.font = '900 170px "Titillium Web", Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(n, 128, 118);
      });
    const steps: [number, number, number][] = [
      [0, 1.0, 1],
      [-1.75, 0.7, 2],
      [1.75, 0.5, 3],
    ];
    for (const [x, h, n] of steps) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 1.5), [stepMat, stepMat, stepMat, stepMat, new THREE.MeshStandardMaterial({ map: numTex(String(n)), roughness: 0.5 }), stepMat]);
      m.position.set(x, h / 2, 0);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    // stage deck + backdrop with the event on it
    const deck = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.2, 5), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    deck.position.set(0, -0.1, -0.4);
    deck.receiveShadow = true;
    this.group.add(deck);
    const backTex = canvasTex(1024, 420, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 420);
      gr.addColorStop(0, '#0e1016');
      gr.addColorStop(1, '#1d2230');
      g.fillStyle = gr;
      g.fillRect(0, 0, 1024, 420);
      g.fillStyle = '#b0001e';
      g.fillRect(0, 300, 1024, 40);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 900 92px "Titillium Web", Arial, sans-serif';
      g.fillText(EVENT.gp, 512, 150, 960);
      g.font = '700 40px "Titillium Web", Arial, sans-serif';
      g.fillText(`${EVENT.place}  ·  APEX GP`, 512, 320);
    });
    const back = new THREE.Mesh(new THREE.BoxGeometry(8.5, 3.6, 0.2), [stepMat, stepMat, stepMat, stepMat, new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.6 }), stepMat]);
    back.position.set(0, 1.8, -2.4);
    back.castShadow = back.receiveShadow = true;
    this.group.add(back);

    // the drivers: P1 centre, P2 at the winner's right hand, P3 at the left
    podium.slice(0, 3).forEach((e, i) => {
      const f = makeFigure(e, i + 1);
      const [x, h] = steps[i];
      f.baseY = h;
      f.root.position.set(x, h, 0.05);
      // turned a little toward the winner
      f.root.rotation.y = i === 0 ? 0 : i === 1 ? 0.25 : -0.25;
      this.group.add(f.root);
      this.figures.push(f);
    });
    this.group.add(this.champagne.points, this.confetti.points);
    // particles live in world space
    this.champagne.points.matrixAutoUpdate = false;
    this.confetti.points.matrixAutoUpdate = false;
    this.champagne.points.matrix.copy(this.group.matrix).invert();
    this.confetti.points.matrix.copy(this.group.matrix).invert();

    // name strap
    this.title = document.createElement('div');
    this.title.className = 'celebration-strap';
    const w = podium[0];
    this.title.innerHTML = `<span class="cs-bar" style="background:${w.team.primary}"></span><span class="cs-k">Winner</span><b>${w.driver.first} ${w.driver.last.toUpperCase()}</b><span class="cs-team">${w.team.name}</span>`;
    Object.assign(this.title.style, {
      position: 'fixed', left: '50%', bottom: '64px', transform: 'translateX(-50%) translateY(12px)', opacity: '0',
      display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 20px', borderRadius: '12px',
      background: 'rgba(10,12,17,0.72)', backdropFilter: 'blur(14px)', color: '#fff', font: '600 18px "Titillium Web", Arial, sans-serif',
      transition: 'opacity .5s, transform .6s cubic-bezier(.2,.9,.3,1.2)', pointerEvents: 'none', zIndex: '20', letterSpacing: '0.02em',
    } as Partial<CSSStyleDeclaration>);
    uiRoot.appendChild(this.title);
    const bar = this.title.querySelector('.cs-bar') as HTMLElement;
    Object.assign(bar.style, { width: '5px', height: '26px', borderRadius: '3px' });
    const k = this.title.querySelector('.cs-k') as HTMLElement;
    Object.assign(k.style, { color: '#d8b04a', textTransform: 'uppercase', fontSize: '13px', letterSpacing: '0.12em' });
    const tm = this.title.querySelector('.cs-team') as HTMLElement;
    Object.assign(tm.style, { color: 'rgba(255,255,255,0.65)', fontSize: '15px' });
  }

  /** world point in the podium's frame (x right of the drivers, y up, z toward the track) */
  private world(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  private pose(f: Figure, t: number) {
    const ph = f.phase;
    const L = f.armL, R = f.armR;
    // phase 1 (0–4 s): wave to the crowd, winner bouncing
    // phase 2 (4–7 s): trophies up
    // phase 3 (7–13 s): champagne
    // phase 4: arms up, jumping
    let jump = 0;
    let lz = 0.12, rz = -0.12, lx = 0, rx = 0, le = 0, re = 0;
    if (t < 4) {
      const w = Math.sin(t * 6 + ph);
      rz = -2.5 - 0.25 * w;
      re = -0.5 + 0.3 * w;
      lz = 0.2;
      if (f.place === 1) jump = Math.max(0, Math.sin(t * 5.2)) * 0.18 * ease(t - 0.6);
    } else if (t < 7) {
      const u = ease((t - 4 - (f.place - 1) * 0.35) / 0.7);
      rz = lerp(-0.12, -2.9, u);
      re = lerp(0, -0.2, u);
      lz = lerp(0.12, 2.6, u);
      le = lerp(0, 0.4, u);
      if (f.place === 1) jump = Math.max(0, Math.sin((t - 4) * 4.5)) * 0.12 * u;
    } else if (t < 13) {
      // bottle in the left hand, aimed forward/up and swung across; right fist pumping
      lx = -1.3 - 0.35 * Math.sin((t - 7) * 3 + ph);
      lz = 0.25 + 0.3 * Math.sin((t - 7) * 1.7 + ph);
      le = -0.15;
      rz = -2.4 - 0.4 * Math.max(0, Math.sin((t - 7) * 7 + ph));
      re = -0.9;
      jump = Math.max(0, Math.sin((t - 7) * 4.2 + ph)) * 0.08;
    } else {
      const w = Math.sin(t * 7 + ph);
      lz = 2.7 + 0.2 * w;
      rz = -2.7 - 0.2 * w;
      le = 0.3;
      re = -0.3;
      jump = Math.max(0, Math.sin(t * 4.8 + ph)) * 0.22;
    }
    L.shoulder.rotation.set(lx, 0, lz);
    R.shoulder.rotation.set(rx, 0, rz);
    L.elbow.rotation.set(0, 0, le);
    R.elbow.rotation.set(0, 0, re);
    f.root.position.y = f.baseY + jump;
    // knees soak up the jumps
    const bend = jump > 0.01 ? 0.25 : 0.06;
    f.legL.rotation.x = -bend * 0.5;
    f.legR.rotation.x = -bend * 0.5;
    f.body.rotation.x = 0.03 + Math.sin(t * 2 + ph) * 0.02;
    f.head.rotation.y = Math.sin(t * 0.7 + ph) * 0.35;
    f.head.rotation.x = -0.12 - (t > 4 && t < 7 ? 0.2 : 0);
    f.trophy.visible = t >= 4 && t < 7 ? true : t < 4 ? f.place === 1 : false;
    f.bottle.visible = t >= 7 && t < 13;
  }

  /** advance; drives the camera; true when finished */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    this.t += dt;
    const t = this.t;
    this.group.updateMatrixWorld(true);
    for (const f of this.figures) this.pose(f, t);
    this.group.updateMatrixWorld(true);

    // champagne jets from the bottle necks
    if (t >= 7.3 && t < 12.8) {
      for (const f of this.figures) {
        const tip = f.bottle.localToWorld(this.tmp.set(0, 0.34, 0));
        const dir = f.bottle.localToWorld(this.tmp2.set(0, 1, 0)).sub(f.bottle.getWorldPosition(new THREE.Vector3())).normalize();
        for (let k = 0; k < 9; k++) this.champagne.emit(tip, dir.clone().multiplyScalar(5.5 + Math.random() * 2.5), 1.4, 0.9);
      }
    }
    // confetti from the gantry above the podium
    if (t >= 4.2 && t < 15.5) {
      for (let k = 0; k < 14; k++) {
        const p = this.world((Math.random() - 0.5) * 11, 6.5 + Math.random() * 1.5, (Math.random() - 0.3) * 6, this.tmp);
        this.confetti.emit(p, new THREE.Vector3(0, -0.4, 0), 0.8, 7);
      }
    }
    this.champagne.update(dt, t);
    this.confetti.update(dt, t);
    this.champagne.points.matrix.copy(this.group.matrixWorld).invert();
    this.confetti.points.matrix.copy(this.group.matrixWorld).invert();

    if (t > 0.8 && t < DURATION - 1.2) {
      this.title.style.opacity = '1';
      this.title.style.transform = 'translateX(-50%) translateY(0)';
    } else {
      this.title.style.opacity = '0';
      this.title.style.transform = 'translateX(-50%) translateY(12px)';
    }

    this.shoot(t, camera);
    return t >= DURATION;
  }

  /** the shot list */
  private shoot(t: number, cam: THREE.PerspectiveCamera) {
    const P = (x: number, y: number, z: number) => this.world(x, y, z, cam.position);
    let fov = 40;
    if (t < 3.5) {
      // wide from the track, dollying in
      const u = ease(t / 3.5);
      P(lerp(-3, 1, u), lerp(2.2, 2.6, u), lerp(16, 11, u));
      this.world(0, 1.9, 0, this.look);
      fov = 38;
    } else if (t < 7) {
      // low on the winner as the trophies go up
      const u = (t - 3.5) / 3.5;
      P(lerp(1.4, 0.6, u), 0.9, lerp(4.6, 4.1, u));
      this.world(0, lerp(2.4, 3.1, ease(u)), 0, this.look);
      fov = 34;
    } else if (t < 10.5) {
      // slow orbit through the spray
      const a = lerp(-0.9, 0.5, (t - 7) / 3.5);
      P(Math.sin(a) * 7.5, 2.4, Math.cos(a) * 7.5);
      this.world(0, 2.1, 0, this.look);
      fov = 36;
    } else if (t < 13.5) {
      // tight on the winner spraying
      const u = (t - 10.5) / 3;
      P(lerp(-3.4, -2.6, u), 2.3, lerp(5.2, 4.6, u));
      this.world(0.1, 2.2, 0, this.look);
      fov = 34;
    } else if (t < 15.5) {
      // reverse: over the drivers' shoulders to the grandstand going wild
      const u = (t - 13.5) / 2;
      P(lerp(-4.4, -2.8, u), 3.1, -0.6);
      this.world(lerp(-16, -4, u), 6.5, 45, this.look);
      fov = 52;
    } else {
      // crane up and out: podium, confetti, the stands
      const u = ease((t - 15.5) / (DURATION - 15.5));
      P(lerp(0, 2, u), lerp(3, 9, u), lerp(9, 18, u));
      this.world(0, lerp(2, 1.5, u), 0, this.look);
      fov = 42;
    }
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** point of focus for depth of field */
  focus(out: THREE.Vector3) {
    if (this.t > 13.5 && this.t < 15.5) return out.copy(this.look);
    return this.world(0, 2, 0, out);
  }

  dispose() {
    this.group.removeFromParent();
    this.title.remove();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
      for (const x of mats) {
        const mm = x as THREE.MeshStandardMaterial;
        mm.map?.dispose();
        x.dispose();
      }
    });
  }
}
