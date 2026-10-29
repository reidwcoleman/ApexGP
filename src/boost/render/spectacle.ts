import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapLook } from './looks.ts';

/**
 * Each arena's showpiece, the thing you look up and see between plays: an airship circling with a
 * scrolling sign (every open-air arena), hot-air balloons drifting over the hills and the mesas, wind
 * turbines turning in the fields, birds wheeling over the canyon, a cable car climbing the mountain, a
 * drone light show over the harbour, a halo of LED screens hung over the home bowl, a submarine
 * cruising past the reef. Authored in the simulation frame (cm, z up) under the arena root.
 */

export interface Spectacle {
  group: THREE.Group;
  /** t seconds, day 1 … 0 night */
  update(t: number, day: number): void;
}

const TAU = Math.PI * 2;
const std = (color: number | THREE.Color, rough = 0.6, metal = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0;
    s ^= s + Math.imul(s ^ (s >>> 7), 61 | s);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

/** a glowing dot that always faces you (lamps, burners, nav lights) */
let dotTex: THREE.CanvasTexture | null = null;
function dot(color: THREE.Color, size: number): THREE.Sprite {
  if (!dotTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d')!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    dotTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

/** an LED sign: a strip of text scrolling along (the texture repeats round) */
function signTexture(words: string[], h = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = h;
  const x = c.getContext('2d')!;
  x.fillStyle = '#04060c';
  x.fillRect(0, 0, c.width, h);
  x.font = `italic 900 ${Math.round(h * 0.62)}px "Titillium Web", Arial, sans-serif`;
  x.textBaseline = 'middle';
  let px = 30;
  let k = 0;
  while (px < c.width) {
    const w = words[k % words.length];
    x.fillStyle = ['#3d8bff', '#ff8a2a', '#ffffff', '#ffd34a'][k % 4];
    x.fillText(w, px, h * 0.54);
    px += x.measureText(w).width + 70;
    k++;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ the airship
function airship(radius: number, z: number): Spectacle {
  const grp = new THREE.Group();
  const ship = new THREE.Group();
  grp.add(ship);
  const L = 3200;
  const body = new THREE.SphereGeometry(1, 40, 20);
  body.scale(L / 2, L * 0.13, L * 0.13);
  ship.add(new THREE.Mesh(body, std(0xe9edf3, 0.35, 0.1)));
  // fins in team colours, a gondola underneath
  const finM = [std(0x1d5ae6, 0.4), std(0xff6a10, 0.4)];
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(420, 20, 360), finM[k % 2]);
    const a = (k / 4) * TAU;
    f.position.set(-L * 0.42, Math.cos(a) * L * 0.1, Math.sin(a) * L * 0.1);
    f.rotation.x = a;
    ship.add(f);
  }
  const gond = new THREE.Mesh(new THREE.BoxGeometry(520, 150, 140), std(0x23262e, 0.5, 0.4));
  gond.position.set(120, 0, -L * 0.135);
  ship.add(gond);
  // the sign down each flank
  const tex = signTexture(['BOOSTBALL', 'GOAL!', 'SUPERSONIC', 'WHAT A SAVE', 'NITRO LEAGUE']);
  tex.repeat.set(1.5, 1);
  const signM = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide });
  for (const s of [1, -1]) {
    const g = new THREE.CylinderGeometry(L * 0.132, L * 0.132, L * 0.5, 32, 1, true, s > 0 ? -0.55 : Math.PI - 0.55, 1.1);
    g.rotateZ(Math.PI / 2);
    const m = new THREE.Mesh(g, signM);
    ship.add(m);
  }
  // nav lights
  const red = dot(new THREE.Color(3, 0.3, 0.2), 220);
  red.position.set(0, L * 0.135, 0);
  const green = dot(new THREE.Color(0.3, 3, 0.6), 220);
  green.position.set(0, -L * 0.135, 0);
  const strobe = dot(new THREE.Color(3, 3, 3), 300);
  strobe.position.set(-L * 0.5, 0, 0);
  ship.add(red, green, strobe);
  return {
    group: grp,
    update(t, day) {
      const a = t * 0.045;
      ship.position.set(Math.cos(a) * radius, Math.sin(a) * radius * 1.15, z + Math.sin(t * 0.3) * 200);
      ship.rotation.set(Math.sin(t * 0.4) * 0.03, 0, a + Math.PI / 2);
      tex.offset.x = (t * 0.06) % 1;
      const n = 1 - day;
      red.material.opacity = green.material.opacity = 0.3 + 0.7 * n;
      strobe.material.opacity = (Math.sin(t * 6) > 0.85 ? 1 : 0) * (0.4 + 0.6 * n);
    },
  };
}

// ------------------------------------------------------------------ hot-air balloons
function balloons(n: number, seed: number, r0: number, r1: number, z0: number, z1: number): Spectacle {
  const grp = new THREE.Group();
  const r = rng(seed);
  // a teardrop envelope (lathe) with vertical gores
  const prof: THREE.Vector2[] = [];
  for (let k = 0; k <= 20; k++) {
    const v = k / 20;
    const a = v * Math.PI;
    const rad = Math.sin(a) * (1 - 0.45 * Math.pow(1 - v, 2.2)) + (v < 0.12 ? 0.12 - v : 0) * 0.6;
    prof.push(new THREE.Vector2(Math.max(0.12, rad) * 0.62, -Math.cos(a) * 0.82 + (v < 0.5 ? (0.5 - v) * -0.18 : 0)));
  }
  const env = new THREE.LatheGeometry(prof, 24);
  const palettes = [
    [0xff3d5a, 0xffd34a],
    [0x2f7bff, 0xffffff],
    [0x39e07a, 0xffd34a],
    [0xb44dff, 0x2ee6e6],
    [0xff7a1f, 0x1b1d22],
    [0xffffff, 0xff3d5a],
  ];
  const items: { g: THREE.Group; x: number; y: number; z: number; ph: number; s: number; burn: THREE.Sprite }[] = [];
  for (let k = 0; k < n; k++) {
    const g = new THREE.Group();
    const pal = palettes[k % palettes.length].map((h) => new THREE.Color(h));
    const geo = env.clone();
    const p = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const gore = Math.floor(((Math.atan2(p.getZ(i), p.getX(i)) / TAU + 1) % 1) * 12);
      const c = pal[gore % 2];
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, std(0xffffff, 0.75, 0, { vertexColors: true }));
    g.add(m);
    const basket = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.12), std(0x6b4a2a, 0.9));
    basket.position.z = -1.12;
    g.add(basket);
    const ropes = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [new THREE.Vector3(sx * 0.07, sy * 0.07, -1.06), new THREE.Vector3(sx * 0.16, sy * 0.16, -0.78)]))),
      new THREE.LineBasicMaterial({ color: 0x2a2018 }),
    );
    g.add(ropes);
    const burn = dot(new THREE.Color(3, 1.6, 0.5), 0.35);
    burn.position.z = -0.92;
    g.add(burn);
    const s = 900 + r() * 700;
    g.scale.setScalar(s);
    const a = r() * TAU;
    const d = r0 + (r1 - r0) * r();
    items.push({ g, x: Math.cos(a) * d, y: Math.sin(a) * d, z: z0 + (z1 - z0) * r(), ph: r() * TAU, s, burn });
    grp.add(g);
  }
  return {
    group: grp,
    update(t, day) {
      for (const b of items) {
        // drifting on a slow wind, wrapping round the far side, rising and sinking a little
        const wx = ((b.x + t * 60 + r1) % (2 * r1)) - r1;
        const rr = Math.hypot(wx, b.y);
        const push = rr < r0 ? r0 / Math.max(rr, 1) : 1;
        b.g.position.set(wx * push, b.y * push, b.z + Math.sin(t * 0.15 + b.ph) * 300);
        b.g.rotation.z = t * 0.02 + b.ph;
        // the burner blazes now and then (bright at dusk and night)
        const on = Math.sin(t * 0.7 + b.ph * 3) > 0.6 ? 1 : 0.15;
        b.burn.material.opacity = on * (0.25 + 0.75 * (1 - day));
      }
    },
  };
}

