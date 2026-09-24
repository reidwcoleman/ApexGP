# APEX GP — module contracts

Browser F1 game. Three.js r186 + WebGL2, Vite 8, TypeScript (strict), `postprocessing` + `n8ao`.
**Every mesh, texture and sound is generated in code** — no .glb, no image files, no HDRIs, no audio files.
Canvas-drawn textures, BufferGeometry, ShaderMaterial / `onBeforeCompile` patches are all fine.
Fonts: `@fontsource/titillium-web` and `@fontsource/jetbrains-mono` are installed (for canvas text use
`"Titillium Web"` after `document.fonts.load(...)`, with a sans-serif fallback).

The quality bar is a modern console F1 game at a glance: physically based materials, real reflections
from the sky environment, shadows, AO, bloom on emissives, believable scale and detail density.
Performance target: 60 fps at 1080p on an Apple-silicon MacBook with 20 cars on track.

## Conventions (non-negotiable — everything else depends on them)

- World: **Y up**, metres, circuit roughly in the XZ plane, ~1 km × 1.6 km plus scenery.
- Heading θ: forward = `(sin θ, 0, cos θ)`. `object.rotation.y = θ` points local **+Z** along it.
- Car local space: **+Z forward, +Y up, +X left**. Right of travel = −X.
- Track lateral offset: **+ = right** of the direction of travel.
- Curvature κ: + = left-hand corner. The lap is clockwise (mostly right-handers).
- Linear workflow: colour textures `colorSpace = SRGBColorSpace`, data textures (normal/roughness) `NoColorSpace`.
  Tone mapping is done in post (ACES) — materials must NOT set `toneMapped` tricks. HDR is expected:
  emissives > 1 bloom (threshold ≈ 1.1). Sun ~ 3–5 intensity, sky env via `scene.environment`.
- Shadows: `renderer.shadowMap` is PCF. Only big/important things cast (`castShadow`), most receive.
- Draw-call discipline: merge static geometry by material (`BufferGeometryUtils.mergeGeometries`),
  use `InstancedMesh` for anything repeated (posts, trees, crowd, boards). Target < 600 draw calls total.
- Max anisotropy on ground textures: pass `renderer.capabilities.getMaxAnisotropy()`.

## Shared modules (already written — read them, don't rewrite them)

- `src/world/Track.ts` — **the track API**. Read the header comment. Key members:
  `n`/`length` (m, samples every 1 m), `px/py/pz` centreline, `tx..`, `rx..` (right), `ux..` (up),
  `heading`, `kappa`, `bank`, `halfWidth`, `kerbL/kerbR` (kerb width, 0 = none),
  `runoffL/runoffR` (`SURF` code beyond the kerb+verge), `barrierL/barrierR` (distance of the wall face
  from the centreline, positive both sides), `racingLine` (lateral offset), `corners` (name, dir, radius,
  sStart/sApex/sEnd, runoff), `startS`, `sectorS`, `drs` (detect/start/end s), `pit` (side, sStart,
  sEnd, wallOffset, laneInner, laneOuter, garageOffset), `gridSlot(k)`, `frame(s)`,
  `point(s, lateral, lift)`, `project(x, z, hint)`, `surfaceAt(s, lat)`, `buildDistanceField()`,
  `Track.sampleField()`. Cross-section: road → kerb → 1.5 m verge (`VERGE`) → runoff → barrier.
  Gravel beds stop `GRAVEL_EDGE` m short of the barrier (grass there).
