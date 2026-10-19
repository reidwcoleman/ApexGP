/**
 * The things that stand on a lawn: rocks, trees, bushes, gnomes, flower beds, ponds, hedges,
 * fences, benches, picnic tables and lanterns. All low-poly, flat-shaded, built in code.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ObstacleDef, Theme } from './levels.ts';
import { Rng } from './util.ts';
import { blob, glowTexture, lam } from './gfx.ts';

export interface Prop {
  group: THREE.Group;
  /** Canopy materials fade out when the mower is hidden behind them. */
  canopy?: { mats: THREE.MeshLambertMaterial[]; x: number; z: number; r: number };
  update?: (t: number, dt: number) => void;
}

const WOOD = '#b98350';
const WOOD_D = '#8f5f37';

export function buildProp(o: ObstacleDef, theme: Theme, waterTime: { value: number }): Prop {
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.z);
  const rng = new Rng(o.seed);
  const p: Prop = { group: g };
  switch (o.kind) {
    case 'rock': {
      const base = blob(o.size, theme.stone, o.seed, 0.2);
      base.scale.set(1.05, 0.7, 0.95);
      base.position.y = o.size * 0.42;
      base.rotation.y = o.rot;
      g.add(base);
      if (rng.chance(0.7)) {
        const s = blob(o.size * 0.5, theme.stone, o.seed + 3, 0.2);
        s.scale.set(1, 0.7, 1);
        s.position.set(o.size * 0.85, o.size * 0.18, o.size * 0.2);
        s.material.color.offsetHSL(0, 0, -0.05);
        g.add(s);
      }
      const moss = blob(o.size * 0.5, theme.canopy[2], o.seed + 9, 0.22);
      moss.scale.set(1, 0.32, 1);
      moss.position.set(-o.size * 0.15, o.size * 0.7, o.size * 0.1);
      g.add(moss);
      break;
    }
    case 'tree': {
      const s = o.size;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.17 * s, 1.05 * s, 7), lam(theme.trunk));
      trunk.position.y = 0.52 * s;
      g.add(trunk);
      const canopy = new THREE.Group();
      const mats: THREE.MeshLambertMaterial[] = [];
      const spots: [number, number, number, number][] = [
        [0, 1.45, 0, 0.9],
        [0.36, 1.95, 0.08, 0.64],
        [-0.34, 1.82, -0.18, 0.58],
        [-0.05, 2.28, 0.1, 0.4],
      ];
      for (let i = 0; i < spots.length; i++) {
        const [x, y, z, r] = spots[i];
        const b = blob(r * s, theme.canopy[i % theme.canopy.length], o.seed + i * 5, 0.13);
        b.position.set(x * s, y * s, z * s);
        (b.material as THREE.MeshLambertMaterial).transparent = true;
        mats.push(b.material as THREE.MeshLambertMaterial);
        canopy.add(b);
      }
      if (theme.id === 'meadow') {
        for (let i = 0; i < 7; i++) {
          const a = rng.range(0, Math.PI * 2);
          const h = rng.range(0.1, 0.9);
          const ap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 * s, 0), lam('#ff4d4d'));
          ap.position.set(Math.cos(a) * 0.86 * s * (1 - h * 0.25), (1.2 + h * 0.5) * s, Math.sin(a) * 0.86 * s * (1 - h * 0.25));
          canopy.add(ap);
        }
      }
      g.add(canopy);
      p.canopy = { mats, x: o.x, z: o.z, r: 1.15 * s };
      p.update = (t) => {
        canopy.rotation.z = Math.sin(t * 0.9 + o.seed) * 0.012;
        canopy.rotation.x = Math.cos(t * 0.7 + o.seed) * 0.01;
      };
      break;
    }
    case 'bush': {
      const n = 3;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + o.rot;
        const r = o.size * (i === 0 ? 0.85 : 0.62);
        const b = blob(r, theme.canopy[(i + 1) % theme.canopy.length], o.seed + i * 7, 0.15);
        b.position.set(i === 0 ? 0 : Math.cos(a) * o.size * 0.62, r * 0.82, i === 0 ? 0 : Math.sin(a) * o.size * 0.62);
        g.add(b);
      }
      for (let i = 0; i < 6; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = new THREE.Mesh(new THREE.IcosahedronGeometry(0.055, 0), lam(rng.pick(theme.blooms)));
        d.position.set(Math.cos(a) * o.size * 0.78, o.size * rng.range(0.7, 1.15), Math.sin(a) * o.size * 0.78);
        g.add(d);
      }
      break;
    }
    case 'gnome': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.3, 8), lam('#3f78d8'));
      body.position.y = 0.15;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), lam('#f7c9a2'));
      head.position.y = 0.38;
      g.add(head);
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.26, 8), lam('#ffffff'));
      beard.position.set(0, 0.27, 0.07);
      beard.rotation.x = Math.PI;
      g.add(beard);
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 8), lam('#e8402f'));
      hat.position.y = 0.6;
      hat.rotation.z = 0.12;
      g.add(hat);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), lam('#f2a07c'));
      nose.position.set(0, 0.38, 0.1);
      g.add(nose);
      g.rotation.y = o.rot;
      break;
    }
    case 'lantern': {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.15, 6), lam('#2e2a3d'));
      pole.position.y = 0.58;
      g.add(pole);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.13, 6), lam('#2e2a3d'));
      cap.position.y = 1.42;
      g.add(cap);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffe7a0' }));
      lamp.position.y = 1.25;
      g.add(lamp);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd98a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
      halo.scale.set(1.5, 1.5, 1);
      halo.position.y = 1.25;
      g.add(halo);
      p.update = (t) => {
        (halo.material as THREE.SpriteMaterial).opacity = 0.72 + Math.sin(t * 3 + o.seed) * 0.08;
      };
      break;
    }
    case 'bed': {
      g.rotation.y = o.rot;
      const { hw, hd } = o;
      const frameMat = lam(WOOD);
      const mk = (w: number, h: number, d: number, x: number, y: number, z: number, m = frameMat) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        b.position.set(x, y, z);
        g.add(b);
      };
      mk(hw * 2, 0.22, 0.09, 0, 0.11, hd - 0.045);
      mk(hw * 2, 0.22, 0.09, 0, 0.11, -hd + 0.045);
      mk(0.09, 0.22, hd * 2 - 0.18, hw - 0.045, 0.11, 0);
      mk(0.09, 0.22, hd * 2 - 0.18, -hw + 0.045, 0.11, 0);
      mk(hw * 2 - 0.18, 0.18, hd * 2 - 0.18, 0, 0.09, 0, lam('#5b3a29'));
      const cols = Math.max(3, Math.round(hw * 4.4));
      const rows = Math.max(2, Math.round(hd * 4));
      const stemMat = lam('#3f9f45');
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = -hw + 0.22 + (c / (cols - 1)) * (hw * 2 - 0.44) + rng.range(-0.04, 0.04);
          const z = -hd + 0.2 + (r / Math.max(1, rows - 1)) * (hd * 2 - 0.4) + rng.range(-0.04, 0.04);
          const h = rng.range(0.32, 0.5);
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, h, 4), stemMat);
          stem.position.set(x, 0.18 + h / 2, z);
          g.add(stem);
          const head = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.08, 0.115), 0), lam(rng.pick(theme.blooms)));
          head.position.set(x, 0.18 + h, z);
          g.add(head);
        }
      }
      break;
    }
    case 'pond': {
      const r = o.size;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: waterTime,
          uA: { value: new THREE.Color(theme.id === 'dusk' ? '#2a4f9a' : '#38aef0') },
          uB: { value: new THREE.Color(theme.id === 'dusk' ? '#6f9cf0' : '#9be5ff') },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uTime; uniform vec3 uA; uniform vec3 uB;
          void main() {
            vec2 q = vUv - 0.5;
            float d = length(q) * 2.0;
            float ring = sin(d * 16.0 - uTime * 1.7) * 0.5 + 0.5;
            float ring2 = sin(d * 9.0 + uTime * 1.1 + q.x * 4.0) * 0.5 + 0.5;
            vec3 c = mix(uB, uA, smoothstep(0.1, 0.95, d));
            c += (ring * 0.05 + ring2 * 0.04);
            float spark = pow(max(0.0, sin((q.x + q.y) * 38.0 + uTime * 2.4) * sin((q.x - q.y) * 31.0 - uTime * 1.9)), 8.0);
            c += spark * 0.35;
            c = mix(c, vec3(0.93, 1.0, 1.0), smoothstep(0.82, 0.97, d) * 0.7);
            gl_FragColor = vec4(c, 1.0);
            #include <colorspace_fragment>
          }`,
      });
      const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.97, 44), mat);
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.05;
      g.add(water);
      const n = Math.round(r * 13);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rng.range(-0.05, 0.05);
        const s = rng.range(0.13, 0.22);
        const st = blob(s, theme.stone, o.seed + i, 0.2, 0);
        st.scale.y = 0.65;
        st.position.set(Math.cos(a) * r, 0.07, Math.sin(a) * r);
        g.add(st);
      }
      const pads: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.15, 0.55) * r;
        const pad = new THREE.Mesh(new THREE.CircleGeometry(rng.range(0.16, 0.24), 10, 0.3, Math.PI * 1.85), lam('#3fb34f'));
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rng.range(0, 6);
        pad.position.set(Math.cos(a) * d, 0.075, Math.sin(a) * d);
        g.add(pad);
        pads.push(pad);
        if (i === 0) {
          const fl = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.1, 6), lam('#ff9ac4'));
          fl.position.set(pad.position.x, 0.12, pad.position.z);
          g.add(fl);
        }
      }
      // a duck that paddles about
      const duck = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), lam('#ffffff'));
      body.scale.set(1, 0.75, 1.3);
      body.position.y = 0.13;
      duck.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), lam('#2f9f5f'));
      head.position.set(0, 0.26, 0.11);
      duck.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 6), lam('#ffa63a'));
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.25, 0.2);
      duck.add(beak);
      g.add(duck);
      const orbit = r * 0.5;
      const ph = rng.range(0, 6);
      p.update = (t) => {
        const a = t * 0.32 + ph;
        duck.position.set(Math.cos(a) * orbit, 0.05 + Math.sin(t * 3) * 0.008, Math.sin(a) * orbit);
        duck.rotation.y = -a;
        pads.forEach((pd, i) => (pd.position.y = 0.075 + Math.sin(t * 1.4 + i) * 0.006));
      };
      break;
    }
    case 'hedge': {
      g.rotation.y = o.rot;
      const hedgeCol = theme.id === 'dusk' ? '#1f7f74' : theme.id === 'autumn' ? '#4f7d2a' : '#2e9a45';
      const body = new THREE.Mesh(new RoundedBoxGeometry(o.hw * 2, 0.9, o.hd * 2, 3, 0.14), lam(hedgeCol));
      body.position.y = 0.45;
      g.add(body);
      const n = Math.max(2, Math.round(o.hw * 2.2));
      for (let i = 0; i < n; i++) {
        const x = -o.hw + (i + 0.5) * ((o.hw * 2) / n);
        const b = blob(0.33, theme.canopy[i % 3], o.seed + i, 0.15, 1);
        b.position.set(x, 0.92, rng.range(-0.04, 0.04));
        g.add(b);
      }
      break;
    }
    case 'fence': {
      g.rotation.y = o.rot;
      const count = Math.max(4, Math.floor((o.hw * 2) / 0.25));
      const pick = new THREE.BoxGeometry(0.13, 0.64, 0.05);
      const tip = new THREE.ConeGeometry(0.092, 0.1, 4);
      tip.rotateY(Math.PI / 4);
      tip.translate(0, 0.37, 0);
      const mat = lam('#f6ecd8');
      const im = new THREE.InstancedMesh(pick, mat, count);
      const it = new THREE.InstancedMesh(tip, mat, count);
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const x = -o.hw + 0.1 + (i / (count - 1)) * (o.hw * 2 - 0.2);
        const hv = rng.range(-0.025, 0.025);
        m.makeTranslation(x, 0.34 + hv, 0);
        im.setMatrixAt(i, m);
        m.makeTranslation(x, 0.34 + hv, 0);
        it.setMatrixAt(i, m);
      }
      g.add(im, it);
      for (const y of [0.22, 0.5]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2, 0.06, 0.05), lam('#e7d9bc'));
        rail.position.set(0, y, -0.05);
        g.add(rail);
      }
      for (const x of [-o.hw + 0.04, o.hw - 0.04]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), lam('#e0cfae'));
        post.position.set(x, 0.4, 0);
        g.add(post);
      }
      break;
    }
    case 'bench': {
      g.rotation.y = o.rot;
      const mk = (w: number, h: number, d: number, x: number, y: number, z: number, c = WOOD) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(c));
        b.position.set(x, y, z);
        g.add(b);
      };
      mk(o.hw * 2, 0.07, o.hd * 1.3, 0, 0.42, 0.04);
      mk(o.hw * 2, 0.34, 0.06, 0, 0.66, -o.hd + 0.06);
      mk(0.08, 0.4, o.hd * 1.6, -o.hw + 0.1, 0.2, 0, WOOD_D);
      mk(0.08, 0.4, o.hd * 1.6, o.hw - 0.1, 0.2, 0, WOOD_D);
      break;
    }
    case 'table': {
      g.rotation.y = o.rot;
      const top = new THREE.Mesh(new RoundedBoxGeometry(o.hw * 2, 0.07, o.hd * 2, 2, 0.03), lam(WOOD));
      top.position.y = 0.62;
      g.add(top);
      const cl = document.createElement('canvas');
      cl.width = cl.height = 64;
      const c2 = cl.getContext('2d')!;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        c2.fillStyle = (x + y) % 2 ? '#ffffff' : '#ef5350';
        c2.fillRect(x * 8, y * 8, 8, 8);
      }
      const tex = new THREE.CanvasTexture(cl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(o.hw * 1.2, o.hd * 1.3), new THREE.MeshLambertMaterial({ map: tex }));
      cloth.rotation.x = -Math.PI / 2;
      cloth.position.y = 0.66;
      g.add(cloth);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.6, 0.09), lam(WOOD_D));
        leg.position.set(sx * (o.hw - 0.14), 0.3, sz * (o.hd - 0.12));
        g.add(leg);
      }
      const basket = new THREE.Mesh(new RoundedBoxGeometry(0.28, 0.18, 0.2, 2, 0.04), lam('#c58b4a'));
      basket.position.set(-o.hw * 0.3, 0.76, 0);
      g.add(basket);
      const fruit = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), lam('#ff5a4a'));
      fruit.position.set(-o.hw * 0.3, 0.88, 0);
      g.add(fruit);
      break;
    }
  }
  return p;
}
