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
  render: { dust: [0.72, 0.71, 0.67], n: 9, puff: 1.2, chip: [0.74, 0.73, 0.7], chips: 10, sparks: 0, cell: 1, size: 0.13 },
  soil: { dust: [0.2, 0.16, 0.1], n: 9, puff: 1.3, chip: [0.1, 0.13, 0.05], chips: 9, sparks: 0, cell: 0, size: 0.11 },
  water: { dust: [0.72, 0.76, 0.76], n: 0, puff: 1, chip: [0, 0, 0], chips: 0, sparks: 0, cell: 0, size: 0 },
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
    bloodCells(c, h, cellAt);
  });
}

/** blood, in the atlas's second half. Multiplied onto the surface, so what's drawn is how much of the wall's colour survives */
function bloodCells(c: CanvasRenderingContext2D, h: number, cellAt: (k: number) => [number, number]) {
  const red = (a: number, k = 1) => `rgba(${Math.round((58 + Math.random() * 40) * k)},${Math.round((3 + Math.random() * 6) * k)},${Math.round((5 + Math.random() * 6) * k)},${a})`;
  const clip = (k: number, f: () => void) => {
    const [cx, cy] = cellAt(k);
    c.save();
    c.beginPath();
    c.rect(cx - h / 2 + 2, cy - h / 2 + 2, h - 4, h - 4);
    c.clip();
    f();
    c.restore();
  };
  const blob = (x: number, y: number, r: number, col: string, wob = 0.25) => {
    c.fillStyle = col;
    c.beginPath();
    const n = 14 + Math.floor(r);
    const ph = Math.random() * 6;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 6.2832, rr = r * (1 + wob * (Math.sin(a * 3 + ph) * 0.5 + Math.sin(a * 5 + ph * 2) * 0.3 + (Math.random() - 0.5) * 0.4));
      c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.fill();
  };
  // a droplet that hit at an angle: round head, a tail thrown on past it
  const drop = (x: number, y: number, r: number, ang: number, stretch: number, col: string) => {
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(x, y, r * stretch, r, ang, 0, 6.2832);
    c.fill();
    if (stretch > 1.6) {
      c.beginPath();
      c.ellipse(x + Math.cos(ang) * r * stretch * 1.7, y + Math.sin(ang) * r * stretch * 1.7, r * 0.45, r * 0.35, ang, 0, 6.2832);
      c.fill();
    }
  };
  // a run down a wall: thin, thickening to a bead where it stopped
  const drip = (x: number, y: number, len: number, w: number, col: string) => {
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineCap = 'round';
    let px = x, py = y;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const nx = px + (Math.random() - 0.5) * 1.6, ny = py + len / n;
      c.lineWidth = w * (0.7 + 0.5 * (i / n));
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(nx, ny);
      c.stroke();
      px = nx;
      py = ny;
    }
    c.beginPath();
    c.ellipse(px, py, w * 0.95, w * 1.3, 0, 0, 6.2832);
    c.fill();
  };
  // 8: a burst on a wall behind someone: a wet core, a spray thrown outward, runs down from the heavy part
  const spray = (k: number, dirBias: number) => {
    clip(k, () => {
      const [cx, cy] = cellAt(k);
      for (let i = 0; i < 5; i++) blob(cx + (Math.random() - 0.5) * h * 0.08, cy + (Math.random() - 0.5) * h * 0.08, h * (0.035 + Math.random() * 0.04), red(0.9, 0.85));
      for (let i = 0; i < 260; i++) {
        let a = Math.random() * 6.2832;
        if (dirBias && Math.random() < dirBias) a = (Math.random() - 0.5) * 1.3;
        const r = Math.pow(Math.random(), 1.5) * h * 0.46;
        const sz = Math.max(0.6, (1 - r / (h * 0.5)) * (Math.random() ** 2.2) * 9 + 0.5);
        drop(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz, a, 1 + (r / h) * 5 * Math.random(), red(0.55 + Math.random() * 0.4));
      }
      for (let i = 0; i < 7; i++) {
        const x = cx + (Math.random() - 0.5) * h * 0.22, y = cy + (Math.random() - 0.1) * h * 0.08;
        drip(x, y, h * (0.12 + Math.random() * 0.3), 1.6 + Math.random() * 2.4, red(0.8, 0.9));
      }
    });
  };
  spray(8, 0);
  spray(9, 0.55);
  // 10: a smear, something pressed and drawn along, runs from its lower edge
  clip(10, () => {
    const [cx, cy] = cellAt(10);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const x = cx - h * 0.36 + t * h * 0.72, y = cy - h * 0.05 + Math.sin(t * 3) * h * 0.04;
      blob(x, y, h * (0.07 - t * 0.03) * (0.8 + Math.random() * 0.4), red(0.35 + (1 - t) * 0.4, 0.9), 0.35);
    }
    c.strokeStyle = 'rgba(40,2,4,0.35)';
    for (let i = 0; i < 30; i++) {
      c.lineWidth = 0.5 + Math.random() * 1.5;
      const y = cy - h * 0.09 + Math.random() * h * 0.1;
      c.beginPath();
      c.moveTo(cx - h * 0.38, y);
      c.lineTo(cx + h * (0.1 + Math.random() * 0.3), y + (Math.random() - 0.5) * 6);
      c.stroke();
    }
    for (let i = 0; i < 9; i++) drip(cx - h * 0.33 + Math.random() * h * 0.55, cy + h * 0.0, h * (0.1 + Math.random() * 0.32), 1.5 + Math.random() * 2.6, red(0.75, 0.9));
  });
  // 11: a pool: dark, thick, an edge that isn't quite round, a lighter rim where it thins
  clip(11, () => {
    const [cx, cy] = cellAt(11);
    blob(cx, cy, h * 0.4, 'rgba(110,22,20,0.55)', 0.22);
    blob(cx + 4, cy - 3, h * 0.37, 'rgb(52,4,6)', 0.2);
    blob(cx - h * 0.05, cy + h * 0.04, h * 0.25, 'rgb(34,2,4)', 0.25);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.28, r = h * (0.38 + Math.random() * 0.08);
      blob(cx + Math.cos(a) * r, cy + Math.sin(a) * r, h * (0.02 + Math.random() * 0.04), 'rgb(56,5,7)', 0.3);
    }
  });
  // 12: drops off a wound, onto the floor: round, crowned
  clip(12, () => {
    const [cx, cy] = cellAt(12);
    for (let i = 0; i < 9; i++) {
      const x = cx + (Math.random() - 0.5) * h * 0.5, y = cy + (Math.random() - 0.5) * h * 0.5, r = h * (0.025 + Math.random() * 0.05);
      blob(x, y, r, red(0.92, 0.8), 0.18);
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * 6.28;
        drop(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4, r * 0.18, a, 1.8, red(0.8));
      }
    }
  });
  // 13: dragged: a long broken streak with a heavier start
  clip(13, () => {
    const [cx, cy] = cellAt(13);
    for (let i = 0; i < 60; i++) {
      const t = i / 59;
      if (Math.random() < 0.18) continue;
      blob(cx - h * 0.44 + t * h * 0.88, cy + Math.sin(t * 5) * h * 0.03, h * (0.09 - t * 0.05) * (0.6 + Math.random() * 0.5), red(0.25 + (1 - t) * 0.45, 0.85), 0.5);
    }
  });
  // 14: old and dried: brown, the edge darker than the middle, flaking
  clip(14, () => {
    const [cx, cy] = cellAt(14);
    blob(cx, cy, h * 0.4, 'rgba(70,38,26,0.55)', 0.3);
    blob(cx + 6, cy - 4, h * 0.33, 'rgba(120,80,60,0.45)', 0.3);
    c.strokeStyle = 'rgba(50,22,14,0.6)';
    c.lineWidth = 3;
    c.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * 6.2832, rr = h * (0.36 + 0.05 * Math.sin(a * 4) + Math.random() * 0.012);
      c[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.stroke();
    for (let i = 0; i < 40; i++) {
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillRect(cx + (Math.random() - 0.5) * h * 0.6, cy + (Math.random() - 0.5) * h * 0.6, 1 + Math.random() * 3, 1 + Math.random() * 2);
    }
  });
  // 15: a hand, slid down the wall
  clip(15, () => {
    const [cx, cy] = cellAt(15);
    const top = cy - h * 0.34;
    blob(cx, top + h * 0.2, h * 0.09, red(0.85, 0.8), 0.2);
    for (let f = 0; f < 4; f++) {
      const fx = cx - h * 0.075 + f * h * 0.05;
      const fy = top + h * (f === 0 || f === 3 ? 0.04 : 0.0);
      c.strokeStyle = red(0.8, 0.8);
      c.lineCap = 'round';
      c.lineWidth = h * 0.032;
      c.beginPath();
      c.moveTo(fx, fy);
      c.lineTo(fx, top + h * 0.17);
      c.stroke();
    }
    c.lineWidth = h * 0.03;
    c.beginPath();
    c.moveTo(cx + h * 0.11, top + h * 0.22);
    c.lineTo(cx + h * 0.16, top + h * 0.15);
    c.stroke();
    // the slide: the print smeared down into streaks
    for (let f = 0; f < 5; f++) {
      const fx = cx - h * 0.08 + f * h * 0.042;
      c.strokeStyle = red(0.22 + Math.random() * 0.2, 0.8);
      c.lineWidth = h * (0.02 + Math.random() * 0.02);
      c.beginPath();
      c.moveTo(fx, top + h * 0.25);
      c.lineTo(fx + (Math.random() - 0.5) * 6, top + h * (0.5 + Math.random() * 0.2));
      c.stroke();
    }
    for (let i = 0; i < 3; i++) drip(cx - h * 0.06 + Math.random() * h * 0.12, top + h * 0.28, h * (0.2 + Math.random() * 0.2), 2, red(0.7, 0.85));
  });
}