// ------------------------------------------------------------------ wind turbines
function turbines(n: number, seed: number, r0: number, r1: number, ground: number): Spectacle {
  const grp = new THREE.Group();
  const r = rng(seed);
  const white = std(0xf2f4f7, 0.45, 0.1);
  const H = 9000;
  const tower = new THREE.CylinderGeometry(70, 150, H, 12).rotateX(Math.PI / 2).translate(0, 0, H / 2);
  const nacelle = new THREE.BoxGeometry(520, 180, 200).translate(120, 0, H);
  const static_ = mergeGeometries([tower, nacelle]);
  const blade = new THREE.BoxGeometry(60, 30, 3600).translate(0, 0, 1800);
  const blades = mergeGeometries([0, 1, 2].map((k) => blade.clone().rotateX((k / 3) * TAU)));
  const rotors: { m: THREE.Mesh; sp: number }[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + r() * 0.3;
    const d = r0 + (r1 - r0) * r();
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * d, Math.sin(a) * d, ground);
    // (all facing into the same wind)
    g.rotation.z = 0.6;
    g.add(new THREE.Mesh(static_, white));
    const rot = new THREE.Mesh(blades, white);
    rot.position.set(-180, 0, H);
    g.add(rot);
    const lamp = dot(new THREE.Color(3, 0.3, 0.2), 260);
    lamp.position.set(120, 0, H + 130);
    g.add(lamp);
    rotors.push({ m: rot, sp: 0.5 + r() * 0.25 });
    grp.add(g);
  }
  return {
    group: grp,
    update(t) {
      for (const q of rotors) q.m.rotation.x = t * q.sp;
    },
  };
}

