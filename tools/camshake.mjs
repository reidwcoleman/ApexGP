// Camera vibration calibration (headless, no browser): an AI lap feeds the real Cameras.ringShake at
// 60 fps and this reports each camera's frame-to-frame rotation at 30 fps as % of its vertical FOV —
// the same measure as phase-correlating the cockpit in onboard footage (the reference clips: ≈0.8 % mean
// on bumpy circuits, 3–5 % jolts on kerbs). By situation: kerbs, off the road, the road by speed.
//   node tools/camshake.mjs [track]
import * as THREE from 'three';
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { Cameras } from '../src/game/Cameras.ts';

const tid = process.argv[2] ?? 'monza';
const track = new Track(CIRCUITS.find((c) => c.id === tid));
const profile = RacingProfile.for(track, F1_SPEC);
// typical vertical FOVs at speed (16:9), for the % of frame height
const FOV = { cockpit: 57, helmet: 72, tcam: 64, nose: 68, chase: 55, far: 52 };
for (const mode of Object.keys(FOV)) {
  const car = new CarPhysics(F1_SPEC);
  car.placeOnTrack(track, track.startS ?? 0, 0);
  car.fuel = 20;
  const ai = new AIDriver(1.0, 0.5, () => 0.5);
  ai.startFrom(car, track);
  const cams = new Cameras(new THREE.PerspectiveCamera(), track, null);
  cams.mode = mode;
  const dt = 1 / 480;
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  let t = 0, n = 0, prev = null;
  const bins = {};
  while (t < 90) {
    for (let k = 0; k < 8; k++) {
      ai.update(dt, car, track, profile, true, [], 0);
      car.step(dt, ai.input, track, false);
      t += dt;
    }
    cams.ringShake(1 / 60, car, Math.max(0, car.vx), 0);
    if (n++ % 2) continue;
    const sh = cams.shake;
    q.setFromEuler(e.set(sh.pitch, sh.yaw, sh.roll, 'XYZ'));
    if (prev) {
      const ang = 2 * Math.acos(Math.min(1, Math.abs(prev.dot(q)))) * 57.3;
      const key = car.onKerb ? 'kerb' : car.offTrack ? 'off' : car.vx > 70 ? 'road>250' : car.vx > 40 ? 'road>145' : 'road<145';
      (bins[key] ??= []).push((ang / FOV[mode]) * 100);
    }
    prev = (prev ?? new THREE.Quaternion()).copy(q);
  }
  const line = Object.entries(bins).sort().map(([k, a]) => {
    a.sort((x, y) => x - y);
    return `${k} ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)}%/${a[Math.floor(a.length * 0.95)].toFixed(2)}%`;
  });
  console.log(mode.padEnd(8), 'mean/p95 per 30 fps frame:', line.join('  '));
}
