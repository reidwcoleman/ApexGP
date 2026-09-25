# APEX GP

A Formula 1 racing game in the browser. Three.js + WebGL2, TypeScript, Vite.

**▶ Play: https://reidwcoleman.github.io/ApexGP/** (desktop Chrome/Safari/Edge; keyboard or gamepad)

Every push to `main` is built and deployed to GitHub Pages by `.github/workflows/pages.yml`.

**Almost everything is generated in code at startup** — the circuits, the cars and their liveries,
the parks, the weather, the engine note. The one exception is the people: drivers, mechanics and
fans are built on rigged CC0 character bodies and animations (`public/models/people/`, 5.5 MB),
dressed and posed in code.

```bash
npm install
npm run dev      # http://localhost:5190
npm run build    # production bundle in dist/
npm run check    # tsc --noEmit
```

## The game

- **Autodromo Nazionale Monza** — the real Temple of Speed, 5.793 km, built from a surveyed
  centreline (within ~4 m of the real track): the Rettifilo chicane, Curva Grande, Roggia, both
  Lesmos, the Serraglio under the old banking, Ascari and the Parabolica, in the Parco di Monza.
- **Circuit de Spa-Francorchamps** and **Silverstone** (the British GP: Copse, Maggotts–Becketts–
  Chapel, Stowe, Vale/Club, the Wing pits straight, airfield flat with tree belts and grandstands at
  every corner) — unlocked through the career.
- **Career, garage and highlights** — your garage is the menu: a working pit garage with tyre
  blankets, jacks, wheel guns, tool trolley, telemetry and your mechanics. Tune the set-up (wings,
  brake bias, suspension, ride height, pressures) with hotspots on the car, drag to look around it,
  and your best moments (overtakes, taking the lead, fastest laps, podiums) are recorded as you race
  and play on the video wall behind the car.
- **Weather, different every race** — Random by default: clear, light cloud, overcast, light rain,
  rain, heavy rain with lightning, or changeable (rain arriving or stopping mid-race), at morning,
  afternoon or golden-hour light. The track gets wet and dries again, a dry line appears once the
  rain stops, spray and aquaplaning in standing water, the radar and your engineer warn you.
- **Race** — 20 cars, standing start with five red lights, 3/5/10/20 laps, four AI levels, start
  from pole / midfield / the back, or **qualify** with a one-shot flying lap against the AI's times. **Time trial** — flying laps against your own best with a live delta.
- **Timing like the broadcast** — position tower with intervals, sectors in purple/green/yellow,
  fastest lap, DRS detection (within 1.0 s at the detection line), track limits delete the lap,
  race-engineer radio.
- **Car physics** — four-wheel model: per-tyre loads (weight, aero, longitudinal and lateral load
  transfer), combined-slip tyres with load sensitivity (wider, stiffer rears), wheel-spin dynamics so
  wheelspin and lock-ups come from the physics, downforce/drag with DRS, slipstream tow and dirty
  air, 8-speed seamless box, launch clutch, ERS overtake, gravity on slopes and banking, kerb chatter,
  grass and gravel, impulse-based contact with walls and cars, front-wing damage, tyre wear.
  Validated with `tools/handling.mjs`: 0–100 km/h 2.2 s, 0–200 4.1 s, 300→80 km/h in 80 m at
  5.9 g, 1.8 g cornering at 100 km/h up to ~5 g at 300 km/h, stable at full lock at any speed.
  An AI flying lap of Monza is ~78.5 s dry (real pole ≈ 79 s), ~84 s on inters in a drizzle,
  ~88 s on wets in the rain.
- **Driving like the F1 games** — full steering input maps to the front tyres' peak-grip angle at
  the current speed; keyboard steering is yaw-rate assisted (release a key and the car straightens);
  countersteer opens up when the rear slides. Assists: traction control Off/Medium/Full, ABS,
  stability, steering assist, braking assist, racing line Off/Corners/Full (the dynamic
  green/yellow/red line), auto/manual gears, DRS assist — as presets (Casual / Standard / Expert)
  or one by one.
- **F1-game mechanics** — flashback (rewind up to 12 s and resume), track-limit warnings and
  5-second penalties, DRS within a second, tow and dirty air, front-wing damage.
