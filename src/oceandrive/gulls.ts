import * as THREE from 'three';

/** laughing gulls over the beach: a body and two jointed wings each, gliding loops with a few flaps */
interface Gull {
  g: THREE.Group;
  wl: THREE.Object3D;
  wr: THREE.Object3D;
  cx: number;
  cz: number;
  r: number;
  h: number;
  w: number;
  ph: number;
}

export class Gulls {
  private readonly list: Gull[] = [];
  readonly root = new THREE.Group();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.8 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.8, side: THREE.DoubleSide });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d1d20, roughness: 0.8 });
    const body = new THREE.CapsuleGeometry(0.07, 0.3, 4, 8);
    body.rotateX(Math.PI / 2);
    const head = new THREE.SphereGeometry(0.06, 8, 6);
    // a wing: a swept trapezoid, root at the origin, along +x
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.1, 0.62, 0, 0.02, 0.62, 0, -0.1, 0, 0, -0.12, 0.62, 0, 0.02, 0.62, 0, -0.1], 3));
    wing.setIndex([0, 1, 3, 1, 2, 3]);
    wing.computeVertexNormals();
    let s = 99;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(body, white));
      const hd = new THREE.Mesh(head, dark);
      hd.position.set(0, 0.03, 0.22);
      g.add(hd);
      const wl = new THREE.Mesh(wing, grey);
      const wr = new THREE.Mesh(wing, grey);
      wr.scale.x = -1;
      g.add(wl, wr);
      g.scale.setScalar(1.1);
      this.root.add(g);
      this.list.push({ g, wl, wr, cx: 120 + rnd() * 120, cz: -60 + rnd() * 120, r: 12 + rnd() * 25, h: 9 + rnd() * 16, w: (0.12 + rnd() * 0.1) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6.28 });
    }
  }

  update(t: number) {
    for (const b of this.list) {
      const a = b.ph + t * b.w;
      const x = b.cx + Math.cos(a) * b.r, z = b.cz + Math.sin(a) * b.r;
      const y = b.h + Math.sin(t * 0.3 + b.ph) * 1.5;
      b.g.position.set(x, y, z);
      // heading along the circle, banked into the turn
      b.g.rotation.set(0, Math.atan2(-Math.sin(a) * Math.sign(b.w), Math.cos(a) * Math.sign(b.w)), -Math.sign(b.w) * 0.35, 'YXZ');
      // flap in bursts, glide in between
      const burst = Math.max(0, Math.sin(t * 0.5 + b.ph * 3));
      const flap = Math.sin(t * 11 + b.ph) * 0.6 * burst + 0.12;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
  }
}
