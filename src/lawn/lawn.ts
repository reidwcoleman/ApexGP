/**
 * One lawn: the floating island of tiles, the grass (tens of thousands of instanced tufts whose
 * height and stripe tone come from a mask the mower paints), the things standing on it, coins,
 * flowers, and the maths of how much has been cut.
 */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import { buildProp, type Prop } from './props.ts';
import { Ambient, Particles } from './fx.ts';
import { disposeTree } from './gfx.ts';
import { damp, lerp, smoothstep, Rng } from './util.ts';
import type { Mower } from './mower.ts';

/** Mask cells per world unit. */
export const CPU = 10;
const DENSITY = 12; // tufts per tile edge (12x12 = 144 per tile)
const STUB = 0.075;
const TALL = 0.52;

export interface View {
  /** Ground-plane direction the camera looks along (away from the viewer) and its right. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  cam: THREE.Camera;
}

export interface LawnEvents {
  coin?: (x: number, z: number) => void;
  flower?: (x: number, z: number, color: string) => void;
  bump?: (impact: number, x: number, z: number) => void;
  milestone?: (pct: number) => void;
  finished?: () => void;
}

interface Coin {
  x: number;
  z: number;
  g: THREE.Group;
  phase: number;
  state: 0 | 1;
  t: number;
  y: number;
  home: number;
}

const BLADE_VS = /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uMower;
uniform float uStub;
uniform float uH;
attribute float aT;
attribute vec3 iData;
attribute vec4 iRnd;
varying float vT;
varying float vTall;
varying float vStripe;
varying float vShadow;
varying float vRnd;
varying vec2 vWp;
void main() {
  vec2 wp = iData.xy;
  vec4 m = texture2D(uMask, wp / uSize + 0.5);
  float tall = m.r;
  float k = tall * tall * (3.0 - 2.0 * tall);
  float H = mix(uStub * (0.75 + 0.5 * iRnd.y), uH * (0.78 + 0.5 * iRnd.y), k);
  float c = cos(iData.z);
  float s = sin(iData.z);
  vec2 lo = vec2(c * position.x + s * position.z, -s * position.x + c * position.z) * mix(0.45, 1.0, k);
  float t = aT;
  float w1 = sin(uTime * 1.6 + wp.x * 0.6 + wp.y * 0.4 + iRnd.z * 6.2831);
  float w2 = sin(uTime * 2.7 + wp.y * 1.1 - wp.x * 0.5 + iRnd.z * 3.0);
  vec2 bend = vec2(w1 * 0.7 + w2 * 0.3, w1 * 0.3 - w2 * 0.2) * 0.075 * t * t * k;
  vec2 d = wp - uMower.xy;
  float md = length(d);
  float push = 1.0 - smoothstep(0.3, uMower.z * 1.6, md);
  bend += (d / max(md, 0.001)) * push * 0.22 * t * t * k;
  float y = position.y * H * (1.0 - push * 0.3 * k * t);
  vT = t;
  vTall = tall;
  vStripe = m.g;
  vShadow = m.b;
  vRnd = iRnd.x;
  vWp = wp;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(wp.x + lo.x + bend.x, y, wp.y + lo.y + bend.y, 1.0);
}`;

const COMMON_FS = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uTipA;
uniform vec3 uTipB;
uniform vec3 uCutL;
uniform vec3 uCutD;
uniform vec3 uShade;
uniform vec3 uMower;
float mowerShadow(vec2 wp) {
  vec2 q = (wp - uMower.xy - vec2(0.12, -0.1)) / vec2(0.95, 0.72);
  return 1.0 - smoothstep(0.0, 1.0, length(q));
}`;

const BLADE_FS = /* glsl */ `
${COMMON_FS}
varying float vT;
varying float vTall;
varying float vStripe;
varying float vShadow;
varying float vRnd;
varying vec2 vWp;
void main() {
  float tt = clamp(vT, 0.0, 1.0);
  vec3 tallC = mix(uBase, mix(uTipA, uTipB, vRnd), sqrt(tt)) * (0.9 + 0.2 * vRnd);
  vec3 cutC = mix(uCutD, uCutL, clamp(vStripe, 0.0, 1.0)) * mix(0.8, 1.03, tt) * (0.96 + 0.08 * vRnd);
  vec3 c = mix(cutC, tallC, smoothstep(0.2, 0.8, vTall));
  c *= mix(vec3(1.0), uShade, vShadow);
  c *= 1.0 - 0.3 * mowerShadow(vWp);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const GROUND_VS = /* glsl */ `
varying vec2 vWp;
void main() {
  vWp = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GROUND_FS = /* glsl */ `
${COMMON_FS}
uniform sampler2D uMask;
uniform vec2 uSize;
varying vec2 vWp;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec4 m = texture2D(uMask, vWp / uSize + 0.5);
  float n = noise(vWp * 3.0) * 0.6 + noise(vWp * 9.0) * 0.4;
  vec3 tallC = uBase * (0.9 + 0.2 * n);
  vec3 cutC = mix(uCutD, uCutL, m.g) * (0.86 + 0.07 * n);
  vec3 c = mix(cutC, tallC, smoothstep(0.3, 0.95, m.r));
  c *= mix(vec3(1.0), uShade, m.b);
  c *= 1.0 - 0.3 * mowerShadow(vWp);
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

function bladeGeometry(rng: Rng): THREE.BufferGeometry {
  const pos: number[] = [];
  const aT: number[] = [];
  const idx: number[] = [];
  const blades = 3;
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const bx = Math.cos(ang) * 0.045;
    const bz = Math.sin(ang) * 0.045;
    const la = ang + rng.range(-0.7, 0.7);
    const lx = Math.cos(la);
    const lz = Math.sin(la);
    const wx = -lz;
    const wz = lx;
    const hf = 0.74 + 0.26 * (b === 0 ? 1 : rng.next());
    const w = 0.04;
    const lean = rng.range(0.07, 0.15);
    const o = pos.length / 3;
    pos.push(bx - wx * w, 0, bz - wz * w, bx + wx * w, 0, bz + wz * w);
    aT.push(0, 0);
    pos.push(bx + lx * lean * 0.28 - wx * w * 0.78, 0.5 * hf, bz + lz * lean * 0.28 - wz * w * 0.78);
    pos.push(bx + lx * lean * 0.28 + wx * w * 0.78, 0.5 * hf, bz + lz * lean * 0.28 + wz * w * 0.78);
    aT.push(0.5, 0.5);
    pos.push(bx + lx * lean, hf, bz + lz * lean);
    aT.push(1);
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2, o + 2, o + 3, o + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setIndex(idx);
  return g;
}

export class Lawn {
  readonly group = new THREE.Group();
  /** Everything that bobs with the island (the mower is parented here too). */
  readonly body = new THREE.Group();
  readonly fx = new Particles();
  readonly events: LawnEvents = {};
  readonly gw: number;
  readonly gh: number;
  total = 0;
  done = 0;
  coinsGot = 0;
  flowersGot = 0;
  readonly coinTotal: number;
  readonly flowerTotal: number;
  finishing = false;
  finished = false;

  private readonly state: Uint8Array;
  private readonly hgt: Float32Array;
  private readonly data: Uint8Array;
  private readonly tex: THREE.DataTexture;
  private readonly active: number[] = [];
  private dirty = true;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly mowerU = new THREE.Vector3(0, 0, 0.7);
  private readonly waterTime = { value: 0 };
  private props: Prop[] = [];
  private coins: Coin[] = [];
  private flowerHeads!: THREE.InstancedMesh;
  private flowerStems!: THREE.InstancedMesh;
  private flowerAlive: boolean[] = [];
  private flowerCell: number[] = [];
  private ambient: Ambient;
  private last: { x: number; z: number; h: number } | null = null;
  private time = 0;
  private nextMilestone = 25;
  private finishList: number[] = [];
  private finishPtr = 0;
  private finishR = 0;
  private finishOrigin = { x: 0, z: 0 };
  private finishDelay = 0;
  private coinGeo: THREE.BufferGeometry;
  private coinMat: THREE.Material[];
  private readonly rng: Rng;
  private readonly tmpV = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();

  constructor(readonly level: LevelDef) {
    const { w, h, theme, nav } = level;
    this.rng = new Rng(level.index * 31 + 7);
    this.gw = w * CPU;
    this.gh = h * CPU;
    this.group.add(this.body);
    this.body.add(this.fx.group);

    // ---- the mask: R tall, G stripe tone, B baked shadow
    const n = this.gw * this.gh;
    this.state = new Uint8Array(n);
    this.hgt = new Float32Array(n);
    this.data = new Uint8Array(n * 4);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const k = j * this.gw + i;
        const x = (i + 0.5) / CPU - w / 2;
        const z = (j + 0.5) / CPU - h / 2;
        let st = 3;
        if (nav.playable(x, z) && !nav.solidAt(x, z, 0.03) && nav.coverable(x, z)) st = 0;
        this.state[k] = st;
        this.hgt[k] = st === 0 ? 1 : 0;
        this.data[k * 4] = st === 0 ? 255 : 0;
        this.data[k * 4 + 1] = st === 0 ? 140 : 110 + ((i + j) % 2) * 10;
        this.data[k * 4 + 3] = 255;
        if (st === 0) this.total++;
      }
    }
    this.bakeShadows();
    this.tex = new THREE.DataTexture(this.data, this.gw, this.gh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    const c = (hex: string) => new THREE.Color(hex);
    this.uniforms = {
      uMask: { value: this.tex },
      uSize: { value: new THREE.Vector2(w, h) },
      uTime: { value: 0 },
      uMower: { value: this.mowerU },
      uStub: { value: STUB },
      uH: { value: TALL },
      uBase: { value: c(theme.base) },
      uTipA: { value: c(theme.tipA) },
      uTipB: { value: c(theme.tipB) },
      uCutL: { value: c(theme.cutL) },
      uCutD: { value: c(theme.cutD) },
      uShade: { value: c(theme.id === 'dusk' ? '#5a5f9a' : '#6f8fb0') },
    };

    this.buildIsland();
    this.buildGrass();
    this.buildProps();
    this.flowerTotal = level.flowers.length;
    this.buildFlowers();
    this.coinTotal = level.coins.length;
    const cg = new THREE.CylinderGeometry(0.27, 0.27, 0.07, 24);
    cg.rotateX(Math.PI / 2);
    const ring = new THREE.TorusGeometry(0.21, 0.03, 6, 24);
    this.coinGeo = cg;
    this.coinMat = [new THREE.MeshLambertMaterial({ color: '#ffd23f', emissive: '#c68600', emissiveIntensity: 0.3, flatShading: true }), new THREE.MeshLambertMaterial({ color: '#fff3a8', emissive: '#e0b000', emissiveIntensity: 0.35, flatShading: true })];
    this.buildCoins(cg, ring);
    this.ambient = new Ambient(theme, w, h, level.index * 13 + 5);
    this.body.add(this.ambient.group);
  }

  get progress() {
    return this.total ? this.done / this.total : 1;
  }
  get coinsLeft() {
    return this.coinTotal - this.coinsGot;
  }

  // ------------------------------------------------------------------ building

  private cellIndex(x: number, z: number) {
    const i = Math.floor((x + this.level.w / 2) * CPU);
    const j = Math.floor((z + this.level.h / 2) * CPU);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return -1;
    return j * this.gw + i;
  }

  private bakeShadows() {
    const { w, h } = this.level;
    const sx = 0.64;
    const sz = -0.3;
    const paint = (cx: number, cz: number, rx: number, rz: number, strength: number, soft: number) => {
      const i0 = Math.max(0, Math.floor((cx - rx - 0.6 + w / 2) * CPU));
      const i1 = Math.min(this.gw - 1, Math.ceil((cx + rx + 0.6 + w / 2) * CPU));
      const j0 = Math.max(0, Math.floor((cz - rz - 0.6 + h / 2) * CPU));
      const j1 = Math.min(this.gh - 1, Math.ceil((cz + rz + 0.6 + h / 2) * CPU));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) / CPU - w / 2;
          const z = (j + 0.5) / CPU - h / 2;
          const d = Math.hypot((x - cx) / rx, (z - cz) / rz);
          const v = strength * (1 - smoothstep(1 - soft, 1, d));
          const k = (j * this.gw + i) * 4 + 2;
          const nv = Math.max(this.data[k], Math.round(v * 255));
          this.data[k] = nv;
        }
      }
    };
    for (const o of this.level.obstacles) {
      const s = o.shape;
      let cx: number, cz: number, rx: number, rz: number;
      if (s.t === 0) {
        cx = s.x;
        cz = s.z;
        rx = rz = s.r;
      } else {
        cx = (s.x0 + s.x1) / 2;
        cz = (s.z0 + s.z1) / 2;
        rx = (s.x1 - s.x0) / 2;
        rz = (s.z1 - s.z0) / 2;
      }
      if (o.kind === 'pond') continue;
      const len = o.height * 0.5;
      const big = o.kind === 'tree' ? o.size : 0;
      paint(cx + sx * len + (big ? sx * 0.4 : 0), cz + sz * len, rx * 1.0 + 0.2 + big * 0.7, rz * 0.9 + 0.2 + big * 0.55, o.kind === 'tree' ? 0.7 : 0.62, 0.7);
      paint(cx, cz, rx + 0.35, rz + 0.35, 0.35, 0.9);
    }
  }

  private buildIsland() {
    const { w, h, theme, tiles } = this.level;
    const tile = (i: number, j: number) => i >= 0 && j >= 0 && i < w && j < h && tiles[j * w + i] === 1;
    // top surface
    const top: number[] = [];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!tile(i, j)) continue;
        const x0 = i - w / 2;
        const z0 = j - h / 2;
        top.push(x0, 0, z0, x0, 0, z0 + 1, x0 + 1, 0, z0, x0 + 1, 0, z0, x0, 0, z0 + 1, x0 + 1, 0, z0 + 1);
      }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    const gm = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: GROUND_VS, fragmentShader: GROUND_FS });
    const ground = new THREE.Mesh(tg, gm);
    ground.frustumCulled = false;
    this.body.add(ground);

    // walls: grass lip, then strata of soil and stone fading into the mist
    const D = 1.5;
    const bands = [
      { y: 0, c: new THREE.Color(theme.cutD).multiplyScalar(0.8) },
      { y: -0.1, c: new THREE.Color(theme.soil[0]) },
      { y: -0.42, c: new THREE.Color(theme.soil[1]) },
      { y: -0.66, c: new THREE.Color(theme.soil[2]) },
      { y: -0.92, c: new THREE.Color(theme.soil[3]) },
      { y: -D, c: new THREE.Color(theme.skyBottom) },
    ];
    const pos: number[] = [];
    const col: number[] = [];
    const nor: number[] = [];
    const quad = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number) => {
      for (let k = 0; k < bands.length - 1; k++) {
        const y0 = bands[k].y;
        const y1 = bands[k + 1].y;
        const c0 = bands[k].c;
        const c1 = k === bands.length - 2 ? bands[k + 1].c : bands[k].c;
        const v = [
          [ax, y0, az, c0],
          [bx, y0, bz, c0],
          [ax, y1, az, c1],
          [bx, y0, bz, c0],
          [bx, y1, bz, c1],
          [ax, y1, az, c1],
        ] as const;
        for (const [x, y, z, cc] of v) {
          pos.push(x, y, z);
          col.push(cc.r, cc.g, cc.b);
          nor.push(nx, 0, nz);
        }
      }
    };
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!tile(i, j)) continue;
        const x0 = i - w / 2;
        const z0 = j - h / 2;
        if (!tile(i, j + 1)) quad(x1(x0), z0 + 1, x0, z0 + 1, 0, 1);
        if (!tile(i, j - 1)) quad(x0, z0, x1(x0), z0, 0, -1);
        if (!tile(i - 1, j)) quad(x0, z0 + 1, x0, z0, -1, 0);
        if (!tile(i + 1, j)) quad(x1(x0), z0, x1(x0), z0 + 1, 1, 0);
      }
    }
    function x1(a: number) {
      return a + 1;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    wg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    const walls = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.body.add(walls);
  }

  private buildGrass() {
    const { w, h, nav } = this.level;
    const rng = new Rng(this.level.index * 977 + 3);
    const geo = bladeGeometry(rng);
    const data: number[] = [];
    const rnd: number[] = [];
    const per = DENSITY;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!nav.tile(i, j)) continue;
        for (let b = 0; b < per; b++) {
          for (let a = 0; a < per; a++) {
            const x = i - w / 2 + (a + rng.range(0.05, 0.95)) / per;
            const z = j - h / 2 + (b + rng.range(0.05, 0.95)) / per;
            if (nav.solidAt(x, z, 0.04)) continue;
            data.push(x, z, rng.range(0, Math.PI * 2));
            rnd.push(rng.next(), rng.next(), rng.next(), rng.next());
          }
        }
      }
    }
    const count = data.length / 3;
    (geo as THREE.InstancedBufferGeometry).instanceCount = count;
    geo.setAttribute('iData', new THREE.InstancedBufferAttribute(new Float32Array(data), 3));
    geo.setAttribute('iRnd', new THREE.InstancedBufferAttribute(new Float32Array(rnd), 4));
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: BLADE_VS, fragmentShader: BLADE_FS, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.body.add(mesh);
  }

  private buildProps() {
    for (const o of this.level.obstacles) {
      const p = buildProp(o, this.level.theme, this.waterTime);
      this.props.push(p);
      this.body.add(p.group);
    }
  }

  private buildFlowers() {
    const fl = this.level.flowers;
    const n = Math.max(1, fl.length);
    this.flowerHeads = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.085, 0), new THREE.MeshLambertMaterial({ flatShading: true }), n);
    this.flowerStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.016, 1, 4), new THREE.MeshLambertMaterial({ color: '#3f9f45', flatShading: true }), n);
    const c = new THREE.Color();
    const m = this.m4;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      m.makeTranslation(f.x, f.h, f.z);
      m.scale(this.tmpV.set(1, 0.8, 1));
      this.flowerHeads.setMatrixAt(i, m);
      this.flowerHeads.setColorAt(i, c.set(f.color));
      m.makeScale(1, f.h, 1);
      m.setPosition(f.x, f.h / 2, f.z);
      this.flowerStems.setMatrixAt(i, m);
      this.flowerAlive.push(true);
      this.flowerCell.push(this.cellIndex(f.x, f.z));
    }
    if (!fl.length) {
      this.flowerHeads.count = 0;
      this.flowerStems.count = 0;
    }
    this.flowerHeads.frustumCulled = false;
    this.flowerStems.frustumCulled = false;
    this.body.add(this.flowerHeads, this.flowerStems);
  }

  private buildCoins(disc: THREE.BufferGeometry, ring: THREE.BufferGeometry) {
    for (const cd of this.level.coins) {
      const g = new THREE.Group();
      const a = new THREE.Mesh(disc, this.coinMat[0]);
      const b = new THREE.Mesh(ring, this.coinMat[1]);
      b.position.z = 0.04;
      g.add(a, b);
      g.position.set(cd.x, 0.7, cd.z);
      this.body.add(g);
      this.coins.push({ x: cd.x, z: cd.z, g, phase: this.rng.range(0, 6.28), state: 0, t: 0, y: 0.7, home: 0.7 });
    }
  }

  // ------------------------------------------------------------------ cutting

  /** Stripe tone for a heading: which way the grass lies as seen from the camera. */
  private tone(h: number, v: View) {
    const dx = Math.sin(h);
    const dz = Math.cos(h);
    const s = dx * v.fx + dz * v.fz + 0.3 * (dx * v.rx + dz * v.rz);
    return Math.round(smoothstep(-0.22, 0.22, s) * 255);
  }

  private stampRect(x: number, z: number, hd: number, halfW: number, halfL: number, tone: number, newCells: number[]) {
    const { w, h } = this.level;
    const fx = Math.sin(hd);
    const fz = Math.cos(hd);
    const rx = Math.cos(hd);
    const rz = -Math.sin(hd);
    const ex = halfW * Math.abs(rx) + halfL * Math.abs(fx);
    const ez = halfW * Math.abs(rz) + halfL * Math.abs(fz);
    const i0 = Math.max(0, Math.floor((x - ex + w / 2) * CPU));
    const i1 = Math.min(this.gw - 1, Math.floor((x + ex + w / 2) * CPU));
    const j0 = Math.max(0, Math.floor((z - ez + h / 2) * CPU));
    const j1 = Math.min(this.gh - 1, Math.floor((z + ez + h / 2) * CPU));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.gw + i;
        const st = this.state[k];
        if (st === 3) continue;
        const dx = (i + 0.5) / CPU - w / 2 - x;
        const dz = (j + 0.5) / CPU - h / 2 - z;
        const u = dx * rx + dz * rz;
        const v = dx * fx + dz * fz;
        if (u > halfW || u < -halfW || v > halfL || v < -halfL) continue;
        this.data[k * 4 + 1] = tone;
        this.dirty = true;
        if (st === 0) {
          this.state[k] = 1;
          this.active.push(k);
          this.done++;
          newCells.push(k);
        }
      }
    }
  }

  private cutSweep(m: Mower, view: View, newCells: number[]) {
    const d = m.deck();
    const cur = { x: d.x, z: d.z, h: m.heading };
    const prev = this.last ?? cur;
    const dist = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const steps = Math.max(1, Math.ceil(dist / 0.05));
    const tone = this.tone(m.heading, view);
    const dh = Math.atan2(Math.sin(cur.h - prev.h), Math.cos(cur.h - prev.h));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      this.stampRect(lerp(prev.x, cur.x, t), lerp(prev.z, cur.z, t), prev.h + dh * t, m.width / 2, 0.3, tone, newCells);
    }
    this.last = cur;
  }

  /** Cells where the cutter just worked, as world positions (for clippings). */
  private cellPos(k: number, out: THREE.Vector3) {
    const i = k % this.gw;
    const j = (k / this.gw) | 0;
    return out.set((i + 0.5) / CPU - this.level.w / 2, 0.08, (j + 0.5) / CPU - this.level.h / 2);
  }

  startFinish(m: Mower) {
    if (this.finishing) return;
    this.finishing = true;
    this.finishOrigin = { x: m.x, z: m.z };
    const list: { k: number; d: number }[] = [];
    for (let k = 0; k < this.state.length; k++) {
      if (this.state[k] !== 0) continue;
      const p = this.cellPos(k, this.tmpV);
      list.push({ k, d: Math.hypot(p.x - m.x, p.z - m.z) });
    }
    list.sort((a, b) => a.d - b.d);
    this.finishList = list.map((e) => e.k);
    this.finishPtr = 0;
    this.finishR = 0;
    this.finishDelay = 0.25;
    this.nextMilestone = 1000;
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, m: Mower, view: View, setup: { magnet: number; active?: boolean }) {
    this.time += dt;
    const { h } = this.level;
    this.uniforms.uTime.value = this.time;
    this.waterTime.value = this.time;
    const live = !this.finished && setup.active !== false;
    this.mowerU.set(m.x, m.z, m.width * 0.5);

    const newCells: number[] = [];
    if (live && !this.finishing) {
      this.cutSweep(m, view, newCells);
    } else {
      this.last = null;
    }

    // the ripple that finishes whatever is left, with the classic mowing stripes
    if (this.finishing && !this.finished) {
      if (this.finishDelay > 0) this.finishDelay -= dt;
      else {
        this.finishR += dt * 15;
        let n = 0;
        while (this.finishPtr < this.finishList.length) {
          const k = this.finishList[this.finishPtr];
          const p = this.cellPos(k, this.tmpV);
          if (Math.hypot(p.x - this.finishOrigin.x, p.z - this.finishOrigin.z) > this.finishR) break;
          this.finishPtr++;
          if (this.state[k] !== 0) continue;
          this.state[k] = 1;
          this.active.push(k);
          this.done++;
          this.data[k * 4 + 1] = (Math.floor((p.z + h / 2) / 0.9) & 1) * 255;
          this.dirty = true;
          if (n++ < 40) newCells.push(k);
        }
        if (this.finishPtr >= this.finishList.length && this.active.length === 0) {
          this.finished = true;
          this.events.finished?.();
        }
      }
    }

    // grass folds down over a tenth of a second
    if (this.active.length) {
      for (let a = this.active.length - 1; a >= 0; a--) {
        const k = this.active[a];
        let v = this.hgt[k] - dt * 9;
        if (v <= 0) {
          v = 0;
          this.state[k] = 2;
          this.active[a] = this.active[this.active.length - 1];
          this.active.pop();
        }
        this.hgt[k] = v;
        this.data[k * 4] = Math.round(v * v * 255);
      }
      this.dirty = true;
    }

    // clippings from the chute and the cut
    if (newCells.length) {
      const f = m.forward();
      const rx = Math.cos(m.heading);
      const rz = -Math.sin(m.heading);
      const take = this.finishing ? newCells.length : Math.min(newCells.length, 5);
      const tint = [this.level.theme.tipA, this.level.theme.tipB, this.level.theme.cutL];
      for (let n = 0; n < take; n++) {
        const k = newCells[(Math.random() * newCells.length) | 0];
        const p = this.cellPos(k, this.tmpV);
        const up = 1.4 + Math.random() * 2.2;
        const side = this.finishing ? (Math.random() - 0.5) * 1.5 : 0.5 + Math.random() * 1.4;
        this.fx.clipping({
          x: p.x, y: 0.12, z: p.z,
          vx: rx * side + f.x * m.speed * 0.3 + (Math.random() - 0.5) * 0.7,
          vy: up,
          vz: rz * side + f.z * m.speed * 0.3 + (Math.random() - 0.5) * 0.7,
          color: tint[(Math.random() * tint.length) | 0],
        });
      }
    }
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }

    // flowers pop as the blades reach them
    for (let i = 0; i < this.flowerAlive.length; i++) {
      if (!this.flowerAlive[i]) continue;
      const k = this.flowerCell[i];
      if (k >= 0 && this.state[k] !== 0) {
        this.flowerAlive[i] = false;
        const f = this.level.flowers[i];
        this.m4.makeScale(0, 0, 0);
        this.flowerHeads.setMatrixAt(i, this.m4);
        this.flowerStems.setMatrixAt(i, this.m4);
        this.flowerHeads.instanceMatrix.needsUpdate = true;
        this.flowerStems.instanceMatrix.needsUpdate = true;
        this.flowersGot++;
        for (let q = 0; q < 6; q++) {
          const a = Math.random() * Math.PI * 2;
          this.fx.petal({ x: f.x, y: f.h, z: f.z, vx: Math.cos(a) * 1.1, vy: 1.6 + Math.random() * 1.4, vz: Math.sin(a) * 1.1, color: f.color });
        }
        this.events.flower?.(f.x, f.z, f.color);
      }
    }

    // coins: float over the long grass, settle as it is cut, swoon into the mower
    for (const c of this.coins) {
      const k = this.cellIndex(c.x, c.z);
      const tallHere = k >= 0 && this.state[k] === 0 ? 1 : 0;
      c.home = 0.3 + 0.36 * tallHere;
      if (c.state === 0) {
        c.y = damp(c.y, c.home, 6, dt);
        c.g.position.set(c.x, c.y + Math.sin(this.time * 2.4 + c.phase) * 0.04, c.z);
        c.g.rotation.y += dt * 2.2;
        const d = Math.hypot(m.x - c.x, m.z - c.z);
        if (live && d < setup.magnet) {
          const pull = (1 - d / setup.magnet) * 7 * dt + (d < 1.2 ? 4 * dt : 0);
          c.x += ((m.x - c.x) / Math.max(d, 0.01)) * pull * Math.max(0.2, d);
          c.z += ((m.z - c.z) / Math.max(d, 0.01)) * pull * Math.max(0.2, d);
        }
        if (live && d < 0.58) {
          c.state = 1;
          c.t = 0;
          this.coinsGot++;
          this.events.coin?.(c.x, c.z);
          for (let q = 0; q < 8; q++) {
            const a = (q / 8) * Math.PI * 2;
            this.fx.spark({ x: c.x, y: c.y + 0.15, z: c.z, vx: Math.cos(a) * 1.6, vy: 0.9 + Math.random() * 0.8, vz: Math.sin(a) * 1.6, life: 0.5 });
          }
        }
      } else {
        c.t += dt;
        const t = Math.min(1, c.t / 0.32);
        c.g.position.set(lerp(c.x, m.x, t * 0.5), c.y + t * 0.9, lerp(c.z, m.z, t * 0.5));
        c.g.rotation.y += dt * 18;
        c.g.scale.setScalar(Math.max(0, 1 + Math.sin(t * Math.PI) * 0.5 - t * t * 1.1));
        if (t >= 1) c.g.visible = false;
      }
    }

    // trees fade when the mower is hidden behind them
    for (const p of this.props) {
      p.update?.(this.time, dt);
      if (p.canopy) {
        const dx = m.x - p.canopy.x;
        const dz = m.z - p.canopy.z;
        const along = dx * view.fx + dz * view.fz;
        const across = dx * view.rx + dz * view.rz;
        const hid = along > -0.4 && along < 3.6 && Math.abs(across) < p.canopy.r * 0.95;
        const target = hid ? 0.22 : 1;
        const cur = p.canopy.mats[0].opacity;
        const v = damp(cur, target, 9, dt);
        for (const mat of p.canopy.mats) mat.opacity = v;
      }
    }

    // milestones
    const pct = this.progress * 100;
    if (pct >= this.nextMilestone && this.nextMilestone < 100) {
      this.events.milestone?.(this.nextMilestone);
      this.nextMilestone += 25;
    }

    this.ambient.setCamera(view.cam.quaternion);
    this.ambient.update(this.time, dt);
    this.fx.update(dt, view.cam);
  }

  /** The nearest bit of long grass to a point (sampled coarsely), for the nudge arrow. */
  nearestUncut(x: number, z: number, heading?: number): { x: number; z: number } | null {
    let best = 1e9;
    let bk = -1;
    const step = 4;
    const fx = heading === undefined ? 0 : Math.sin(heading);
    const fz = heading === undefined ? 0 : Math.cos(heading);
    for (let j = 0; j < this.gh; j += step) {
      for (let i = 0; i < this.gw; i += step) {
        const k = j * this.gw + i;
        if (this.state[k] !== 0) continue;
        const px = (i + 0.5) / CPU - this.level.w / 2;
        const pz = (j + 0.5) / CPU - this.level.h / 2;
        const dx = px - x;
        const dz = pz - z;
        let d = Math.hypot(dx, dz);
        // with a heading, prefer what is ahead: a mower can't turn on a coin
        if (heading !== undefined && d > 0.01) d *= 1 + 0.9 * (1 - (dx * fx + dz * fz) / d);
        if (d < best) {
          best = d;
          bk = k;
        }
      }
    }
    if (bk < 0) return null;
    const p = this.cellPos(bk, this.tmpV);
    return { x: p.x, z: p.z };
  }

  /** Catch the mower if it hit something this frame (called by the game). */
  bump(impact: number, x: number, z: number) {
    this.events.bump?.(impact, x, z);
  }

  dispose() {
    disposeTree(this.group);
    this.tex.dispose();
    this.ambient.dispose();
    this.coinGeo.dispose();
    this.coinMat.forEach((m) => m.dispose());
  }
}
