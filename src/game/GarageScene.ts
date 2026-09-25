import * as THREE from 'three';
import type { CarRig } from '../car/CarModel.ts';
import type { Team, Driver } from '../race/Teams.ts';
import { Person, type Look, type PeopleKit } from '../people/Humans.ts';
import { driverLook } from '../people/drivers.ts';
import { naturalStance, turnHead, aimArm } from '../people/poses.ts';
import { MOMENT_LABEL, FRAME_DT, type Highlight, type Highlights } from '../career/Highlights.ts';
import type { Career } from '../career/Career.ts';
import type { Track } from '../world/Track.ts';

/**
 * Your garage, dressed for the menu: a video wall behind the car playing your best
 * racing moments, a telemetry screen and a career screen on rolling stands, the car
 * on tyre blankets with jacks front and rear, wheel guns and their air lines, a tool
 * trolley, the engineers' laptop cart — and people: you in your race suit, mechanics
 * kneeling at the wheels, the race engineer at the laptop.
 *
 * Built in the car's frame (x = the car's left, z = forward toward the lane); `side`
 * says which way the garage's open middle is (cameras and people stand there).
 */

const FONT = '"Titillium Web", Arial, sans-serif';

interface Screen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

function screen(w: number, h: number): Screen {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, ctx, tex };
}

export type PartId = 'frontWing' | 'rearWing' | 'brakes' | 'suspension' | 'powerUnit' | 'tyres' | 'floor';

