import * as THREE from 'three';

/**
 * Particles, all in the simulation frame (cm): a glowing additive pool (boost trails, sparks, the
 * goal fireworks, the supersonic streaks) and a soft alpha pool (smoke, dust, confetti), plus the
 * goal shockwave. CPU-integrated, drawn as point sprites with per-particle size, colour and fade.
 */

interface Pool {
  n: number;
  max: number;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  life: Float32Array;
  age: Float32Array;
  size: Float32Array;
  grow: Float32Array;
  drag: Float32Array;
  grav: Float32Array;
  geo: THREE.BufferGeometry;
  aPos: THREE.BufferAttribute;
  aCol: THREE.BufferAttribute;
  aSize: THREE.BufferAttribute;
  aAlpha: THREE.BufferAttribute;
  points: THREE.Points;
}

function pool(max: number, additive: boolean): Pool {
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const aSize = new THREE.BufferAttribute(new Float32Array(max), 1);
  const aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1);
  for (const a of [aPos, aCol, aSize, aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('color', aCol);
  geo.setAttribute('size', aSize);
  geo.setAttribute('alpha', aAlpha);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 800 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(400.0, size * 0.01 * uScale / max(0.2, -mv.z)); }`,
    fragmentShader: additive
      ? `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); if (d > 1.0) discard; float k = exp(-d*3.2); gl_FragColor = vec4(vC * k * vA, k * vA); }`
      : `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); if (d > 1.0) discard; float k = (1.0-d); gl_FragColor = vec4(vC, k*k*vA); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 12 : 11;
  return {
    n: 0,
    max,
    pos: new Float32Array(max * 3),
    vel: new Float32Array(max * 3),
    col: new Float32Array(max * 3),
    life: new Float32Array(max),
    age: new Float32Array(max),
    size: new Float32Array(max),
    grow: new Float32Array(max),
    drag: new Float32Array(max),
    grav: new Float32Array(max),
    geo,
    aPos,
    aCol,
    aSize,
    aAlpha,
    points,
  };
}

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  r: number;
  g: number;
  b: number;
  life: number;
  size: number;
  grow?: number;
  drag?: number;
  grav?: number;
}

export class FX {
  readonly group = new THREE.Group();
  private glow = pool(7000, true);
  private soft = pool(2500, false);
  private waves: { mesh: THREE.Mesh; age: number; life: number; max: number }[] = [];
  private waveGeo = new THREE.SphereGeometry(1, 48, 24);

  constructor() {
    this.group.add(this.soft.points, this.glow.points);
  }

