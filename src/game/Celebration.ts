import * as THREE from 'three';
import { TEAMS, type Entry } from '../race/Teams.ts';
import type { Track } from '../world/Track.ts';
import { EVENT } from '../world/event.ts';
import { FanCrowd, ACT } from '../people/Crowd.ts';
import { peopleKit } from '../people/Humans.ts';
import { PodiumDriver } from '../people/drivers.ts';

/**
 * The podium ceremony, filmed like the broadcast.
 *
 * On the main straight, backed onto the pit wall: the podium stage with the three
 * drivers in their race suits and team caps, the top three cars parked in parc
 * fermé in front of it, team crews and fans filling the track below waving
 * flags. The sequence: establishing shots, the anthem as the flags go up, the
 * trophies handed over (third, second, winner), the champagne — shaken, sprayed,
 * one shot in slow motion — the crowd going wild, and the team photo under the
 * ticker tape as the camera cranes away. ~36 s; `update` returns true at the end.
 */

const DURATION = 36;

// ------------------------------------------------------------------------------------ helpers
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** smooth value noise for hand-held camera drift */
function wobble(t: number, seed: number) {
  return Math.sin(t * 0.73 + seed) * 0.5 + Math.sin(t * 1.61 + seed * 2.1) * 0.3 + Math.sin(t * 3.7 + seed * 0.7) * 0.12;
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

const FONT = '"Titillium Web", Arial, sans-serif';

// ------------------------------------------------------------------------------------ props
function mesh(g: THREE.BufferGeometry, m: THREE.Material, cast = true) {
  const x = new THREE.Mesh(g, m);
  x.castShadow = cast;
  x.receiveShadow = true;
  return x;
}

function makeTrophy(place: number): THREE.Object3D {
  const gold = new THREE.MeshPhysicalMaterial({ color: place === 1 ? 0xe2bd5a : place === 2 ? 0xd7d9dc : 0xc98a55, metalness: 1, roughness: 0.16, clearcoat: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.35, metalness: 0.4 });
  const k = place === 1 ? 1.15 : 1;
  const prof: [number, number][] = [
    [0.0, 0], [0.075, 0], [0.075, 0.05], [0.06, 0.06], [0.03, 0.075], [0.02, 0.19], [0.026, 0.22], [0.06, 0.25], [0.105, 0.3], [0.125, 0.37], [0.12, 0.44], [0.112, 0.45], [0.0, 0.45],
  ];
  const g = new THREE.Group();
  const cup = mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x * k, y * k)), 40), gold);
  g.add(cup);
  // plinth band and handles
  const band = mesh(new THREE.CylinderGeometry(0.077 * k, 0.077 * k, 0.04 * k, 32), dark);
  band.position.y = 0.025 * k;
  g.add(band);
  for (const s of [-1, 1]) {
    const h = mesh(new THREE.TorusGeometry(0.055 * k, 0.008 * k, 8, 18, Math.PI * 1.1), gold);
    h.position.set(s * 0.13 * k, 0.36 * k, 0);
    h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    g.add(h);
  }
  return g;
}

function makeBottle(): THREE.Object3D {
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x14361a, metalness: 0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1 });
  const foil = new THREE.MeshStandardMaterial({ color: 0xc9a23c, metalness: 1, roughness: 0.28 });
  const label = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5, metalness: 0.2 });
  const prof: [number, number][] = [[0, 0], [0.05, 0], [0.052, 0.02], [0.052, 0.22], [0.045, 0.26], [0.019, 0.32], [0.016, 0.38], [0.0, 0.38]];
  const b = mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28), glass);
  const f = mesh(new THREE.CylinderGeometry(0.019, 0.024, 0.09, 16), foil);
  f.position.y = 0.335;
  const l = mesh(new THREE.CylinderGeometry(0.0535, 0.0535, 0.09, 28, 1, true), label);
  l.position.y = 0.11;
  const g = new THREE.Group();
  g.add(b, f, l);
  return g;
}

// ------------------------------------------------------------------------------------ particles
let _dot: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  return (_dot ??= canvasTex(64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }));
}

