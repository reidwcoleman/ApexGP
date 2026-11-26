// Particles (smoke, sparks, fire), bullet tracers, muzzle flashes and impact decals.
import * as THREE from 'three';
import { groundAt } from '../world/map';
import { decalTexture, glowTexture } from '../world/textures';

const pVert = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const pFrag = /* glsl */ `
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  s0: number; s1: number;
  r: number; g: number; b: number; a: number;
  grav: number; drag: number;
}

class PointPool {
  pts: P[] = [];
  geo = new THREE.BufferGeometry();
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  obj: THREE.Points;
  mat: THREE.ShaderMaterial;
  constructor(scene: THREE.Scene, private cap: number, additive: boolean, tex: THREE.Texture) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pVert, fragmentShader: pFrag, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: tex }, uScale: { value: 600 } },
    });
    this.obj = new THREE.Points(this.geo, this.mat);
    this.obj.frustumCulled = false;
    this.obj.renderOrder = additive ? 6 : 5;
    scene.add(this.obj);
  }
  add(p: P) {
    if (this.pts.length >= this.cap) this.pts.shift();
    this.pts.push(p);
  }
  update(dt: number, scale: number) {
    this.mat.uniforms.uScale.value = scale;
    let n = 0;
    for (let i = this.pts.length - 1; i >= 0; i--) {
      const p = this.pts[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pts[i] = this.pts[this.pts.length - 1];
        this.pts.pop();
        continue;
      }
      p.vy -= p.grav * dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of this.pts) {
      const t = 1 - p.life / p.max;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r; this.col[n * 4 + 1] = p.g; this.col[n * 4 + 2] = p.b;
      this.col[n * 4 + 3] = p.a * (1 - t) * Math.min(1, t * 8 + 0.3);
      this.size[n] = p.s0 + (p.s1 - p.s0) * t;
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Effects {
  smoke: PointPool;
  glow: PointPool;
  tracers: THREE.LineSegments;
  private tracerData: { a: THREE.Vector3; b: THREE.Vector3; life: number }[] = [];
  private tracerPos: Float32Array;
  decals: THREE.InstancedMesh;
  private decalIdx = 0;
  flash: THREE.PointLight;
  private flashT = 0;
  private muzzle: THREE.Sprite;
  private muzzleT = 0;
  private dm = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  // brass, and what's left on the ground (blood pools, scorch marks)
  private shells: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; life: number; big: boolean }[] = [];
  private shellMesh: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private scorches: THREE.InstancedMesh;
  private poolData: { x: number; y: number; z: number; s: number; target: number; rot: number }[] = [];
  private scorchIdx = 0;

  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const g = glowTexture();
    this.smoke = new PointPool(scene, 900, false, g);
    this.glow = new PointPool(scene, 600, true, g);
    this.tracerPos = new Float32Array(64 * 6);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    const dg = new THREE.PlaneGeometry(0.35, 0.35);
    this.decals = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ map: decalTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 120);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    scene.add(this.decals);
    this.flash = new THREE.PointLight(0xffc070, 0, 12, 2);
    scene.add(this.flash);
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: g, color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.muzzle.visible = false;
    scene.add(this.muzzle);
    const sg = new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6);
    sg.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.9, roughness: 0.3 }), 96);
    this.shellMesh.count = 0;
    this.shellMesh.frustumCulled = false;
    scene.add(this.shellMesh);
    const pg = new THREE.PlaneGeometry(1, 1);
    pg.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshStandardMaterial({ map: radialTex([60, 4, 6], 0.95), transparent: true, depthWrite: false, roughness: 0.15, polygonOffset: true, polygonOffsetFactor: -3 });
    this.pools = new THREE.InstancedMesh(pg, poolMat, 48);
    this.pools.count = 0;
    this.pools.frustumCulled = false;
    scene.add(this.pools);
    const scMat = new THREE.MeshBasicMaterial({ map: radialTex([8, 7, 6], 0.9), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.scorches = new THREE.InstancedMesh(pg, scMat, 24);
    this.scorches.count = 0;
    this.scorches.frustumCulled = false;
    scene.add(this.scorches);
  }

  private chunks: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; life: number }[] = [];
  private chunkGeo = [new THREE.BoxGeometry(0.5, 0.08, 0.3), new THREE.BoxGeometry(0.9, 0.15, 0.22), new THREE.BoxGeometry(0.25, 0.25, 0.05)];
  private chunkMats = new Map<number, THREE.MeshStandardMaterial>();
  /** a crash: glass glitter and a few panels / trim pieces thrown off, which tumble and settle */
  debris(x: number, y: number, z: number, speed: number, paint: number) {
    const r = Math.random;
    for (let i = 0; i < Math.min(26, speed * 1.2); i++)
      this.glow.add({ x, y: y + 0.3, z, vx: (r() - 0.5) * 7, vy: 1 + r() * 4, vz: (r() - 0.5) * 7, life: 0.6 + r() * 0.6, max: 1.2, s0: 0.08, s1: 0.05, r: 0.75, g: 0.88, b: 1, a: 0.9, grav: 12, drag: 0.6 });
    const n = Math.min(4, Math.floor(speed / 8));
    const scene = this.scene;
    for (let i = 0; i < n; i++) {
      if (this.chunks.length > 40) {
        const old = this.chunks.shift()!;
        scene.remove(old.m);
      }
      const dark = i % 2 === 1;
      let mat = this.chunkMats.get(dark ? 0x151515 : paint);
      if (!mat) this.chunkMats.set(dark ? 0x151515 : paint, (mat = new THREE.MeshStandardMaterial({ color: dark ? 0x151515 : paint, roughness: 0.4, metalness: 0.4 })));
      const m = new THREE.Mesh(this.chunkGeo[i % 3], mat);
      m.position.set(x, y + 0.2, z);
      m.castShadow = true;
      scene.add(m);
      this.chunks.push({ m, v: new THREE.Vector3((r() - 0.5) * speed * 0.5, 2 + r() * speed * 0.25, (r() - 0.5) * speed * 0.5), w: new THREE.Vector3(r() * 12, r() * 12, r() * 12), life: 25 });
    }
  }

  /** a spent case thrown out of the ejection port, to the right */
  shell(muzzle: THREE.Vector3, yaw: number, big: boolean) {
    if (this.shells.length >= 96) this.shells.shift();
    const rx = -Math.cos(yaw), rz = Math.sin(yaw);
    const r = Math.random;
    this.shells.push({
      p: muzzle.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), -0.25),
      v: new THREE.Vector3(rx * (2 + r()) - Math.sin(yaw) * 0.5, 2 + r() * 1.5, rz * (2 + r()) - Math.cos(yaw) * 0.5),
      r: new THREE.Euler(r() * 6, r() * 6, 0), life: 6, big,
    });
  }

  /** blood spreading under someone who's down */
  bloodPool(h: { pos: THREE.Vector3; dead: boolean }, killed: boolean) {
    if (!killed) return;
    const i = this.poolData.length >= 48 ? (this.poolData.shift(), this.poolData.length) : this.poolData.length;
    void i;
    this.poolData.push({ x: h.pos.x, y: groundAt(h.pos.x, h.pos.z) + 0.035, z: h.pos.z, s: 0.2, target: 1.4 + Math.random() * 0.8, rot: Math.random() * 6 });
  }

  scorch(x: number, z: number) {
    const i = this.scorchIdx++ % 24;
    this.dm.compose(new THREE.Vector3(x, groundAt(x, z) + 0.03, z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6), new THREE.Vector3(7, 1, 7));
    this.scorches.setMatrixAt(i, this.dm);
    this.scorches.count = Math.min(24, Math.max(this.scorches.count, i + 1));
    this.scorches.instanceMatrix.needsUpdate = true;
  }

  puff(x: number, y: number, z: number, kind: 'smoke' | 'dark' | 'tire' | 'dust' | 'splash' | 'blood' | 'steam') {
    const r = Math.random;
    const base: Record<string, [number, number, number, number, number, number, number]> = {
      smoke: [0.6, 0.6, 0.6, 0.5, 2.2, 1.2, 4],
      dark: [0.12, 0.11, 0.1, 0.7, 2.6, 1.5, 6],
      tire: [0.9, 0.9, 0.9, 0.45, 1.6, 1.5, 5],
      dust: [0.8, 0.72, 0.6, 0.4, 1.0, 0.8, 3],
      splash: [0.85, 0.95, 1.0, 0.7, 0.8, 0.6, 2],
      blood: [0.55, 0.05, 0.05, 0.9, 0.5, 0.15, 0.6],
      steam: [0.95, 0.95, 0.95, 0.35, 1.5, 1.0, 3],
    };
    const [cr, cg, cb, a, life, s0, s1] = base[kind];
    const up = kind === 'splash' ? 4 : kind === 'blood' ? 1 : 1.2;
    this.smoke.add({
      x: x + (r() - 0.5) * 0.4, y, z: z + (r() - 0.5) * 0.4,
      vx: (r() - 0.5) * 1.2, vy: up * (0.5 + r()), vz: (r() - 0.5) * 1.2,
      life: life * (0.7 + r() * 0.6), max: life, s0, s1, r: cr, g: cg, b: cb, a,
      grav: kind === 'splash' || kind === 'blood' ? 9 : -0.2, drag: 1.2,
    });
  }

  sparks(x: number, y: number, z: number, n: number, color = [1, 0.75, 0.3]) {
    for (let i = 0; i < n; i++) {
      const r = Math.random;
      this.glow.add({
        x, y, z, vx: (r() - 0.5) * 8, vy: r() * 5, vz: (r() - 0.5) * 8, life: 0.25 + r() * 0.3, max: 0.5,
        s0: 0.25, s1: 0.05, r: color[0], g: color[1], b: color[2], a: 1, grav: 12, drag: 0.5,
      });
    }
  }

  fire(x: number, y: number, z: number) {
    const r = Math.random;
    this.glow.add({
      x: x + (r() - 0.5) * 1.2, y, z: z + (r() - 0.5) * 1.2, vx: (r() - 0.5) * 0.5, vy: 2 + r() * 2, vz: (r() - 0.5) * 0.5,
      life: 0.5 + r() * 0.4, max: 0.9, s0: 1.6, s1: 0.4, r: 1, g: 0.45 + r() * 0.2, b: 0.1, a: 0.9, grav: -1, drag: 1,
    });
  }

  explosion(x: number, y: number, z: number) {
    // the core flash, then the fireball rolling up, then debris and smoke
    for (let i = 0; i < 12; i++)
      this.glow.add({ x, y: y + 0.8, z, vx: 0, vy: 0, vz: 0, life: 0.18, max: 0.18, s0: 9, s1: 14, r: 1, g: 0.9, b: 0.6, a: 1, grav: 0, drag: 0 });
    for (let i = 0; i < 30; i++) {
      const r = Math.random;
      this.glow.add({
        x: x + (r() - 0.5) * 2, y: y + 1, z: z + (r() - 0.5) * 2, vx: (r() - 0.5) * 5, vy: 3 + r() * 6, vz: (r() - 0.5) * 5, life: 0.9 + r() * 0.8, max: 1.7,
        s0: 5, s1: 2.5, r: 1, g: 0.35 + r() * 0.25, b: 0.06, a: 0.9, grav: -2, drag: 1.5,
      });
    }
    for (let i = 0; i < 40; i++) {
      const r = Math.random;
      this.glow.add({
        x, y: y + 0.5, z, vx: (r() - 0.5) * 16, vy: r() * 10, vz: (r() - 0.5) * 16, life: 0.5 + r() * 0.6, max: 1.1,
        s0: 4, s1: 1, r: 1, g: 0.5 + r() * 0.3, b: 0.15, a: 1, grav: 2, drag: 3,
      });
    }
    for (let i = 0; i < 45; i++) this.puff(x + (Math.random() - 0.5) * 4, y + 1 + Math.random() * 3, z + (Math.random() - 0.5) * 4, 'dark');
    this.sparks(x, y + 1, z, 30);
    this.lightFlash(x, y + 2, z, 220, 0.5, 0xffa040);
  }

  lightFlash(x: number, y: number, z: number, intensity: number, dur: number, color = 0xffc070) {
    this.flash.position.set(x, y, z);
    this.flash.color.setHex(color);
    this.flash.intensity = intensity;
    this.flash.distance = intensity > 40 ? 40 : 12;
    this.flashT = dur;
  }

  muzzleFlash(p: THREE.Vector3, big: boolean) {
    this.muzzle.position.copy(p);
    this.muzzle.scale.setScalar(big ? 0.9 : 0.7);
    this.muzzle.material.rotation = Math.random() * 6;
    this.muzzle.visible = true;
    this.muzzleT = 0.05;
    this.lightFlash(p.x, p.y, p.z, 12, 0.05);
    this.puff(p.x, p.y, p.z, 'steam');
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3) {
    if (this.tracerData.length >= 64) this.tracerData.shift();
    // draw only the last part of the path so it reads as a streak
    const d = this.v.subVectors(b, a);
    const len = d.length();
    // a short streak somewhere along the path reads better than a full-length line
    const seg = Math.min(len, 4);
    const t0 = Math.random() * Math.max(0, len - seg);
    const dirn = d.clone().divideScalar(len || 1);
    const start = a.clone().addScaledVector(dirn, t0);
    const end = start.clone().addScaledVector(dirn, seg);
    this.tracerData.push({ a: start, b: end, life: 0.05 });
  }

  decal(p: THREE.Vector3, n: THREE.Vector3) {
    const i = this.decalIdx++ % this.decals.instanceMatrix.count;
    this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    const s = 0.7 + Math.random() * 0.6;
    this.dm.compose(this.v.copy(p).addScaledVector(n, 0.02), this.q, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(i, this.dm);
    this.decals.count = Math.min(this.decals.instanceMatrix.count, Math.max(this.decals.count, i + 1));
    this.decals.instanceMatrix.needsUpdate = true;
  }

  update(dt: number, viewportH: number, fov: number) {
    const scale = viewportH / (2 * Math.tan((fov * Math.PI) / 360));
    this.smoke.update(dt, scale);
    this.glow.update(dt, scale);
    let n = 0;
    for (let i = this.tracerData.length - 1; i >= 0; i--) {
      const t = this.tracerData[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracerData.splice(i, 1);
        continue;
      }
    }
    for (const t of this.tracerData) {
      this.tracerPos.set([t.a.x, t.a.y, t.a.z, t.b.x, t.b.y, t.b.z], n * 6);
      n++;
    }
    this.tracers.geometry.setDrawRange(0, n * 2);
    (this.tracers.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.intensity = 0;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.visible = false;
    }
    // shells: fall, bounce, lie a while
    let k = 0;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shells.splice(i, 1);
        continue;
      }
      if (s.v.lengthSq() > 0.001) {
        s.v.y -= 9.81 * dt;
        s.p.addScaledVector(s.v, dt);
        s.r.x += dt * 20;
        s.r.y += dt * 9;
        const gy = groundAt(s.p.x, s.p.z, s.p.y + 0.3) + 0.006;
        if (s.p.y < gy) {
          s.p.y = gy;
          s.v.y = -s.v.y * 0.3;
          s.v.x *= 0.5;
          s.v.z *= 0.5;
          if (Math.abs(s.v.y) < 0.4) s.v.set(0, 0, 0);
        }
      }
    }
    for (const s of this.shells) {
      const sc = s.big ? 1.8 : 1;
      this.dm.compose(s.p, this.q.setFromEuler(s.r), this.v.set(sc, sc, sc));
      this.shellMesh.setMatrixAt(k++, this.dm);
    }
    this.shellMesh.count = k;
    this.shellMesh.instanceMatrix.needsUpdate = true;
    // crash debris tumbles, bounces and lies there
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.m.parent?.remove(c.m);
        this.chunks.splice(i, 1);
        continue;
      }
      if (c.v.lengthSq() < 0.0004) continue;
      c.v.y -= 9.81 * dt;
      c.m.position.addScaledVector(c.v, dt);
      c.m.rotation.x += c.w.x * dt;
      c.m.rotation.y += c.w.y * dt;
      c.m.rotation.z += c.w.z * dt;
      const gy = groundAt(c.m.position.x, c.m.position.z, c.m.position.y + 0.3) + 0.05;
      if (c.m.position.y < gy) {
        c.m.position.y = gy;
        c.v.y = -c.v.y * 0.25;
        c.v.x *= 0.55;
        c.v.z *= 0.55;
        c.w.multiplyScalar(0.5);
        if (Math.abs(c.v.y) < 0.6) {
          c.v.set(0, 0, 0);
          c.m.rotation.x = Math.round(c.m.rotation.x / Math.PI) * Math.PI;
          c.m.rotation.z = Math.round(c.m.rotation.z / Math.PI) * Math.PI;
        }
      }
    }
    // pools spread
    k = 0;
    for (const p of this.poolData) {
      p.s += (p.target - p.s) * Math.min(1, dt * 0.5);
      this.dm.compose(this.v.set(p.x, p.y, p.z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(p.s, 1, p.s * 0.8));
      this.pools.setMatrixAt(k++, this.dm);
    }
    this.pools.count = k;
    this.pools.instanceMatrix.needsUpdate = true;
  }
}

/** a soft round blot (blood, scorch) */
function radialTex(rgb: [number, number, number], a: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 7; i++) {
    const cx = 64 + (Math.random() - 0.5) * 30, cy = 64 + (Math.random() - 0.5) * 30, r = 22 + Math.random() * 30;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(${rgb.join(',')},${a})`);
    g.addColorStop(0.7, `rgba(${rgb.join(',')},${a * 0.8})`);
    g.addColorStop(1, `rgba(${rgb.join(',')},0)`);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
