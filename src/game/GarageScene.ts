import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { CarRig } from '../car/CarModel.ts';
import { uiColor, type Team, type Driver } from '../race/Teams.ts';
import { Person, fanLook, type Look, type PeopleKit } from '../people/Humans.ts';
import { driverLook } from '../people/drivers.ts';
import { naturalStance, turnHead, aimArm, lean } from '../people/poses.ts';
import { MOMENT_LABEL, type Highlight, type Highlights } from '../career/Highlights.ts';
import type { Career } from '../career/Career.ts';
import type { Track } from '../world/Track.ts';

/**
 * Your garage, dressed for the menu like a team feature on TV: the car on branded tyre
 * blankets with proper front and rear jacks, a cooling blower in its sidepod, an LED
 * light box overhead; a video wall behind it playing your best racing moments (real
 * video, with a broadcast lower third), the telemetry and career screens on rolling
 * towers, the engineers' laptop cart, tool chests, a wheel-gun rack; and people: you in
 * your race suit, mechanics kneeling at the wheels and fetching tools, the race engineer
 * at the laptop, two engineers at the data desk, fans at the rope on the pit-lane walk.
 *
 * Built in the car's frame (x = the car's left, z = forward toward the lane); `side`
 * says which way the garage's open middle is (cameras stand there). Static props are
 * merged per material (a handful of draw calls); screens are drawn once at high
 * resolution and animated with texture offsets and mesh transforms, never re-uploaded
 * per frame. The car wears a garage reflection map while the menu shows.
 */

const FONT = '"Titillium Web", Arial, sans-serif';

interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

export type PartId = 'frontWing' | 'rearWing' | 'brakes' | 'suspension' | 'powerUnit' | 'tyres' | 'floor';

type Pose = (p: Person, t: number, dt: number) => void;

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** one reflection map per team colour, shared by every garage built for it */
let envCache: { key: string; rt: THREE.WebGLRenderTarget } | null = null;

export class GarageScene {
  readonly group = new THREE.Group();
  readonly side: number;
  /** world anchors for the setup hotspots */
  readonly parts: Record<PartId, THREE.Vector3> = {} as Record<PartId, THREE.Vector3>;
  /** the video wall's centre (world) — the Highlights tab frames it */
  readonly wallCenter = new THREE.Vector3();