- `src/world/Circuits.ts` — `MONZA`: the **real Autodromo Nazionale Monza** (5.79 km, clockwise), built
  from a surveyed centreline (`src/world/circuits/monzaLine.ts`, within ~4 m of the real thing).
  Map orientation: world **x = east, z = south** (north = −Z). s = 0 is just after the Parabolica exit.
  - Main straight on the **west** side, running **north** (toward −Z) from the Parabolica (south end,
    s≈5380) to the Rettifilo chicane. Start/finish line **s = 550**. Pit lane on the **right (east, inside)**,
    s 120 → 960; the pit building/garages/paddock are east of it. Main grandstand (Tribuna Centrale)
    opposite the pits on the west side of the straight.
  - T1/T2 **Variante del Rettifilo** (s≈1180/1225, right–left, big asphalt runoff straight on).
  - T3 **Curva Grande** (s 1300–2010, long flat-out right sweeping north-east, lined by tall trees).
  - T4/T5 **Variante della Roggia** (s≈2395/2440, left–right).
  - T6 **Lesmo 1** (s≈2850), T7 **Lesmo 2** (s≈3127) — the north-east corner, deep in the woods.
  - **Serraglio** straight running south-west (s 3160–4180) — passes **under the old banking**
    (the 1955 high-speed oval, "Sopraelevata", crumbling banked concrete in the trees) around s≈3450.
  - T8–T10 **Variante Ascari** (s≈4200/4346/4392, left–right–left), then the back straight south.
  - T11 **Parabolica / Curva Alboreto** (s 5364–5723, long right, tightening then opening onto the straight).
  - Corner names in `track.corners`: 'Turn 1', 'Turn 2', 'Curva Grande', 'Roggia', 'Turn 5', 'Lesmo 1',
    'Lesmo 2', 'Ascari', 'Turn 9', 'Turn 10', 'Parabolica'. Nearly flat (≤ 6.3 m elevation).
  - Setting: the **Parco di Monza** — a royal park: dense mature deciduous forest (plane trees, oaks,
    horse chestnuts, 20–30 m tall) right up to the catch fences for most of the lap, open lawns, gravel
    paths, the old oval, big grandstands at the main straight, T1, Roggia, Lesmo, Ascari and Parabolica,
    tifosi in red. Lombardy light: hazy, warm.
  - `track.data.segStart/segLen` still exist (straights/corners auto-derived) but **don't index them by
    number** — use corner names or s values. Old Costa del Sol assumptions (sea, harbour, lighthouse,
    town, cliffs, segment 10/20/26) are gone.
- `src/world/Weather.ts` — **weather model** (no three.js). `WeatherState` (read its comments): `kind`
  ('clear'|'cloudy'|'overcast'|'drizzle'|'rain'|'storm'), `time` ('morning'|'afternoon'|'golden'),
  `cloud` 0–1, `rain` 0–1, `wetness` 0–1 (standing water), `dryLine` 0–1, `fog` 0–1, `windX/windZ`,
  `lightning` 0–1 (flash this frame), `airTemp`, `trackTemp`, `t` (clock). A new random forecast is
  rolled for every race; it can change mid-race (e.g. dry → rain, rain → drying with a dry line).
  Build a state for testing: `new Weather(planWeather('rain', 'afternoon', 600)).state`, or just write a
  literal `WeatherState` object.
- `src/world/weatherUniforms.ts` — `weatherUniforms` { uWetness, uRain, uDryLine, uCloud, uLightning,
  uWind, uWeatherTime }: shared uniform objects the game updates every frame. **Any material that should
  react to rain puts these same objects into its uniforms** (ShaderMaterial or `onBeforeCompile`).
- `src/core/Renderer.ts` — renderer + post chain. `gfx.grade.set({...})`, `gfx.bloom`, `gfx.ao`,
  `gfx.maxAnisotropy`, `gfx.renderer`.
- `src/race/Teams.ts` — 10 teams × 2 drivers, colours, livery pattern, sponsor, helmet colours.
- `src/dev/devkit.ts` — dev-page harness: `createDevStage()`, `studioLighting()`. Dev pages live in
  `src/dev/<name>.html` + `<name>.ts`. URL params `?cam=x,y,z&look=x,y,z&fov=&q=&frames=`.

## Verifying your work (do this, look at the PNGs, iterate)

- Vite dev server: `http://localhost:5190` (already running; if `curl -s localhost:5190 >/dev/null`
  fails, start it with `npx vite --port 5190 &` from the repo root).
- Screenshot: `node tools/shot.mjs /src/dev/<page>.html?cam=...&look=... shots/<you>_<name>.png --w 1600 --h 900`
  It waits for `window.__ready` (devkit sets it after N frames), prints console errors and
  `window.__info` (draw calls / triangles). Then **Read the PNG** and judge it honestly against the bar.
- Types: `npx tsc --noEmit -p .` — only fix errors in files you own; other agents are editing other
  files concurrently, so ignore theirs.
- Do not edit files you don't own. If a shared file needs a change, say so in your final report.

## Module ownership and APIs

### Car — `src/car/*` (CarModel.ts, Livery.ts, carTextures.ts …), dev page `src/dev/car.*`

