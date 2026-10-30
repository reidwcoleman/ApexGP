import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/**
 * The physics world: Rapier at 120 Hz. Collision groups: each fighter owns one bit (0–7) and never
 * collides with itself, the arena is bit 8, loose props bit 9. Everything static in an arena hangs
 * off one fixed body so a hand can make a joint to it (that is how you hang from a ledge).
 */
export const R = RAPIER;
export const STEP = 1 / 120;
export const GRAVITY = 13.5;
export const WORLD_BIT = 8;
export const PROP_BIT = 9;

export async function initPhysics() {
  await RAPIER.init();
}

export function makeWorld() {
  const w = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  w.timestep = STEP;
  w.numSolverIterations = 6;
  return w;
}

const groups = (member: number, filter: number) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
export const fighterGroups = (slot: number) => groups(1 << slot, 0xffff & ~(1 << slot));
export const worldGroups = () => groups(1 << WORLD_BIT, 0xffff);
export const propGroups = () => groups(1 << PROP_BIT, 0xffff);
/** a query that sees the arena and props only */
export const solidQuery = () => groups(0xffff, (1 << WORLD_BIT) | (1 << PROP_BIT));

export type V = { x: number; y: number; z: number };
export const rv = (v: V) => ({ x: v.x, y: v.y, z: v.z });
export const vec = (o: V, out = new THREE.Vector3()) => out.set(o.x, o.y, o.z);
export const quat = (o: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) => out.set(o.x, o.y, o.z, o.w);
export const rq = (q: THREE.Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

/** what a collider belongs to: the game looks hits and grabs up by collider handle */
export interface PartRef {
  fighter?: import('./fighter.ts').Fighter;
  part?: number;
  hand?: number;
  foot?: number;
  /** surface velocity added on top of the body's own (conveyor belts) */
  belt?: (p: THREE.Vector3, out: THREE.Vector3) => THREE.Vector3;
  /** a slippery surface: less grip for whoever stands on it */
  slick?: number;
  /** touching it knocks you back: the impulse (m/s) along its normal */
  bumper?: number;
  onBump?: (p: THREE.Vector3) => void;
}