  private readonly people: { p: Person; pose?: Pose }[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly aniso: number;
  private readonly accent: string;
  private t = 0;
  private active = false;

  // ---- screens
  private readonly tele: Screen;
  private readonly stats: Screen;
  private readonly laptop: Screen;
  private readonly laptopTex: THREE.CanvasTexture;

  // ---- the video wall
  private readonly video: HTMLVideoElement;
  private readonly videoTex: THREE.VideoTexture;
  private readonly wallMat: THREE.MeshBasicMaterial;
  private readonly blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private readonly attract: Screen;
  private readonly sheen: THREE.Mesh;
  private readonly overlay = new THREE.Group();
  private readonly lower: { mesh: THREE.Mesh; s: Screen; w: number };
  private readonly pips: Screen;
  private readonly progress: THREE.Mesh;
  private clip = 0;
  private playingId: string | null = null;
  private clipAge = 0;
  private bright = 0;
  private wantNext = false;
  private readonly wallPx: (x: number, y: number) => THREE.Vector3;

  // ---- the car's reflections while in the garage
  private readonly envSwap: { m: THREE.MeshStandardMaterial; env: THREE.Texture | null; k: number }[] = [];
  private readonly garageEnv: THREE.Texture | null = null;

  // ---- people who move around
  private walker: { p: Person; path: THREE.Vector3[]; leg: number; u: number; wait: number; walking: boolean } | null = null;

  constructor(
    kit: PeopleKit | null,
    private readonly rig: CarRig,
    bay: { pos: THREE.Vector3; yaw: number; inward: THREE.Vector3 },
    private readonly team: Team,
    private readonly driver: Driver,
    private readonly highlights: Highlights,
    private readonly career: Career,
    private readonly track: Track,
    opts: { renderer?: THREE.WebGLRenderer; shadowLayer?: number; reflectLayer?: number } = {},
  ) {
    this.group.name = 'garage-scene';
    const g = this.group;
    g.position.copy(bay.pos);
    g.rotation.y = bay.yaw;
    g.updateMatrixWorld(true);
    this.aniso = opts.renderer ? opts.renderer.capabilities.getMaxAnisotropy() : 8;
    const fwd = new THREE.Vector3(Math.sin(bay.yaw), 0, Math.cos(bay.yaw));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const S = left.dot(bay.inward) > 0 ? 1 : -1;
    this.side = S;
    this.accent = uiColor(team);

    // ------------------------------------------------------------ materials
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const mat = (key: string, color: THREE.ColorRepresentation, rough = 0.5, metal = 0.2, extra: THREE.MeshStandardMaterialParameters = {}) => {
      let m = mats.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
        mats.set(key, m);
        this.owned.push(m);
      }
      return m;
    };
    const prim = new THREE.Color(team.primary);
    const darkTeam = prim.r + prim.g + prim.b < 0.25;
    const teamCol = darkTeam ? new THREE.Color(team.secondary) : prim;
    const steel = mat('steel', 0xa3a9b0, 0.32, 0.9);
    const chrome = mat('chrome', 0xd8dde2, 0.14, 1);
    const black = mat('black', 0x131417, 0.55, 0.25);
    const satin = mat('satin', 0x1c1e22, 0.38, 0.5);
    const rubber = mat('rubber', 0x0b0b0c, 0.88, 0);
    const teamPaint = mat('team', teamCol, 0.3, 0.45, { envMapIntensity: 1 });
    const teamMatte = mat('teamMatte', teamCol.clone().multiplyScalar(0.85), 0.62, 0.1);
    const hose = mat('hose', 0x1d1f23, 0.7, 0);
    const alu = mat('alu', 0x6f757d, 0.42, 0.85);

    // ------------------------------------------------------------ building helpers (baked + merged at the end)
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, parent: THREE.Object3D = g, bake = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.bake = bake;
      parent.add(mesh);
      this.owned.push(geo);
      return mesh;
    };
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g, ry = 0, rx = 0, rz = 0) =>
      add(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry, rx, rz, parent);
    const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g, ry = 0) =>
      add(new RoundedBoxGeometry(w, h, d, 2, r), m, x, y, z, ry, 0, 0, parent);
    const cyl = (r0: number, r1: number, h: number, seg: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g, ry = 0, rx = 0, rz = 0) =>
      add(new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z, ry, rx, rz, parent);
    const tube = (pts: THREE.Vector3[], r: number, m: THREE.Material, parent: THREE.Object3D = g, seg = 48) =>
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 8, false), m, 0, 0, 0, 0, 0, 0, parent);
    const node = (x: number, y: number, z: number, ry = 0, parent: THREE.Object3D = g) => {
      const n = new THREE.Group();
      n.position.set(x, y, z);
      n.rotation.y = ry;
      parent.add(n);
      return n;
    };
    const caster = (x: number, z: number, parent: THREE.Object3D, r = 0.04) => {
      cyl(r, r, 0.035, 12, rubber, x, r, z, parent, 0, 0, Math.PI / 2);
      box(0.05, 0.05, 0.05, steel, x, r * 2 + 0.02, z, parent);
    };

    // ------------------------------------------------------------ where the car is (car frame)
    rig.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const local = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const A = rig.anchors;
    const wFL = local(A.wheelFL), wFR = local(A.wheelFR), wRL = local(A.wheelRL), wRR = local(A.wheelRR);
    const R = rig.dims.wheelRadius;
    const noseZ = local(A.nose).z, tailZ = local(A.rearWing).z;
    const midZ = (wFL.z + wRL.z) / 2;

    // ------------------------------------------------------------ tyre blankets: branded, wrapping tread and sidewalls
    {
      // charcoal quilted cover: accent piping at both shoulders, a small wordmark on the tread
      const band = this.canvasTex(2048, 256, (c, w, h) => {
        c.fillStyle = '#17181b';
        c.fillRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,0.035)';
        for (let x = 0; x < w; x += 32) c.fillRect(x, 0, 2, h);
        c.fillStyle = this.accent;
        for (const y of [0.3, 0.68]) c.fillRect(0, h * y, w, h * 0.022);
        c.fillStyle = 'rgba(255,255,255,0.85)';
        c.font = `italic 700 26px ${FONT}`;
        c.textBaseline = 'middle';
        for (let k = 0; k < 6; k++) c.fillText(team.name.toUpperCase(), k * (w / 6) + 60, h * 0.5, w / 6 - 120);
      });
      band.wrapS = THREE.RepeatWrapping;
      const blanketM = new THREE.MeshStandardMaterial({ map: band, roughness: 0.92, metalness: 0 });
      blanketM.userData.reflect = true;
      this.owned.push(blanketM);
      for (const w of [wFL, wFR, wRL, wRR]) {
        const out = Math.sign(w.x);
        const hw = w === wFL || w === wFR ? 0.19 : 0.21;
        const pts: THREE.Vector2[] = [];
        // profile (radius, axial): inner sidewall → shoulder → tread → shoulder → outer sidewall
        const rIn = R * 0.8, rOut = R + 0.03;
        const prof: [number, number][] = [
          [rIn, -hw - 0.02],
          [rOut - 0.05, -hw - 0.025],
          [rOut - 0.01, -hw + 0.01],
          [rOut, -hw + 0.05],
          [rOut + 0.004, 0],
          [rOut, hw - 0.05],
          [rOut - 0.01, hw - 0.01],
          [rOut - 0.05, hw + 0.025],
          [rIn + 0.02, hw + 0.03],
        ];
        for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
        const geo = new THREE.LatheGeometry(pts, 48);
        geo.rotateZ(Math.PI / 2);
        add(geo, blanketM, w.x + out * 0.005, w.y, w.z);
        // controller box and its lead to the floor
        rbox(0.09, 0.045, 0.14, 0.01, black, w.x + out * 0.06, w.y + R + 0.05, w.z - 0.02);
        tube([new THREE.Vector3(w.x + out * 0.06, w.y + R + 0.05, w.z - 0.09), new THREE.Vector3(w.x + out * 0.1, w.y + R * 0.6, w.z - R - 0.12), new THREE.Vector3(w.x + out * 0.14, 0.2, w.z - R - 0.25), new THREE.Vector3(w.x + out * 0.2, 0.07, w.z - R - 0.6)], 0.008, hose, g, 20);
      }
    }

    // ------------------------------------------------------------ jacks, front and rear
    const jack = (z: number, dir: 1 | -1, lift: number) => {
      const j = node(0, 0, z, dir > 0 ? 0 : Math.PI);
      // chassis rail and wheels
      rbox(0.36, 0.08, 1.0, 0.02, satin, 0, 0.11, 0.42, j);
      for (const x of [-0.14, 0.14]) caster(x, 0.82, j, 0.05);
      box(0.3, 0.03, 0.12, rubber, 0, 0.03, 0.02, j);
      // lifting arm and saddle (team colour)
      box(0.08, lift - 0.12, 0.08, steel, 0, (lift - 0.12) / 2 + 0.12, 0.04, j, 0, -0.18);
      rbox(0.5, 0.05, 0.14, 0.015, teamPaint, 0, lift, 0, j);
      for (const x of [-0.23, 0.23]) box(0.04, 0.09, 0.14, teamPaint, x, lift + 0.05, 0, j);
      box(0.44, 0.012, 0.12, rubber, 0, lift + 0.03, 0, j);
      // long handle with a T-grip, resting at an angle
      const h = node(0, 0.14, 0.9, 0, j);
      // leaning up and away from the car
      h.rotation.x = 1.15;
      cyl(0.022, 0.022, 1.25, 12, teamPaint, 0, 0.62, 0, h);
      cyl(0.026, 0.026, 0.12, 12, rubber, 0, 1.2, 0, h);
      cyl(0.02, 0.02, 0.36, 10, satin, 0, 1.25, 0, h, 0, 0, Math.PI / 2);
      for (const x of [-0.18, 0.18]) cyl(0.024, 0.024, 0.08, 10, rubber, x, 1.25, 0, h, 0, 0, Math.PI / 2);
    };
    jack(noseZ - 0.15, 1, 0.18);
    jack(tailZ - 0.3, -1, 0.34);

    // ------------------------------------------------------------ the cooling blower in the working-side sidepod
    {
      const B = node(-S * 1.95, 0, midZ + 0.55, S > 0 ? Math.PI / 2 : -Math.PI / 2);
      rbox(0.46, 0.38, 0.56, 0.04, teamMatte, 0, 0.33, 0, B);
      box(0.48, 0.03, 0.58, black, 0, 0.53, 0, B);
      for (const x of [-0.2, 0.2]) for (const z of [-0.24, 0.24]) caster(x, z, B);
      // fan grille and hose to the sidepod inlet
      add(new THREE.RingGeometry(0.06, 0.16, 32), black, 0, 0.36, -0.312, Math.PI, 0, 0, B);
      add(new THREE.CircleGeometry(0.06, 24), satin, 0, 0.36, -0.313, Math.PI, 0, 0, B);
      for (let k = 0; k < 6; k++) box(0.003, 0.3, 0.004, steel, 0, 0.36, -0.316, B, 0, 0, (k * Math.PI) / 6);
      tube(
        [new THREE.Vector3(0, 0.33, 0.26), new THREE.Vector3(0, 0.3, 0.52), new THREE.Vector3(0, 0.42, 0.8), new THREE.Vector3(0, 0.55, 1.08)],
        0.05,
        mat('duct', 0x2a2c31, 0.8, 0),
        B,
      );
    }

    // ------------------------------------------------------------ tool chests on the working side
    const chest = (x: number, z: number, ry: number, w: number, h: number, drawers: number) => {
      const T = node(x, 0, z, ry);
      rbox(w, h, 0.56, 0.02, teamPaint, 0, 0.1 + h / 2, 0, T);
      rbox(w + 0.03, 0.035, 0.6, 0.012, rubber, 0, 0.1 + h + 0.018, 0, T);
      const dh = (h - 0.06) / drawers;
      for (let d = 0; d < drawers; d++) {
        const y = 0.13 + d * dh + dh / 2;
        box(w - 0.07, dh - 0.018, 0.012, satin, 0, y, 0.283, T);
        cyl(0.008, 0.008, w * 0.55, 8, chrome, 0, y + dh * 0.28, 0.3, T, 0, 0, Math.PI / 2);
      }
      for (const cx of [-w / 2 + 0.07, w / 2 - 0.07]) for (const cz of [-0.2, 0.2]) caster(cx, cz, T);
      return T;
    };
    {
      const c1 = chest(-S * 2.62, midZ + 0.1, S > 0 ? Math.PI / 2 : -Math.PI / 2, 1.3, 0.92, 7);
      // on top: a tablet, spanners, a torque wrench
      box(0.26, 0.012, 0.18, black, -0.3, 1.06, 0.05, c1, 0.2);
      for (let k = 0; k < 5; k++) box(0.018, 0.012, 0.16 + k * 0.03, steel, 0.02 + k * 0.06, 1.052, -0.04, c1, 0.12 * (k % 2 ? 1 : -1));
      cyl(0.012, 0.012, 0.62, 8, chrome, 0.36, 1.06, 0.08, c1, 0.25, 0, Math.PI / 2);
      chest(-S * 2.62, midZ - 1.45, S > 0 ? Math.PI / 2 : -Math.PI / 2, 0.8, 0.72, 5);
      // small trolley at the rear, top tray with parts
      const T = node(-S * 2.35, 0, tailZ - 1.25, S > 0 ? Math.PI / 2 + 0.3 : -Math.PI / 2 - 0.3);
      for (const y of [0.25, 0.85]) rbox(0.72, 0.04, 0.46, 0.012, satin, 0, y, 0, T);
      for (const x of [-0.33, 0.33]) for (const z of [-0.2, 0.2]) cyl(0.012, 0.012, 0.86, 8, steel, x, 0.47, z, T);
      for (const x of [-0.33, 0.33]) for (const z of [-0.2, 0.2]) caster(x, z, T, 0.035);
      box(0.3, 0.1, 0.2, teamMatte, -0.12, 0.92, 0, T);
      box(0.22, 0.05, 0.3, black, 0.18, 0.9, 0.02, T, 0.4);
    }

    // ------------------------------------------------------------ wheel-gun rack by the door
    {
      const Rk = node(-S * 2.8, 0, 4.55, S > 0 ? Math.PI / 2 : -Math.PI / 2);
      box(0.9, 0.05, 0.4, satin, 0, 0.03, 0, Rk);
      for (const x of [-0.4, 0.4]) box(0.05, 1.25, 0.05, steel, x, 0.65, -0.12, Rk);
      box(0.9, 0.06, 0.08, teamPaint, 0, 1.28, -0.12, Rk);
      for (let k = 0; k < 4; k++) {
        const x = -0.3 + k * 0.2;
        const G = node(x, 0.98, 0.02, 0, Rk);
        G.rotation.x = -0.35;
        cyl(0.05, 0.056, 0.26, 16, mat('gun', 0x2b2e33, 0.35, 0.7), 0, 0, 0, G);
        cyl(0.04, 0.04, 0.07, 12, chrome, 0, -0.16, 0, G);
        box(0.035, 0.14, 0.05, teamPaint, 0, 0.02, 0.07, G, 0, 0.6);
        // hose, looping down to the floor and away
        tube([new THREE.Vector3(x, 1.1, 0.02), new THREE.Vector3(x + 0.02, 1.25, 0.12), new THREE.Vector3(x + 0.05, 0.9, 0.3), new THREE.Vector3(x, 0.2, 0.32), new THREE.Vector3(x - 0.1, 0.03, 0.6)], 0.012, hose, Rk, 24);
      }
    }

    // ------------------------------------------------------------ LED light box over the car (the car's long top highlight)
    {
      // (it is the key light's housing: it casts no shadow)
      const L = node(0, 3.62, midZ, 0);
      box(1.3, 0.07, 3.6, black, 0, 0.04, 0, L).castShadow = false;
      const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.3) });
      this.owned.push(lm);
      add(new THREE.PlaneGeometry(1.18, 3.48), lm, 0, 0.002, 0, 0, Math.PI / 2, 0, L).castShadow = false;
      for (const z of [-1.5, 1.5]) cyl(0.006, 0.006, 0.36, 4, steel, 0, 0.24, z, L).castShadow = false;
    }

    // ------------------------------------------------------------ team logo on the floor in front of the car, and a contact shadow under it
    {
      const logo = this.canvasTex(1024, 256, (c, w, h) => {
        c.clearRect(0, 0, w, h);
        c.fillStyle = 'rgba(255,255,255,0.9)';
        c.font = `italic 700 150px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(team.short?.toUpperCase?.() ?? team.name.toUpperCase(), w / 2, h / 2 + 8, w - 60);
      });
      const lm = new THREE.MeshStandardMaterial({ map: logo, transparent: true, opacity: 0.32, roughness: 0.3, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.owned.push(lm);
      const m = add(new THREE.PlaneGeometry(2.2, 0.55), lm, 0, 0.006, noseZ + 1.25, 0, -Math.PI / 2, 0, g, false);
      m.castShadow = false;
      const sh = this.canvasTex(256, 512, (c, w, h) => {
        const gr = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, 'rgba(0,0,0,0.85)');
        gr.addColorStop(0.55, 'rgba(0,0,0,0.5)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.setTransform(1, 0, 0, h / w, 0, 0);
        c.fillStyle = gr;
        c.fillRect(0, 0, w, w);
      }, false);
      const sm = new THREE.MeshBasicMaterial({ map: sh, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      this.owned.push(sm);
      const s = add(new THREE.PlaneGeometry(2.3, (noseZ - tailZ) + 0.9), sm, 0, 0.004, (noseZ + tailZ) / 2, 0, -Math.PI / 2, 0, g, false);
      s.castShadow = false;
      s.receiveShadow = false;
    }

    // ------------------------------------------------------------ the engineers' laptop cart
    this.laptop = this.screen(2048, 640);
    this.laptopTex = this.laptop.tex;
    this.laptopTex.wrapS = THREE.RepeatWrapping;
    this.laptopTex.repeat.set(0.5, 1);
    const lp = new THREE.Vector3(-S * 2.05, 0, wFL.z + 1.05);
    {
      const T = node(lp.x, 0, lp.z, -S * 1.2);
      cyl(0.03, 0.03, 0.95, 10, steel, 0, 0.5, 0, T);
      cyl(0.26, 0.3, 0.04, 20, satin, 0, 0.02, 0, T);
      for (let k = 0; k < 4; k++) caster(Math.cos(k * 1.57) * 0.24, Math.sin(k * 1.57) * 0.24, T, 0.03);
      rbox(0.62, 0.03, 0.45, 0.01, black, 0, 0.98, 0, T);
      rbox(0.42, 0.02, 0.3, 0.008, alu, 0, 1.005, 0.03, T);
      const lid = node(0, 1.01, -0.12, 0, T);
      lid.rotation.x = -0.25;
      rbox(0.42, 0.28, 0.012, 0.006, alu, 0, 0.14, 0, lid);
      const sm = new THREE.MeshBasicMaterial({ map: this.laptopTex, color: new THREE.Color(1.1, 1.1, 1.1) });
      this.owned.push(sm);
      add(new THREE.PlaneGeometry(0.39, 0.25), sm, 0, 0.14, 0.007, 0, 0, 0, lid, false).castShadow = false;
    }

    // ------------------------------------------------------------ video wall behind the car (LED wall on a truss)
    const WW = 4.8, WH = (WW * 9) / 16;
    const wallY = 1.05 + WH / 2;
    this.attract = this.screen(1920, 1080);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.crossOrigin = 'anonymous';
    this.video.addEventListener('ended', () => (this.wantNext = true));
    this.video.addEventListener('error', () => (this.wantNext = true));
    this.videoTex = new THREE.VideoTexture(this.video);
    this.videoTex.colorSpace = THREE.SRGBColorSpace;
    this.videoTex.minFilter = THREE.LinearFilter;
    this.videoTex.magFilter = THREE.LinearFilter;
    this.videoTex.generateMipmaps = false;
    this.videoTex.anisotropy = this.aniso;
    this.owned.push(this.videoTex, this.blackTex);
    this.blackTex.needsUpdate = true;
    this.wallMat = new THREE.MeshBasicMaterial({ map: this.attract.tex });
    // the clips were tone-mapped once when they were filmed and are tone-mapped again as
    // part of this scene: give back the contrast and colour the second pass takes out
    this.wallMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.3)) * 1.3;
        float wl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = max(mix(vec3(wl), diffuseColor.rgb, 1.18), vec3(0.0));`,
      );
    };
    this.owned.push(this.wallMat);
    {
      const T = node(-S * 1.25, 0, tailZ - 3.5, S * 0.3);
      // truss legs, feet and header
      for (const x of [-WW / 2 - 0.16, WW / 2 + 0.16]) {
        for (const dz of [-0.13, 0.03]) for (const dx of [-0.07, 0.07]) cyl(0.018, 0.018, wallY + WH / 2 + 0.35, 6, alu, x + dx, (wallY + WH / 2 + 0.35) / 2, dz, T);
        for (let y = 0.3; y < wallY + WH / 2; y += 0.4) box(0.14, 0.012, 0.16, alu, x, y, -0.05, T);
        rbox(0.6, 0.05, 0.7, 0.01, satin, x, 0.025, -0.05, T);
      }
      rbox(WW + 0.12, WH + 0.12, 0.1, 0.02, black, 0, wallY, -0.07, T);
      add(new THREE.PlaneGeometry(WW, WH), this.wallMat, 0, wallY, -0.015, 0, 0, 0, T, false).castShadow = false;
      // header light box with the team name
      const hdr = this.canvasTex(2048, 128, (c, w, h) => {
        c.fillStyle = '#0b0c0f';
        c.fillRect(0, 0, w, h);
        c.fillStyle = this.accent;
        c.fillRect(0, h - 10, w, 10);
        c.fillStyle = '#ffffff';
        c.font = `italic 700 72px ${FONT}`;
        c.textBaseline = 'middle';
        c.textAlign = 'center';
        c.fillText(team.name.toUpperCase(), w / 2, h / 2 - 4, w - 200);
      });
      const hm = new THREE.MeshBasicMaterial({ map: hdr });
      this.owned.push(hm);
      rbox(WW + 0.12, 0.34, 0.12, 0.02, black, 0, wallY + WH / 2 + 0.26, -0.07, T);
      add(new THREE.PlaneGeometry(WW, 0.3), hm, 0, wallY + WH / 2 + 0.26, -0.005, 0, 0, 0, T, false).castShadow = false;
      // the wall's overlay (lower third, bug, progress) sits a hair in front of the picture
      this.overlay.position.set(0, wallY, 0);
      T.add(this.overlay);
      this.wallPx = (x: number, y: number) => new THREE.Vector3((x / 1920 - 0.5) * WW, (0.5 - y / 1080) * WH, 0);
      // a slow sheen across the attract loop
      const sh = this.canvasTex(512, 64, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, w, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0.10)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr;
        c.fillRect(0, 0, w, h);
      }, false);
      const shm = new THREE.MeshBasicMaterial({ map: sh, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      this.owned.push(shm);
      this.sheen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, WH), shm);
      this.owned.push(this.sheen.geometry);
      this.sheen.rotation.z = -0.35;
      this.sheen.position.set(0, wallY, -0.008);
      T.add(this.sheen);
      T.updateMatrixWorld(true);
      this.wallCenter.set(0, wallY, 0).applyMatrix4(T.matrixWorld);
    }
    // overlay pieces
    const ovMat = (tex: THREE.Texture | null, color: THREE.ColorRepresentation = 0xffffff, opacity = 1) => {
      const m = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
      if (tex) m.color.multiplyScalar(1.22);
      this.owned.push(m);
      return m;
    };
    const ovPlane = (m: THREE.Material, x: number, y: number, w: number, h: number, z = 0.004, anchorLeft = false) => {
      const geo = new THREE.PlaneGeometry((w / 1920) * WW, (h / 1080) * WH);
      if (anchorLeft) geo.translate(((w / 1920) * WW) / 2, 0, 0);
      this.owned.push(geo);
      const mesh = new THREE.Mesh(geo, m);
      const p = this.wallPx(anchorLeft ? x : x + w / 2, y + h / 2);
      mesh.position.set(p.x, p.y, z);
      mesh.renderOrder = 2;
      this.overlay.add(mesh);
      return mesh;
    };
    {
      const bug = this.canvasTex(512, 96, (c, w, h) => {
        c.fillStyle = 'rgba(8,9,12,0.78)';
        this.round(c, 0, 0, w, h, 14);
        c.fill();
        c.fillStyle = '#ff2b3f';
        c.beginPath();
        c.arc(44, h / 2, 11, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffffff';
        c.font = `700 40px ${FONT}`;
        c.textBaseline = 'middle';
        c.fillText('HIGHLIGHTS', 74, h / 2 + 2);
      });
      ovPlane(ovMat(bug), 64, 56, 352, 66);
      this.pips = this.screen(512, 32);
      ovPlane(ovMat(this.pips.tex), 1920 - 64 - 400, 70, 400, 25);
      const ls = this.screen(1600, 240);
      const lw = 1200;
      const lm = ovMat(ls.tex);
      ls.tex.wrapS = THREE.ClampToEdgeWrapping;
      this.lower = { mesh: ovPlane(lm, 64, 1080 - 72 - 180, lw, 180, 0.004, true), s: ls, w: lw };
      ovPlane(ovMat(null, 0xffffff, 0.18), 64, 1080 - 44, 1792, 6, 0.003, true);
      this.progress = ovPlane(ovMat(null, new THREE.Color(this.accent)), 64, 1080 - 44, 1792, 6, 0.005, true);
    }

    // ------------------------------------------------------------ telemetry + career screens on rolling towers
    this.tele = this.screen(1536, 864);
    this.stats = this.screen(1536, 864);
    const tower = (x: number, z: number, ry: number, s: Screen) => {
      const T = node(x, 0, z, ry);
      T.userData.keep = true;
      rbox(0.74, 0.05, 0.56, 0.015, satin, 0, 0.09, 0, T);
      for (const cx of [-0.31, 0.31]) for (const cz of [-0.22, 0.22]) caster(cx, cz, T, 0.035);
      rbox(0.1, 1.5, 0.1, 0.02, alu, 0, 0.85, -0.04, T);
      rbox(1.4, 0.84, 0.07, 0.025, black, 0, 1.62, -0.02, T);
      box(1.4, 0.03, 0.072, teamPaint, 0, 1.62 - 0.435, -0.02, T);
      const sm = new THREE.MeshBasicMaterial({ map: s.tex, color: new THREE.Color(1.05, 1.05, 1.05) });
      this.owned.push(sm);
      add(new THREE.PlaneGeometry(1.32, 0.7425), sm, 0, 1.63, 0.017, 0, 0, 0, T, false).castShadow = false;
      return T;
    };
    tower(S * 2.9, tailZ - 3.4, S * 0.35, this.tele);
    // the career tower beside it, at the back of the open side (clear of every tab's camera and of the camera's moves)
    tower(S * 4.45, tailZ - 2.85, S * 0.62, this.stats);

    // ------------------------------------------------------------ fans' rope on the pit-lane walk
    {
      for (const x of [-S * 2.6, -S * 0.3, S * 2.0]) {
        cyl(0.03, 0.03, 0.95, 10, chrome, x, 0.48, 7.2, g);
        cyl(0.16, 0.18, 0.04, 16, chrome, x, 0.02, 7.2, g);
      }
      const rope = mat('rope', teamCol.clone().multiplyScalar(0.6), 0.8, 0);
      for (const [a, b] of [[-S * 2.6, -S * 0.3], [-S * 0.3, S * 2.0]]) tube([new THREE.Vector3(a, 0.9, 7.2), new THREE.Vector3((a + b) / 2, 0.72, 7.2), new THREE.Vector3(b, 0.9, 7.2)], 0.018, rope, g, 16);
    }

    // ------------------------------------------------------------ hotspot anchors (world)
    const W2 = (v: THREE.Vector3) => v.clone().applyMatrix4(g.matrixWorld);
    this.parts.frontWing = W2(new THREE.Vector3(0, 0.25, noseZ - 0.15));
    this.parts.rearWing = W2(new THREE.Vector3(0, 0.95, tailZ + 0.05));
    this.parts.brakes = W2(wFL.clone().add(new THREE.Vector3(Math.sign(wFL.x) * 0.24, 0.05, 0)));
    this.parts.suspension = W2(new THREE.Vector3(wFR.x * 0.55, 0.45, wFR.z - 0.05));
    this.parts.powerUnit = W2(new THREE.Vector3(0, 0.75, midZ - 0.6));
    this.parts.tyres = W2(wRL.clone().add(new THREE.Vector3(Math.sign(wRL.x) * 0.25, 0.2, 0)));
    this.parts.floor = W2(new THREE.Vector3(S * 0.7, 0.08, midZ));

    // ------------------------------------------------------------ people
    if (kit) this.buildPeople(kit, { S, wFL, wFR, wRL, wRR, tailZ, noseZ, midZ, lp, teamCol });

    // ------------------------------------------------------------ bake the static props into one mesh per material
    this.bake();
    if (opts.reflectLayer !== undefined)
      for (const ch of g.children) {
        const m = (ch as THREE.Mesh).material as THREE.Material | undefined;
        if (m?.userData.reflect) ch.layers.enable(opts.reflectLayer);
      }
    // what casts into the key light's shadow map: the props and the people under it
    if (opts.shadowLayer !== undefined) {
      for (const ch of g.children) {
        const person = this.people.some((x) => x.p.root === ch);
        if (person && Math.hypot(ch.position.x, ch.position.z - midZ) > 4) continue;
        ch.traverse((o) => o.layers.enable(opts.shadowLayer!));
      }
    }

    // ------------------------------------------------------------ the car mirrored in the epoxy
    if (opts.renderer && opts.reflectLayer !== undefined) this.buildMirror(opts.reflectLayer, S, midZ, noseZ, tailZ);

    // ------------------------------------------------------------ the car's reflections: a garage, not the sky
    if (opts.renderer) {
      this.garageEnv = this.buildEnv(opts.renderer, bay.yaw, teamCol);
      rig.root.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
        if (!m) return;
        for (const x of Array.isArray(m) ? m : [m]) {
          if (!(x as THREE.MeshStandardMaterial).isMeshStandardMaterial || this.envSwap.some((e) => e.m === x)) continue;
          this.envSwap.push({ m: x, env: x.envMap, k: x.envMapIntensity });
          // the livery's decals and the paint get crisp at grazing angles
          for (const t of [x.map, x.normalMap, x.roughnessMap] as (THREE.Texture | null)[]) {
            if (t && t.anisotropy < this.aniso) {
              t.anisotropy = this.aniso;
              t.needsUpdate = true;
            }
          }
        }
      });
    }

    this.offList = this.highlights.onChange(() => this.onList());
    document.fonts?.ready.then(() => {
      if (!this.disposed) {
        this.drawStatic();
        this.onList(true);
      }
    });
    this.drawStatic();
    this.onList(true);
    this.setActive(true);
  }

  private disposed = false;
  private offList: (() => void) | null = null;

  // ================================================================== people

  private buildPeople(
    kit: PeopleKit,
    c: { S: number; wFL: THREE.Vector3; wFR: THREE.Vector3; wRL: THREE.Vector3; wRR: THREE.Vector3; tailZ: number; noseZ: number; midZ: number; lp: THREE.Vector3; teamCol: THREE.Color },
  ) {
    const g = this.group;
    const { S, wFR, wRL, tailZ, midZ, lp, teamCol } = c;
    const team = this.team;
    const prim = new THREE.Color(team.primary);
    const dark = prim.r + prim.g + prim.b < 0.25;
    const place = (p: Person, x: number, z: number, faceX: number, faceZ: number) => {
      p.root.position.set(x, 0, z);
      p.root.rotation.y = Math.atan2(faceX - x, faceZ - z);
      g.add(p.root);
    };
    // you: behind the car on the working side, talking to your engineer
    const me = new Person(kit, driverLook(team, this.driver, { cap: true }));
    place(me, S * 1.55, tailZ - 1.05, S * 3.8, c.wFL.z + 4);
    me.play('Idle_Talking_Loop');
    this.people.push({
      p: me,
      pose: (p, t) => {
        naturalStance(p, 0.8);
        turnHead(p, Math.sin(t * 0.3) * 0.25 + 0.2, -0.05);
      },
    });
    const crewLook = (female: boolean, tone: number, hair: Look['hair'], beard = false): Look => ({
      female,
      tone,
      hair,
      hairColor: [0x1c140f, 0x3a2a1c, 0x6b4a2c][Math.floor(tone * 2.9)],
      beard,
      top: 'jacket',
      topColor: teamCol,
      top2: team.secondary,
      accent: team.accent,
      bottom: 'trousers',
      bottomColor: dark ? 0x1a1b1e : new THREE.Color(team.secondary).multiplyScalar(0.35),
      shoeColor: 0x141416,
      gloves: 0x202226,
      headset: true,
      cap: null,
    });
    // mechanics kneeling at the far front wheel and the near rear wheel
    const m1 = new Person(kit, crewLook(false, 0.2, 'buzzed', true));
    place(m1, wFR.x + Math.sign(wFR.x) * 0.95, wFR.z + 0.15, wFR.x, wFR.z);
    m1.play('Fixing_Kneeling', { offset: 0.2 });
    this.people.push({ p: m1 });
    const m2 = new Person(kit, crewLook(true, 0.65, 'buns'));
    place(m2, wRL.x + Math.sign(wRL.x) * 0.95, wRL.z - 0.2, wRL.x, wRL.z);
    m2.play('Fixing_Kneeling', { offset: 0.6 });
    this.people.push({ p: m2 });
    // the race engineer at the laptop
    const eng = new Person(kit, { ...crewLook(false, 0.45, 'simpleparted'), top: 'polo', gloves: null });
    place(eng, lp.x + S * 0.55, lp.z + 0.2, lp.x, lp.z);
    eng.play('Idle_Loop', { offset: 0.4 });
    this.people.push({
      p: eng,
      pose: (p, t) => {
        naturalStance(p, 0.85);
        // hands on the keyboard, a glance up at the car now and then
        aimArm(p, 'l', [0.18, -0.55, 0.8], [-0.2, -0.25, 0.95], 0.9);
        aimArm(p, 'r', [0.18, -0.55, 0.8], [-0.2, -0.25, 0.95], 0.9);
        turnHead(p, Math.sin(t * 0.21) > 0.7 ? -S * 0.6 : 0, 0.35);
      },
    });
    // a mechanic fetching tools: the chest ↔ the trolley at the rear, along the working side
    {
      const w = new Person(kit, crewLook(false, 0.8, 'buzzed'));
      const path = [new THREE.Vector3(-S * 2.02, 0, midZ + 0.1), new THREE.Vector3(-S * 2.15, 0, midZ - 1.0), new THREE.Vector3(-S * 1.95, 0, tailZ - 1.2)];
      place(w, path[0].x, path[0].z, -S * 3, path[0].z);
      w.play('Interact', { offset: 0.3 });
      this.walker = { p: w, path, leg: 0, u: 0, wait: 2.5, walking: false };
      this.people.push({ p: w });
    }
    // two engineers at the data desk at the back, headsets on, reading traces
    for (const [k, x] of [[0, S * 2.7], [1, S * 3.9]] as const) {
      const e = new Person(kit, { ...crewLook(k === 1, k ? 0.3 : 0.55, k ? 'long' : 'simpleparted'), top: 'polo', gloves: null });
      place(e, x, -8.25, x, -9.5);
      e.play(k ? 'Idle_Talking_Loop' : 'Idle_Loop', { offset: k * 0.5 });
      this.people.push({
        p: e,
        pose: (p, t) => {
          naturalStance(p, 0.85);
          lean(p, 0.18);
          aimArm(p, 'l', [0.2, -0.6, 0.75], [-0.15, -0.35, 0.92], 0.85);
          aimArm(p, 'r', [0.2, -0.6, 0.75], [-0.15, -0.35, 0.92], 0.85);
          turnHead(p, Math.sin(t * 0.27 + k * 2) > 0.8 ? (k ? -0.7 : 0.7) : 0, 0.25);
        },
      });
    }
    // fans at the rope, phones up
    {
      let seed = team.name.length * 97 + 13;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (const [k, x] of [[0, -S * 2.0], [1, -S * 1.2], [2, S * 1.1]] as const) {
        const f = new Person(kit, fanLook(rand, team));
        place(f, x, 7.65, x * 0.3, 0);
        f.play('Idle_Loop', { offset: k * 0.37 });
        const phone = k !== 1;
        this.people.push({
          p: f,
          pose: (p, t) => {
            naturalStance(p, 0.8);
            if (phone) {
              aimArm(p, 'r', [0.2, 0.1, 0.95], [0.05, 0.45, 0.9], 1);
              aimArm(p, 'l', [0.15, -0.9, 0.3], [0.1, -0.8, 0.6], 0.7);
              turnHead(p, 0, -0.1);
            } else turnHead(p, Math.sin(t * 0.4 + k) * 0.35, 0.05);
          },
        });
      }
    }
  }

  private updateWalker(dt: number) {
    const W = this.walker;
    if (!W) return;
    const p = W.p;
    if (!W.walking) {
      W.wait -= dt;
      if (W.wait > 0) return;
      W.walking = true;
      W.u = 0;
      p.play('Walk_Loop', { fade: 0.35 });
    }
    // walk the path forward on even legs, back on odd
    const pts = W.leg % 2 === 0 ? W.path : W.path.slice().reverse();
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    W.u += (dt * 1.05) / len;
    const u = Math.min(1, W.u);
    let d = u * len;
    let pos = pts[0], dir = new THREE.Vector3(0, 0, 1);
    for (let i = 1; i < pts.length; i++) {
      const seg = pts[i].distanceTo(pts[i - 1]);
      if (d <= seg || i === pts.length - 1) {
        dir = pts[i].clone().sub(pts[i - 1]).normalize();
        pos = pts[i - 1].clone().addScaledVector(dir, Math.min(d, seg));
        break;
      }
      d -= seg;
    }
    p.root.position.set(pos.x, 0, pos.z);
    const want = Math.atan2(dir.x, dir.z);
    let dy = want - p.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.root.rotation.y += dy * Math.min(1, dt * 8);
    if (u >= 1) {
      // arrived: turn to the work (the chest at the start, the trolley at the end) and work a while
      W.walking = false;
      W.leg++;
      W.wait = 3 + ((W.leg * 1.7) % 2.5);
      const atStart = W.leg % 2 === 0;
      const face = atStart ? new THREE.Vector3(-this.side * 3, 0, pos.z) : new THREE.Vector3(-this.side * 2.35, 0, pos.z - 1);
      p.root.rotation.y = Math.atan2(face.x - pos.x, face.z - pos.z);
      p.play(atStart ? 'Interact' : 'PickUp_Table', { fade: 0.35 });
    }
  }

  // ================================================================== baking

  /** merge every static prop mesh into one mesh per material (few draw calls) */
  private bake() {
    const g = this.group;
    g.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const groups = new Map<string, { mat: THREE.Material; cast: boolean; list: THREE.BufferGeometry[] }>();
    const kill: THREE.Mesh[] = [];
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.userData.bake || Array.isArray(m.material)) return;
      // only meshes whose ancestors are plain transform nodes (not people, not the overlay)
      for (let p = m.parent; p && p !== g; p = p.parent) if (p.userData.noBake || p === this.overlay) return;
      const geo = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()) as THREE.BufferGeometry;
      for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const key = { mat: m.material, cast: m.castShadow };
      let e = groups.get(`${m.material.uuid}:${m.castShadow}`);
      if (!e) groups.set(`${m.material.uuid}:${m.castShadow}`, (e = { ...key, list: [] }));
      e.list.push(geo);
      kill.push(m);
    });
    for (const m of kill) m.removeFromParent();
    // the transform nodes left empty
    const prune = (o: THREE.Object3D) => {
      for (const c of o.children.slice()) prune(c);
      if (o !== g && o.type === 'Group' && !o.children.length && !o.userData.keep) o.removeFromParent();
    };
    prune(g);
    for (const { mat, cast, list } of groups.values()) {
      const merged = mergeGeometries(list, false);
      for (const x of list) x.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      this.owned.push(merged);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.name = 'garage-props';
      g.add(mesh);
    }
  }

  // ================================================================== screens

  private screen(w: number, h: number): Screen {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.aniso;
    this.owned.push(tex);
    return { canvas, ctx, tex };
  }

  private canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
    const s = this.screen(w, h);
    draw(s.ctx, w, h);
    if (!srgb) s.tex.colorSpace = THREE.NoColorSpace;
    s.tex.needsUpdate = true;
    return s.tex;
  }

  private round(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.roundRect(x, y, w, h, r);
  }

  /** the screens that change slowly: telemetry, career, the laptop traces, the attract loop */
  private drawStatic() {
    const tr = this.track;
    const accent = this.accent;
    const header = (g: CanvasRenderingContext2D, title: string, sub: string) => {
      g.fillStyle = '#8b93a1';
      g.font = `700 30px ${FONT}`;
      g.textBaseline = 'alphabetic';
      g.fillText(title, 56, 76);
      g.fillStyle = '#5c6472';
      g.font = `600 26px ${FONT}`;
      g.textAlign = 'right';
      g.fillText(sub, 1536 - 56, 76);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(56, 100, 1536 - 112, 2);
    };
    // ---- telemetry: the circuit and its speed trace
    {
      const { ctx: g, canvas: c } = this.tele;
      const bg = g.createLinearGradient(0, 0, 0, c.height);
      bg.addColorStop(0, '#0e1117');
      bg.addColorStop(1, '#07080b');
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      header(g, `TELEMETRY · ${tr.def.short.toUpperCase()}`, 'LIVE');
      g.fillStyle = '#22d17a';
      g.beginPath();
      g.arc(1536 - 56 - 76, 67, 8, 0, Math.PI * 2);
      g.fill();
      // track map
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < tr.n; i += 4) {
        x0 = Math.min(x0, tr.px[i]);
        x1 = Math.max(x1, tr.px[i]);
        z0 = Math.min(z0, tr.pz[i]);
        z1 = Math.max(z1, tr.pz[i]);
      }
      const k = Math.min(560 / (x1 - x0), 620 / (z1 - z0));
      const ox = 56 + (560 - (x1 - x0) * k) / 2, oy = 150 + (620 - (z1 - z0) * k) / 2;
      const path = () => {
        g.beginPath();
        for (let i = 0; i < tr.n; i += 3) {
          const x = ox + (tr.px[i] - x0) * k, y = oy + (tr.pz[i] - z0) * k;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.closePath();
      };
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 22;
      path();
      g.stroke();
      g.strokeStyle = accent;
      g.lineWidth = 7;
      path();
      g.stroke();
      // start line
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ox + (tr.px[0] - x0) * k, oy + (tr.pz[0] - z0) * k, 11, 0, Math.PI * 2);
      g.fill();
      // speed trace (from curvature) with a grid
      const X0 = 700, Wd = 780, Y0 = 560, Ht = 380;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        g.beginPath();
        g.moveTo(X0, Y0 - (i / 4) * Ht);
        g.lineTo(X0 + Wd, Y0 - (i / 4) * Ht);
        g.stroke();
      }
      const trace = (fill: boolean) => {
        g.beginPath();
        for (let i = 0; i <= 480; i++) {
          const s = (i / 480) * tr.length;
          let kap = 0;
          for (let d = 0; d < 80; d += 10) kap = Math.max(kap, Math.abs(tr.kappa[Math.floor(tr.wrap(s + d)) % tr.n]));
          const v = Math.min(1, 1 / (1 + kap * 90));
          const x = X0 + (i / 480) * Wd, y = Y0 - v * Ht;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        if (fill) {
          g.lineTo(X0 + Wd, Y0);
          g.lineTo(X0, Y0);
          g.closePath();
        }
      };
      const fillG = g.createLinearGradient(0, Y0 - Ht, 0, Y0);
      fillG.addColorStop(0, 'rgba(34,209,122,0.28)');
      fillG.addColorStop(1, 'rgba(34,209,122,0)');
      g.fillStyle = fillG;
      trace(true);
      g.fill();
      g.strokeStyle = '#22d17a';
      g.lineWidth = 4;
      trace(false);
      g.stroke();
      g.fillStyle = '#8b93a1';
      g.font = `600 24px ${FONT}`;
      g.fillText('SPEED', X0, 160);
      // stat tiles
      const tile = (x: number, v: string, label: string) => {
        g.fillStyle = 'rgba(255,255,255,0.05)';
        this.round(g, x, 640, 240, 150, 16);
        g.fill();
        g.fillStyle = '#ffffff';
        g.font = `700 60px ${FONT}`;
        g.fillText(v, x + 24, 730);
        g.fillStyle = '#8b93a1';
        g.font = `600 24px ${FONT}`;
        g.fillText(label, x + 24, 768);
      };
      tile(700, (tr.length / 1000).toFixed(3), 'KM');
      tile(970, String(tr.def.corners?.length ?? '—'), 'TURNS');
      tile(1240, `${Math.round(Math.max(...Array.from({ length: 60 }, (_, i) => 1 / (1 + Math.abs(tr.kappa[Math.floor((i / 60) * tr.n)]) * 90))) * 340)}`, 'KM/H TOP');
      this.tele.tex.needsUpdate = true;
    }
    // ---- career
    {
      const { ctx: g, canvas: c } = this.stats;
      const d = this.career.data;
      const bg = g.createLinearGradient(0, 0, 0, c.height);
      bg.addColorStop(0, '#0e1117');
      bg.addColorStop(1, '#07080b');
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = accent;
      g.fillRect(0, 0, 12, c.height);
      header(g, `${this.driver.first.toUpperCase()} ${this.driver.last.toUpperCase()}`, 'CAREER');
      const stat = (x: number, y: number, v: string, k: string, hero = false) => {
        g.fillStyle = hero ? accent : '#ffffff';
        g.font = `700 ${hero ? 150 : 96}px ${FONT}`;
        g.fillText(v, x, y);
        g.fillStyle = '#8b93a1';
        g.font = `600 28px ${FONT}`;
        g.fillText(k, x, y + 44);
      };
      stat(56, 300, String(d.points), 'POINTS', true);
      stat(560, 300, String(d.wins), 'WINS');
      stat(900, 300, String(d.podiums), 'PODIUMS');
      stat(56, 620, String(d.races), 'RACES');
      stat(560, 620, `${Math.round(this.career.development() * 100)}%`, 'CAR DEVELOPED');
      stat(1040, 620, `${Math.round(d.credits / 1000)}k`, 'CREDITS');
      this.stats.tex.needsUpdate = true;
    }
    // ---- laptop: four channels, twice as wide as the screen (it scrolls by texture offset)
    {
      const { ctx: g, canvas: c } = this.laptop;
      g.fillStyle = '#0a0c10';
      g.fillRect(0, 0, c.width, c.height);
      const cols = ['#22d17a', '#f7c948', '#4aa8ff', '#ff5a6a'];
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        g.beginPath();
        g.moveTo(0, 80 + k * 150);
        g.lineTo(c.width, 80 + k * 150);
        g.stroke();
      }
      for (let k = 0; k < 4; k++) {
        g.strokeStyle = cols[k];
        g.lineWidth = 4;
        g.beginPath();
        for (let x = 0; x <= c.width; x += 4) {
          // periodic over the canvas width so the scroll wraps seamlessly
          const u = (x / c.width) * Math.PI * 2;
          const y = 80 + k * 150 + 50 * Math.sin(u * (6 + k * 2) + k) * Math.sin(u * 2 + k * 1.3);
          if (x === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      this.laptop.tex.needsUpdate = true;
    }
    // ---- the attract loop (before the first highlight)
    {
      const { ctx: g, canvas: c } = this.attract;
      const W = c.width, H = c.height;
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#12151c');
      bg.addColorStop(1, '#06070a');
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      // a diagonal band in the team colour
      g.save();
      g.globalAlpha = 0.9;
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(W * 0.62, 0);
      g.lineTo(W * 0.7, 0);
      g.lineTo(W * 0.46, H);
      g.lineTo(W * 0.38, H);
      g.fill();
      g.globalAlpha = 0.25;
      g.beginPath();
      g.moveTo(W * 0.72, 0);
      g.lineTo(W * 0.74, 0);
      g.lineTo(W * 0.5, H);
      g.lineTo(W * 0.48, H);
      g.fill();
      g.restore();
      g.fillStyle = '#ffffff';
      g.font = `italic 700 440px ${FONT}`;
      g.textBaseline = 'alphabetic';
      g.fillText(String(this.driver.number), 120, 620);
      g.font = `700 40px ${FONT}`;
      g.fillStyle = '#8b93a1';
      g.fillText(this.team.name.toUpperCase(), 128, 720);
      g.fillStyle = '#ffffff';
      g.font = `700 96px ${FONT}`;
      g.fillText(`${this.driver.first} ${this.driver.last.toUpperCase()}`, 124, 830);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = `600 36px ${FONT}`;
      g.fillText('Your best moments play here. Go racing.', 128, 910);
      this.attract.tex.needsUpdate = true;
    }
  }

  refreshStats() {
    this.drawStatic();
  }

  // ================================================================== the video wall

  /** the highlight list changed: keep playing what plays, or start */
  private onList(force = false) {
    const list = this.highlights.list;
    this.drawPips();
    if (!list.length) {
      this.playingId = null;
      this.video.pause();
      this.video.removeAttribute('src');
      this.wallMat.map = this.attract.tex;
      this.wallMat.color.setScalar(1);
      this.overlay.visible = false;
      this.sheen.visible = true;
      return;
    }
    const i = this.playingId ? list.findIndex((h) => h.id === this.playingId) : -1;
    if (i >= 0 && !force) {
      this.clip = i;
      return;
    }
    this.load(Math.max(0, Math.min(this.clip, list.length - 1)));
  }

  private load(i: number) {
    const list = this.highlights.list;
    if (!list.length) return;
    this.clip = ((i % list.length) + list.length) % list.length;
    const h = list[this.clip];
    this.playingId = h.id;
    this.clipAge = 0;
    this.bright = 0;
    this.wantNext = false;
    // black until the new clip has a frame (uploading an empty video is an error)
    this.wallMat.map = this.blackTex;
    this.wallMat.color.setScalar(0);
    this.overlay.visible = true;
    this.sheen.visible = false;
    this.drawLower(h);
    this.drawPips();
    this.video.src = this.highlights.videoUrl(h);
    if (this.active) this.video.play().catch(() => {});
  }

  /** play a given highlight next on the wall */
  playHighlight(id: string) {
    const i = this.highlights.list.findIndex((h) => h.id === id);
    if (i >= 0) this.load(i);
  }

  get current(): Highlight | null {
    const l = this.highlights.list;
    if (!l.length) return null;
    return l.find((h) => h.id === this.playingId) ?? l[this.clip % l.length];
  }

  private drawLower(h: Highlight) {
    const { ctx: g, canvas: c } = this.lower.s;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,9,12,0.84)';
    this.round(g, 0, 0, W, H, 18);
    g.fill();
    g.fillStyle = this.accent;
    g.fillRect(0, 0, 14, H);
    g.textBaseline = 'alphabetic';
    g.fillStyle = this.accent;
    g.font = `700 34px ${FONT}`;
    g.fillText(MOMENT_LABEL[h.kind].toUpperCase(), 52, 64);
    g.fillStyle = '#ffffff';
    g.font = `700 72px ${FONT}`;
    g.fillText(h.title, 50, 144, W - 100);
    g.fillStyle = '#8b93a1';
    g.font = `600 34px ${FONT}`;
    g.fillText(h.sub, 52, 200, W - 100);
    this.lower.s.tex.needsUpdate = true;
  }

  private drawPips() {
    const { ctx: g, canvas: c } = this.pips;
    g.clearRect(0, 0, c.width, c.height);
    const list = this.highlights.list;
    const n = Math.min(list.length, 12);
    for (let i = 0; i < n; i++) {
      g.fillStyle = i === this.clip % Math.max(1, list.length) ? '#ffffff' : 'rgba(255,255,255,0.3)';
      this.round(g, c.width - (n - i) * 42, 10, 32, 10, 5);
      g.fill();
    }
    this.pips.tex.needsUpdate = true;
  }

  private updateWall(dt: number) {
    if (!this.overlay.visible) {
      // attract loop: a sheen sweeps across every few seconds
      const u = (this.t % 7) / 7;
      this.sheen.position.x = (u * 1.6 - 0.8) * 4.8;
      (this.sheen.material as THREE.MeshBasicMaterial).opacity = Math.sin(Math.min(1, u * 1.3) * Math.PI);
      return;
    }
    const v = this.video;
    this.clipAge += dt;
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : (this.current?.duration ?? 8);
    const left = dur - v.currentTime;
    // dip to black between clips; up as soon as the new clip shows frames
    if (this.wallMat.map !== this.videoTex && v.readyState >= 2) this.wallMat.map = this.videoTex;
    const up = v.readyState >= 2 && v.currentTime > 0.04 && left > 0.28 && !this.wantNext;
    this.bright += ((up ? 1 : 0) - this.bright) * Math.min(1, dt * (up ? 7 : 12));
    this.wallMat.color.setScalar(this.bright);
    if (this.wantNext || (this.clipAge > 1 && v.paused && this.active && v.readyState >= 2 && left < 0.05)) {
      if (this.bright < 0.05 || this.clipAge > dur + 1.5) this.load(this.clip + 1);
    }
    // the lower third wipes in after the clip starts and out before it ends
    const L = this.lower;
    const inU = smooth((v.currentTime - 0.5) / 0.6) * smooth((left - 0.5) / 0.5);
    const s = Math.max(0.001, inU);
    L.mesh.scale.x = s;
    L.s.tex.repeat.x = s;
    (L.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, inU * 3);
    this.progress.scale.x = Math.max(0.001, Math.min(1, v.currentTime / dur));
  }

  // ================================================================== per frame

  /** the menu is showing (true) or not: the car's reflections, the video and the people pause when hidden */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.group.visible = on;
    for (const e of this.envSwap) {
      e.m.envMap = on && this.garageEnv ? this.garageEnv : e.env;
      e.m.envMapIntensity = on && this.garageEnv ? e.k * 1.2 : e.k;
    }
    if (on) {
      if (this.overlay.visible && this.video.src) this.video.play().catch(() => {});
    } else this.video.pause();
  }

  /**
   * Animate the people (anyone standing in the camera's way steps out of shot; anyone
   * out of the picture isn't drawn or animated: people are never frustum-culled by
   * three, their skinned meshes would all render every frame) and the screens.
   */
  private readonly seg = new THREE.Line3();
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  update(dt: number, cam?: THREE.Vector3, target?: THREE.Vector3, camera?: THREE.Camera) {
    this.t += dt;
    this.frameNo++;
    if (cam && target) this.seg.set(cam, target);
    if (camera) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    this.updateWalker(dt);
    for (const { p, pose } of this.people) {
      if (camera) {
        p.root.getWorldPosition(this.sphere.center).y += 0.9;
        this.sphere.radius = 1.2;
        if (!this.frustum.intersectsSphere(this.sphere)) {
          p.root.visible = false;
          continue;
        }
      }
      if (cam && target) {
        const v = p.root.getWorldPosition(this.v1);
        v.y += 1.1;
        const q = this.seg.closestPointToPoint(v, true, this.v2);
        const along = q.distanceTo(cam) / Math.max(0.01, cam.distanceTo(target));
        const d = v.distanceTo(cam);
        // in the line of sight, or filling the frame just in front of the lens
        p.root.visible = !(q.distanceTo(v) < 0.75 && along < 0.92) && d > 0.9 && !(d < 3.2 && this.v3.copy(v).sub(cam).dot(this.seg.delta(this.v4)) > 0);
      }
      if (!p.root.visible) continue;
      p.update(dt);
      pose?.(p, this.t, dt);
    }
    this.laptopTex.offset.x = (this.laptopTex.offset.x + dt * 0.035) % 1;
    this.updateWall(dt);
  }

  // ================================================================== the floor mirror

  private frameNo = 0;
  private mirror: { rt: THREE.WebGLRenderTarget; cam: THREE.PerspectiveCamera; tm: THREE.Matrix4; done: number; layer: number } | null = null;

  /**
   * A glossy floor under the car: the car (and its blankets) rendered once more from
   * the camera mirrored in the floor, at half resolution, blurred through the mip chain
   * and laid over the epoxy with a Fresnel falloff and soft edges. Only the car's layer
   * is drawn (and the garage lights, which carry that layer too).
   */
  private buildMirror(layer: number, S: number, midZ: number, noseZ: number, tailZ: number) {
    const rt = new THREE.WebGLRenderTarget(512, 256, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.owned.push(rt);
    const tm = new THREE.Matrix4();
    const cam = new THREE.PerspectiveCamera();
    cam.layers.set(layer);
    this.mirror = { rt, cam, tm, done: -1, layer };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tRefl: { value: rt.texture }, texMatrix: { value: tm }, strength: { value: 0.95 } },
      vertexShader: /* glsl */ `
        uniform mat4 texMatrix;
        varying vec4 vProj;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vProj = texMatrix * vec4(position, 1.0);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tRefl;
        uniform float strength;
        varying vec4 vProj;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vec2 p = vProj.xy / vProj.w;
          // a glossy, not mirror-like, finish: sample a blurred mip, and a sharper one near contact
          vec4 a = textureLod(tRefl, p, 2.2);
          vec4 b = textureLod(tRefl, p, 0.8);
          vec4 r = mix(a, b, 0.6);
          float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x) * smoothstep(0.0, 0.14, vUv.y) * smoothstep(1.0, 0.86, vUv.y);
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = 0.3 + 0.7 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
          float alpha = clamp(r.a, 0.0, 1.0) * edge * fres * strength;
          gl_FragColor = vec4(r.rgb / max(r.a, 1e-3), alpha);
        }`,
    });
    this.owned.push(mat);
    const geo = new THREE.PlaneGeometry(3.4, noseZ - tailZ + 2.2);
    geo.rotateX(-Math.PI / 2);
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(0, 0.005, (noseZ + tailZ) / 2);
    m.renderOrder = 1;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.name = 'garage-mirror';
    this.group.add(m);
    void S;
    void midZ;
    const plane = new THREE.Plane();
    const clip = new THREE.Vector4();
    const q = new THREE.Vector4();
    const mirrorPos = new THREE.Vector3(), camPos = new THREE.Vector3(), normal = new THREE.Vector3(0, 1, 0);
    const view = new THREE.Vector3(), look = new THREE.Vector3(), target = new THREE.Vector3(), rot = new THREE.Matrix4();
    const size = new THREE.Vector2();
    const clearCol = new THREE.Color();
    m.onBeforeRender = (renderer, scene, camera) => {
      const M = this.mirror;
      if (!M || !this.active || M.done === this.frameNo || !(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;
      M.done = this.frameNo;
      const c = camera as THREE.PerspectiveCamera;
      // half the drawing buffer
      renderer.getDrawingBufferSize(size);
      const w = Math.max(64, Math.round(size.x / 2)), h = Math.max(64, Math.round(size.y / 2));
      if (M.rt.width !== w || M.rt.height !== h) M.rt.setSize(w, h);
      mirrorPos.setFromMatrixPosition(m.matrixWorld);
      camPos.setFromMatrixPosition(c.matrixWorld);
      normal.set(0, 1, 0);
      view.subVectors(mirrorPos, camPos);
      if (view.dot(normal) > 0) return;
      view.reflect(normal).negate().add(mirrorPos);
      rot.extractRotation(c.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
      M.cam.position.copy(view);
      M.cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      M.cam.lookAt(target);
      M.cam.far = c.far;
      M.cam.near = c.near;
      M.cam.updateMatrixWorld();
      M.cam.projectionMatrix.copy(c.projectionMatrix);
      M.tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      M.tm.multiply(M.cam.projectionMatrix).multiply(M.cam.matrixWorldInverse).multiply(m.matrixWorld);
      // oblique near plane: nothing below the floor
      plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(M.cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const pm = M.cam.projectionMatrix.elements;
      q.set((Math.sign(clip.x) + pm[8]) / pm[0], (Math.sign(clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
      clip.multiplyScalar(2 / clip.dot(q));
      pm[2] = clip.x;
      pm[6] = clip.y;
      pm[10] = clip.z + 1 - 0.003;
      pm[14] = clip.w;
      // render only the mirror layer, into a transparent target
      const prevRt = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearCol);
      const s3 = scene as THREE.Scene;
      const bg = s3.background;
      s3.background = null;
      m.visible = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(M.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.state.buffers.depth.setMask(true);
      renderer.clear();
      renderer.render(scene, M.cam);
      renderer.setClearColor(clearCol, prevAlpha);
      renderer.shadowMap.autoUpdate = prevShadow;
      renderer.setRenderTarget(prevRt);
      s3.background = bg;
      m.visible = true;
    };
  }

  /** put these objects into the floor mirror */
  mirrorObjects(...objs: THREE.Object3D[]) {
    const M = this.mirror;
    if (!M) return;
    for (const o of objs) o.traverse((x) => x.layers.enable(M.layer));
  }

  // ================================================================== reflections

  /** a small room with the garage's light strips, its open door and the team wall, as a reflection map */
  private buildEnv(renderer: THREE.WebGLRenderer, yaw: number, teamCol: THREE.Color): THREE.Texture {
    const key = `${teamCol.getHexString()}:${yaw.toFixed(3)}`;
    if (envCache?.key === key) return envCache.rt.texture;
    const scene = new THREE.Scene();
    const room = new THREE.Group();
    room.rotation.y = yaw;
    scene.add(room);
    const basic = (c: THREE.Color | number) => new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide });
    const disp: { dispose(): void }[] = [];
    const quad = (w: number, h: number, c: THREE.Color, x: number, y: number, z: number, rx: number, ry: number) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const m = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
      disp.push(geo, m);
      const q = new THREE.Mesh(geo, m);
      q.position.set(x, y, z);
      q.rotation.set(rx, ry, 0);
      room.add(q);
    };
    const shell = new THREE.BoxGeometry(18, 5, 18);
    const shellM = basic(new THREE.Color(0.05, 0.05, 0.055));
    disp.push(shell, shellM);
    const sh = new THREE.Mesh(shell, shellM);
    sh.position.y = 2;
    room.add(sh);
    // floor: dark glossy epoxy
    quad(18, 18, new THREE.Color(0.025, 0.025, 0.028), 0, -0.45, 0, -Math.PI / 2, 0);
    // light strips across the ceiling, and the light box right overhead
    for (const z of [2.2, -1.9, -6.0]) quad(12, 0.7, new THREE.Color(3, 2.95, 2.85), 0, 4.1, z, Math.PI / 2, 0);
    quad(1.2, 3.5, new THREE.Color(3, 3, 2.9), 0, 3.1, 0, Math.PI / 2, 0);
    // the open door: daylight from the pit lane
    quad(16, 4.2, new THREE.Color(1.6, 1.7, 1.85), 0, 1.6, 8.8, 0, Math.PI);
    // side walls: light grey partitions with a team stripe; the branded back wall
    for (const x of [-8.8, 8.8]) {
      quad(18, 4, new THREE.Color(0.32, 0.33, 0.34), x, 1.5, 0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2);
      quad(18, 0.35, teamCol.clone().multiplyScalar(0.7), x * 0.99, 1.9, 0, 0, x > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    quad(10, 4, teamCol.clone().multiplyScalar(0.35), 0, 1.8, -8.8, 0, 0);
    quad(4.8, 2.7, new THREE.Color(0.5, 0.55, 0.65), 0, 2.2, -5.4, 0, 0);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(scene, 0.03, 0.1, 50);
    pm.dispose();
    for (const d of disp) d.dispose();
    envCache?.rt.dispose();
    envCache = { key, rt };
    return rt.texture;
  }

  dispose() {
    this.disposed = true;
    this.offList?.();
    this.setActive(false);
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    for (const { p } of this.people) p.dispose();
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}
