/** Where a body can be hit: a head and two capsules, from its state alone, so both ends agree. */
export interface Body {
  x: number;
  y: number;
  z: number;
  yaw: number;
  lean: number;
  crouch: boolean;
}

export function bodyHeight(crouch: boolean) {
  return crouch ? 1.22 : 1.78;
}

/** nearest hit of a ray on a body within t; zone 0 head, 1 torso, 2 arm, 4 leg */
export function hitBody(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Body, maxT: number): { t: number; zone: number } | null {
  const h = bodyHeight(b.crouch);
  const lx = Math.cos(b.yaw) * b.lean * 0.3, lz = -Math.sin(b.yaw) * b.lean * 0.3;
  let best: { t: number; zone: number } | null = null;
  const sph = (cx: number, cy: number, cz: number, r: number, zone: number) => {
    const t = raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r);
    if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, zone };
  };
  sph(b.x + lx, b.y + h - 0.12, b.z + lz, 0.125, 0);
  // the torso and the legs as strings of spheres: simple, and close enough to a capsule
  const top = h - 0.28, mid = h * 0.52;
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    sph(b.x + lx * k, b.y + mid + (top - mid) * k, b.z + lz * k, 0.215, 1);
  }
  for (let i = 0; i <= 4; i++) sph(b.x, b.y + 0.1 + (mid - 0.14) * (i / 4), b.z, 0.17, 4);
  // the arms hang outside the chest: shoulders to the elbows, along the body's right
  const ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
  for (const sd of [-1, 1]) for (let i = 0; i <= 2; i++) sph(b.x + lx + ax * sd * 0.29, b.y + top - 0.04 - i * 0.17, b.z + lz + az * sd * 0.29, 0.075, 2);
  return best;
}

function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) {
  const px = cx - ox, py = cy - oy, pz = cz - oz;
  const t = px * dx + py * dy + pz * dz;
  if (t < 0) return -1;
  const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
  const d2 = qx * qx + qy * qy + qz * qz;
  if (d2 > r * r) return -1;
  return t - Math.sqrt(r * r - d2);
}
