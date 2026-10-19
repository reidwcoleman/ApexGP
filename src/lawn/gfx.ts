import * as THREE from 'three';

/** Flat-shaded matte material: the whole game's look. */
export function lam(color: string | number, extra: Partial<THREE.MeshLambertMaterialParameters> = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

/** Push every vertex along its radius by a position-keyed amount (so split faces stay joined). */
export function jitterGeo<T extends THREE.BufferGeometry>(geo: T, amp: number, seed: number): T {
  const pos = geo.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = Math.sin(Math.round(v.x * 500) * 12.9898 + Math.round(v.y * 500) * 78.233 + Math.round(v.z * 500) * 37.719 + seed) * 43758.5453;
    const n = k - Math.floor(k);
    v.multiplyScalar(1 + (n - 0.5) * 2 * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function blob(r: number, color: string | number, seed: number, amp = 0.16, detail = 1) {
  const m = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(r, detail), amp, seed), lam(color));
  return m;
}

let glowTex: THREE.Texture | null = null;
/** A soft round glow (additive sprites, lantern halos, fireflies). */
export function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else if (mat) mat.dispose();
  });
}
