import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { U } from './materials.ts';
import { shared, skin } from './world.ts';
import type { Env } from './env.ts';
import { REFLECT } from './reflection.ts';

/**
 * Boats on Biscayne Bay: yachts, cruisers, center consoles, sailboats and the odd superyacht lying
 * alongside the marinas' docks (Bayside's Miamarina, Sea Isle), rocking on the chop; and a few under way
 * on long loops out in the bay, each pushing a bow wave and dragging a white wake.
 */
const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

interface MarinaData {
  moored: [string, number, number, number][];
  loops: { model: string; pts: [number, number][]; speed: number }[];
  models: Record<string, [number, number]>;
}

interface Under {
  model: string;
  pts: THREE.Vector2[];
  cum: number[];
  len: number;
  s: number;
  speed: number;
  idx: number;
  wake: THREE.Mesh;
}

export class Boats {
  readonly root = new THREE.Group();
  private kinds = new Map<string, THREE.InstancedMesh[]>();
  private moored: { model: string; x: number; z: number; yaw: number; idx: number; ph: number }[] = [];
  private under: Under[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private acc = 0;

  constructor(readonly env: Env, readonly sea = -1.5) {
    this.root.name = 'boats';
  }

  async load() {
    const [gltf, data] = await Promise.all([
      new GLTFLoader().loadAsync(BASE + 'boats.glb'),
      fetch(BASE + 'marina.json').then((r) => r.json() as Promise<MarinaData>),
    ]);
    const S = shared();
    const hull = new THREE.MeshPhysicalMaterial({ name: 'od_hull', color: 0xf4f5f3, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, vertexColors: true });
    const anti = new THREE.MeshStandardMaterial({ name: 'od_antifoul', color: 0x1a2436, roughness: 0.7 });
    const glass = new THREE.MeshPhysicalMaterial({ name: 'od_boatglass', color: 0x0a0f14, roughness: 0.03, metalness: 0.4, clearcoat: 1 });
    const chrome = new THREE.MeshStandardMaterial({ name: 'od_chrome', color: 0xdfe3e6, roughness: 0.12, metalness: 1 });
    const canvas = new THREE.MeshStandardMaterial({ name: 'od_canvas', color: 0xffffff, roughness: 0.85, vertexColors: true });
    skin(gltf.scene, new Map(), this.env, S, (name) =>
      name === 'od_hull' ? hull : name === 'od_antifoul' ? anti : name === 'od_boatglass' ? glass : name === 'od_chrome' ? chrome : name === 'od_canvas' ? canvas : null,
    );
    for (const m of [hull, anti, glass, chrome, canvas]) this.env.prep(m);
    // count instances per model
    const count = new Map<string, number>();
    for (const [m] of data.moored) count.set(m, (count.get(m) ?? 0) + 1);
    for (const l of data.loops) count.set(l.model, (count.get(l.model) ?? 0) + 1);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const top = (mesh.parent && mesh.parent !== gltf.scene ? mesh.parent.name : mesh.name).replace(/_\d+$/, '');
      if (top === 'docks' || mesh.name.startsWith('docks')) return;
      const kind = top.replace(/^boat_/, '');
      const n = count.get(kind) ?? 0;
      if (!n) return;
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material as THREE.Material, n);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.layers.enable(REFLECT);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(im);
      if (!this.kinds.has(kind)) this.kinds.set(kind, []);
      this.kinds.get(kind)!.push(im);
    });
    // the docks stay as they are
    const docks = gltf.scene.getObjectByName('docks');
    if (docks) {
      docks.position.y = 0;
      this.root.add(docks);
      docks.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          m.layers.enable(REFLECT);
        }
      });
    }
    const next = new Map<string, number>();
    const take = (k: string) => {
      const i = next.get(k) ?? 0;
      next.set(k, i + 1);
      return i;
    };
    for (const [m, x, y, h] of data.moored) this.moored.push({ model: m, x, z: -y, yaw: -h, idx: take(m), ph: Math.random() * 10 });
    const wakeMat = wakeMaterial();
    for (const l of data.loops) {
      const pts = l.pts.map(([x, y]) => new THREE.Vector2(x, -y));
      pts.push(pts[0].clone());
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const L = data.models[l.model]?.[0] ?? 12;
      const wake = new THREE.Mesh(wakeGeometry(L), wakeMat);
      wake.frustumCulled = false;
      wake.renderOrder = 3;
      this.root.add(wake);
      this.under.push({ model: l.model, pts, cum, len: cum[cum.length - 1], s: Math.random() * cum[cum.length - 1], speed: l.speed, idx: take(l.model), wake });
    }
    this.update(0, true);
  }

  private set(kind: string, idx: number, m: THREE.Matrix4) {
    for (const im of this.kinds.get(kind) ?? []) im.setMatrixAt(idx, m);
  }

  update(dt: number, force = false) {
    this.acc += dt;
    const t = U.uTime.value as number;
    // moored boats: a slow roll and pitch on the chop (every few frames is plenty)
    if (force || this.acc > 0.05) {
      this.acc = 0;
      for (const b of this.moored) {
        const r = Math.sin(t * 0.9 + b.ph) * 0.025, p = Math.sin(t * 0.63 + b.ph * 1.7) * 0.012;
        this.q.setFromEuler(this.e.set(p, b.yaw, r, 'YXZ'));
        this.m4.compose(this.v.set(b.x, this.sea + Math.sin(t * 1.1 + b.ph) * 0.06, b.z), this.q, this.one);
        this.set(b.model, b.idx, this.m4);
      }
    }
    for (const u of this.under) {
      u.s = (u.s + u.speed * dt) % u.len;
      let i = 1;
      while (i < u.cum.length - 1 && u.cum[i] < u.s) i++;
      const a = u.pts[i - 1], b = u.pts[i];
      const f = (u.s - u.cum[i - 1]) / Math.max(1e-3, u.cum[i] - u.cum[i - 1]);
      const x = a.x + (b.x - a.x) * f, z = a.y + (b.y - a.y) * f;
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      // under way: the bow lifts, the boat heels into the turn a little
      this.q.setFromEuler(this.e.set(-0.045, yaw + Math.PI, Math.sin(t * 0.7 + u.idx) * 0.02, 'YXZ'));
      this.m4.compose(this.v.set(x, this.sea + 0.12, z), this.q, this.one);
      this.set(u.model, u.idx, this.m4);
      u.wake.position.set(x, this.sea + 0.06, z);
      u.wake.rotation.set(0, yaw, 0);
    }
    for (const list of this.kinds.values()) for (const im of list) im.instanceMatrix.needsUpdate = true;
  }
}