export class GarageScene {
  readonly group = new THREE.Group();
  private readonly people: { p: Person; pose?: (p: Person, t: number) => void }[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly wall: Screen;
  private readonly tele: Screen;
  private readonly stats: Screen;
  private readonly laptop: Screen;
  private clip = 0;
  private clipT = 0;
  private readonly frames = new Map<string, HTMLImageElement[]>();
  private t = 0;
  private redrawT = 0;
  /** world anchors for the setup hotspots */
  readonly parts: Record<PartId, THREE.Vector3> = {} as Record<PartId, THREE.Vector3>;
  /** the video wall's centre (world) — the Highlights tab frames it */
  readonly wallCenter = new THREE.Vector3();

  constructor(
    kit: PeopleKit | null,
    private readonly rig: CarRig,
    bay: { pos: THREE.Vector3; yaw: number; inward: THREE.Vector3 },
    private readonly team: Team,
    private readonly driver: Driver,
    private readonly highlights: Highlights,
    private readonly career: Career,
    private readonly track: Track,
  ) {
    this.group.name = 'garage-scene';
    const g = this.group;
    g.position.copy(bay.pos);
    g.rotation.y = bay.yaw;
    g.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(Math.sin(bay.yaw), 0, Math.cos(bay.yaw));
    const left = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const side = left.dot(bay.inward) > 0 ? 1 : -1;
    this.side = side;
    const mat = (color: THREE.ColorRepresentation, rough = 0.5, metal = 0.2) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
      this.owned.push(m);
      return m;
    };
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, parent: THREE.Object3D = g) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      this.owned.push(geo);
      return mesh;
    };
    const prim = new THREE.Color(team.primary);
    const dark = prim.r + prim.g + prim.b < 0.25;
    const teamCol = dark ? new THREE.Color(team.secondary) : prim;
    const steel = mat(0x8d949c, 0.35, 0.8);
    const black = mat(0x16171a, 0.55, 0.3);
    const rubber = mat(0x0c0c0d, 0.85, 0);
    const teamM = mat(teamCol, 0.4, 0.35);
    const blanket = new THREE.MeshStandardMaterial({ color: teamCol.clone().multiplyScalar(0.5), roughness: 1, metalness: 0 });
    this.owned.push(blanket);

    // ---------------------------------------------------------------- where the wheels are (car frame)
    rig.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const local = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const A = rig.anchors;
    const wFL = local(A.wheelFL), wFR = local(A.wheelFR), wRL = local(A.wheelRL), wRR = local(A.wheelRR);
    const R = rig.dims.wheelRadius;
    const noseZ = local(A.nose).z, tailZ = local(A.rearWing).z;

    // ---------------------------------------------------------------- tyre blankets on all four
    for (const w of [wFL, wFR, wRL, wRR]) {
      const outSide = Math.sign(w.x);
      const cyl = new THREE.CylinderGeometry(R + 0.025, R + 0.025, 0.38, 28, 1, true);
      cyl.rotateZ(Math.PI / 2);
      add(cyl, blanket, w.x + outSide * 0.02, w.y, w.z);
      // the blanket wraps the tyre; the rim and wheel nut stay visible
      const ring = new THREE.RingGeometry(R * 0.8, R + 0.028, 28, 1);
      ring.rotateY(outSide > 0 ? Math.PI / 2 : -Math.PI / 2);
      add(ring, blanket, w.x + outSide * 0.2, w.y, w.z);
      // the blanket's power lead down to the floor
      const lead = new THREE.CylinderGeometry(0.012, 0.012, w.y, 6);
      add(lead, black, w.x + outSide * 0.24, w.y / 2, w.z - 0.2);
    }

    // ---------------------------------------------------------------- jacks front and rear
    const jack = (z: number, dir: number) => {
      const j = new THREE.Group();
      j.position.set(0, 0, z);
      g.add(j);
      add(new THREE.BoxGeometry(0.5, 0.08, 0.3), black, 0, 0.12, 0, 0, 0, 0, j);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), rubber, -0.2, 0.05, 0, 0, 0, Math.PI / 2, j);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), rubber, 0.2, 0.05, 0, 0, 0, Math.PI / 2, j);
      const handle = new THREE.CylinderGeometry(0.022, 0.022, 1.3, 8);
      const h = add(handle, teamM, 0, 0.55, dir * 0.55, 0, dir * 0.95, 0, j);
      h.castShadow = true;
      add(new THREE.BoxGeometry(0.42, 0.035, 0.035), black, 0, 1.06, dir * 1.1, 0, 0, 0, j);
    };
    jack(noseZ + 0.35, 1);
    jack(tailZ - 0.4, -1);

    // ---------------------------------------------------------------- wheel guns and their air lines
    const gun = (x: number, z: number, ry: number) => {
      const G = new THREE.Group();
      G.position.set(x, 0.05, z);
      G.rotation.y = ry;
      g.add(G);
      add(new THREE.CylinderGeometry(0.06, 0.07, 0.24, 14), mat(0x2d3035, 0.4, 0.6), 0, 0.06, 0, 0, 0, Math.PI / 2, G);
      add(new THREE.BoxGeometry(0.06, 0.2, 0.05), teamM, 0.05, 0.04, 0.0, 0, 0, 0, G);
      add(new THREE.TorusGeometry(0.34, 0.016, 6, 40), black, -0.45, 0.0, 0.1, 0, Math.PI / 2, 0, G);
      add(new THREE.TorusGeometry(0.28, 0.016, 6, 40), black, -0.45, 0.02, 0.1, 0.3, Math.PI / 2, 0, G);
    };
    gun(wFL.x + Math.sign(wFL.x) * 0.9, wFL.z + 0.4, 0.4);
    gun(wRR.x + Math.sign(wRR.x) * 0.95, wRR.z - 0.3, -2.2);
    gun(wRL.x + Math.sign(wRL.x) * 0.9, wRL.z - 0.5, 2.6);

    // ---------------------------------------------------------------- tool trolley (open drawer, spanners in the top tray)
    {
      const T = new THREE.Group();
      T.position.set(-side * 2.05, 0, (wFL.z + wRL.z) / 2 - 0.2);
      T.rotation.y = -side * Math.PI / 2;
      g.add(T);
      add(new THREE.BoxGeometry(0.95, 0.85, 0.5), teamM, 0, 0.5, 0, 0, 0, 0, T);
      add(new THREE.BoxGeometry(0.97, 0.03, 0.52), black, 0, 0.94, 0, 0, 0, 0, T);
      for (let d = 0; d < 4; d++) add(new THREE.BoxGeometry(0.8, 0.012, 0.02), steel, 0, 0.2 + d * 0.18, 0.255, 0, 0, 0, T);
      // an open drawer
      add(new THREE.BoxGeometry(0.86, 0.1, 0.42), black, 0, 0.74, 0.22, 0, 0, 0, T);
      for (let k = 0; k < 7; k++) add(new THREE.BoxGeometry(0.02, 0.012, 0.22 - k * 0.012), steel, -0.36 + k * 0.1, 0.8, 0.22, 0, 0, 0, T);
      // spanners and a torque wrench on the top
      for (let k = 0; k < 5; k++) add(new THREE.BoxGeometry(0.018, 0.012, 0.18 + k * 0.03), steel, -0.3 + k * 0.08, 0.965, 0.02, 0.15 * (k % 2 ? 1 : -1));
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.7, 8), mat(0xb5bcc4, 0.3, 0.9), 0.15, 0.975, -0.12, Math.PI / 2 - 0.2, 0, Math.PI / 2, T);
      for (const x of [-0.4, 0.4]) for (const z of [-0.2, 0.2]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 10), rubber, x, 0.04, z, 0, 0, Math.PI / 2, T);
    }

    // ---------------------------------------------------------------- the engineers' laptop cart
    this.laptop = screen(512, 320);
    {
      const T = new THREE.Group();
      T.position.set(-side * 2.0, 0, wFL.z + 0.9);
      T.rotation.y = -side * 1.2;
      g.add(T);
      add(new THREE.CylinderGeometry(0.03, 0.03, 0.95, 8), steel, 0, 0.5, 0, 0, 0, 0, T);
      add(new THREE.CylinderGeometry(0.28, 0.3, 0.04, 16), black, 0, 0.02, 0, 0, 0, 0, T);
      add(new THREE.BoxGeometry(0.62, 0.03, 0.45), black, 0, 0.98, 0, 0, 0, 0, T);
      add(new THREE.BoxGeometry(0.42, 0.02, 0.3), mat(0x2a2c30, 0.4, 0.5), 0, 1.005, 0.03, 0, 0, 0, T);
      const lid = new THREE.Group();
      lid.position.set(0, 1.01, -0.12);
      lid.rotation.x = -0.25;
      T.add(lid);
      add(new THREE.BoxGeometry(0.42, 0.28, 0.012), mat(0x2a2c30, 0.4, 0.5), 0, 0.14, 0, 0, 0, 0, lid);
      const sm = new THREE.MeshBasicMaterial({ map: this.laptop.tex, toneMapped: false });
      this.owned.push(sm, this.laptop.tex);
      add(new THREE.PlaneGeometry(0.39, 0.25), sm, 0, 0.14, 0.007, 0, 0, 0, lid);
    }

    // ---------------------------------------------------------------- video wall behind the car
    this.wall = screen(1280, 720);
    {
      const W = 4.4, H = W * 9 / 16;
      const z = tailZ - 3.4, y = 1.05 + H / 2;
      const T = new THREE.Group();
      T.position.set(-side * 1.2, 0, z);
      T.rotation.y = side * 0.32;
      g.add(T);
      // truss legs and frame
      for (const x of [-W / 2 - 0.1, W / 2 + 0.1]) {
        add(new THREE.BoxGeometry(0.12, y + H / 2 + 0.2, 0.12), black, x, (y + H / 2 + 0.2) / 2, -0.05, 0, 0, 0, T);
        add(new THREE.BoxGeometry(0.5, 0.05, 0.6), black, x, 0.025, -0.05, 0, 0, 0, T);
      }
      add(new THREE.BoxGeometry(W + 0.14, H + 0.14, 0.08), black, 0, y, -0.06, 0, 0, 0, T);
      const sm = new THREE.MeshBasicMaterial({ map: this.wall.tex, toneMapped: false });
      sm.color.setScalar(0.92);
      this.owned.push(sm, this.wall.tex);
      add(new THREE.PlaneGeometry(W, H), sm, 0, y, -0.015, 0, 0, 0, T);
      // team stripe on the header
      add(new THREE.BoxGeometry(W + 0.14, 0.06, 0.09), teamM, 0, y + H / 2 + 0.1, -0.06, 0, 0, 0, T);
      T.updateMatrixWorld(true);
      this.wallCenter.set(0, y, 0).applyMatrix4(T.matrixWorld);
      // a soft glow from the screen onto the car's tail
      const glow = new THREE.PointLight(0xbfd2ff, 6, 7, 2);
      glow.position.set(0, y, 1.2);
      T.add(glow);
    }

    // ---------------------------------------------------------------- telemetry + career screens on rolling stands
    this.tele = screen(768, 432);
    this.stats = screen(768, 432);
    const stand = (x: number, z: number, ry: number, s: Screen) => {
      const T = new THREE.Group();
      T.position.set(x, 0, z);
      T.rotation.y = ry;
      g.add(T);
      add(new THREE.BoxGeometry(0.08, 1.6, 0.08), black, 0, 0.8, 0, 0, 0, 0, T);
      add(new THREE.BoxGeometry(0.7, 0.04, 0.5), black, 0, 0.03, 0, 0, 0, 0, T);
      for (const cx of [-0.3, 0.3]) for (const cz of [-0.2, 0.2]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), rubber, cx, 0.02, cz, 0, 0, Math.PI / 2, T);
      add(new THREE.BoxGeometry(1.36, 0.8, 0.06), black, 0, 1.62, -0.02, 0, 0, 0, T);
      const sm = new THREE.MeshBasicMaterial({ map: s.tex, toneMapped: false });
      sm.color.setScalar(0.9);
      this.owned.push(sm, s.tex);
      add(new THREE.PlaneGeometry(1.28, 0.72), sm, 0, 1.62, 0.012, 0, 0, 0, T);
    };
    stand(side * 3.0, tailZ - 3.4, side * 0.5, this.tele);
    stand(side * 3.9, noseZ - 1.2, side * 1.05, this.stats);

    // ---------------------------------------------------------------- hotspot anchors (world)
    const W2 = (v: THREE.Vector3) => v.clone().applyMatrix4(g.matrixWorld);
    this.parts.frontWing = W2(new THREE.Vector3(0, 0.25, noseZ - 0.15));
    this.parts.rearWing = W2(new THREE.Vector3(0, 0.95, tailZ + 0.05));
    this.parts.brakes = W2(wFL.clone().add(new THREE.Vector3(Math.sign(wFL.x) * 0.24, 0.05, 0)));
    this.parts.suspension = W2(new THREE.Vector3(wFR.x * 0.55, 0.45, wFR.z - 0.05));
    this.parts.powerUnit = W2(new THREE.Vector3(0, 0.75, (wRL.z + wFL.z) / 2 - 0.6));
    this.parts.tyres = W2(wRL.clone().add(new THREE.Vector3(Math.sign(wRL.x) * 0.25, 0.2, 0)));
    this.parts.floor = W2(new THREE.Vector3(side * 0.7, 0.08, (wRL.z + wFL.z) / 2));

    // ---------------------------------------------------------------- people
    if (kit) {
      const place = (p: Person, x: number, z: number, faceX: number, faceZ: number) => {
        p.root.position.set(x, 0, z);
        p.root.rotation.y = Math.atan2(faceX - x, faceZ - z);
        g.add(p.root);
      };
      // you: at the front corner, on the open side, talking to your engineer
      const me = new Person(kit, driverLook(team, driver, { cap: true }));
      place(me, -side * 0.7, tailZ - 1.6, side * 3.5, wFL.z + 5);
      me.play('Idle_Talking_Loop');
      this.people.push({
        p: me,
        pose: (p, t) => {
          naturalStance(p, 0.8);
          turnHead(p, Math.sin(t * 0.3) * 0.25 - side * 0.2, -0.05);
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
      const lp = new THREE.Vector3(-side * 2.0, 0, wFL.z + 0.9);
      place(eng, lp.x - side * 0.55, lp.z + 0.2, lp.x, lp.z);
      eng.play('Idle_Loop', { offset: 0.4 });
      this.people.push({
        p: eng,
        pose: (p, t) => {
          naturalStance(p, 0.85);
          // hands on the keyboard, a glance up at the car now and then
          aimArm(p, 'l', [0.18, -0.55, 0.8], [-0.2, -0.25, 0.95], 0.9);
          aimArm(p, 'r', [0.18, -0.55, 0.8], [-0.2, -0.25, 0.95], 0.9);
          turnHead(p, Math.sin(t * 0.21) > 0.7 ? side * 0.6 : 0, 0.35);
        },
      });
    }

    this.highlights.onChange(() => this.loadFrames());
    this.loadFrames();
    this.drawStatic();
  }

  readonly side: number;

  private loadFrames() {
    for (const h of this.highlights.list) {
      if (this.frames.has(h.id)) continue;
      this.frames.set(
        h.id,
        h.frames.map((src) => {
          const im = new Image();
          im.src = src;
          return im;
        }),
      );
    }
  }

  /** the screens that change slowly: telemetry and career */
  private drawStatic() {
    const tr = this.track;
    // ---- telemetry: the circuit and a speed trace
    {
      const { ctx: g, canvas: c } = this.tele;
      g.fillStyle = '#0b0d12';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#8b93a1';
      g.font = `700 22px ${FONT}`;
      g.fillText(`TELEMETRY · ${tr.def.short.toUpperCase()}`, 28, 42);
      // track map
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < tr.n; i += 4) {
        x0 = Math.min(x0, tr.px[i]); x1 = Math.max(x1, tr.px[i]);
        z0 = Math.min(z0, tr.pz[i]); z1 = Math.max(z1, tr.pz[i]);
      }
      const k = Math.min(300 / (x1 - x0), 300 / (z1 - z0));
      g.strokeStyle = this.team.primary.toLowerCase() === '#141414' ? '#e0e0e0' : this.team.primary;
      g.lineWidth = 5;
      g.lineJoin = 'round';
      g.beginPath();
      for (let i = 0; i < tr.n; i += 6) {
        const x = 40 + (tr.px[i] - x0) * k, y = 80 + (tr.pz[i] - z0) * k;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.stroke();
      // corner-speed trace (curvature)
      g.strokeStyle = '#22d17a';
      g.lineWidth = 2.5;
      g.beginPath();
      const X0 = 380, Wd = 360, Y0 = 380, Ht = 260;
      for (let i = 0; i < 360; i++) {
        const s = (i / 360) * tr.length;
        // curvature over the next ~60 m sets how fast this bit is
        let kap = 0;
        for (let d = 0; d < 60; d += 10) kap = Math.max(kap, Math.abs(tr.kappa[Math.floor(tr.wrap(s + d)) % tr.n]));
        const v = Math.min(1, 1 / (1 + kap * 90));
        const x = X0 + (i / 360) * Wd, y = Y0 - v * Ht;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = '#5c6472';
      g.font = `600 16px ${FONT}`;
      g.fillText('SPEED TRACE', X0, 100);
      g.fillText(`${(tr.length / 1000).toFixed(3)} km`, X0, 408);
      this.tele.tex.needsUpdate = true;
    }
    // ---- career
    {
      const { ctx: g, canvas: c } = this.stats;
      const d = this.career.data;
      g.fillStyle = '#0b0d12';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = this.team.primary;
      g.fillRect(0, 0, 10, c.height);
      g.fillStyle = '#8b93a1';
      g.font = `700 22px ${FONT}`;
      g.fillText(`${this.driver.first.toUpperCase()} ${this.driver.last.toUpperCase()} · CAREER`, 36, 44);
      const stat = (x: number, y: number, v: string, k: string) => {
        g.fillStyle = '#ffffff';
        g.font = `700 64px ${FONT}`;
        g.fillText(v, x, y);
        g.fillStyle = '#8b93a1';
        g.font = `600 20px ${FONT}`;
        g.fillText(k, x, y + 30);
      };
      stat(36, 150, String(d.points), 'POINTS');
      stat(270, 150, String(d.wins), 'WINS');
      stat(470, 150, String(d.podiums), 'PODIUMS');
      stat(36, 290, String(d.races), 'RACES');
      stat(270, 290, `${Math.round(this.career.development() * 100)}%`, 'CAR DEVELOPED');
      stat(470, 290, `₵${Math.round(d.credits / 1000)}k`, 'CREDITS');
      this.stats.tex.needsUpdate = true;
    }
  }

  /** redraw the moving screens, animate the people (anyone standing in the camera's way steps out of shot) */
  update(dt: number, cam?: THREE.Vector3, target?: THREE.Vector3) {
    this.t += dt;
    const v = new THREE.Vector3(), seg = new THREE.Line3();
    if (cam && target) seg.set(cam, target);
    for (const { p, pose } of this.people) {
      p.update(dt);
      pose?.(p, this.t);
      if (cam && target) {
        p.root.getWorldPosition(v);
        v.y += 1.1;
        const q = seg.closestPointToPoint(v, true, new THREE.Vector3());
        const along = q.distanceTo(cam) / Math.max(0.01, cam.distanceTo(target));
        p.root.visible = !(q.distanceTo(v) < 0.75 && along < 0.92) && v.distanceTo(cam) > 0.9;
      }
    }
    this.redrawT -= dt;
    if (this.redrawT > 0) return;
    this.redrawT = 1 / 20;
    this.drawWall(1 / 20);
    this.drawLaptop();
  }

  /** the video wall: highlights, one after another, with a broadcast lower third */
  private drawWall(dt: number) {
    const { ctx: g, canvas: c } = this.wall;
    const W = c.width, H = c.height;
    const list = this.highlights.list;
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, W, H);
    const accent = this.team.primary.toLowerCase() === '#141414' ? this.team.secondary : this.team.primary;
    if (!list.length) {
      // attract loop: your number, your name, an invitation
      const t = this.t;
      for (let i = 0; i < 9; i++) {
        g.fillStyle = `rgba(255,255,255,${0.03 + 0.02 * Math.sin(t + i)})`;
        const x = ((i * 190 + t * 60) % (W + 400)) - 200;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 120, 0);
        g.lineTo(x - 180, H);
        g.lineTo(x - 300, H);
        g.fill();
      }
      g.fillStyle = accent;
      g.font = `italic 700 300px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(String(this.driver.number), W / 2, H / 2 + 60);
      g.fillStyle = '#ffffff';
      g.font = `700 54px ${FONT}`;
      g.fillText(`${this.driver.first} ${this.driver.last.toUpperCase()}`, W / 2, H / 2 + 150);
      g.fillStyle = '#8b93a1';
      g.font = `600 30px ${FONT}`;
      g.fillText('Your best moments will play here. Go racing.', W / 2, H / 2 + 205);
      g.textAlign = 'left';
      this.wall.tex.needsUpdate = true;
      return;
    }
    // the clip: frames played at half speed, crossfaded; each clip twice, then the next
    const h = list[this.clip % list.length];
    const frames = this.frames.get(h.id) ?? [];
    const per = FRAME_DT * 2.2;
    const len = frames.length * per;
    this.clipT += dt;
    if (this.clipT > len * 1.6 + 0.8) {
      this.clipT = 0;
      this.clip = (this.clip + 1) % list.length;
    }
    const tt = Math.min(this.clipT % (len + 0.4), len - 0.001);
    const fi = Math.floor(tt / per), fk = (tt % per) / per;
    const draw = (im: HTMLImageElement | undefined, a: number) => {
      if (!im || !im.complete || !im.naturalWidth) return;
      g.globalAlpha = a;
      // slow push-in
      const z = 1.02 + 0.05 * (this.clipT / (len * 1.6));
      g.drawImage(im, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z);
      g.globalAlpha = 1;
    };
    draw(frames[fi], 1);
    draw(frames[Math.min(frames.length - 1, fi + 1)], fk);
    // fade between clips
    const edge = Math.min(this.clipT / 0.4, (len * 1.6 + 0.8 - this.clipT) / 0.4);
    if (edge < 1) {
      g.fillStyle = `rgba(7,8,11,${1 - Math.max(0, edge)})`;
      g.fillRect(0, 0, W, H);
    }
    // bug: REPLAY
    g.fillStyle = 'rgba(10,12,17,0.72)';
    g.fillRect(40, 36, 190, 44);
    g.fillStyle = '#ff2b3f';
    g.beginPath();
    g.arc(64, 58, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 24px ${FONT}`;
    g.fillText('HIGHLIGHTS', 82, 67);
    // lower third
    g.fillStyle = 'rgba(10,12,17,0.82)';
    g.fillRect(40, H - 150, 760, 104);
    g.fillStyle = accent;
    g.fillRect(40, H - 150, 10, 104);
    g.fillStyle = accent;
    g.font = `700 22px ${FONT}`;
    g.fillText(MOMENT_LABEL[h.kind].toUpperCase(), 70, H - 116);
    g.fillStyle = '#ffffff';
    g.font = `700 40px ${FONT}`;
    g.fillText(h.title, 70, H - 74, 710);
    g.fillStyle = '#8b93a1';
    g.font = `600 22px ${FONT}`;
    g.fillText(h.sub, 70, H - 50 + 0, 710);
    // which clip of how many
    for (let i = 0; i < Math.min(list.length, 12); i++) {
      g.fillStyle = i === this.clip % list.length ? '#ffffff' : 'rgba(255,255,255,0.3)';
      g.fillRect(W - 40 - (Math.min(list.length, 12) - i) * 26, 52, 18, 5);
    }
    this.wall.tex.needsUpdate = true;
  }

  /** play a given highlight next on the wall */
  playHighlight(id: string) {
    const i = this.highlights.list.findIndex((h) => h.id === id);
    if (i >= 0) {
      this.clip = i;
      this.clipT = 0;
    }
  }

  get current(): Highlight | null {
    const l = this.highlights.list;
    return l.length ? l[this.clip % l.length] : null;
  }

  private drawLaptop() {
    const { ctx: g, canvas: c } = this.laptop;
    g.fillStyle = '#0a0c10';
    g.fillRect(0, 0, c.width, c.height);
    const cols = ['#22d17a', '#f7c948', '#4aa8ff', '#ff5a6a'];
    for (let k = 0; k < 4; k++) {
      g.strokeStyle = cols[k];
      g.lineWidth = 2;
      g.beginPath();
      for (let x = 0; x < c.width; x += 6) {
        const y = 40 + k * 70 + 24 * Math.sin(x * 0.03 + this.t * (0.8 + k * 0.3) + k) * Math.sin(x * 0.007 + k);
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    this.laptop.tex.needsUpdate = true;
  }

  refreshStats() {
    this.drawStatic();
  }

  dispose() {
    for (const { p } of this.people) p.dispose();
    for (const o of this.owned) o.dispose();
    this.group.removeFromParent();
  }
}
