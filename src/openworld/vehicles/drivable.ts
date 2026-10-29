import type * as THREE from 'three';
import type { Pad } from '../input.ts';
import type { CamSubject } from '../camera.ts';
import type { Network } from '../roads.ts';
import type { CollisionWorld } from '../sim/collide.ts';

/** what every vehicle the player can take hands the game */
export interface HudInfo {
  name: string;
  speed: number;
  /** 0..1 gauges (battery, gas, fuel) */
  gauges: { label: string; value: number; color: string }[];
  altitude?: number;
  mode?: string;
  gear?: string;
}

export interface WorldCtx {
  net: Network;
  world: CollisionWorld;
  t: number;
  night: number;
}

export interface Drivable {
  kind: 'car' | 'bike' | 'heli' | 'plane' | 'boat';
  name: string;
  root: THREE.Object3D;
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  yaw: number;
  /** a driver aboard (player or AI) */
  occupied: boolean;
  /** this frame's controls when the player drives it */
  drive(dt: number, pad: Pad | null, ctx: WorldCtx): void;
  subject(): CamSubject;
  hud(): HudInfo;
  /** where the player stands after getting out */
  exitPoint(out: THREE.Vector3): THREE.Vector3;
  /** strongest impact this frame (m/s) */
  impact: number;
  /** a police vehicle */
  police?: boolean;
  /** health 0..1 */
  health: number;
  dispose?(): void;
}
