// Wakes: a boat or jet ski under way leaves a foam trail on the water that follows its actual path
// through every turn, spreading into a V behind it and fading over a few seconds; strongest right at
// the stern and along the two edges. A ribbon per hull (up to six near you), rebuilt each frame.
import * as THREE from 'three';
import type { Vehicle } from '../entities/vehicle';
import { WATER_Y } from '../world/map';
import type { Game } from './game';

const N = 41; // trail points per hull (40 recorded + the stern now)
const LIFE = 3.6; // seconds a point lasts
const STEP = 0.1; // seconds between points

const vert = /* glsl */ `
attribute float aAge;
attribute float aSide;
attribute float aPow;
varying float vAge;
varying float vSide;
varying float vPow;
varying vec2 vW;
void main() {
  vAge = aAge;
  vSide = aSide;
  vPow = aPow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const frag = /* glsl */ `
uniform float uTime;
uniform vec3 uLight;
varying float vAge;
varying float vSide;
varying float vPow;
varying vec2 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float s = abs(vSide);
  // foam: churned in the middle right behind the hull, then two bright edges that spread out
  float edge = smoothstep(0.72, 0.93, s) * (1.0 - smoothstep(0.93, 1.0, s));
  float churn = (1.0 - s * 0.7) * (1.0 - smoothstep(0.0, 0.3, vAge));
  // foam breaks up into patches and streaks, more so as it ages
  float noise = n(vW * 4.2 + uTime * 0.7) * 0.55 + n(vW * 11.0 - uTime * 1.1) * 0.45;
  float lace = smoothstep(0.38 + vAge * 0.25, 0.68 + vAge * 0.2, noise);
  float a = (edge * 0.95 + churn * 0.75 + (1.0 - s) * 0.12) * lace;
  a *= pow(1.0 - vAge, 1.6) * vPow;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.97, 1.0) * uLight, a * 0.7);
}`;

interface Trail {
  v: Vehicle;
  pts: { x: number; z: number; t: number; w: number; p: number }[];
  mesh: THREE.Mesh;
  acc: number;
}

export class Wakes {
  private trails = new Map<Vehicle, Trail>();
  private readonly mat: THREE.ShaderMaterial;
  private readonly geoIndex: number[] = [];

  constructor(private game: Game) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2;
      this.geoIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  private make(v: Vehicle): Trail {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(N * 2), 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(N * 2), 1));
    geo.setAttribute('aPow', new THREE.BufferAttribute(new Float32Array(N * 2), 1));
    geo.setIndex(this.geoIndex);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.game.scene.add(mesh);
    return { v, pts: [], mesh, acc: 0 };
  }

  update(dt: number) {
    const g = this.game;
    const t = g.elapsed;
    const cam = g.camera.position;
    this.mat.uniforms.uTime.value = t;
    (this.mat.uniforms.uLight.value as THREE.Color).setScalar(0.35 + 0.65 * g.sky.day);
    // the hulls near you
    const hulls = g.vehicles.filter((v) => v.isBoat && !v.sunk && Math.hypot(v.pos.x - cam.x, v.pos.z - cam.z) < 260).slice(0, 6);
    for (const v of hulls) if (!this.trails.has(v)) this.trails.set(v, this.make(v));
    for (const [v, tr] of this.trails) {
      const keep = hulls.includes(v);
      // drop points as they age out
      while (tr.pts.length && t - tr.pts[0].t > LIFE) tr.pts.shift();
      if (keep) {
        tr.acc += dt;
        const sp = Math.abs(v.speed);
        if (tr.acc >= STEP) {
          tr.acc = 0;
          if (sp > 2.5) {
            const back = v.spec.len * 0.45;
            tr.pts.push({ x: v.pos.x - v.fwdX() * back, z: v.pos.z - v.fwdZ() * back, t, w: v.spec.wid * 0.45, p: Math.min(1, (sp - 2.5) / 10) });
            if (tr.pts.length > N - 1) tr.pts.shift();
          }
        }
      }
      if (!keep && !tr.pts.length) {
        g.scene.remove(tr.mesh);
        tr.mesh.geometry.dispose();
        this.trails.delete(v);
        continue;
      }
      this.build(tr, t);
    }
  }

  private build(tr: Trail, t: number) {
    const geo = tr.mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const age = geo.getAttribute('aAge') as THREE.BufferAttribute;
    const side = geo.getAttribute('aSide') as THREE.BufferAttribute;
    const pw = geo.getAttribute('aPow') as THREE.BufferAttribute;
    // the newest point is the stern itself, so the trail always reaches the boat
    const v = tr.v;
    const pts = tr.pts.slice();
    if (pts.length && Math.abs(v.speed) > 2.5 && !v.sunk) {
      const back = v.spec.len * 0.45;
      pts.push({ x: v.pos.x - v.fwdX() * back, z: v.pos.z - v.fwdZ() * back, t, w: v.spec.wid * 0.45, p: pts[pts.length - 1].p });
    }
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const q = pts[i];
      const a = Math.min(1, (t - q.t) / LIFE);
      // direction along the trail here
      const o = pts[Math.min(n - 1, i + 1)], b = pts[Math.max(0, i - 1)];
      let dx = o.x - b.x, dz = o.z - b.z;
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl;
      dz /= dl;
      const hw = q.w + a * 7 * q.p;
      // the sea is a flat plane at WATER_Y (the swell is in its shading), so the foam lies just on it
      const y = WATER_Y + 0.18;
      for (let k = 0; k < 2; k++) {
        const s = k ? 1 : -1;
        const j = i * 2 + k;
        pos.setXYZ(j, q.x - dz * hw * s, y, q.z + dx * hw * s);
        age.setX(j, a);
        side.setX(j, s);
        pw.setX(j, q.p);
      }
    }
    pos.needsUpdate = age.needsUpdate = side.needsUpdate = pw.needsUpdate = true;
    geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    void v;
  }
}