/** champagne: droplets and foam as soft points (world space) */
class Spray {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  constructor(n: number, size: number, private gravity: number, private drag: number, colour: THREE.Color, opacity: number) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -1e4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const m = new THREE.PointsMaterial({ size, color: colour, transparent: true, opacity, depthWrite: false, map: dotTexture() });
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
  update(dt: number) {
    const P = this.pos, V = this.vel;
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.life.length; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        P[i * 3 + 1] = -1e4;
        this.life[i] = 0;
        continue;
      }
      V[i * 3] *= k;
      V[i * 3 + 2] *= k;
      V[i * 3 + 1] = V[i * 3 + 1] * k - this.gravity * dt;
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** ticker tape: thin paper strips tumbling and fluttering down (instanced, lit, double-sided) */
class TickerTape {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array;
  private v: Float32Array;
  private rot: Float32Array;
  private spin: Float32Array;
  private live: Uint8Array;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly t = new THREE.Vector3();
  constructor(private n: number, colours: string[]) {
    const g = new THREE.PlaneGeometry(0.035, 0.11);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.35, metalness: 0.55 });
    this.mesh = new THREE.InstancedMesh(g, mat, n);
    this.mesh.frustumCulled = false;
    this.mesh.count = n;
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 3);
    this.live = new Uint8Array(n);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.mesh.setColorAt(i, c.set(colours[i % colours.length]));
      this.p[i * 3 + 1] = -1e4;
      this.mesh.setMatrixAt(i, this.m.makeTranslation(0, -1e4, 0));
    }
  }
  emit(x: number, y: number, z: number) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.p.set([x, y, z], i * 3);
    this.v.set([(Math.random() - 0.5) * 1.2, -0.6 - Math.random() * 0.6, (Math.random() - 0.5) * 1.2], i * 3);
    this.rot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    this.spin.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14], i * 3);
    this.live[i] = 1;
  }
  update(dt: number, t: number, ground: number) {
    const P = this.p, V = this.v, R = this.rot, S = this.spin;
    for (let i = 0; i < this.n; i++) {
      if (!this.live[i]) continue;
      const o = i * 3;
      // paper falls at ~1 m/s, sways side to side
      V[o + 1] += (-1.0 - V[o + 1]) * Math.min(1, dt * 2);
      P[o] += (V[o] + Math.sin(t * 2.3 + i) * 0.5) * dt;
      P[o + 1] += V[o + 1] * dt;
      P[o + 2] += (V[o + 2] + Math.cos(t * 1.9 + i * 1.3) * 0.5) * dt;
      if (P[o + 1] < ground + 0.01) {
        P[o + 1] = ground + 0.01;
        R[o] = Math.PI / 2;
        R[o + 2] = 0;
        S[o] = S[o + 1] = S[o + 2] = 0;
        this.live[i] = 2;
      } else {
        R[o] += S[o] * dt;
        R[o + 1] += S[o + 1] * dt;
        R[o + 2] += S[o + 2] * dt;
      }
      this.q.setFromEuler(this.e.set(R[o], R[o + 1], R[o + 2]));
      this.m.compose(this.t.set(P[o], P[o + 1], P[o + 2]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
      if (this.live[i] === 2) this.live[i] = 0;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** how many of the fans follow each team (Ferrari's tifosi are everywhere) */
const FOLLOWING = [3.2, 1.8, 1.8, 2.2, 1.1, 0.8, 0.9, 0.7, 0.7, 0.8, 0.7];
function pickTeam(): number {
  const tot = FOLLOWING.slice(0, TEAMS.length).reduce((a, b) => a + b, 0);
  let x = Math.random() * tot;
  for (let k = 0; k < TEAMS.length; k++) {
    x -= FOLLOWING[k] ?? 0.7;
    if (x <= 0) return k;
  }
  return 0;
}

// ------------------------------------------------------------------------------------ the ceremony
export class Celebration {
  readonly group = new THREE.Group();
  /** where the shadows should focus */
  readonly center = new THREE.Vector3();
  /** where the top three cars are parked (world pose), for the game to place them */
  readonly parkSlots: { pos: THREE.Vector3; yaw: number }[] = [];
  private figures: PodiumDriver[] = [];
  private champagne = new Spray(2600, 0.035, 8, 0.5, new THREE.Color(1, 0.97, 0.86), 0.85);
  private foam = new Spray(900, 0.09, 3.5, 1.8, new THREE.Color(1, 1, 0.97), 0.6);
  private mist = new Spray(700, 0.22, 0.4, 2.2, new THREE.Color(1, 0.98, 0.92), 0.12);
  private tape: TickerTape;
  private crowd: FanCrowd;
  private flags: { pole: THREE.Object3D; flag: THREE.Mesh; geo: THREE.PlaneGeometry; base: Float32Array }[] = [];
  /** ceremony clock (runs slow during the slow-motion shot) */
  private t = 0;
  /** ceremony clock (s) */
  get time() {
    return this.t;
  }
  /** real seconds since the start */
  private real = 0;
  private title: HTMLDivElement;
  private strap: HTMLDivElement;
  private bars: HTMLDivElement;
  private strapKey = '';
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly camQ = new THREE.Quaternion();
  private dofRange = 6;
  private dofBokeh = 1.6;
  private readonly podium: Entry[];
  private groundY = 0;

  constructor(track: Track, groundAt: (x: number, z: number) => number, podium: Entry[], uiRoot: HTMLElement) {
    this.group.name = 'Celebration';
    this.podium = podium;
    void groundAt;
    // on the track by the pit wall just short of the line, facing the main grandstand
    const s = track.wrap(track.startS - 45);
    const side = track.pit.side;
    const lat = side * (track.halfWidthAt(s) - 2.2);
    const base = track.point(s, lat, 0);
    const toTrack = track.point(s, -side * 20, 0).sub(base).setY(0).normalize();
    this.center.set(base.x, base.y, base.z);
    this.groundY = base.y;
    this.group.position.copy(this.center);
    this.group.rotation.y = Math.atan2(toTrack.x, toTrack.z);
    this.group.updateMatrixWorld(true);

    // ---- the stage: steps, deck, backdrop, gantry with the flag poles
    const stepMat = new THREE.MeshPhysicalMaterial({ color: 0xeeeeec, roughness: 0.35, clearcoat: 0.4 });
    const numTex = (n: string) =>
      canvasTex(256, 256, (g) => {
        g.fillStyle = '#121419';
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = '#d8b04a';
        g.fillRect(0, 222, 256, 10);
        g.fillStyle = '#ffffff';
        g.font = `900 160px ${FONT}`;
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
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, h, 1.5), [stepMat, stepMat, stepMat, stepMat, new THREE.MeshStandardMaterial({ map: numTex(String(n)), roughness: 0.4 }), stepMat]);
      m.position.set(x, h / 2, 0);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x17191e, roughness: 0.55, metalness: 0.1 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 0.25, 5.2), deckMat);
    deck.position.set(0, -0.12, -0.4);
    deck.receiveShadow = deck.castShadow = true;
    this.group.add(deck);
    // front skirt with the event name
    const skirtTex = canvasTex(2048, 64, (g) => {
      g.fillStyle = '#0f1116';
      g.fillRect(0, 0, 2048, 64);
      g.fillStyle = '#d8b04a';
      g.font = `700 36px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let k = 0; k < 4; k++) g.fillText(`${EVENT.gp.toUpperCase()}   ·   `, 256 + k * 512, 34);
    });
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.25), new THREE.MeshStandardMaterial({ map: skirtTex, roughness: 0.6 }));
    skirt.position.set(0, -0.12, 2.21);
    this.group.add(skirt);
    const backTex = canvasTex(2048, 840, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 840);
      gr.addColorStop(0, '#0b0d13');
      gr.addColorStop(1, '#1b2030');
      g.fillStyle = gr;
      g.fillRect(0, 0, 2048, 840);
      // repeating event wall behind the drivers, like a press backdrop
      g.globalAlpha = 0.16;
      g.fillStyle = '#ffffff';
      g.font = `italic 900 54px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let y = 60; y < 840; y += 120) for (let x = (y / 120) % 2 ? 150 : 0; x < 2200; x += 420) g.fillText('APEX GP', x, y);
      g.globalAlpha = 1;
      g.fillStyle = '#b0001e';
      g.fillRect(0, 600, 2048, 70);
      g.fillStyle = '#ffffff';
      g.font = `italic 900 170px ${FONT}`;
      g.fillText(EVENT.gp.toUpperCase(), 1024, 330, 1900);
      g.font = `700 60px ${FONT}`;
      g.fillText(`${EVENT.place.toUpperCase()}`, 1024, 636);
    });
    const back = new THREE.Mesh(new THREE.BoxGeometry(9, 3.8, 0.22), [stepMat, stepMat, stepMat, stepMat, new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.55 }), stepMat]);
    back.position.set(0, 1.9, -2.55);
    back.castShadow = back.receiveShadow = true;
    this.group.add(back);
    // gantry over the stage (confetti cannons, lights)
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.4, metalness: 0.8 });
    for (const x of [-4.4, 4.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 6.2, 0.22), steel);
      post.position.set(x, 3.1, -2.2);
      post.castShadow = true;
      this.group.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.35, 0.35), steel);
    beam.position.set(0, 6.1, -2.2);
    beam.castShadow = true;
    this.group.add(beam);
    // flag poles on top of the backdrop: winner's team centre, then second and third
    const poleMat = new THREE.MeshStandardMaterial({ color: 0xd9dbe0, roughness: 0.25, metalness: 0.9 });
    podium.slice(0, 3).forEach((e, i) => {
      const x = i === 0 ? 0 : i === 1 ? -2.6 : 2.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 4.4, 10), poleMat);
      pole.position.set(x, 6.1, -2.6);
      pole.castShadow = true;
      this.group.add(pole);
      const tex = canvasTex(512, 320, (g) => {
        g.fillStyle = e.team.primary;
        g.fillRect(0, 0, 512, 320);
        g.fillStyle = e.team.secondary;
        g.fillRect(0, 214, 512, 106);
        g.fillStyle = e.team.accent;
        g.fillRect(0, 206, 512, 12);
        g.fillStyle = e.team.ink;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `italic 900 76px ${FONT}`;
        g.fillText(e.team.short, 256, 108, 460);
      });
      const geo = new THREE.PlaneGeometry(1.6, 1.0, 16, 6);
      geo.translate(0.8, 0, 0);
      const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
      flag.castShadow = true;
      flag.position.set(x + 0.04, 4.6, -2.6);
      this.group.add(flag);
      this.flags.push({ pole, flag, geo, base: (geo.getAttribute('position') as THREE.BufferAttribute).array.slice() as Float32Array });
    });

    // ---- the drivers: P1 centre, P2 at the winner's right hand, P3 at the left
    podium.slice(0, 3).forEach((e, i) => {
      const trophy = makeTrophy(i + 1);
      trophy.visible = false;
      const bottle = makeBottle();
      bottle.visible = false;
      this.group.add(trophy, bottle);
      const f = new PodiumDriver(peopleKit()!, e.team, e.driver, i + 1, (i + 1) * 1.7, trophy, bottle);
      const [x, h] = steps[i];
      f.baseY = h;
      f.root.position.set(x, h, 0.1);
      f.root.rotation.y = i === 0 ? 0 : i === 1 ? 0.22 : -0.22;
      this.group.add(f.root);
      this.figures.push(f);
    });

    // ---- parc fermé: the top three cars nose-in below the podium, numbered boards in front.
    // The podium backs onto the pit wall; the track in front of it is ~10 m wide.
    const trackFar = track.halfWidthAt(s) + Math.abs(lat) - 0.4;
    for (let i = 0; i < 3; i++) {
      const lx = [0, -3.6, 3.6][i];
      const lz = i === 0 ? 4.6 : 5.0;
      const p = this.world(lx, 0, lz, new THREE.Vector3());
      // pointing at the podium, a little splayed
      const yaw = this.group.rotation.y + Math.PI + [0, 0.18, -0.18][i];
      this.parkSlots.push({ pos: p, yaw });
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.05), new THREE.MeshStandardMaterial({ map: numTex(String(i + 1)), roughness: 0.5 }));
      board.position.set(lx + [0, 0.25, -0.25][i], 0.62, 1.35);
      board.castShadow = true;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), steel);
      leg.position.set(0, -0.5, 0);
      board.add(leg);
      this.group.add(board);
    }

    // ---- the crowd on the track: team crews round the cars, fans packed in behind them to the far wall
    const spots: { x: number; z: number; y: number; yaw: number; team: number; flag: boolean }[] = [];
    const podTeams = podium.slice(0, 3).map((e) => TEAMS.indexOf(e.team));
    const gap = 0.72;
    for (let x = -28; x <= 28; x += gap) {
      for (let z = 2.2; z <= trackFar; z += gap) {
        const jx = x + (Math.random() - 0.5) * gap * 0.8;
        const jz = z + (Math.random() - 0.5) * gap * 0.8;
        // parc fermé is roped off: the cars and a lane for the cameras
        if (Math.abs(jx) < 6.4 && jz < 8.1) continue;
        // thinner toward the ends of the crowd
        if (Math.random() < Math.max(0, (Math.abs(jx) - 14) / 16)) continue;
        const crew = jz < 8.6 && Math.abs(jx) < 11;
        const team = crew && Math.random() < 0.8 ? podTeams[Math.floor(Math.random() * 3)] : pickTeam();
        // everyone faces the podium
        const yaw = Math.PI + Math.atan2(-jx, jz + 2) * 0.9 + (Math.random() - 0.5) * 0.3;
        spots.push({ x: jx, z: jz, y: 0, yaw, team, flag: Math.random() < (crew ? 0.05 : 0.12) });
      }
    }
    this.crowd = new FanCrowd(
      peopleKit()!,
      spots.map((sp) => ({ x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw, team: sp.team, act: sp.flag ? ACT.FLAG : undefined, excite: 0.5 + Math.random() * 0.5 })),
      { shadows: true },
    );
    this.group.add(this.crowd.group);

    // TV lighting on the stage: a soft key from the front (the sun is often behind the podium)
    const key = new THREE.SpotLight(0xfff3e6, 60, 40, 0.55, 0.8, 1.2);
    key.position.set(-3, 9, 14);
    key.target.position.set(0, 1.8, 0);
    key.castShadow = false;
    this.group.add(key, key.target);

    // ---- champagne and ticker tape (world space)
    const cols = ['#e8c35a', '#f3f3f3', '#d9dce1', '#e8c35a', ...podium.slice(0, 3).map((e) => e.team.primary)];
    this.tape = new TickerTape(3200, cols);
    for (const o of [this.champagne.points, this.foam.points, this.mist.points, this.tape.mesh]) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(this.group.matrixWorld).invert();
      this.group.add(o);
    }

    // ---- broadcast graphics
    const css = (el: HTMLElement, st: Partial<CSSStyleDeclaration>) => Object.assign(el.style, st);
    this.bars = document.createElement('div');
    this.bars.innerHTML = '<i></i><i></i>';
    css(this.bars, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '19' });
    for (const [k, b] of Array.from(this.bars.children).entries()) {
      css(b as HTMLElement, { position: 'absolute', left: '0', right: '0', height: '0', background: '#000', transition: 'height 1.2s cubic-bezier(.3,.8,.3,1)', [k ? 'bottom' : 'top']: '0' } as Partial<CSSStyleDeclaration>);
    }
    uiRoot.appendChild(this.bars);
    this.title = document.createElement('div');
    css(this.title, {
      position: 'fixed', left: '48px', top: '48px', opacity: '0', transition: 'opacity .8s', pointerEvents: 'none', zIndex: '20',
      color: '#fff', font: `700 15px ${FONT}`, letterSpacing: '0.16em', textTransform: 'uppercase', textShadow: '0 1px 8px rgba(0,0,0,.5)',
    });
    this.title.innerHTML = `<div style="font-size:12px;color:#d8b04a">Podium ceremony</div><div style="font-size:20px;letter-spacing:.06em;margin-top:4px">${EVENT.gp}</div>`;
    uiRoot.appendChild(this.title);
    this.strap = document.createElement('div');
    css(this.strap, {
      position: 'fixed', left: '50%', bottom: '72px', transform: 'translateX(-50%) translateY(14px)', opacity: '0',
      display: 'flex', gap: '14px', alignItems: 'center', padding: '12px 22px 12px 14px', borderRadius: '10px',
      background: 'rgba(10,12,17,0.78)', backdropFilter: 'blur(14px)', color: '#fff', font: `600 19px ${FONT}`,
      transition: 'opacity .45s, transform .55s cubic-bezier(.2,.9,.3,1.1)', pointerEvents: 'none', zIndex: '20', letterSpacing: '0.02em',
    });
    uiRoot.appendChild(this.strap);
    requestAnimationFrame(() => {
      for (const b of Array.from(this.bars.children) as HTMLElement[]) b.style.height = '8.5vh';
    });
  }

  /** world point in the podium's frame (x right of the drivers, y up, z toward the track) */
  private world(x: number, y: number, z: number, out: THREE.Vector3) {
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  /** time-scale of the ceremony clock: the champagne close-up plays in slow motion */
  private rate(): number {
    const r = this.real;
    return r > 24.4 && r < 27.6 ? 0.32 : 1;
  }

  /** the body language of one driver at ceremony time t */
  private pose(f: PodiumDriver, t: number, dt: number) {
    const ph = f.phase;
    const me = f.place;
    // trophy handed over: third at 14, second at 16.5, winner at 19
    const tTrophy = me === 3 ? 14 : me === 2 ? 16.5 : 19;
    let jump = 0;
    let lx = 0.08, lz = 0.12, le = 0, rx = 0.08, rz = -0.12, re = 0;
    // forearms hang slightly forward when relaxed
    let lex = -0.28, rex = -0.28;
    let headY = Math.sin(t * 0.5 + ph) * 0.25;
    let headX = -0.05;
    let lean = 0.02 + Math.sin(t * 1.9 + ph) * 0.012;
    const breathe = 1 + Math.sin(t * 1.7 + ph) * 0.008;
    if (t < 4.5) {
      // walk-on done: waving to the crowd, the winner punching the air
      const w = Math.sin(t * 5.5 + ph);
      rz = -2.45 - 0.25 * w;
      re = -0.4 + 0.35 * w;
      rex = 0;
      lz = 0.18;
      if (me === 1) {
        lz = 2.6 + 0.15 * Math.sin(t * 7);
        le = 0.5;
        lex = 0;
        jump = Math.max(0, Math.sin(t * 5)) * 0.14 * ease(t - 0.5);
      }
      headY = Math.sin(t * 0.9 + ph) * 0.45;
    } else if (t < 11) {
      // the anthem: still, facing the flags, winner with a hand on the heart
      headX = -0.28;
      headY = me === 1 ? 0 : (me === 2 ? -0.12 : 0.12);
      lean = -0.02;
      rz = -0.08;
      lz = 0.08;
      if (me === 1) {
        rx = -0.85;
        rz = 0.3;
        re = 0.4;
        rex = -1.6;
      }
    } else if (t < tTrophy) {
      // waiting, clapping the others
      const c = Math.max(0, Math.sin(t * 9 + ph));
      rx = -0.35;
      lx = -0.35;
      rz = 0.12;
      lz = -0.12;
      rex = -1.35 + 0.1 * c;
      lex = -1.35 + 0.1 * c;
      re = 0.45 - 0.2 * c;
      le = -0.45 + 0.2 * c;
      headY = me === 1 ? (t < 16.5 ? 0.5 : -0.5) : 0;
    } else if (t < 22) {
      // the trophy goes up, kissed, held high
      const u = ease((t - tTrophy) / 0.8);
      rz = lerp(-0.1, -2.95, u);
      re = lerp(0, -0.15, u);
      rx = lerp(0, -0.15, u);
      rex = lerp(-0.28, 0, u);
      if (me === 1) lex = lerp(-0.28, 0, u);
      lz = lerp(0.1, me === 1 ? 2.5 : 0.35, u);
      le = me === 1 ? 0.4 : 0;
      if (me === 1) jump = Math.max(0, Math.sin((t - tTrophy) * 4.4)) * 0.16 * u;
      headX = -0.25 * u;
    } else if (t < 24.2) {
      // bottles: shaking them up, thumb over the neck
      const sh = Math.sin(t * 22 + ph) * 0.25;
      lx = -0.5;
      lz = 0.15;
      lex = -1.2 + sh;
      rx = -0.5;
      rz = -0.15;
      rex = -1.3 + sh * 0.5;
      lean = 0.05;
      jump = Math.max(0, Math.sin(t * 6 + ph)) * 0.05;
    } else if (t < 30) {
      // spraying: bottle out front, aimed at the others and the crowd, swept across
      const sweep = Math.sin((t - 24.2) * (me === 1 ? 1.9 : 1.5) + ph);
      lx = -1.35 - 0.3 * Math.sin((t - 24.2) * 2.6 + ph);
      lz = 0.25 + 0.45 * sweep;
      le = -0.12;
      lex = -0.15;
      rz = -2.3 - 0.4 * Math.max(0, Math.sin((t - 24.2) * 6.5 + ph));
      re = -0.9;
      rex = 0;
      headY = sweep * 0.4;
      lean = 0.06;
      jump = Math.max(0, Math.sin((t - 24.2) * 4 + ph)) * 0.07;
    } else {
      // the photo: arms up with the trophies, jumping together
      const w = Math.sin(t * 6.5 + ph);
      lz = 2.6 + 0.2 * w;
      rz = -2.75 - 0.2 * w;
      le = 0.3;
      re = -0.2;
      lex = rex = 0;
      jump = Math.max(0, Math.sin(t * 4.6 + ph * 0.3)) * 0.2;
      headX = -0.2;
    }
    f.apply(dt, { lx, lz, lex, le, rx, rz, rex, re, headX, headY, lean, jump });
    void breathe;
    f.trophy.visible = t >= tTrophy - 0.1;
    // the trophy goes on the step while spraying; back up for the photo
    if (t >= 22 && t < 30) f.trophy.visible = false;
    f.bottle.visible = t >= 22 && t < 30;
  }

  /** advance; drives the camera; true when finished */
  update(dtReal: number, camera: THREE.PerspectiveCamera): boolean {
    this.real += dtReal;
    const dt = dtReal * this.rate();
    this.t += dt;
    const t = this.t;
    this.group.updateMatrixWorld(true);
    for (const f of this.figures) this.pose(f, t, dt);
    this.group.updateMatrixWorld(true);

    // flags: raised during the anthem, rippling in the breeze
    this.flags.forEach((F, i) => {
      const up = ease((t - 5.5 - (i === 0 ? 0 : 0.2)) / 5);
      F.flag.position.y = lerp(4.4, 7.4, up);
      const pa = F.geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < pa.count; k++) {
        const x = F.base[k * 3];
        const y = F.base[k * 3 + 1];
        const w = x / 1.6;
        pa.setZ(k, Math.sin(x * 3.2 - t * 5.5 + i) * 0.09 * w + Math.sin(x * 5.5 - t * 8 + y * 2) * 0.03 * w);
        pa.setY(k, y - w * w * 0.1 * (1 - up * 0.5));
      }
      pa.needsUpdate = true;
      F.geo.computeVertexNormals();
    });

    // champagne jets from the bottle necks (shaken bottles: a hard jet, then foam and mist)
    if (t >= 24.2 && t < 29.8) {
      const fade = t < 28 ? 1 : 1 - (t - 28) / 1.8;
      for (const f of this.figures) {
        const tip = f.bottle.localToWorld(this.tmp.set(0, 0.38, 0));
        const dir = f.bottle.localToWorld(this.tmp2.set(0, 1, 0)).sub(f.bottle.getWorldPosition(new THREE.Vector3())).normalize();
        const jet = (6.5 + Math.random() * 3) * fade;
        const n = Math.ceil(26 * fade * Math.min(2, dt * 60));
        for (let k = 0; k < n; k++) this.champagne.emit(tip, dir.clone().multiplyScalar(jet * (0.75 + Math.random() * 0.5)), 1.1, 1.1);
        for (let k = 0; k < 5 * fade; k++) this.foam.emit(tip, dir.clone().multiplyScalar(jet * 0.35), 1.4, 0.8);
        if (Math.random() < 0.6) this.mist.emit(tip.addScaledVector(dir, 1.5), dir.clone().multiplyScalar(1.5), 1.5, 2.2);
      }
    }
    // ticker tape from the gantry when the winner lifts the trophy, and for the photo
    if ((t >= 19.2 && t < 23) || t >= 29.5) {
      const burst = t < 20.5 || (t > 29.5 && t < 31) ? 60 : 16;
      for (let k = 0; k < burst * Math.min(2, dt * 60); k++) {
        const p = this.world((Math.random() - 0.5) * 12, 7 + Math.random() * 2, -2 + Math.random() * 12, this.tmp);
        this.tape.emit(p.x, p.y, p.z);
      }
    }
    this.champagne.update(dt);
    this.foam.update(dt);
    this.mist.update(dt);
    this.tape.update(dt, t, this.groundY);
    for (const o of [this.champagne.points, this.foam.points, this.mist.points, this.tape.mesh]) o.matrix.copy(this.group.matrixWorld).invert();
    // the crowd: cheering on arrival, quiet for the anthem, wild for the trophies and champagne
    // quiet and still for the anthem, then wild
    const calm = t < 5 ? 0 : t < 11 ? Math.min(1, (t - 5) / 1.2) : Math.max(0, 1 - (t - 11) / 1.2);
    this.crowd.update(this.real, calm);

    this.graphics(t);
    this.shoot(camera);
    return this.real >= DURATION;
  }

  /** the crowd noise the scene calls for (0..1) */
  get crowdLevel(): number {
    const t = this.t;
    return t < 5 ? 0.9 : t < 11 ? 0.25 : 1;
  }

  private graphics(t: number) {
    this.title.style.opacity = this.real > 0.8 && this.real < 6 ? '1' : '0';
    // lower-third names as each driver gets their trophy, then the winner
    let key = '';
    let html = '';
    const row = (e: Entry, label: string) =>
      `<span style="width:5px;height:30px;border-radius:3px;background:${e.team.primary}"></span><span style="color:#d8b04a;font-size:13px;letter-spacing:.14em;text-transform:uppercase">${label}</span><b style="font-weight:700">${e.driver.first} ${e.driver.last.toUpperCase()}</b><span style="color:rgba(255,255,255,.62);font-size:15px">${e.team.name}</span>`;
    const [p1, p2, p3] = this.podium;
    if (t > 14 && t < 16.3 && p3) (key = '3'), (html = row(p3, 'Third'));
    else if (t > 16.6 && t < 18.8 && p2) (key = '2'), (html = row(p2, 'Second'));
    else if (t > 19.1 && t < 23.5 && p1) (key = '1'), (html = row(p1, 'Race winner'));
    else if (this.real > 31 && this.real < DURATION - 1.2 && p1) (key = 'w'), (html = row(p1, `Winner · ${EVENT.gp}`));
    if (key !== this.strapKey) {
      this.strapKey = key;
      if (key) this.strap.innerHTML = html;
      this.strap.style.opacity = key ? '1' : '0';
      this.strap.style.transform = key ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(14px)';
    }
  }

  /**
   * The shot list, cut on real time. Each shot: camera path + look target in the
   * podium's frame, lens (fov), focus, and how hand-held it is.
   */
  private shoot(cam: THREE.PerspectiveCamera) {
    const r = this.real;
    const P = (x: number, y: number, z: number) => this.world(x, y, z, cam.position);
    const Lk = (x: number, y: number, z: number) => this.world(x, y, z, this.look);
    const f1 = this.figures[0], f2 = this.figures[1], f3 = this.figures[2];
    const headOf = (f: PodiumDriver | undefined, out: THREE.Vector3) => (f ? f.headWorld(out) : this.world(0, 2.6, 0, out));
    let fov = 40;
    let hand = 0.5;
    let range = 6;
    let bokeh = 1.4;
    if (r < 4.5) {
      // 1. establishing: high and wide from across the track, the whole scene, a slow push
      const u = ease(r / 4.5);
      P(lerp(-9, -6, u), lerp(9, 7.5, u), lerp(30, 25, u));
      Lk(0, 2.2, 3);
      fov = lerp(44, 38, u);
      hand = 0.4;
      range = 18;
      bokeh = 0.6;
    } else if (r < 8) {
      // 2. parc fermé: low along the winner's car toward the podium
      const u = (r - 4.5) / 3.5;
      const car = this.parkSlots[0]?.pos ?? this.world(0, 0, 7, this.tmp2);
      const back = this.world(lerp(1.7, 1.1, u), 0.6, 7.8, this.tmp);
      cam.position.copy(back);
      this.look.copy(car).lerp(this.world(0, 2.4, 0, this.tmp2), 0.35 + 0.3 * u);
      this.look.y += 0.4;
      fov = 30;
      hand = 0.8;
      range = 4;
      bokeh = 2.2;
    } else if (r < 13.5) {
      // 3. the anthem: low, past the winner, up to the flags rising
      const u = ease((r - 8) / 5.5);
      P(lerp(2.4, 1.8, u), 1.1, lerp(5.2, 4.6, u));
      Lk(lerp(0, -0.4, u), lerp(2.6, 6.6, u), lerp(0, -2.4, u));
      fov = 36;
      hand = 0.6;
      range = 8;
      bokeh = 1.2;
    } else if (r < 16.3) {
      // 4. third place gets the trophy: telephoto from the crowd
      P(-4.8, 2.7, 9.2);
      headOf(f3, this.look);
      this.look.y -= 0.25;
      fov = 15;
      hand = 1.2;
      range = 2.5;
      bokeh = 2.8;
    } else if (r < 18.8) {
      // 5. second place
      P(4.8, 2.7, 9.2);
      headOf(f2, this.look);
      this.look.y -= 0.25;
      fov = 15;
      hand = 1.2;
      range = 2.5;
      bokeh = 2.8;
    } else if (r < 22) {
      // 6. the winner lifts it: low hero angle, slow push
      const u = ease((r - 18.8) / 3.2);
      P(lerp(-1.2, -0.7, u), 1.2, lerp(4.2, 3.6, u));
      headOf(f1, this.look);
      this.look.y += 0.1;
      fov = 30;
      hand = 0.9;
      range = 3;
      bokeh = 2.2;
    } else if (r < 24.4) {
      // 7. shaking the bottles: medium on the three
      P(0.6, 2.4, 6.2);
      Lk(0, 2.3, 0);
      fov = 30;
      hand = 1;
      range = 4;
      bokeh = 1.8;
    } else if (r < 27.6) {
      // 8. slow motion: close on the winner's spray, from the side
      const u = (r - 24.4) / 3.2;
      P(lerp(-2.8, -2.2, u), 2.35, lerp(2.4, 2.8, u));
      if (f1) f1.bottle.localToWorld(this.look.set(0, 0.5, 0));
      else Lk(0, 2.3, 0.5);
      fov = 34;
      hand = 0.35;
      range = 1.8;
      bokeh = 3;
    } else if (r < 30.5) {
      // 9. reverse: over the drivers' shoulders to the crowd on the track and the stands
      const u = ease((r - 27.6) / 2.9);
      P(lerp(-3.6, -2, u), 3.4, -1);
      Lk(lerp(-10, 2, u), 1.2, 22);
      fov = 50;
      hand = 0.9;
      range = 14;
      bokeh = 0.8;
    } else {
      // 10. the photo, then crane up and away over the crowd
      const u = ease((r - 30.5) / (DURATION - 30.5));
      P(lerp(0.5, 3, u), lerp(2.6, 14, u), lerp(8, 26, u));
      Lk(0, lerp(2.4, 1.2, u), lerp(0, 3, u));
      fov = lerp(34, 46, u);
      hand = 0.5;
      range = lerp(5, 16, u);
      bokeh = lerp(1.6, 0.6, u);
    }
    // hand-held: slow drift and a little breathing on the lens
    const k = hand * 0.035;
    cam.position.x += wobble(r, 1) * k;
    cam.position.y += wobble(r, 2) * k * 0.7;
    cam.position.z += wobble(r, 3) * k;
    cam.lookAt(this.look);
    this.camQ.setFromAxisAngle(this.tmp.set(0, 0, 1), wobble(r * 0.8, 4) * hand * 0.006);
    cam.quaternion.multiply(this.camQ);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.dofRange = range;
    this.dofBokeh = bokeh;
  }

  /** point of focus for depth of field */
  focus(out: THREE.Vector3) {
    return out.copy(this.look);
  }
  get dof(): { range: number; bokeh: number } {
    return { range: this.dofRange, bokeh: this.dofBokeh };
  }

  dispose() {
    this.group.removeFromParent();
    this.title.remove();
    this.strap.remove();
    this.bars.remove();
    this.crowd.dispose();
    for (const f of this.figures) f.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
      for (const x of mats) {
        const mm = x as THREE.MeshStandardMaterial;
        if (mm.map && mm.map !== _dot) mm.map.dispose();
        x.dispose();
      }
    });
  }
}