  setViewport(h: number, fovDeg: number): void {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const p of [this.glow, this.soft]) (p.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  private add(p: Pool, e: Emit): void {
    if (p.n >= p.max) return;
    const i = p.n++;
    p.pos[i * 3] = e.x;
    p.pos[i * 3 + 1] = e.y;
    p.pos[i * 3 + 2] = e.z;
    p.vel[i * 3] = e.vx ?? 0;
    p.vel[i * 3 + 1] = e.vy ?? 0;
    p.vel[i * 3 + 2] = e.vz ?? 0;
    p.col[i * 3] = e.r;
    p.col[i * 3 + 1] = e.g;
    p.col[i * 3 + 2] = e.b;
    p.life[i] = e.life;
    p.age[i] = 0;
    p.size[i] = e.size;
    p.grow[i] = e.grow ?? 0;
    p.drag[i] = e.drag ?? 0;
    p.grav[i] = e.grav ?? 0;
  }

  spark(e: Emit): void {
    this.add(this.glow, e);
  }
  smoke(e: Emit): void {
    this.add(this.soft, e);
  }

  /** a burst of glowing sparks */
  burst(x: number, y: number, z: number, n: number, speed: number, col: THREE.Color, size: number, life: number, grav = 650): void {
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + Math.random() * 0.7);
      this.spark({ x, y, z, vx: Math.cos(a) * s * v, vy: Math.sin(a) * s * v, vz: u * v, r: col.r, g: col.g, b: col.b, life: life * (0.5 + Math.random() * 0.5), size: size * (0.5 + Math.random()), drag: 1.5, grav });
    }
  }

  goal(x: number, y: number, z: number, team: number): void {
    const c = new THREE.Color(team === 0 ? 0x3d8bff : 0xff7a1f).multiplyScalar(3);
    const w = new THREE.Color(3, 2.8, 2.5);
    this.burst(x, y, z, 900, 5200, c, 70, 2.4, 400);
    this.burst(x, y, z, 400, 3000, w, 50, 1.6, 300);
    // rising fountains
    for (let k = 0; k < 260; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 300;
      this.spark({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, vz: 2400 + Math.random() * 2400, r: c.r, g: c.g, b: c.b, life: 2 + Math.random(), size: 60, drag: 0.6, grav: 900 });
    }
    // smoke and confetti
    for (let k = 0; k < 160; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 600 + Math.random() * 1200;
      this.smoke({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: Math.random() * 600, r: 0.25, g: 0.27, b: 0.32, life: 3 + Math.random() * 2, size: 300, grow: 260, drag: 1.4, grav: -40 });
    }
    for (let k = 0; k < 400; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 800 + Math.random() * 2500;
      const cc = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
      if (Math.random() < 0.5) cc.set(team === 0 ? 0x3d8bff : 0xff7a1f);
      this.smoke({ x, y, z: z + 200, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 1200 + Math.random() * 2000, r: cc.r, g: cc.g, b: cc.b, life: 4 + Math.random() * 2, size: 22, drag: 2.2, grav: 300 });
    }
    this.wave(x, y, z, 2600, 1.1, c);
    this.wave(x, y, z, 1500, 0.7, w);
  }

  demo(x: number, y: number, z: number): void {
    const f = new THREE.Color(3, 1.3, 0.3);
    this.burst(x, y, z, 260, 1800, f, 80, 1.0, 200);
    this.burst(x, y, z, 120, 2600, new THREE.Color(3, 2.6, 1.8), 30, 0.8, 650);
    for (let k = 0; k < 50; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 500;
      this.smoke({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 200 + Math.random() * 400, r: 0.12, g: 0.12, b: 0.13, life: 2.4, size: 160, grow: 160, drag: 1.2, grav: -60 });
    }
    this.wave(x, y, z, 700, 0.45, f);
  }

  private wave(x: number, y: number, z: number, max: number, life: number, c: THREE.Color): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uK: { value: 1 }, uC: { value: c } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(1.0-abs(dot(normalize(vN),normalize(vV))), 0.0), 3.0); gl_FragColor = vec4(uC*f*uK, f*uK); }`,
    });
    const m = new THREE.Mesh(this.waveGeo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 13;
    this.group.add(m);
    this.waves.push({ mesh: m, age: 0, life, max });
  }

  update(dt: number): void {
    for (const p of [this.glow, this.soft]) {
      let j = 0;
      for (let i = 0; i < p.n; i++) {
        const age = p.age[i] + dt;
        if (age >= p.life[i]) continue;
        // compact into slot j
        if (j !== i) {
          p.pos.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.vel.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.col.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.life[j] = p.life[i];
          p.size[j] = p.size[i];
          p.grow[j] = p.grow[i];
          p.drag[j] = p.drag[i];
          p.grav[j] = p.grav[i];
        }
        p.age[j] = age;
        const dr = Math.exp(-p.drag[j] * dt);
        p.vel[j * 3] *= dr;
        p.vel[j * 3 + 1] *= dr;
        p.vel[j * 3 + 2] = p.vel[j * 3 + 2] * dr - p.grav[j] * dt;
        p.pos[j * 3] += p.vel[j * 3] * dt;
        p.pos[j * 3 + 1] += p.vel[j * 3 + 1] * dt;
        p.pos[j * 3 + 2] += p.vel[j * 3 + 2] * dt;
        if (p.pos[j * 3 + 2] < 2) {
          p.pos[j * 3 + 2] = 2;
          p.vel[j * 3 + 2] *= -0.3;
        }
        p.size[j] += p.grow[j] * dt;
        const t = age / p.life[j];
        const pa = p.aPos.array as Float32Array;
        pa[j * 3] = p.pos[j * 3];
        pa[j * 3 + 1] = p.pos[j * 3 + 1];
        pa[j * 3 + 2] = p.pos[j * 3 + 2];
        const ca = p.aCol.array as Float32Array;
        ca[j * 3] = p.col[j * 3];
        ca[j * 3 + 1] = p.col[j * 3 + 1];
        ca[j * 3 + 2] = p.col[j * 3 + 2];
        (p.aSize.array as Float32Array)[j] = p.size[j];
        (p.aAlpha.array as Float32Array)[j] = (1 - t) * Math.min(1, age * 20);
        j++;
      }
      p.n = j;
      p.geo.setDrawRange(0, j);
      for (const a of [p.aPos, p.aCol, p.aSize, p.aAlpha]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, j * a.itemSize);
        a.needsUpdate = true;
      }
    }
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) {
        this.group.remove(w.mesh);
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(k, 1);
        continue;
      }
      w.mesh.scale.setScalar(w.max * (1 - Math.pow(1 - t, 3)));
      ((w.mesh.material as THREE.ShaderMaterial).uniforms.uK as { value: number }).value = 1 - t;
    }
  }
}
