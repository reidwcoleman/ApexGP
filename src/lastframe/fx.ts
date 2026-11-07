import * as THREE from 'three';
import { LF, applyLF } from './lighting.ts';
import type { Phys } from './physics.ts';

/**
 * Everything a shot leaves behind. Two layers: what stands in the world (holes, brass, glass, the flash)
 * is drawn with the scene; what hangs in the air (smoke, dust, sparks, rain) goes to a half-size buffer
 * of its own in Post, tested against the scene's depth by hand so it can fade where it meets a wall
 * instead of slicing through it. Smoke and rain take their light from the baked volume, so they glow
 * under a lamp and go dark in a corner.
 */

function canvasTex(size: number, paint: (c: CanvasRenderingContext2D, s: number) => void, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  paint(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** four kinds of puff in a 2x2 sheet: a soft edge eaten by noise */
function puffSheet() {
  const S = 256, H = S / 2;
  const data = new Uint8Array(S * S * 4);
  const grad = (ix: number, iy: number, seed: number) => {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453;
    const a = (n - Math.floor(n)) * 6.2832;
    return [Math.cos(a), Math.sin(a)];
  };
  const noise = (x: number, y: number, seed: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const d = (i: number, j: number) => {
      const g = grad(ix + i, iy + j, seed);
      return g[0] * (fx - i) + g[1] * (fy - j);
    };
    const a = d(0, 0) + (d(1, 0) - d(0, 0)) * u, b = d(0, 1) + (d(1, 1) - d(0, 1)) * u;
    return a + (b - a) * v;
  };
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * H, oy = (k >> 1) * H;
    for (let j = 0; j < H; j++) for (let i = 0; i < H; i++) {
      const x = (i + 0.5) / H - 0.5, y = (j + 0.5) / H - 0.5;
      const r = Math.hypot(x, y) * 2;
      let f = 0, a = 0.5, s = 3.2;
      for (let o = 0; o < 5; o++) {
        f += noise(x * s + k * 9, y * s + k * 5, k + o * 3) * a;
        a *= 0.55;
        s *= 2.05;
      }
      const edge = 1 - r + f * 0.95;
      const v = Math.max(0, Math.min(1, edge * 1.9)) ** 1.4 * (0.62 + 0.38 * Math.max(0, Math.min(1, 0.5 + f * 1.5)));
      data[((j + oy) * S + i + ox) * 4] = v * 255;
      data[((j + oy) * S + i + ox) * 4 + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export const AIR = {
  tDepth: { value: null as THREE.Texture | null },
  inv: { value: new THREE.Vector2() },
  nf: { value: new THREE.Vector2(0.05, 900) },
  /** the muzzle or the blast, lighting the smoke round it */
  spark: { value: new THREE.Vector4(0, -99, 0, 0) },
  /** the flashlight, for smoke drifting through the beam */
  beamP: { value: new THREE.Vector4(0, -99, 0, 0) },
  beamD: { value: new THREE.Vector3(0, 0, -1) },
};

const AIR_PARS = /* glsl */ `
uniform highp sampler3D lfVolAvg;
uniform vec3 lfVolMin;
uniform vec3 lfVolInv;
uniform vec2 lfK;
uniform vec4 spark;
uniform vec4 beamP;
uniform vec3 beamD;
vec3 airLight( vec3 p ) {
  vec3 e = texture( lfVolAvg, ( p - lfVolMin ) * lfVolInv ).rgb;
  vec3 c = ( exp2( e * lfK.x ) - 1.0 ) / lfK.y;
  vec3 d = p - spark.xyz;
  c += vec3( 1.0, 0.68, 0.38 ) * spark.w / ( dot( d, d ) + 0.5 );
  vec3 b = p - beamP.xyz;
  float bl = length( b ) + 1e-3;
  c += vec3( 1.0, 0.93, 0.82 ) * beamP.w * smoothstep( 0.8, 0.93, dot( b / bl, beamD ) ) / ( bl * bl + 0.6 );
  return c;
}
`;
const PVS = /* glsl */ `
attribute float aSize; attribute float aAlpha; attribute vec3 aCol; attribute float aRot;
varying float vA; varying vec3 vC; varying float vZ; varying vec2 vRot; varying float vCell;
uniform float scale;
uniform float lit;
${AIR_PARS}
void main(){
  vA = aAlpha;
  vec3 c = aCol;
  if ( lit > 0.5 ) c *= airLight( position ) * 0.8;
  vC = c;
  vec4 mv = modelViewMatrix * vec4( position, 1. );
  vZ = -mv.z;
  vRot = vec2( cos( aRot ), sin( aRot ) );
  vCell = floor( fract( aRot * 0.37 ) * 3.999 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = min( 300., aSize * scale / max( .1, -mv.z ) );
}
`;
const PFS = /* glsl */ `
varying float vA; varying vec3 vC; varying float vZ; varying vec2 vRot; varying float vCell;
uniform sampler2D tPuff;
uniform sampler2D tDepth;
uniform vec2 inv;
uniform vec2 nf;
uniform float lit;
uniform float soft;
void main(){
  float a;
  vec2 p = gl_PointCoord - .5;
  if ( lit > 0.5 ) {
    vec2 q = vec2( p.x * vRot.x - p.y * vRot.y, p.x * vRot.y + p.y * vRot.x );
    if ( dot( q, q ) > .25 ) discard;
    vec2 uv = ( q + .5 ) * .5 + vec2( mod( vCell, 2. ), floor( vCell * .5 ) ) * .5;
    a = texture2D( tPuff, uv ).r;
  } else {
    a = smoothstep( 1., .1, length( p ) * 2. );
  }
  float d = texture2D( tDepth, gl_FragCoord.xy * inv ).r;
  float z = nf.x * nf.y / ( nf.y - d * ( nf.y - nf.x ) );
  a *= clamp( ( z - vZ ) / soft, 0., 1. ) * clamp( ( vZ - 0.1 ) * 3., 0., 1. );
  a *= vA;
  if ( a < .002 ) discard;
  // premultiplied: smoke hides what's behind it, sparks only add
  gl_FragColor = vec4( vC * a, lit > 0.5 ? a : 0. );
}
`;

const BLEND = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;

class Pool {
  readonly geo = new THREE.BufferGeometry();
  private pos: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private col: Float32Array;
  private rot: Float32Array;
  private v: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grow: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private a0: Float32Array;
  private i = 0;
  readonly points: THREE.Points;
  readonly mat: THREE.ShaderMaterial;
  constructor(readonly cap: number, lit: boolean, puff: THREE.Texture) {
    this.pos = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.col = new Float32Array(cap * 3);
    this.rot = new Float32Array(cap);
    this.v = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false, depthTest: false, ...BLEND,
      uniforms: {
        scale: { value: 800 }, lit: { value: lit ? 1 : 0 }, soft: { value: lit ? 0.45 : 0.05 }, tPuff: { value: puff }, tDepth: AIR.tDepth, inv: AIR.inv, nf: AIR.nf,
        lfVolAvg: LF.volAvg, lfVolMin: LF.volMin, lfVolInv: LF.volInv, lfK: LF.lmK, spark: AIR.spark, beamP: AIR.beamP, beamD: AIR.beamD,
      },
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, r: number, g: number, b: number, a: number, grav: number, drag = 2.2) {
    const i = (this.i = (this.i + 1) % this.cap);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = this.max[i] = life;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.a0[i] = a;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.rot[i] = Math.random() * 6.2832;
  }
  update(dt: number) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      const dr = Math.exp(-dt * this.drag[i]);
      this.v[i * 3] *= dr;
      this.v[i * 3 + 2] *= dr;
      this.pos[i * 3] += this.v[i * 3] * dt;
      this.pos[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt * (0.25 + k);
      this.rot[i] += dt * 0.35 * (i % 2 ? 1 : -1);
      // in, then a long fade
      this.alpha[i] = this.a0[i] * Math.min(1, (1 - k) * 14) * (k * k * (3 - 2 * k));
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aCol', 'aRot']) (this.geo.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** what a round knocks out of a surface: dust albedo, how much, chip colour, chips, sparks */
const SURF: Record<string, { dust: [number, number, number]; n: number; puff: number; chip: [number, number, number]; chips: number; sparks: number; cell: number; size: number }> = {
  stone: { dust: [0.34, 0.31, 0.28], n: 8, puff: 1, chip: [0.22, 0.2, 0.18], chips: 7, sparks: 3, cell: 0, size: 0.1 },
  plaster: { dust: [0.6, 0.58, 0.53], n: 8, puff: 1.15, chip: [0.6, 0.58, 0.52], chips: 9, sparks: 0, cell: 1, size: 0.13 },
  wood: { dust: [0.36, 0.25, 0.15], n: 6, puff: 0.8, chip: [0.34, 0.22, 0.12], chips: 11, sparks: 0, cell: 2, size: 0.1 },
  metal: { dust: [0.12, 0.12, 0.12], n: 3, puff: 0.45, chip: [0.16, 0.16, 0.17], chips: 2, sparks: 14, cell: 3, size: 0.07 },
  glass: { dust: [0.5, 0.52, 0.55], n: 3, puff: 0.5, chip: [0.45, 0.5, 0.52], chips: 0, sparks: 0, cell: 7, size: 0.2 },
  flesh: { dust: [0.16, 0.012, 0.01], n: 7, puff: 0.5, chip: [0.1, 0.01, 0.01], chips: 0, sparks: 0, cell: 4, size: 0.42 },
  card: { dust: [0.5, 0.42, 0.3], n: 7, puff: 1.2, chip: [0.45, 0.36, 0.24], chips: 8, sparks: 0, cell: 1, size: 0 },
  plastic: { dust: [0.3, 0.3, 0.3], n: 3, puff: 0.6, chip: [0.1, 0.1, 0.1], chips: 5, sparks: 0, cell: 1, size: 0 },
  bag: { dust: [0.14, 0.14, 0.14], n: 5, puff: 0.9, chip: [0.05, 0.05, 0.05], chips: 3, sparks: 0, cell: 1, size: 0 },
  rubber: { dust: [0.1, 0.1, 0.1], n: 4, puff: 0.7, chip: [0.03, 0.03, 0.03], chips: 3, sparks: 0, cell: 1, size: 0 },
};

/** eight marks on white: drawn multiplied, so a hole is as dark as the wall it's in under any lamp */
function marks() {
  return canvasTex(1024, (c, s) => {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, s, s);
    const h = s / 4;
    const cellAt = (k: number): [number, number] => [(k % 4) * h + h / 2, Math.floor(k / 4) * h + h / 2 + s / 2 * 0];
    const hole = (cx: number, cy: number, r: number, rim: string, cracks: number, crackC: string) => {
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * 6.28, d = r * (1.2 + Math.random() * 1.6), q = r * (0.08 + Math.random() * 0.22);
        c.fillStyle = rim;
        c.beginPath();
        c.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, q, 0, 6.28);
        c.fill();
      }
      c.strokeStyle = crackC;
      for (let i = 0; i < cracks; i++) {
        let a = Math.random() * 6.28, x = cx + Math.cos(a) * r * 0.7, y = cy + Math.sin(a) * r * 0.7;
        c.lineWidth = 1 + Math.random() * 2;
        c.beginPath();
        c.moveTo(x, y);
        const n = 3 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) {
          a += (Math.random() - 0.5) * 0.9;
          const l = r * (0.3 + Math.random() * 0.5);
          x += Math.cos(a) * l;
          y += Math.sin(a) * l;
          c.lineTo(x, y);
        }
        c.stroke();
      }
      const g = c.createRadialGradient(cx, cy, r * 0.25, cx, cy, r * 1.05);
      g.addColorStop(0, 'rgb(6,6,7)');
      g.addColorStop(0.62, 'rgb(14,13,13)');
      g.addColorStop(0.86, 'rgba(70,66,62,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath();
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * 6.2832, rr = r * (0.92 + Math.random() * 0.26);
        c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      c.fill();
    };
    const R = h * 0.17;
    let p = cellAt(0);
    hole(p[0], p[1], R, 'rgba(90,86,80,0.5)', 7, 'rgba(25,24,22,0.7)');
    p = cellAt(1);
    hole(p[0], p[1], R * 0.85, 'rgba(120,116,108,0.42)', 9, 'rgba(50,48,44,0.6)');
    p = cellAt(2);
    {
      // torn wood: splinters along the grain
      const [cx, cy] = p;
      c.strokeStyle = 'rgba(40,26,14,0.75)';
      for (let i = 0; i < 26; i++) {
        const x = cx + (Math.random() - 0.5) * R * 1.8, y = cy + (Math.random() - 0.5) * R * 2.2, l = R * (0.6 + Math.random() * 1.7);
        c.lineWidth = 1 + Math.random() * 2.6;
        c.beginPath();
        c.moveTo(x, y - l);
        c.lineTo(x + (Math.random() - 0.5) * 6, y + l);
        c.stroke();
      }
      hole(cx, cy, R * 0.68, 'rgba(120,90,60,0.4)', 2, 'rgba(25,16,10,0.8)');
    }
    p = cellAt(3);
    {
      const [cx, cy] = p;
      const g = c.createRadialGradient(cx, cy, 2, cx, cy, R * 1.9);
      g.addColorStop(0, 'rgb(30,30,32)');
      g.addColorStop(0.3, 'rgb(90,90,94)');
      g.addColorStop(0.6, 'rgba(120,118,116,0.7)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(cx - h / 2, cy - h / 2, h, h);
      hole(cx, cy, R * 0.5, 'rgba(70,70,72,0.3)', 0, '#000');
    }
    p = cellAt(4);
    for (let i = 0; i < 150; i++) {
      const [cx, cy] = p;
      const a = Math.random() * 6.28, r = Math.pow(Math.random(), 1.9) * h * 0.46, sz = Math.random() ** 2 * 11 + 0.8;
      c.fillStyle = `rgba(${70 + Math.random() * 44},${6 + Math.random() * 6},${8 + Math.random() * 6},${0.5 + Math.random() * 0.45})`;
      c.beginPath();
      c.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz, sz * (0.5 + Math.random() * 0.5), a, 0, 6.28);
      c.fill();
    }
    p = cellAt(5);
    {
      const [cx, cy] = p;
      c.fillStyle = 'rgb(62,6,8)';
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * 6.2832, rr = h * (0.28 + 0.1 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 7) + Math.random() * 0.012);
        c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      c.fill();
    }
    p = cellAt(6);
    {
      const [cx, cy] = p;
      const g = c.createRadialGradient(cx, cy, h * 0.03, cx, cy, h * 0.49);
      g.addColorStop(0, 'rgb(12,12,12)');
      g.addColorStop(0.5, 'rgb(46,44,42)');
      g.addColorStop(0.8, 'rgba(120,116,112,0.6)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(cx - h / 2, cy - h / 2, h, h);
      c.strokeStyle = 'rgba(16,15,14,0.8)';
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * 6.28, l = h * (0.22 + Math.random() * 0.26);
        c.lineWidth = 1 + Math.random() * 3;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * h * 0.1, cy + Math.sin(a) * h * 0.1);
        c.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l);
        c.stroke();
      }
    }
    p = cellAt(7);
    hole(p[0], p[1], R * 0.4, 'rgba(120,130,135,0.3)', 14, 'rgba(90,100,105,0.8)');
  });
}

const CELLS_V = 4;

interface Chip { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; wx: number; wy: number; life: number; floor: number; s: number; bounced: boolean; long: boolean }
interface Line { ax: number; ay: number; az: number; dx: number; dy: number; dz: number; len: number; at: number; life: number }

export class Fx {
  /** in the world, drawn with the scene */
  readonly group = new THREE.Group();
  /** in the air, drawn by Post into its own layer */
  readonly air = new THREE.Scene();
  private soft: Pool;
  private glow: Pool;
  private decals: THREE.InstancedMesh;
  private dI = 0;
  private DM = 700;
  private markMat: THREE.MeshBasicMaterial;
  private tracer: THREE.LineSegments;
  private tPos = new Float32Array(48 * 6);
  private tl: Line[] = [];
  private tI = 0;
  private flash: THREE.Mesh[] = [];
  private flashT = 0;
  private shells: THREE.InstancedMesh;
  private shellScale: number[] = [];
  private shards: THREE.InstancedMesh;
  private chips: THREE.InstancedMesh;
  private chipList: Chip[] = [];
  private cI = 0;
  private CM = 220;
  private rain: THREE.LineSegments;
  private rainU = { cam: { value: new THREE.Vector3() }, time: { value: 0 }, roofs: { value: [] as THREE.Vector4[] }, k: { value: 1 }, tDepth: AIR.tDepth, inv: AIR.inv, nf: AIR.nf, lfVolAvg: LF.volAvg, lfVolMin: LF.volMin, lfVolInv: LF.volInv, lfK: LF.lmK, spark: AIR.spark, beamP: AIR.beamP, beamD: AIR.beamD };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private z = new THREE.Vector3(0, 0, 1);
  private e = new THREE.Euler();
  private c = new THREE.Color();
  private splashAcc = 0;
  groundAt: (x: number, y: number, z: number) => number = () => 0;
  /** is there open sky over this point */
  outside: (x: number, z: number) => boolean = () => true;

  constructor(roofs: THREE.Vector4[], private phys: Phys, glassMat: THREE.Material) {
    const puff = puffSheet();
    this.soft = new Pool(900, true, puff);
    this.glow = new Pool(500, false, puff);
    this.air.add(this.soft.points, this.glow.points);
    // ---- marks
    const dg = new THREE.PlaneGeometry(1, 1);
    dg.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(this.DM), 1));
    const dm = (this.markMat = new THREE.MeshBasicMaterial({
      map: marks(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    }));
    dm.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;').replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv = vec2( ( uv.x + mod( aCell, 4.0 ) ) * 0.25, ( uv.y + ${CELLS_V - 1}.0 - floor( aCell / 4.0 ) ) * ${1 / CELLS_V} );`);
    };
    dm.customProgramCacheKey = () => 'lfmark';
    this.decals = new THREE.InstancedMesh(dg, dm, this.DM);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 3;
    this.group.add(this.decals);
    // ---- tracers
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracer = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: new THREE.Color(14, 9.5, 4.5), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracer.frustumCulled = false;
    this.group.add(this.tracer);
    for (let i = 0; i < 48; i++) this.tl.push({ ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 0, len: 0, at: 0, life: 0 });
    // ---- the flash: crossed cards, redrawn at random each shot
    const star = canvasTex(256, (c, s) => {
      c.clearRect(0, 0, s, s);
      c.translate(s / 2, s / 2);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.48);
      g.addColorStop(0, 'rgba(255,244,214,1)');
      g.addColorStop(0.22, 'rgba(255,182,86,0.92)');
      g.addColorStop(0.6, 'rgba(255,110,30,0.35)');
      g.addColorStop(1, 'rgba(255,90,10,0)');
      c.fillStyle = g;
      for (let i = 0; i < 9; i++) {
        c.rotate((Math.PI * 2) / 9 + Math.random() * 0.3);
        c.beginPath();
        c.moveTo(-s * 0.05, 0);
        c.lineTo(Math.random() * s * 0.04, -s * (0.22 + Math.random() * 0.26));
        c.lineTo(s * 0.05, 0);
        c.fill();
      }
      c.beginPath();
      c.arc(0, 0, s * 0.13, 0, 6.28);
      c.fill();
    });
    const fm = new THREE.MeshBasicMaterial({ map: star, color: new THREE.Color(22, 16, 11), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
      p.visible = false;
      p.renderOrder = 7;
      p.frustumCulled = false;
      this.flash.push(p);
      this.group.add(p);
    }
    // ---- brass: turned, with a rim and a neck, on the physics pool
    const lathe = new THREE.LatheGeometry([[0.0, -0.019], [0.0048, -0.019], [0.0052, -0.0175], [0.0046, -0.016], [0.0049, -0.015], [0.0049, 0.009], [0.0034, 0.014], [0.0034, 0.019], [0.0, 0.019]].map(([x, y]) => new THREE.Vector2(x, y)), 8);
    this.shells = new THREE.InstancedMesh(lathe, applyLF(new THREE.MeshStandardMaterial({ color: 0xc09a4a, metalness: 1, roughness: 0.32 })), phys.brass.length);
    this.shells.frustumCulled = false;
    this.shells.count = phys.brass.length;
    this.group.add(this.shells);
    this.m.makeTranslation(0, -60, 0);
    for (let i = 0; i < phys.brass.length; i++) {
      this.shells.setMatrixAt(i, this.m);
      this.shellScale.push(1);
    }
    // ---- glass in the air: thin triangles
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.4, 0, -0.1, 0.6, 0, -0.5, -0.5, 0, -0.1, 0.6, 0, 0.5, -0.4, 0], 3));
    tri.computeVertexNormals();
    this.shards = new THREE.InstancedMesh(tri, glassMat, phys.shards.length);
    this.shards.frustumCulled = false;
    this.shards.renderOrder = 5;
    this.group.add(this.shards);
    // ---- chips: little boxes that bounce once or twice and go
    const cg = new THREE.BoxGeometry(1, 1, 1);
    this.chips = new THREE.InstancedMesh(cg, applyLF(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })), this.CM);
    this.chips.frustumCulled = false;
    this.chips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.CM * 3).fill(0.5), 3);
    this.m.makeTranslation(0, -60, 0);
    for (let i = 0; i < this.CM; i++) {
      this.chips.setMatrixAt(i, this.m);
      this.chipList.push({ x: 0, y: -60, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, wx: 0, wy: 0, life: 0, floor: 0, s: 0.01, bounced: false, long: false });
    }
    this.group.add(this.chips);
    // ---- rain: fine streaks round the camera, kept off anything with a roof, lit by what they fall through
    const N = 5200;
    const rp = new Float32Array(N * 6), seed = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      rp.set([x, y, z, x, y, z], i * 6);
      seed[i * 2] = 0;
      seed[i * 2 + 1] = 1;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rg.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.rainU.roofs.value = roofs;
    this.rain = new THREE.LineSegments(rg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false, ...BLEND, uniforms: this.rainU,
      vertexShader: `attribute float aEnd; uniform vec3 cam; uniform float time; uniform vec4 roofs[${roofs.length}]; varying float vA; varying vec3 vC; varying float vZ;
        ${AIR_PARS}
        void main(){
          vec3 box = vec3(22., 13., 22.);
          vec3 p = position * box;
          float sp = 0.82 + fract( position.x * 91.7 ) * 0.36;
          p.y -= time * 13.5 * sp;
          p.x -= time * 1.1 * sp;
          vec3 o = cam - box * .5;
          p = mod(p - o, box) + o;
          float y0 = p.y;
          float dist = length( p - cam );
          float L = .07 + .12 * clamp( dist / 9., 0., 1. );
          p.y += aEnd * L; p.x += aEnd * L * .08;
          vA = .17 * smoothstep( .8, 3.2, dist );
          for (int i = 0; i < ${roofs.length}; i++) { vec4 r = roofs[i]; if (p.x > r.x && p.x < r.z && p.z > r.y && p.z < r.w) vA = 0.; }
          if (y0 < -0.12) vA = 0.;
          vC = airLight( p ) * 1.1 + vec3( .004, .005, .006 );
          vec4 mv = viewMatrix * vec4(p, 1.);
          vZ = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; varying vec3 vC; varying float vZ; uniform float k; uniform sampler2D tDepth; uniform vec2 inv; uniform vec2 nf;
        void main(){ if (vA <= 0.) discard;
          float d = texture2D( tDepth, gl_FragCoord.xy * inv ).r;
          float z = nf.x * nf.y / ( nf.y - d * ( nf.y - nf.x ) );
          if ( z < vZ ) discard;
          float a = vA * k; gl_FragColor = vec4( vC * a, a * .25 ); }`,
    }));
    this.rain.frustumCulled = false;
    this.air.add(this.rain);
  }

  /** keeps sprites the same size in the world whatever the resolution */
  setScale(s: number) {
    this.soft.mat.uniforms.scale.value = s;
    this.glow.mat.uniforms.scale.value = s;
  }

  muzzle(p: THREE.Vector3, d: THREE.Vector3, big = 1) {
    this.flashT = 0.03;
    const s = (0.17 + Math.random() * 0.2) * big;
    this.flash.forEach((f, i) => {
      f.visible = true;
      f.position.copy(p).addScaledVector(d, 0.04 + s * 0.3);
      if (i === 0) f.quaternion.setFromUnitVectors(this.z, d);
      else {
        const t = new THREE.Vector3(i === 1 ? 1 : 0, i === 1 ? 0 : 1, 0.01).cross(d).normalize();
        f.quaternion.setFromUnitVectors(this.z, t);
      }
      if (i === 0) f.rotateZ(Math.random() * 6.28);
      f.scale.setScalar(i === 0 ? s * 0.8 : s * 1.3);
    });
    // gas, then a little haze that hangs
    for (let i = 0; i < 4; i++) this.soft.emit(p.x, p.y, p.z, d.x * 3 + rnd(0.5), d.y * 3 + rnd(0.5) + 0.2, d.z * 3 + rnd(0.5), 0.04 * big, 0.36, 0.4 + Math.random() * 0.45, 0.36, 0.36, 0.38, 0.07, -0.15, 3);
    for (let i = 0; i < 3; i++) this.glow.emit(p.x, p.y, p.z, d.x * (6 + Math.random() * 9) + rnd(1.5), d.y * (6 + Math.random() * 9) + rnd(1.5), d.z * (6 + Math.random() * 9) + rnd(1.5), 0.006, 0, 0.05 + Math.random() * 0.08, 20, 11, 4, 1, 3);
  }

  private chip(x: number, y: number, z: number, vx: number, vy: number, vz: number, s: number, r: number, g: number, b: number, long = false) {
    const i = (this.cI = (this.cI + 1) % this.CM);
    const c = this.chipList[i];
    Object.assign(c, { x, y, z, vx, vy, vz, rx: Math.random() * 6, ry: Math.random() * 6, wx: rnd(26), wy: rnd(26), life: 1.6 + Math.random() * 1.6, floor: this.groundAt(x, y + 0.1, z), s, bounced: false, long });
    this.chips.setColorAt(i, this.c.setRGB(r, g, b));
    this.chips.instanceColor!.needsUpdate = true;
  }

  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, surf: string, far = false) {
    const c = SURF[surf] ?? SURF.stone;
    const [dr, dg, db] = c.dust;
    const n = far ? Math.ceil(c.n / 2) : c.n;
    const flesh = surf === 'flesh';
    for (let i = 0; i < n; i++) {
      const sp = 0.5 + Math.random() * 2.4;
      this.soft.emit(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, nx * sp + rnd(0.7), ny * sp + rnd(0.7) + 0.1, nz * sp + rnd(0.7), (0.06 + Math.random() * 0.08) * c.puff, 0.6 * c.puff, 0.5 + Math.random() * 1.1, dr, dg, db, flesh ? 0.5 : 0.22, flesh ? 3 : 0.32, 3.2);
    }
    if (c.chips) {
      for (let i = 0; i < c.chips; i++) {
        const sp = 1.4 + Math.random() * 3.6;
        const k = 0.6 + Math.random() * 0.8;
        this.chip(x + nx * 0.02, y + ny * 0.02, z + nz * 0.02, nx * sp + rnd(1.9), ny * sp + rnd(1.9) + 0.8, nz * sp + rnd(1.9), 0.006 + Math.random() ** 2 * 0.02, c.chip[0] * k, c.chip[1] * k, c.chip[2] * k, surf === 'wood' || surf === 'card');
      }
    }
    for (let i = 0; i < c.sparks; i++) {
      const sp = 2.5 + Math.random() * 7;
      this.glow.emit(x, y, z, nx * sp + rnd(3.4), ny * sp + rnd(3.4) + 1, nz * sp + rnd(3.4), 0.009, 0, 0.1 + Math.random() * 0.28, 16, 8, 2.8, 1, 9, 1);
    }
    if (surf === 'glass') {
      for (let i = 0; i < 14; i++) this.glow.emit(x + rnd(0.2), y + rnd(0.2), z + rnd(0.2), rnd(2), -Math.random(), rnd(2), 0.012, 0, 0.4 + Math.random() * 0.4, 0.7, 0.8, 0.9, 0.7, 9, 1);
      return;
    }
    if (c.size && (nx || ny || nz)) this.decal(x, y, z, nx, ny, nz, c.cell, far ? c.size * 1.3 : c.size + Math.random() * 0.05);
  }

  /** a round skipping off: a streak of sparks along the surface */
  skip(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    for (let i = 0; i < 10; i++) {
      const sp = 5 + Math.random() * 9;
      this.glow.emit(x, y, z, nx * sp * 0.4 + rnd(5), ny * sp * 0.4 + rnd(5) + 1, nz * sp * 0.4 + rnd(5), 0.008, 0, 0.08 + Math.random() * 0.16, 18, 10, 3.4, 1, 7, 1);
    }
  }

  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, cell: number, size: number) {
    const i = this.dI;
    this.dI = (this.dI + 1) % this.DM;
    this.decals.count = Math.max(this.decals.count, i + 1);
    this.v.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.z, this.v);
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.z, Math.random() * 6.28));
    this.m.compose(this.s.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006), this.q, new THREE.Vector3(size, size, size));
    this.decals.setMatrixAt(i, this.m);
    this.decals.instanceMatrix.needsUpdate = true;
    const a = this.decals.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    a.setX(i, cell);
    a.needsUpdate = true;
  }

  /** a mark that belongs to something that moves */
  holeMesh(surf: string): THREE.Mesh {
    const c = SURF[surf] ?? SURF.wood;
    const g = new THREE.PlaneGeometry(1, 1);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const cx = c.cell % 4, cy = CELLS_V - 1 - Math.floor(c.cell / 4);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + cx) * 0.25, (uv.getY(i) + cy) / CELLS_V);
    const m = this.markMat.clone();
    m.onBeforeCompile = () => {};
    m.customProgramCacheKey = () => 'lfmark1';
    const mesh = new THREE.Mesh(g, m);
    mesh.scale.setScalar(c.size);
    mesh.renderOrder = 3;
    return mesh;
  }

  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, wall?: { x: number; y: number; z: number; nx: number; ny: number; nz: number }) {
    for (let i = 0; i < 14; i++) {
      const sp = 1 + Math.random() * 3.6;
      this.soft.emit(x, y, z, dx * sp + rnd(0.9), dy * sp + rnd(0.9) + 0.4, dz * sp + rnd(0.9), 0.03 + Math.random() * 0.05, 0.16, 0.22 + Math.random() * 0.3, 0.2, 0.012, 0.012, 0.7, 7, 1.5);
    }
    if (wall) this.decal(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, 4, 0.5 + Math.random() * 0.5);
  }

  /** where someone came to rest */
  pool(x: number, y: number, z: number) {
    this.decal(x, y + 0.006, z, 0, 1, 0, 5, 0.9 + Math.random() * 0.5);
  }

  tracerLine(a: THREE.Vector3, bx: number, by: number, bz: number) {
    const i = this.tI;
    this.tI = (this.tI + 1) % 48;
    const t = this.tl[i];
    const dx = bx - a.x, dy = by - a.y, dz = bz - a.z, d = Math.hypot(dx, dy, dz) || 1;
    t.ax = a.x;
    t.ay = a.y;
    t.az = a.z;
    t.dx = dx / d;
    t.dy = dy / d;
    t.dz = dz / d;
    t.len = d;
    t.at = 0.4;
    t.life = 1;
  }

  shell(p: THREE.Vector3, v: THREE.Vector3, q: THREE.Quaternion, size: number) {
    const i = this.phys.shell(p, v, q);
    this.shellScale[(i + this.phys.brass.length - 1) % this.phys.brass.length] = size;
  }

  /** the window goes: `at` where it was hit, `push` the way it was going */
  shatter(mesh: THREE.Mesh, at: THREE.Vector3, push: THREE.Vector3) {
    const b = new THREE.Box3().setFromObject(mesh);
    const area = (b.max.x - b.min.x + b.max.z - b.min.z) * (b.max.y - b.min.y);
    const n = Math.min(44, Math.round(14 + area * 7));
    this.phys.shatter(b.min, b.max, at, push, n);
    for (let i = 0; i < 26; i++) this.glow.emit(at.x + rnd(0.5), at.y + rnd(0.5), at.z + rnd(0.5), push.x * 2 + rnd(2.2), rnd(1.5), push.z * 2 + rnd(2.2), 0.01, 0, 0.3 + Math.random() * 0.5, 0.9, 1, 1.1, 0.8, 9, 1);
  }

  burst(p: THREE.Vector3, kind: 'frag' | 'flash', indoors: boolean) {
    const frag = kind === 'frag';
    const g = this.groundAt(p.x, p.y + 0.3, p.z);
    if (frag) {
      // the fireball, gone in an instant
      for (let i = 0; i < 26; i++) this.glow.emit(p.x + rnd(0.3), p.y + 0.25 + rnd(0.2), p.z + rnd(0.3), rnd(7), Math.random() * 7, rnd(7), 0.5 + Math.random() * 0.7, 3, 0.09 + Math.random() * 0.1, 26, 12, 3.2, 0.9, -2, 5);
      // the column: dark, thick, slow to leave
      for (let i = 0; i < 80; i++) {
        const a = Math.random() * 6.28, sp = Math.random() ** 0.6 * 6.5, up = 0.6 + Math.random() * 5;
        this.soft.emit(p.x + rnd(0.5), p.y + 0.15 + Math.random() * 0.7, p.z + rnd(0.5), Math.cos(a) * sp, up, Math.sin(a) * sp, 0.4 + Math.random() * 0.5, 2.6, 2.2 + Math.random() * 3.6, 0.1, 0.095, 0.09, 0.62, -0.28, 2.4);
      }
      // a ring of dust thrown along the ground
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * 6.283, sp = 7 + Math.random() * 6;
        this.soft.emit(p.x + Math.cos(a) * 0.3, g + 0.1, p.z + Math.sin(a) * 0.3, Math.cos(a) * sp, 0.3 + Math.random() * 0.9, Math.sin(a) * sp, 0.26, 1.9, 1.1 + Math.random() * 1.2, 0.3, 0.27, 0.24, 0.4, 0.2, 3.4);
      }
      for (let i = 0; i < 70; i++) {
        const sp = 7 + Math.random() * 20;
        const a = Math.random() * 6.28, e = Math.random() * 1.3;
        this.glow.emit(p.x, p.y + 0.15, p.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.012, 0, 0.14 + Math.random() * 0.4, 22, 11, 3.2, 1, 10, 1.2);
      }
      for (let i = 0; i < 46; i++) {
        const sp = 3 + Math.random() * 8, a = Math.random() * 6.28, k = 0.12 + Math.random() * 0.16;
        this.chip(p.x, g + 0.1, p.z, Math.cos(a) * sp, 2 + Math.random() * 6, Math.sin(a) * sp, 0.01 + Math.random() ** 2 * 0.045, k, k * 0.95, k * 0.9);
      }
      this.decal(p.x, g + 0.008, p.z, 0, 1, 0, 6, 2.6 + Math.random() * 0.8);
      if (indoors) {
        // the ceiling comes down a little
        for (let i = 0; i < 50; i++) this.soft.emit(p.x + rnd(5), p.y + 2.2 + Math.random() * 0.5, p.z + rnd(5), rnd(0.2), -0.4 - Math.random() * 1.2, rnd(0.2), 0.14, 0.42, 1.6 + Math.random() * 2.2, 0.45, 0.43, 0.4, 0.18, 0.5, 1.2);
      }
    } else {
      this.glow.emit(p.x, p.y + 0.3, p.z, 0, 0, 0, 7, 9, 0.12, 60, 60, 62, 1, 0, 1);
      for (let i = 0; i < 40; i++) this.glow.emit(p.x, p.y + 0.1, p.z, rnd(13), Math.random() * 9, rnd(13), 0.012, 0, 0.18 + Math.random() * 0.3, 18, 15, 11, 1, 12, 1);
      for (let i = 0; i < 26; i++) this.soft.emit(p.x + rnd(0.4), p.y + 0.2, p.z + rnd(0.4), rnd(3), Math.random() * 2.4, rnd(3), 0.3, 1.5, 1.4 + Math.random() * 1.8, 0.6, 0.6, 0.62, 0.22, -0.1, 2.5);
    }
  }

  /** a boot in a puddle */
  splash(x: number, y: number, z: number, k: number) {
    for (let i = 0; i < 7 * k; i++) {
      const a = Math.random() * 6.28, sp = 0.6 + Math.random() * 1.2;
      this.glow.emit(x, y + 0.03, z, Math.cos(a) * sp, 1.2 + Math.random() * 1.8, Math.sin(a) * sp, 0.009, 0, 0.18 + Math.random() * 0.2, 0.35, 0.38, 0.42, 0.7, 9, 0.6);
    }
  }

  update(dt: number, time: number, cam: THREE.Camera, indoors: boolean) {
    this.flashT -= dt;
    if (this.flashT <= 0) for (const f of this.flash) f.visible = false;
    // rain landing round the camera
    if (!indoors) {
      this.splashAcc += dt * 60;
      while (this.splashAcc > 1) {
        this.splashAcc -= 1;
        const x = cam.position.x + rnd(9), z = cam.position.z + rnd(9);
        if (!this.outside(x, z)) continue;
        const y = this.groundAt(x, cam.position.y + 0.5, z);
        for (let i = 0; i < 2; i++) this.glow.emit(x, y + 0.02, z, rnd(0.5), 0.5 + Math.random() * 0.8, rnd(0.5), 0.006, 0, 0.1, 0.1, 0.11, 0.13, 0.6, 7, 0.4);
      }
    }
    this.soft.update(dt);
    this.glow.update(dt);
    // ---- tracers: a bright slug flying down the line
    const tp = this.tPos;
    let dirty = false;
    for (let i = 0; i < 48; i++) {
      const t = this.tl[i];
      if (t.life <= 0) continue;
      dirty = true;
      t.at += dt * 420;
      const head = Math.min(t.at, t.len), tail = Math.max(0, t.at - 3.4);
      if (tail >= t.len) {
        t.life = 0;
        tp.fill(0, i * 6, i * 6 + 6);
        continue;
      }
      tp[i * 6] = t.ax + t.dx * tail;
      tp[i * 6 + 1] = t.ay + t.dy * tail;
      tp[i * 6 + 2] = t.az + t.dz * tail;
      tp[i * 6 + 3] = t.ax + t.dx * head;
      tp[i * 6 + 4] = t.ay + t.dy * head;
      tp[i * 6 + 5] = t.az + t.dz * head;
    }
    if (dirty) (this.tracer.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    // ---- brass
    const br = this.phys.brass;
    let upd = false;
    for (let i = 0; i < br.length; i++) {
      const s = br[i];
      if (!s.live) continue;
      const t = s.body.translation(), r = s.body.rotation();
      this.m.compose(this.v.set(t.x, t.y, t.z), this.q.set(r.x, r.y, r.z, r.w), this.s.setScalar(this.shellScale[i]));
      this.shells.setMatrixAt(i, this.m);
      upd = true;
    }
    if (upd) this.shells.instanceMatrix.needsUpdate = true;
    // ---- shards
    const sh = this.phys.shards;
    let any = false;
    for (let i = 0; i < sh.length; i++) {
      const s = sh[i];
      if (s.life <= 0) {
        this.shards.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      any = true;
      const t = s.body.translation(), r = s.body.rotation();
      // the slab the body is, seen flat side on
      this.q.set(r.x, r.y, r.z, r.w).multiply(FLAT);
      this.m.compose(this.v.set(t.x, t.y, t.z), this.q, this.s.set(s.sx, s.sy, 1));
      this.shards.setMatrixAt(i, this.m);
    }
    this.shards.visible = any;
    if (any) this.shards.instanceMatrix.needsUpdate = true;
    // ---- chips
    let cu = false;
    for (let i = 0; i < this.CM; i++) {
      const c = this.chipList[i];
      if (c.life <= 0) continue;
      c.life -= dt;
      cu = true;
      if (c.life <= 0) {
        this.chips.setMatrixAt(i, this.m.makeTranslation(0, -60, 0));
        continue;
      }
      c.vy -= 11 * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.rx += c.wx * dt;
      c.ry += c.wy * dt;
      if (c.y < c.floor + c.s && c.vy < 0) {
        c.y = c.floor + c.s;
        c.vy *= -0.3;
        c.vx *= 0.45;
        c.vz *= 0.45;
        c.wx *= 0.4;
        c.wy *= 0.4;
        if (Math.abs(c.vy) < 0.5) {
          c.vy = c.vx = c.vz = c.wx = c.wy = 0;
        }
      }
      this.e.set(c.rx, c.ry, 0);
      this.q.setFromEuler(this.e);
      const fade = Math.min(1, c.life * 2);
      this.m.compose(this.v.set(c.x, c.y, c.z), this.q, this.s.set(c.s * fade, c.s * fade * 0.7, c.s * fade * (c.long ? 3.6 : 1.2)));
      this.chips.setMatrixAt(i, this.m);
    }
    if (cu) this.chips.instanceMatrix.needsUpdate = true;
    this.rainU.cam.value.copy(cam.position);
    this.rainU.time.value = time;
    this.rainU.k.value = indoors ? 0.45 : 1;
  }
}

const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;