// ------------------------------------------------------------------ birds
function birds(n: number, seed: number, z: number): Spectacle {
  const r = rng(seed);
  const geo = new THREE.BufferGeometry();
  // two wings per bird: a flat V that flaps (one triangle each side)
  const pos = new Float32Array(n * 18);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a1410, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  const B = Array.from({ length: n }, () => ({ c: [(r() - 0.5) * 20000, (r() - 0.5) * 20000] as [number, number], rad: 1500 + r() * 2500, sp: (0.15 + r() * 0.1) * (r() < 0.5 ? -1 : 1), ph: r() * TAU, z: z + r() * 2500, s: 90 + r() * 60 }));
  const grp = new THREE.Group();
  grp.add(m);
  return {
    group: grp,
    update(t) {
      B.forEach((b, i) => {
        const a = b.ph + t * b.sp;
        const x = b.c[0] + Math.cos(a) * b.rad;
        const y = b.c[1] + Math.sin(a) * b.rad;
        const fx = -Math.sin(a) * Math.sign(b.sp);
        const fy = Math.cos(a) * Math.sign(b.sp);
        const sx = -fy;
        const sy = fx;
        const flap = Math.sin(t * 5 + b.ph * 4) * 0.5 * b.s;
        const o = i * 18;
        const w = b.s * 1.6;
        for (const [k, sd] of [[0, 1], [9, -1]]) {
          pos.set([x + fx * b.s * 0.4, y + fy * b.s * 0.4, b.z, x - fx * b.s * 0.3, y - fy * b.s * 0.3, b.z, x + sx * w * sd, y + sy * w * sd, b.z + flap], o + k);
        }
      });
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ the cable car
function cableCar(): Spectacle {
  const grp = new THREE.Group();
  const A = new THREE.Vector3(9500, -6000, 2600);
  const B = new THREE.Vector3(52000, -36000, 22000);
  const steel = std(0x6d737d, 0.4, 0.8);
  // pylons along the line
  for (let k = 1; k < 5; k++) {
    const p = A.clone().lerp(B, k / 5);
    const h = 1400 + k * 400;
    const py = new THREE.Mesh(new THREE.BoxGeometry(160, 160, h).translate(0, 0, -h / 2), steel);
    py.position.copy(p).add(new THREE.Vector3(0, 0, 200));
    grp.add(py);
  }
  // two cables, one each way, sagging between the pylons
  const cable = (off: number) => {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 60; k++) {
      const u = k / 60;
      const p = A.clone().lerp(B, u);
      p.z -= Math.sin(((u * 5) % 1) * Math.PI) * 300;
      p.x += off;
      pts.push(p);
    }
    return pts;
  };
  const lines = [cable(-250), cable(250)];
  for (const pts of lines) grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x23262e })));
  const cabM = [std(0xd62a2a, 0.35, 0.2), std(0xffd34a, 0.35, 0.2)];
  const glassM = std(0x223344, 0.1, 0.6);
  const cabs: { g: THREE.Group; u: number; line: number; lamp: THREE.Sprite }[] = [];
  for (let k = 0; k < 8; k++) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(320, 260, 260), cabM[k % 2]);
    box.position.z = -420;
    const win = new THREE.Mesh(new THREE.BoxGeometry(330, 270, 90), glassM);
    win.position.z = -360;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 300).translate(0, 0, -150), steel);
    const lamp = dot(new THREE.Color(3, 2.6, 1.6), 200);
    lamp.position.z = -360;
    g.add(box, win, arm, lamp);
    grp.add(g);
    cabs.push({ g, u: k / 8, line: k % 2, lamp });
  }
  const at = (pts: THREE.Vector3[], u: number) => {
    const f = Math.min(0.9999, Math.max(0, u)) * (pts.length - 1);
    const i = Math.floor(f);
    return pts[i].clone().lerp(pts[i + 1], f - i);
  };
  return {
    group: grp,
    update(t, day) {
      for (const c of cabs) {
        const u = (c.u + t * 0.012) % 1;
        c.g.position.copy(at(lines[c.line], c.line ? u : 1 - u));
        c.g.rotation.z = Math.sin(t * 0.8 + c.u * 9) * 0.03;
        c.lamp.material.opacity = 0.2 + 0.8 * (1 - day);
      }
    },
  };
}