/**
 * Blood, its own sheet: 5 x 5 cells at 500 px, on a clear ground, drawn as wet paint (a thin translucent edge, a
 * darker body, clots in the middle of a pool, droplets thrown on with tails pointing the way they flew). It is lit
 * like any surface and glossy, so a pool shines under a flashlight. Two of each kind:
 *   0 a burst on a wall, 1 a burst thrown one way, 2 a smear, 3 a pool, 4 drops, 5 a drag, 6 old and dried, 7 a hand,
 *   8 runs, 9 mist, 10 cast off, 11 a boot print
 */
function bloodAtlas() {
  return canvasTex(2500, (c, S) => {
    c.clearRect(0, 0, S, S);
    const h = S / 5;
    const R = Math.random;
    const fresh = (a: number, k = 1) => `rgba(${Math.round((60 + R() * 30) * k)},${Math.round((1 + R() * 3) * k)},${Math.round((4 + R() * 4) * k)},${a})`;
    const core = (a: number) => `rgba(${Math.round(48 + R() * 16)},${Math.round(1 + R() * 3)},${Math.round(4 + R() * 3)},${a})`;
    const thin = (a: number) => `rgba(${Math.round(110 + R() * 25)},${Math.round(6 + R() * 6)},${Math.round(10 + R() * 6)},${a})`;
    const blob = (x: number, y: number, r: number, col: string, wob = 0.25) => {
      c.fillStyle = col;
      c.beginPath();
      const n = 24 + Math.floor(r / 2);
      const ph = R() * 6, ph2 = R() * 6;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * 6.2832, rr = r * (1 + wob * (Math.sin(a * 3 + ph) * 0.45 + Math.sin(a * 7 + ph2) * 0.25 + (R() - 0.5) * 0.25));
        c[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      c.fill();
    };
    // an outline that isn't round: lobes, a wobble, never the same twice
    const shape = (p: Path2D, x: number, y: number, r: number, wob: number) => {
      const n = 32 + Math.floor(r / 2);
      const ph = R() * 6, ph2 = R() * 6, k3 = 2 + Math.floor(R() * 3);
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * 6.2832, rr = r * (1 + wob * (Math.sin(a * k3 + ph) * 0.5 + Math.sin(a * 7 + ph2) * 0.22 + (R() - 0.5) * 0.12));
        if (i) p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else p.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      p.closePath();
    };
    // wet blood: one body, dark where it's deep and redder where it thins, a thin translucent rim where it ran out
    const pour = (p: Path2D, x: number, y: number, r: number, deep: string, edge: string, rim: string, rimW: number) => {
      // the body on its own layer first, so the outlines of the lobes inside it never show; the rim only round the outside
      const L = document.createElement('canvas');
      L.width = L.height = Math.ceil(h);
      const lc = L.getContext('2d')!;
      const ox = Math.floor(x / h) * h, oy = Math.floor(y / h) * h;
      lc.translate(-ox, -oy);
      const g = lc.createRadialGradient(x, y, r * 0.05, x, y, r * 1.15);
      g.addColorStop(0, deep);
      g.addColorStop(0.65, deep);
      g.addColorStop(1, edge);
      lc.strokeStyle = rim;
      lc.lineWidth = rimW;
      lc.lineJoin = 'round';
      lc.stroke(p);
      lc.globalCompositeOperation = 'destination-out';
      lc.fill(p);
      lc.globalCompositeOperation = 'source-over';
      lc.fillStyle = g;
      lc.fill(p);
      c.drawImage(L, ox, oy);
    };
    const wet = (x: number, y: number, r: number, wob = 0.25) => {
      const p = new Path2D();
      shape(p, x, y, r, wob);
      pour(p, x, y, r, 'rgba(36,0,3,0.97)', 'rgba(76,3,7,0.95)', thin(0.35), Math.max(1.5, r * 0.08));
    };
    // a droplet that flew at an angle: round where it hit, a tail and a satellite past it in the way it was going
    const drop = (x: number, y: number, r: number, ang: number, stretch: number) => {
      c.fillStyle = fresh(0.92);
      c.beginPath();
      c.ellipse(x, y, r * stretch, r, ang, 0, 6.2832);
      c.fill();
      if (stretch > 1.4) {
        c.strokeStyle = fresh(0.8);
        c.lineWidth = r * 0.5;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x + Math.cos(ang) * r * stretch, y + Math.sin(ang) * r * stretch);
        c.lineTo(x + Math.cos(ang) * r * stretch * 2.2, y + Math.sin(ang) * r * stretch * 2.2);
        c.stroke();
        c.beginPath();
        c.arc(x + Math.cos(ang) * r * stretch * 2.6, y + Math.sin(ang) * r * stretch * 2.6, r * 0.35, 0, 6.2832);
        c.fill();
      }
    };
    // a run down: thin, wandering a little, thickening to a bead where it stopped
    const drip = (x: number, y: number, len: number, w: number) => {
      c.strokeStyle = fresh(0.9);
      c.fillStyle = fresh(0.95);
      c.lineCap = 'round';
      let px = x, py = y;
      const n = 14;
      for (let i = 0; i < n; i++) {
        const nx = px + (R() - 0.5) * 2.2, ny = py + len / n;
        c.lineWidth = w * (0.6 + 0.6 * (i / n));
        c.beginPath();
        c.moveTo(px, py);
        c.lineTo(nx, ny);
        c.stroke();
        px = nx;
        py = ny;
      }
      c.beginPath();
      c.ellipse(px, py, w * 1.1, w * 1.5, 0, 0, 6.2832);
      c.fill();
    };
    const cell = (k: number, f: (cx: number, cy: number) => void) => {
      const cx = (k % 5) * h + h / 2, cy = Math.floor(k / 5) * h + h / 2;
      c.save();
      c.beginPath();
      c.rect(cx - h / 2 + 3, cy - h / 2 + 3, h - 6, h - 6);
      c.clip();
      f(cx, cy);
      c.restore();
    };
    for (let v = 0; v < 2; v++) {
      // bursts: a wet core where it hit, hundreds of droplets thrown out with their tails pointing away, runs below
      for (const kind of [0, 1]) {
        cell(kind * 2 + v, (cx, cy) => {
          const bias = kind === 1 ? 0.6 : 0;
          const dir = R() * 0.6 - 0.3;
          for (let i = 0; i < 6; i++) wet(cx + (R() - 0.5) * h * 0.1, cy + (R() - 0.5) * h * 0.1, h * (0.03 + R() * 0.045), 0.4);
          for (let i = 0; i < 520; i++) {
            let a = R() * 6.2832;
            if (bias && R() < bias) a = dir + (R() - 0.5) * 1.1;
            const r = Math.pow(R(), 1.35) * h * 0.47;
            const sz = Math.max(0.8, (1 - r / (h * 0.5)) * (R() ** 2.4) * 15 + 0.6);
            drop(cx + Math.cos(a) * r, cy + Math.sin(a) * r, sz, a, 1 + (r / h) * 6 * R());
          }
          for (let i = 0; i < 9; i++) drip(cx + (R() - 0.5) * h * 0.26, cy + (R() - 0.2) * h * 0.08, h * (0.12 + R() * 0.32), 2.5 + R() * 3.5);
        });
      }
      // a smear: pressed and drawn along, the streaks of what did it, runs off its lower edge
      cell(4 + v, (cx, cy) => {
        for (let i = 0; i < 40; i++) {
          const t = i / 39;
          blob(cx - h * 0.38 + t * h * 0.76, cy - h * 0.04 + Math.sin(t * 3 + v) * h * 0.04, h * (0.085 - t * 0.04) * (0.8 + R() * 0.4), fresh(0.3 + (1 - t) * 0.5), 0.3);
        }
        c.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 26; i++) {
          c.strokeStyle = `rgba(0,0,0,${0.08 + R() * 0.18})`;
          c.lineWidth = 1 + R() * 3;
          const y = cy - h * 0.11 + R() * h * 0.14;
          c.beginPath();
          c.moveTo(cx - h * 0.4, y);
          c.lineTo(cx + h * (0.1 + R() * 0.3), y + (R() - 0.5) * 10);
          c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 10; i++) drip(cx - h * 0.33 + R() * h * 0.55, cy + h * 0.02, h * (0.1 + R() * 0.34), 2.5 + R() * 3);
      });
      // a pool: one body with lobes where it found a low spot, deep and near black in the middle, a red rim where it
      // thins, a translucent film past that, a few clots, the odd drop beside it
      cell(6 + v, (cx, cy) => {
        const p = new Path2D();
        shape(p, cx, cy, h * 0.33, 0.18);
        for (let i = 0; i < 4; i++) {
          const a = R() * 6.28, d = h * (0.2 + R() * 0.08);
          shape(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d, h * (0.08 + R() * 0.08), 0.25);
        }
        pour(p, cx, cy, h * 0.42, 'rgba(22,0,2,0.98)', 'rgba(70,3,6,0.96)', thin(0.28), h * 0.03);
        for (let i = 0; i < 26; i++) {
          const a = R() * 6.28, r = R() * h * 0.22;
          c.fillStyle = `rgba(${18 + R() * 14},0,2,${0.25 + R() * 0.35})`;
          c.beginPath();
          c.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + R() * 9, 2 + R() * 6, R() * 3, 0, 6.28);
          c.fill();
        }
        for (let i = 0; i < 8; i++) {
          const a = R() * 6.28, r = h * (0.4 + R() * 0.06);
          wet(cx + Math.cos(a) * r, cy + Math.sin(a) * r, h * (0.006 + R() * 0.014), 0.2);
        }
      });
      // drops off a wound onto the floor: round, crowned, the odd one stepped in
      cell(8 + v, (cx, cy) => {
        for (let i = 0; i < 14; i++) {
          const x = cx + (R() - 0.5) * h * 0.6, y = cy + (R() - 0.5) * h * 0.6, r = h * (0.015 + R() * 0.04);
          wet(x, y, r, 0.12);
          for (let k = 0; k < 4; k++) {
            if (R() < 0.4) continue;
            const a = R() * 6.28;
            drop(x + Math.cos(a) * r * (1.15 + R() * 0.4), y + Math.sin(a) * r * (1.15 + R() * 0.4), r * (0.06 + R() * 0.08), a, 1.3);
          }
        }
      });
      // dragged: a heavy start, then a broken streak with the drag lines through it
      cell(10 + v, (cx, cy) => {
        for (let i = 0; i < 90; i++) {
          const t = i / 89;
          if (R() < 0.12) continue;
          blob(cx - h * 0.45 + t * h * 0.9, cy + Math.sin(t * 4 + v) * h * 0.035, h * (0.1 - t * 0.055) * (0.6 + R() * 0.5), fresh(0.25 + (1 - t) * 0.6), 0.45);
        }
        c.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 40; i++) {
          c.strokeStyle = `rgba(0,0,0,${0.08 + R() * 0.2})`;
          c.lineWidth = 0.8 + R() * 2.5;
          const y = cy - h * 0.09 + R() * h * 0.18;
          c.beginPath();
          c.moveTo(cx - h * 0.46, y);
          c.lineTo(cx + h * 0.46, y + (R() - 0.5) * 14);
          c.stroke();
        }
        c.globalCompositeOperation = 'source-over';
      });
      // old and dried: gone near black and brown, darker at the edge where it dried first, cracked, flaking
      cell(12 + v, (cx, cy) => {
        const p = new Path2D();
        shape(p, cx, cy, h * 0.34, 0.22);
        for (let i = 0; i < 3; i++) {
          const a = R() * 6.28;
          shape(p, cx + Math.cos(a) * h * 0.2, cy + Math.sin(a) * h * 0.2, h * (0.08 + R() * 0.06), 0.3);
        }
        pour(p, cx, cy, h * 0.4, 'rgba(40,12,7,0.86)', 'rgba(30,7,4,0.94)', 'rgba(16,3,2,0.9)', h * 0.022);
        c.globalCompositeOperation = 'destination-out';
        c.strokeStyle = 'rgba(0,0,0,0.35)';
        for (let i = 0; i < 22; i++) {
          let x = cx + (R() - 0.5) * h * 0.5, y = cy + (R() - 0.5) * h * 0.5, a = R() * 6.28;
          c.lineWidth = 0.6 + R() * 1.2;
          c.beginPath();
          c.moveTo(x, y);
          for (let k = 0; k < 5; k++) {
            a += (R() - 0.5) * 1.4;
            x += Math.cos(a) * h * 0.035;
            y += Math.sin(a) * h * 0.035;
            c.lineTo(x, y);
          }
          c.stroke();
        }
        for (let i = 0; i < 30; i++) {
          c.fillStyle = `rgba(0,0,0,${0.2 + R() * 0.5})`;
          c.fillRect(cx + (R() - 0.5) * h * 0.6, cy + (R() - 0.5) * h * 0.6, 1 + R() * 5, 1 + R() * 4);
        }
        c.globalCompositeOperation = 'source-over';
      });
      // a hand: the palm and fingers, slid down the wall into streaks
      cell(14 + v, (cx, cy) => {
        const top = cy - h * 0.34;
        c.save();
        c.translate(cx, top + h * 0.2);
        c.rotate((R() - 0.5) * 0.4);
        blob(0, 0, h * 0.085, fresh(0.9), 0.15);
        blob(0, h * 0.03, h * 0.07, core(0.6), 0.2);
        c.lineCap = 'round';
        for (let f = 0; f < 4; f++) {
          const fx = -h * 0.075 + f * h * 0.05;
          c.strokeStyle = fresh(0.88);
          c.lineWidth = h * 0.03;
          c.beginPath();
          c.moveTo(fx, -h * 0.05);
          c.lineTo(fx * 1.1, -h * (f === 0 || f === 3 ? 0.17 : 0.21));
          c.stroke();
        }
        c.lineWidth = h * 0.03;
        c.beginPath();
        c.moveTo(h * 0.08, 0);
        c.lineTo(h * 0.15, -h * 0.07);
        c.stroke();
        c.restore();
        for (let f = 0; f < 6; f++) {
          const fx = cx - h * 0.08 + f * h * 0.034, y1 = top + h * (0.5 + R() * 0.25);
          const g = c.createLinearGradient(0, top + h * 0.26, 0, y1);
          g.addColorStop(0, fresh(0.55));
          g.addColorStop(1, fresh(0));
          c.strokeStyle = g;
          c.lineWidth = h * (0.012 + R() * 0.016);
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(fx, top + h * 0.26);
          c.lineTo(fx + (R() - 0.5) * 8, y1);
          c.stroke();
        }
        for (let i = 0; i < 3; i++) drip(cx - h * 0.06 + R() * h * 0.12, top + h * 0.3, h * (0.2 + R() * 0.25), 3);
      });
      // runs: each from a bead at the top of the cell to wherever it stopped. The shader lets them out a little at a
      // time, from the top down, so a fresh splash goes on running after the shot
      cell(16 + v, (cx, cy) => {
        const top = cy - h * 0.47;
        const n = 3 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) {
          const x0 = cx + ((i + 0.5) / n - 0.5) * h * 0.7 + (R() - 0.5) * h * 0.08;
          const len = h * (0.35 + R() * 0.55), w = 3.2 + R() * 4.5;
          let px = x0, py = top;
          c.lineCap = 'round';
          const steps = 40;
          for (let k = 0; k < steps; k++) {
            const t = k / steps;
            const nx = px + (R() - 0.5) * 1.6, ny = py + len / steps;
            // thick where it left, thinner as it ran out of blood, the film at its edges redder than its middle
            c.strokeStyle = thin(0.5);
            c.lineWidth = w * (1.25 - t * 0.55) + 2;
            c.beginPath();
            c.moveTo(px, py);
            c.lineTo(nx, ny);
            c.stroke();
            c.strokeStyle = fresh(0.94);
            c.lineWidth = w * (1.1 - t * 0.6);
            c.beginPath();
            c.moveTo(px, py);
            c.lineTo(nx, ny);
            c.stroke();
            px = nx;
            py = ny;
          }
          wet(px, py, w * 0.95, 0.1);
          wet(x0, top + h * 0.02, w * (1.2 + R() * 0.8), 0.3);
        }
      });
      // mist: what a round carries out the far side, a cloud of specks finer than a pinhead with a few drops in it
      cell(18 + v, (cx, cy) => {
        for (let i = 0; i < 2600; i++) {
          const a = R() * 6.2832, r = Math.pow(R(), 0.8) * h * 0.47;
          const k = 1 - r / (h * 0.5);
          c.fillStyle = fresh(0.45 + R() * 0.5);
          c.beginPath();
          c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.5 + R() ** 3 * 2.4 * (0.4 + k), 0, 6.2832);
          c.fill();
        }
        for (let i = 0; i < 70; i++) {
          const a = R() * 6.2832, r = Math.pow(R(), 1.2) * h * 0.4;
          drop(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.4 + R() ** 2 * 5, a, 1 + R() * 2.5);
        }
      });
      // cast off: a line of drops flung from something swinging or pumped from an artery, each longer than the last
      cell(20 + v, (cx, cy) => {
        const bend = (R() - 0.5) * 0.9, a0 = (R() - 0.5) * 0.5;
        for (let i = 0; i < 34; i++) {
          const t = i / 33;
          const x = cx - h * 0.44 + t * h * 0.88, y = cy + Math.sin(t * 3.1) * h * 0.16 * bend + (R() - 0.5) * h * 0.035;
          const r = (1 - t * 0.75) * (2.5 + R() * 6.5);
          drop(x, y, r, a0 + bend * (t - 0.5), 1.2 + t * 3 * R());
          if (r > 6 && R() < 0.5) drip(x, y, h * (0.05 + R() * 0.2), r * 0.45);
        }
        for (let i = 0; i < 120; i++) {
          c.fillStyle = fresh(0.7);
          c.beginPath();
          c.arc(cx + (R() - 0.5) * h * 0.9, cy + (R() - 0.5) * h * 0.3, 0.5 + R() * 1.4, 0, 6.2832);
          c.fill();
        }
      });
      // a boot that went through it: the heel and the ball of the foot, the tread bars left clean, more of it gone
      // toward one side where the weight wasn't
      cell(22 + v, (cx, cy) => {
        c.save();
        c.translate(cx, cy);
        c.fillStyle = core(0.93);
        c.beginPath();
        c.ellipse(0, -h * 0.1, h * 0.085, h * 0.17, 0, 0, 6.2832);
        c.fill();
        c.beginPath();
        c.ellipse(0, h * 0.2, h * 0.066, h * 0.078, 0, 0, 6.2832);
        c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.strokeStyle = 'rgba(0,0,0,1)';
        for (let i = 0; i < 13; i++) {
          const y = -h * 0.27 + i * h * 0.043;
          c.lineWidth = h * 0.014;
          c.beginPath();
          c.moveTo(-h * 0.1, y + h * 0.012);
          c.lineTo(0, y - h * 0.012);
          c.lineTo(h * 0.1, y + h * 0.012);
          c.stroke();
        }
        for (let i = 0; i < 260; i++) {
          const x = (R() - 0.5) * h * 0.2, y = (R() - 0.5) * h * 0.6;
          c.fillStyle = `rgba(0,0,0,${R() * (0.25 + (x / (h * 0.1)) * (v ? 0.3 : -0.3) + 0.3)})`;
          c.beginPath();
          c.arc(x, y, 1 + R() * 7, 0, 6.2832);
          c.fill();
        }
        c.globalCompositeOperation = 'source-over';
        c.restore();
      });
    }
  });
}