/** the wake: a long V behind the stern (local +z ahead), vertex v = distance back, u = across */
function wakeGeometry(L: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const N = 24, len = 120;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const back = -L * 0.35 - s * len;
    const half = 1.2 + s * len * 0.36;
    for (const u of [-1, 0, 1]) {
      pos.push(u * half, 0, back);
      uv.push(u, s);
    }
  }
  for (let i = 0; i < N; i++)
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k, b = a + 1, c = a + 3, d = a + 4;
      idx.push(a, c, b, b, c, d);
    }
  // the bow wave either side of the hull
  const base = pos.length / 3;
  for (const sd of [-1, 1]) {
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      pos.push(sd * (0.8 + s * L * 0.3), 0, L * 0.4 - s * L * 0.8, sd * (1.6 + s * L * 0.45), 0, L * 0.35 - s * L * 0.8);
      uv.push(sd * 0.98, -1 - s, sd * 1.0, -1 - s);
    }
  }
  for (const sd of [0, 1]) {
    const o = base + sd * 14;
    for (let i = 0; i < 6; i++) {
      const a = o + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function wakeMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uSunCol: U.uSunCol, uNight: U.uNight },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uSunCol; uniform float uNight;
      varying vec2 vUv; varying vec3 vW;
      float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      float vn( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      void main() {
        float a;
        if ( vUv.y < 0.0 ) {
          // the bow wave: a white roll along the hull
          a = ( 1.0 - smoothstep( 0.6, 1.0, abs( vUv.x ) ) * 0.0 ) * smoothstep( -2.0, -1.2, vUv.y ) * 0.8;
        } else {
          // the wake: two foamy arms (the edges of the V) and the churned prop wash down the middle, dying away
          float arms = smoothstep( 0.6, 0.97, abs( vUv.x ) ) * ( 1.0 - smoothstep( 0.97, 1.0, abs( vUv.x ) ) );
          float wash = 1.0 - smoothstep( 0.0, 0.18 + vUv.y * 0.3, abs( vUv.x ) );
          float n = vn( vW.xz * 0.9 + vec2( uTime * 0.3, 0.0 ) ) * vn( vW.xz * 2.7 - uTime * 0.2 );
          a = ( arms * 0.8 + wash ) * ( 1.0 - vUv.y ) * ( 1.0 - vUv.y ) * smoothstep( 0.12, 0.55, n + 0.3 * ( 1.0 - vUv.y ) );
        }
        vec3 c = vec3( 0.92, 0.95, 0.96 ) * ( dot( uSunCol, vec3( 0.06 ) ) * ( 1.0 - uNight ) + 0.12 );
        gl_FragColor = vec4( c, clamp( a, 0.0, 1.0 ) * 0.85 );
      }`,
  });
  return m;
}