// ------------------------------------------------------------------ the drone show
function droneShow(n: number): Spectacle {
  const grp = new THREE.Group();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uK: { value: 1 } },
    vertexShader: `attribute vec3 color; varying vec3 vC; uniform float uK; void main(){ vC = color * uK; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(9000.0 / -mv.z, 2.0, 14.0); }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; float k = exp(-d * 3.5); gl_FragColor = vec4(vC * k, k); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  grp.add(pts);
  // formations, each a function of the drone's index (0…1) and time: a ring, a double helix, a ball,
  // a wave, the two team colours facing off
  const C = new THREE.Vector3(0, 0, 9000);
  const forms: ((u: number, t: number, o: THREE.Vector3) => void)[] = [
    (u, t, o) => o.set(Math.cos(u * TAU + t * 0.4) * 4200, Math.sin(u * TAU + t * 0.4) * 4200, Math.sin(u * TAU * 4 + t) * 300),
    (u, t, o) => {
      const s = u < 0.5 ? 0 : Math.PI;
      const v = (u * 2) % 1;
      o.set(Math.cos(v * TAU * 2 + s + t * 0.6) * 1800, Math.sin(v * TAU * 2 + s + t * 0.6) * 1800, (v - 0.5) * 7000);
    },
    (u, t, o) => {
      const phi = Math.acos(1 - 2 * ((u * 977) % 1));
      const th = u * TAU * 37 + t * 0.3;
      o.set(Math.sin(phi) * Math.cos(th) * 3200, Math.sin(phi) * Math.sin(th) * 3200, Math.cos(phi) * 3200);
    },
    (u, t, o) => {
      const gx = (u * 16) % 1;
      const gy = Math.floor(u * 16) / 16;
      o.set((gx - 0.5) * 9000, (gy - 0.5) * 9000, Math.sin(gx * 6 + t * 1.5) * 600 + Math.cos(gy * 5 + t) * 600);
    },
  ];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Color();
  return {
    group: grp,
    update(t, day) {
      const period = 9;
      const f = Math.floor(t / period);
      const k = THREE.MathUtils.smoothstep((t % period) / period, 0.72, 1);
      const F0 = forms[f % forms.length];
      const F1 = forms[(f + 1) % forms.length];
      for (let i = 0; i < n; i++) {
        const u = i / n;
        F0(u, t, a);
        F1(u, t, b);
        a.lerp(b, k).add(C);
        pos.set([a.x, a.y, a.z], i * 3);
        if (f % 2) c.setHSL((u + t * 0.05) % 1, 1, 0.55);
        else c.set(u < 0.5 ? 0x3d8bff : 0xff8a2a);
        col.set([c.r * 2.4, c.g * 2.4, c.b * 2.4], i * 3);
      }
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      mat.uniforms.uK.value = 0.35 + 0.65 * (1 - day);
    },
  };
}

// ------------------------------------------------------------------ the halo
function halo(): Spectacle {
  const grp = new THREE.Group();
  const R = 2600;
  const ring = new THREE.Group();
  ring.position.z = 5000;
  grp.add(ring);
  const tex = signTexture(['BOOSTBALL', 'APEX', 'KICKOFF', 'AERIAL', 'DEMOLITION', 'FLIP RESET'], 160);
  tex.repeat.set(3, 1);
  const screen = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 520, 64, 1, true).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5), side: THREE.DoubleSide }));
  ring.add(screen);
  const frameM = std(0x15181f, 0.5, 0.7);
  for (const z of [-290, 290]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(R, 40, 8, 64), frameM);
    t.position.z = z;
    ring.add(t);
  }
  // a band of team light under it
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(R, 18, 6, 96),
    new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uT; varying vec3 vP; void main(){ float a = atan(vP.y, vP.x); vec3 c = mix(vec3(0.3, 0.8, 3.0), vec3(3.0, 1.0, 0.2), 0.5 + 0.5 * sin(a * 2.0 + uT)); gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  glow.position.z = -330;
  ring.add(glow);
  // cables up to the roof
  const cab = new THREE.LineBasicMaterial({ color: 0x30343c });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const p = new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R, 5300);
    const q = new THREE.Vector3(Math.cos(a) * R * 2.2, Math.sin(a) * R * 2.6, 7300);
    grp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, q]), cab));
  }
  return {
    group: grp,
    update(t) {
      ring.rotation.z = t * 0.05;
      tex.offset.x = (t * 0.03) % 1;
      (glow.material as THREE.ShaderMaterial).uniforms.uT.value = t;
    },
  };
}

// ------------------------------------------------------------------ the submarine
function submarine(): Spectacle {
  const grp = new THREE.Group();
  const sub = new THREE.Group();
  grp.add(sub);
  const hullM = std(0xffc21a, 0.4, 0.3);
  const L = 2600;
  const hull = new THREE.CapsuleGeometry(L * 0.11, L * 0.75, 8, 24).rotateZ(Math.PI / 2);
  sub.add(new THREE.Mesh(hull, hullM));
  const tower = new THREE.Mesh(new THREE.BoxGeometry(L * 0.18, L * 0.06, L * 0.12), hullM);
  tower.position.set(L * 0.08, 0, L * 0.14);
  sub.add(tower);
  const portM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 1.4) });
  for (let k = -3; k <= 3; k++)
    for (const s of [1, -1]) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(40, 12), portM);
      p.position.set(k * 220, s * L * 0.111, 30);
      p.rotation.x = (s * Math.PI) / 2;
      sub.add(p);
    }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 420), std(0x3a3e46, 0.4, 0.8));
  prop.position.x = -L * 0.5;
  sub.add(prop);
  // a searchlight ahead
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 900, 6000, 20, 1, true).rotateZ(Math.PI / 2).translate(3000 + L * 0.5, 0, 0),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = uv.y; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vL; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = f * pow(vL, 2.0) * 0.12; gl_FragColor = vec4(vec3(0.8, 1.0, 1.0) * a, a); }`,
    }),
  );
  sub.add(beam);
  const lamp = dot(new THREE.Color(3, 3, 2.6), 380);
  lamp.position.x = L * 0.5;
  sub.add(lamp);
  return {
    group: grp,
    update(t) {
      const a = t * 0.03 + 2;
      sub.position.set(Math.cos(a) * 15000, Math.sin(a) * 17000, 4200 + Math.sin(t * 0.2) * 600);
      sub.rotation.set(0, Math.sin(t * 0.2) * 0.04, a + Math.PI / 2);
      prop.rotation.x = t * 6;
    },
  };
}

/** the showpieces for an arena (null: none) */
export function buildSpectacle(map: MapLook): Spectacle | null {
  const parts: Spectacle[] = [];
  const open = map.surround !== 'ocean';
  if (map.surround === 'ocean') parts.push(submarine());
  if (map.id === 'apex') parts.push(halo());
  if (open) parts.push(airship(map.tiers === 2 ? 17000 : 14000, map.tiers === 2 ? 12000 : 9000));
  if (map.surround === 'hills') parts.push(balloons(7, 3, 12000, 30000, 4500, 12000), turbines(9, 5, 19000, 28000, -800), birds(18, 7, 5000));
  if (map.surround === 'canyon') parts.push(balloons(9, 11, 12000, 32000, 5000, 15000), birds(14, 13, 6000));
  if (map.surround === 'mountains') parts.push(cableCar());
  if (map.surround === 'city') parts.push(droneShow(420));
  if (!parts.length) return null;
  const group = new THREE.Group();
  for (const p of parts) group.add(p.group);
  return { group, update: (t, d) => parts.forEach((p) => p.update(t, d)) };
}