```ts
export interface CarRig {
  root: THREE.Group;            // place/orient this. Origin: ground level, midpoint of the wheelbase.
  body: THREE.Group;            // sprung body; game sets body.rotation.x/z (pitch/roll) + position.y (heave)
  setSteer(rad: number): void;  // front wheel steer angle (+ = left); also turns the steering wheel ×~6
  setWheelSpin(frontRad: number, rearRad: number): void;  // accumulated wheel rotation angles
  setWheelSpeed(mps: number): void;  // drives rim/tyre motion-blur look at speed
  setBrakeGlow(v: number): void;     // 0..1 disc/caliper heat glow (emissive, blooms)
  setRainLight(on: boolean): void;   // rear red light (blinks when on — call update)
  setDrs(open: number): void;        // 0 closed … 1 open (upper rear-wing flap rotates)
  setDetail(level: 0 | 1 | 2): void; // 0 = full (player/near), 1 = medium, 2 = far (few draw calls)
  setDriverVisible(v: boolean): void;
  update(dt: number): void;
  readonly anchors: { cockpit: THREE.Object3D; tcam: THREE.Object3D; nose: THREE.Object3D; rearWing: THREE.Object3D;
                      exhaust: THREE.Object3D; wheelFL: THREE.Object3D; wheelFR: THREE.Object3D; wheelRL: THREE.Object3D; wheelRR: THREE.Object3D; };
  readonly dims: { wheelbase: number; trackFront: number; trackRear: number; length: number; width: number; wheelRadius: number };
  dispose(): void;
}
export function createCar(team: Team, driver: Driver, seat: 0 | 1, opts?: { envMap?: THREE.Texture }): CarRig;
```

### Weather hooks every visual module must honour (round 3)

The game calls, every frame: `applyWeatherUniforms(state)` then `env.setWeather(state)`. Wet look targets
(F1 game in the rain): dark saturated asphalt with sky/car/light reflections and puddles, a visibly drier
racing line once `dryLine` rises, rooster-tail spray and mist behind cars, rain streaks, grey soft
light, lightning flashes in storms. Dry look: crisp Lombardy sun, long soft shadows at golden hour.

### Trackside — `src/world/TrackMesh.ts` (+ helpers `src/world/trackside/*`), dev page `src/dev/track.*`

```ts
export interface StartLights { set(lit: number): void; /* 0..5 red columns lit; call set(0) = lights out */ }
export interface Trackside {
  group: THREE.Group;
  startLights: StartLights;
  update(dt: number, camera: THREE.Camera): void;
}
export function buildTrackside(track: Track, gfx: Renderer): Trackside;
```
Everything from the centreline out to the barriers (+ a few metres behind them): road, kerbs, verges,
runoff, gravel, grass inside the barriers, barriers, fences, markings, start gantry, footbridges, marshal posts, boards. (The pit lane, pit wall, spur lanes and garages belong to `src/world/PitComplex.ts`; hand-off constant `PIT_HANDOFF` in trackside/context.ts.)

### World — `src/world/Environment.ts` (+ `src/world/env/*`), dev page `src/dev/world.*`

```ts
export type TimeOfDay = 'day' | 'golden' | 'overcast';
export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;         // castShadow on; game calls focusShadow() every frame
  focusShadow(target: THREE.Vector3): void;
  setTimeOfDay(t: TimeOfDay): void;     // sky, sun, env map, fog, gfx.grade presets
  update(dt: number, camera: THREE.Camera): void;
}
export function createEnvironment(track: Track, gfx: Renderer, scene: THREE.Scene, time: TimeOfDay): Environment;
```
Everything beyond the barriers: sky, sun, clouds, environment map, fog, terrain, sea, vegetation,
grandstands + crowds, pit building/garages/paddock, lighthouse, harbour, town, bridges, hills.

### Audio — `src/core/Audio.ts`

```ts
export class GameAudio {
  init(): Promise<void>;                // call from a user gesture
  setVolume(master: number): void;
  setView(v: 'chase' | 'cockpit' | 'tv'): void;
  updatePlayer(s: { rpm: number; throttle: number; brake: number; speed: number; gear: number;
                    slip: number; surface: number; onKerb: boolean; drs: boolean; ers: number; limiter: boolean }): void;
  shift(up: boolean): void;
  updateOpponents(list: { id: number; rpm: number; throttle: number; distance: number; relVel: number; pan: number }[]): void;
  impact(strength: number): void;
  startBeep(final: boolean): void;
  crowd(level: number): void;
  ui(kind: 'move' | 'select' | 'back'): void;
  update(dt: number): void;
  suspend(): void; resume(): void;
}
```