- **Tyres & pit stops** — Soft / Medium / Hard slicks plus Intermediates and full Wets, each with
  its own wet-track grip curve (slick/inter crossover ≈ damp, inter/wet ≈ standing water) and
  working temperature: tyres come out of the blankets at 80 °C, heat from sliding, cool on the
  straights and in the wet, lose grip out of their window and wear faster when overheated (the HUD
  colours them blue / green / yellow / red like the F1 game). Cars carry race fuel and get lighter
  lap by lap. The two-compound rule for dry races of 10+ laps (+30 s if you don't), pit assist: request
  a stop, the car drives the pit lane at the 80 km/h limiter, ~2.5 s stop in the team's box (new
  tyres, front wing fixed), ~20 s lost overall. The AI runs its own one-stop strategies and makes
  its own weather calls — some gamble, some box early.
- **AI** — K1999 racing line, friction-ellipse speed profile built at several grip levels (so it
  drives to the conditions: rain, cold or worn tyres), curvature-feedforward + Stanley steering
  capped at the grip limit, overtaking and defending, single file through chicanes, backs off in
  dirty air.

## Controls

| | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake | ↑ / ↓ (W / S) | RT / LT |
| Steer | ← → (A / D) | left stick |
| DRS (in a zone, when enabled) | Space | Y / △ |
| ERS overtake (hold) | Left Shift or F | A / ✕ |
| Gear up / down (manual gearbox) | E / Q | RB / LB |
| Change camera | C | D-pad up |
| Look back | B | click a stick |
| Box this lap (pit stop, auto pit lane) | I | D-pad down |
| Flashback (rewind; ← → scrub, Enter resume) | R | View / Share |
| Pause (also: reset car to track) | Esc / P | Menu / Options |

Menus: arrows + Enter, or the mouse. Enter twice from the title starts a race.

## Layout

```
src/
  world/   CircuitGen (layout → curvature → closed centreline), Circuits, Track (surfaces,
           kerbs, barriers, racing line), TrackMesh (road, kerbs, runoff, barriers, gantry),
           Environment (sky, sun, sea, terrain, vegetation, grandstands, pit building)
  car/     CarModel — the procedural car, liveries, LODs
  sim/     CarPhysics, RacingProfile, AIDriver
  race/    Race (session, timing, DRS, contact), Teams, Engineer (radio)
  game/    Game (states + loop), CarView, Cameras
  fx/      Particles (tyre smoke, dust, sparks)
  ui/      HUD, Menu, design tokens
  core/    Renderer (post chain: N8AO, bloom, speed blur, grade, ACES, SMAA), Input, Audio
  people/  Humans (bodies, clothing shader, faces, props), Crowd (GPU-skinned instanced fans),
           drivers, poses
  career/  Career (progress, upgrades, set-up), Highlights (recorded race moments, IndexedDB)
  dev/     dev pages for each module (car, track, world, audio, hud, people, crowd, drivers)
tools/     shot.mjs (headless screenshots), simtest.mjs (headless 20-car race), trackplot
```

Regression checks (all headless, no browser):
- `node tools/handling.mjs` — acceleration, top speed, braking, step steer, full lock, power oversteer.
- `node tools/kbbot.mjs 2` — a simulated keyboard player (binary keys, reaction delay) drives laps
  on each assist preset through the real control layer; reports off-tracks and spins.
- `node tools/simtest.mjs 20 3` / `node tools/racetest.mjs 3 [weather]` — 20 AI cars racing: lap
  times, wall hits, off-tracks, penalties, weather and tyre calls, classification
  (`SEED=6 node tools/racetest.mjs 8 changeable` brings rain mid-race).
- `node tools/diag.mjs 2 rain wet` — one AI car: lap times, tyre temperatures, grip, wear, fuel.
- `node tools/limits.mjs 3` — where AI cars run wide in a race.

## Credits

The Monza, Spa and Silverstone centrelines are derived from the [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database)
(Technical University of Munich, LGPL-3.0), traced from satellite imagery.

People: *Universal Base Characters* and *Universal Animation Library* by
[Quaternius](https://quaternius.com) (CC0 1.0), converted by `tools/build_people.py`; clothing,
faces, crowds and poses are done in code. Teams, drivers and sponsors in the game are fictional.