/**
 * How thick the blood lies, as a normal map: its skin stands up from the floor with a rounded edge, and that edge is
 * what catches a torch. Half the sheet's size; the alpha is the height.
 */
function bloodRelief(sheet: THREE.CanvasTexture) {
  const src = sheet.image as HTMLCanvasElement;
  const N = src.width / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  c.filter = 'blur(1.6px)';
  c.drawImage(src, 0, 0, N, N);
  c.filter = 'none';
  const im = c.getImageData(0, 0, N, N);
  const d = im.data;
  const hgt = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const a = d[i * 4 + 3] / 255;
    // a meniscus: steep at the rim, nearly flat on top
    hgt[i] = 1 - (1 - a) * (1 - a);
  }
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(N - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(N - 1, y + 1);
      const nx = (hgt[y * N + x0] - hgt[y * N + x1]) * 3.2, ny = (hgt[y1 * N + x] - hgt[y0 * N + x]) * 3.2;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  c.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.anisotropy = 4;
  return t;
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
  private DM = 1400;
  /** the first `fixed` marks are the map's own (old blood): gunfire wraps round after them, never over them */
  private fixed = 0;
  private markMat: THREE.MeshBasicMaterial;
  /** blood is its own layer, lit and glossy */
  private gore: THREE.InstancedMesh;
  private bI = 0;
  private BM = 1400;
  private bFixed = 0;
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
  /** how much rain this map has */
  rainOn = 1;
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
    const bg = new THREE.PlaneGeometry(1, 1);
    bg.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(this.BM), 1));
    // when it landed, and how much of it there is (a run: how far down it has got; anything else: how strong)
    bg.setAttribute('aLife', new THREE.InstancedBufferAttribute(new Float32Array(this.BM * 2), 2));
    const sheet = bloodAtlas();
    sheet.anisotropy = 8;
    const bm = new THREE.MeshStandardMaterial({
      map: sheet, normalMap: bloodRelief(sheet), transparent: true, depthWrite: false, roughness: 0.2, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    bm.normalScale.set(1.5, 1.5);
    bm.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;\nattribute vec2 aLife;\nvarying vec3 vGore;\nvarying vec2 vQuad;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
vMapUv = vec2( ( uv.x + mod( aCell, 5.0 ) ) * 0.2, ( uv.y + 4.0 - floor( aCell / 5.0 ) ) * 0.2 );
vNormalMapUv = vMapUv;
vQuad = uv;
vGore = vec3( aLife, step( 15.5, aCell ) * step( aCell, 17.5 ) );`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGore;\nvarying vec2 vQuad;\nfloat gDry;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  // a run comes out of its bead a little at a time; a print is as strong as what was left on the boot
  float shown = vGore.z > 0.5 ? smoothstep( vGore.y + 0.015, vGore.y - 0.015, 1.0 - vQuad.y ) : vGore.y;
  // blood dries from its thin edge inward: it goes from wet red to a dull brown, and stops shining
  float age = lfTime - vGore.x;
  gDry = clamp( ( age - 22.0 * diffuseColor.a * diffuseColor.a ) / 95.0, 0.0, 1.0 );
  // the sheet is painted as it looks in a dim room; under a torch wet blood is a deep clear red, not black
  vec3 wetC = diffuseColor.rgb * vec3( 3.0, 1.5, 1.5 ) + vec3( 0.018, 0.0, 0.0 );
  // dried, the red goes out of it: rust brown where it was thin, near black where it lay deep
  vec3 dryC = vec3( 0.3, 0.115, 0.075 ) * ( diffuseColor.r * 2.2 + 0.03 );
  diffuseColor.rgb = mix( wetC, dryC, gDry );
  diffuseColor.a *= shown * mix( 1.0, 0.9, gDry );
}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( 0.09, 0.66, gDry * gDry );')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize( mix( normal, nonPerturbedNormal, gDry * 0.6 ) );');
    };
    bm.customProgramCacheKey = () => 'lfblood2';
    applyLF(bm, { spec: 1 });
    this.gore = new THREE.InstancedMesh(bg, bm, this.BM);
    this.gore.count = 0;
    this.gore.frustumCulled = false;
    this.gore.renderOrder = 3;
    this.group.add(this.gore);
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
    if (surf === 'water') {
      // a thin spout that stands up and falls back, and a ring of spray at its foot
      for (let i = 0; i < 16; i++) {
        const up = 2.6 + Math.random() * 3.6, spread = 0.1 + Math.random() * 0.34;
        this.soft.emit(x + rnd(0.05), y + 0.02, z + rnd(0.05), rnd(spread), up, rnd(spread), 0.03 + Math.random() * 0.05, 0.14, 0.35 + Math.random() * 0.45, dr, dg, db, 0.42, 7.5, 1.1);
      }
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * 6.283, sp = 0.7 + Math.random() * 1.6;
        this.soft.emit(x, y + 0.03, z, Math.cos(a) * sp, 0.5 + Math.random(), Math.sin(a) * sp, 0.05 + Math.random() * 0.06, 0.3, 0.3 + Math.random() * 0.3, dr, dg, db, 0.28, 1.2, 1.4);
      }
      return;
    }
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
    // a round into a body leaves its mark on the body, which isn't here a second later: nothing is hung in the air where it was
    if (c.size && !flesh && (nx || ny || nz)) this.decal(x, y, z, nx, ny, nz, c.cell, far ? c.size * 1.3 : c.size + Math.random() * 0.05);
  }

  /** a round skipping off: a streak of sparks along the surface */
  skip(x: number, y: number, z: number, nx: number, ny: number, nz: number) {
    for (let i = 0; i < 10; i++) {
      const sp = 5 + Math.random() * 9;
      this.glow.emit(x, y, z, nx * sp * 0.4 + rnd(5), ny * sp * 0.4 + rnd(5) + 1, nz * sp * 0.4 + rnd(5), 0.008, 0, 0.08 + Math.random() * 0.16, 18, 10, 3.4, 1, 7, 1);
    }
  }

  /** spin: 'down' turns the mark so whatever runs in it runs down the wall; otherwise random */
  decal(x: number, y: number, z: number, nx: number, ny: number, nz: number, cell: number, size: number, spin?: 'down' | number, keep = false, stretch = 1, k = 1) {
    let i: number;
    // blood goes to its own layer: cells 8-15 are its kinds, each drawn twice
    const bl = cell >= 8;
    if (bl) {
      // blood lies on something or it isn't drawn: a surface within a hand's width behind the mark, facing the same way
      const h = this.rayAt(x + nx * 0.12, y + ny * 0.12, z + nz * 0.12, -nx, -ny, -nz, 0.26);
      if (!h || h.nx * nx + h.ny * ny + h.nz * nz < 0.7) return -1;
      const back = h.t - 0.12;
      x -= nx * back;
      y -= ny * back;
      z -= nz * back;
    }
    const mesh = bl ? this.gore : this.decals;
    if (bl) {
      cell = (cell - 8) * 2 + (Math.random() < 0.5 ? 0 : 1);
      if (keep && this.bFixed < this.BM - 300) {
        i = this.bFixed++;
        this.bI = Math.max(this.bI, this.bFixed);
      } else {
        i = this.bI;
        this.bI = this.bI + 1 >= this.BM ? this.bFixed : this.bI + 1;
      }
    } else if (keep && this.fixed < this.DM - 300) {
      i = this.fixed++;
      this.dI = Math.max(this.dI, this.fixed);
    } else {
      i = this.dI;
      this.dI = this.dI + 1 >= this.DM ? this.fixed : this.dI + 1;
    }
    mesh.count = Math.max(mesh.count, i + 1);
    this.v.set(nx, ny, nz).normalize();
    this.q.setFromUnitVectors(this.z, this.v);
    let ang = typeof spin === 'number' ? spin : Math.random() * 6.28;
    if (spin === 'down' && Math.abs(this.v.y) < 0.9) {
      // where the texture's down lands now, and where down is on this face
      const a = new THREE.Vector3(0, -1, 0).applyQuaternion(this.q);
      const b = new THREE.Vector3(this.v.x * this.v.y, -1 + this.v.y * this.v.y, this.v.z * this.v.y).normalize();
      ang = Math.atan2(this.v.dot(new THREE.Vector3().crossVectors(a, b)), a.dot(b)) + (Math.random() - 0.5) * 0.25;
    }
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(this.z, ang));
    this.m.compose(this.s.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006), this.q, new THREE.Vector3(size, size * stretch, size));
    mesh.setMatrixAt(i, this.m);
    mesh.instanceMatrix.needsUpdate = true;
    const a = mesh.geometry.getAttribute('aCell') as THREE.InstancedBufferAttribute;
    a.setX(i, cell);
    a.needsUpdate = true;
    if (bl) {
      // what the map came with dried long ago
      const l = mesh.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
      l.setXY(i, keep ? -1e4 : this.now, k);
      l.needsUpdate = true;
      this.grow = this.grow.filter((g) => g.i !== i);
    }
    return i;
  }

  /** a mark that spreads: grows to size over secs */
  private grow: { i: number; x: number; y: number; z: number; q: THREE.Quaternion; s: number; to: number; k: number; secs: number; run?: boolean }[] = [];
  /** the time, as the blood's shader has it */
  private now = 0;
  /** blood still wet enough to walk through: where, how wide, when */
  private wetAt: { x: number; y: number; z: number; r: number; t: number }[] = [];
  private soles = new Map<number, { left: number; side: number }>();
  private spread(x: number, y: number, z: number, cell: number, from: number, to: number, secs: number) {
    const i = this.decal(x, y, z, 0, 1, 0, cell, from);
    if (i < 0) return;
    this.gore.getMatrixAt(i, this.m);
    const q = new THREE.Quaternion();
    this.m.decompose(this.v, q, this.s);
    this.grow.push({ i, x: this.v.x, y: this.v.y, z: this.v.z, q, s: from, to, k: 0, secs });
    this.wetAt.push({ x, y, z, r: to * 0.36, t: this.now });
    if (this.wetAt.length > 24) this.wetAt.shift();
  }

  /** a splash on a wall goes on running: beads let go and crawl down, slower as they thin */
  private run(x: number, y: number, z: number, nx: number, ny: number, nz: number, w: number) {
    // no further than the floor
    const drop = y - this.groundAt(x + nx * 0.05, y, z + nz * 0.05);
    const len = Math.min(0.25 + Math.random() * 0.75, drop - 0.02);
    if (len < 0.12) return;
    // the sheet's cell is square: the mark is as long as the run and hangs from where it started
    const i = this.decal(x, y - len / 2, z, nx, ny, nz, 16, w, 'down', false, len / w, 0);
    if (i < 0) return;
    this.grow.push({ i, x: 0, y: 0, z: 0, q: this.q, s: 0.04, to: 0.5 + Math.random() * 0.5, k: 0, secs: 4 + Math.random() * 9, run: true });
  }

  /**
   * A foot comes down. Through wet blood, the sole carries it: a print at each step after, fainter every time
   */
  tread(who: number, x: number, y: number, z: number, yaw: number) {
    let s = this.soles.get(who);
    for (const w of this.wetAt) {
      if (this.now - w.t > 150 || Math.abs(w.y - y) > 0.5) continue;
      const grown = Math.min(1, (this.now - w.t) / 8);
      if (Math.hypot(w.x - x, w.z - z) < w.r * (0.35 + 0.65 * grown) + 0.1) {
        if (!s) this.soles.set(who, (s = { left: 0, side: 1 }));
        s.left = 9;
      }
    }
    if (!s || s.left <= 0) return;
    s.side = -s.side;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const px = x + fz * 0.11 * s.side, pz = z - fx * 0.11 * s.side;
    const f = this.groundAt(px, y + 0.3, pz);
    if (Math.abs(f - y) < 0.4) this.decal(px, f + 0.004, pz, 0, 1, 0, 19, 0.36, Math.atan2(-fx, -fz) + (Math.random() - 0.5) * 0.25 + s.side * 0.12, false, 1, (s.left / 9) ** 0.8);
    s.left--;
  }

  /** blood in flight: each drop lands where it lands and leaves its mark */
  private drops: { x: number; y: number; z: number; vx: number; vy: number; vz: number; floor: number; life: number; s: number }[] = [];
  private fling(x: number, y: number, z: number, vx: number, vy: number, vz: number, s: number) {
    if (this.drops.length > 120) return;
    this.drops.push({ x, y, z, vx, vy, vz, floor: this.groundAt(x, y + 0.05, z), life: 4, s });
  }

  /** where something of yours sees the world from: blood on the lens */
  lensHit: (k: number) => void = () => {};
  /** the camera, for the lens */
  private eye = new THREE.Vector3();
  /** what's behind a wound: casts for the wall the round carries it to */
  rayAt: (x: number, y: number, z: number, dx: number, dy: number, dz: number, far: number) => { t: number; nx: number; ny: number; nz: number } | null = () => null;

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

  /** a round through someone: k is how much (a kill is more), d the way it was going */
  blood(x: number, y: number, z: number, dx: number, dy: number, dz: number, wall?: { x: number; y: number; z: number; nx: number; ny: number; nz: number }, k = 1) {
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    // a quick puff where the round came out: gone in a blink, the rest of it falls
    for (let i = 0; i < 5 * k; i++) {
      const sp = 0.6 + Math.random() * 2.4;
      this.soft.emit(x + dx * 0.08, y + dy * 0.08, z + dz * 0.08, dx * sp + rnd(0.6), dy * sp + rnd(0.5), dz * sp + rnd(0.6), 0.02 + Math.random() * 0.03, 0.22, 0.06 + Math.random() * 0.1, 0.17, 0.008, 0.01, 0.45, 5, 3.2);
    }
    // and the mist a round drags out the far side: a fine pink haze in a narrow cone, hanging a moment in the light
    for (let i = 0; i < 9 * k; i++) {
      const sp = 2.5 + Math.random() * 6;
      this.soft.emit(x + dx * 0.1, y + dy * 0.1, z + dz * 0.1, dx * sp + rnd(0.9), dy * sp + rnd(0.7) + 0.2, dz * sp + rnd(0.9), 0.012 + Math.random() * 0.02, 0.5, 0.25 + Math.random() * 0.35, 0.3, 0.03, 0.03, 0.16, 7, 0.5);
    }
    // the thick of it, a little way back the way it came
    for (let i = 0; i < 3 * k; i++) {
      const sp = 0.5 + Math.random() * 1.4;
      this.soft.emit(x, y, z, -dx * sp + rnd(0.5), rnd(0.4) + 0.3, -dz * sp + rnd(0.5), 0.02 + Math.random() * 0.03, 0.2, 0.12 + Math.random() * 0.15, 0.14, 0.006, 0.008, 0.85, 6, 1.2);
    }
    // drops thrown on ahead: they fall and land
    for (let i = 0; i < 20 * k; i++) {
      const sp = 1.2 + Math.random() * 4;
      this.fling(x, y, z, dx * sp + rnd(1.2), dy * sp + rnd(0.8) + Math.random() * 1.2, dz * sp + rnd(1.2), 0.035 + Math.random() * 0.06);
    }
    // the spray reaches whatever is behind them
    const w = wall ?? (() => {
      const h = this.rayAt(x, y, z, dx, dy - 0.06, dz, 2.6);
      return h ? { x: x + dx * h.t, y: y + (dy - 0.06) * h.t, z: z + dz * h.t, nx: h.nx, ny: h.ny, nz: h.nz, t: h.t } : undefined;
    })();
    if (w) {
      const t = Math.hypot(w.x - x, w.y - y, w.z - z);
      // close to the wall it's a dense patch, further off a wider, thinner spray
      const sz = (0.45 + t * 0.28) * (0.8 + Math.random() * 0.4) * (k > 1 ? 1.35 : 1);
      const wallish = Math.abs(w.ny) < 0.6;
      // right behind them the wall takes the heavy part and it runs; from further off only the mist gets there
      const near = t < 1.5;
      if (near) this.decal(w.x, w.y, w.z, w.nx, w.ny, w.nz, Math.random() < 0.5 ? 8 : 9, sz, wallish ? 'down' : undefined);
      this.decal(w.x + rnd(0.1), w.y + rnd(0.1), w.z + rnd(0.1), w.nx, w.ny, w.nz, 17, sz * (near ? 1.7 : 1.3), undefined, false, 1, near ? 0.9 : 0.75);
      if (wallish && near) {
        const tx = -w.nz, tz = w.nx;
        for (let i = 0, n = 1 + Math.floor(Math.random() * 2 * k); i < n; i++) {
          const o = rnd(sz * 0.3);
          this.run(w.x + tx * o, w.y + rnd(sz * 0.12), w.z + tz * o, w.nx, w.ny, w.nz, 0.1 + Math.random() * 0.08);
        }
      }
      if (k > 1 && wallish && Math.random() < 0.5) this.decal(w.x + rnd(0.15), w.y - 0.2, w.z + rnd(0.15), w.nx, w.ny, w.nz, 10, sz * 0.8, 'down');
    }
    // close enough to the camera and some of it lands on the lens
    const ed = Math.hypot(x - this.eye.x, y - this.eye.y, z - this.eye.z);
    if (ed < 1.3) {
      // only right up close, and only some of it: the blood belongs on the floor, not hanging on the glass
      const facing = -((x - this.eye.x) * dx + (y - this.eye.y) * dy + (z - this.eye.z) * dz) / (ed || 1);
      this.lensHit(Math.min(1, (1.3 - ed) / 1.0) * (0.15 + Math.max(0, facing) * 0.4) * k);
    }
  }

  /** someone just down: for a few seconds blood runs out of them and falls to the floor (at() is where, as the body settles) */
  private bleeders: { at: () => THREE.Vector3 | null; t: number; secs: number; acc: number; dir: number }[] = [];
  bleed(at: () => THREE.Vector3 | null, secs = 4.5) {
    this.bleeders.push({ at, t: secs, secs, acc: 0, dir: Math.random() * 6.28 });
  }

  /** where someone came to rest: it spreads out from under them */
  pool(x: number, y: number, z: number) {
    this.spread(x, y + 0.006, z, 11, 0.15, 1.1 + Math.random() * 0.6, 14 + Math.random() * 8);
    // it finds the low side of the floor: a tongue of it creeping out one way, later
    const a = Math.random() * 6.28, d = 0.35 + Math.random() * 0.25;
    this.spread(x + Math.cos(a) * d, y + 0.006, z + Math.sin(a) * d, 11, 0.05, 0.5 + Math.random() * 0.4, 22 + Math.random() * 10);
  }

  /** smoke off a hot barrel: thin, slow, rising */
  wisp(p: THREE.Vector3, k: number) {
    this.soft.emit(p.x + rnd(0.01), p.y, p.z + rnd(0.01), rnd(0.06), 0.18 + Math.random() * 0.2, rnd(0.06), 0.012, 0.32, 0.9 + Math.random() * 0.9, 0.62, 0.62, 0.64, 0.1 + 0.14 * k, -0.08, 1.6);
  }

  /** a wound on the move: a few drops on the floor */
  drip(x: number, y: number, z: number, vx = 0, vz = 0) {
    this.fling(x + rnd(0.08), y, z + rnd(0.08), vx * 0.7 + rnd(0.2), -0.2, vz * 0.7 + rnd(0.2), 0.03 + Math.random() * 0.035);
  }

  /** blood that was here before anyone came: old, set in */
  /** old blood the map was built with: kept for the whole match */
  stain(x: number, y: number, z: number, nx: number, ny: number, nz: number, size: number, cell?: number) {
    const floor = ny > 0.7;
    const r = Math.random();
    // set on something that isn't a wall or a floor (a bed that has since been moved): let it lie on the floor under it
    if (floor && !this.rayAt(x, y + 0.12, z, 0, -1, 0, 0.26)) {
      const f = this.groundAt(x, y + 0.1, z);
      if (f < y - 1.4) return;
      y = f;
    }
    if (floor) this.decal(x, y + 0.005, z, nx, ny, nz, cell ?? (r < 0.5 ? 14 : r < 0.8 ? 11 : 13), size, undefined, true);
    else this.decal(x, y, z, nx, ny, nz, cell ?? (r < 0.35 ? 15 : r < 0.7 ? 10 : r < 0.85 ? 8 : 14), size, 'down', true);
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
    this.eye.copy(cam.position);
    this.now = time;
    // the bleeding: heavy at first, then a trickle
    for (let i = this.bleeders.length - 1; i >= 0; i--) {
      const b = this.bleeders[i];
      b.t -= dt;
      const p = b.at();
      if (b.t <= 0 || !p) {
        this.bleeders.splice(i, 1);
        continue;
      }
      // it comes with the heart: a spurt, a gap, a weaker spurt, until there's no pressure left
      const left = b.t / b.secs, beat = Math.max(0, Math.sin((b.secs - b.t) * 9.5)) ** 6;
      b.acc += dt * (14 + 70 * beat) * left ** 1.5;
      while (b.acc > 1) {
        b.acc -= 1;
        const a = b.dir + rnd(0.25), sp = beat * left * 2.6;
        this.fling(p.x + rnd(0.08), p.y - 0.03, p.z + rnd(0.08), Math.cos(a) * sp + rnd(0.3), -0.3 - Math.random() * 0.6 + sp * 0.5, Math.sin(a) * sp + rnd(0.3), 0.02 + Math.random() * 0.04);
      }
    }
    // drops land
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      // seen falling: a short dark streak behind each one, gone in a blink
      this.soft.emit(d.x, d.y, d.z, d.vx * 0.15, d.vy * 0.15, d.vz * 0.15, d.s * 0.55, 0.0, 0.05, 0.17, 0.008, 0.01, 0.85, 0, 0);
      d.life -= dt;
      d.vy -= 9.8 * dt;
      const ox = d.x, oz = d.z;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      const len = Math.hypot(d.x - ox, d.z - oz);
      const h = len > 1e-4 ? this.rayAt(ox, d.y, oz, (d.x - ox) / len, 0, (d.z - oz) / len, len + 0.02) : null;
      if (h && Math.abs(h.ny) < 0.5) {
        // into a wall: it runs
        const wx = ox + (d.x - ox) / len * h.t, wz = oz + (d.z - oz) / len * h.t;
        this.decal(wx, d.y, wz, h.nx, h.ny, h.nz, Math.random() < 0.6 ? 12 : 8, d.s * 2.2, 'down');
        if (d.s > 0.06 && Math.random() < 0.5) this.run(wx, d.y, wz, h.nx, h.ny, h.nz, d.s * 3);
        this.drops.splice(i, 1);
        continue;
      }
      // the floor under where it is now, not where it started: off a balcony it falls to the ground
      if (d.vy < 0) d.floor = this.groundAt(d.x, d.y + 0.05, d.z);
      if (d.y <= d.floor || d.life <= 0) {
        if (d.y <= d.floor) {
          // a drop that came in at an angle lands long, pointing the way it was going
          const hv = Math.hypot(d.vx, d.vz), slant = Math.min(2.4, 1 + hv / Math.max(1.5, -d.vy) * 1.1);
          this.decal(d.x, d.floor + 0.004, d.z, 0, 1, 0, 12, d.s * (1.5 + Math.random() * 1.5), Math.atan2(-d.vx, -d.vz), false, slant);
          if (hv > 2 && Math.random() < 0.3) this.decal(d.x + d.vx / hv * d.s * 3, d.floor + 0.004, d.z + d.vz / hv * d.s * 3, 0, 1, 0, 17, d.s * 4, undefined, false, 1, 0.7);
        }
        this.drops.splice(i, 1);
      }
    }
    if (this.grow.length) {
      const life = this.gore.geometry.getAttribute('aLife') as THREE.InstancedBufferAttribute;
      for (let i = this.grow.length - 1; i >= 0; i--) {
        const g = this.grow[i];
        g.k = Math.min(1, g.k + dt / g.secs);
        const e = 1 - (1 - g.k) * (1 - g.k);
        const s = g.s + (g.to - g.s) * e;
        if (g.run) {
          life.setY(g.i, s);
          life.needsUpdate = true;
        } else {
          this.m.compose(this.v.set(g.x, g.y, g.z), g.q, this.s.set(s, s, s));
          this.gore.setMatrixAt(g.i, this.m);
          this.gore.instanceMatrix.needsUpdate = true;
        }
        if (g.k >= 1) this.grow.splice(i, 1);
      }
    }
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
    this.rainU.k.value = (indoors ? 0.45 : 1) * this.rainOn;
  }
}

const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const rnd = (s: number) => (Math.random() - 0.5) * 2 * s;
