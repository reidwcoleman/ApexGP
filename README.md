# APEX GP

A Formula 1 racing game in the browser. Three.js + WebGL2, TypeScript, Vite.

**▶ Play: https://reidwcoleman.github.io/ApexGP/** (desktop Chrome/Safari/Edge; keyboard or gamepad)

Every push to `main` is built and deployed to GitHub Pages by `.github/workflows/pages.yml`.

**Everything is generated in code at startup** — the circuit, the cars and their liveries, the
coast, the crowds, the engine note. No model files, no image files, no audio files.

```bash
npm install
npm run dev      # http://localhost:5190
npm run build    # production bundle in dist/
npm run check    # tsc --noEmit
```

## The game

- **Autódromo Costa del Sol** — a 4.7 km clockwise cliff-top circuit: pit straight, the Faro
  lighthouse hairpin-entry, the drop to the harbour hairpin, the pine esses, Curva Grande, the
  Bus Stop chicane and the Parabólica.
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
  Validated with `tools/handling.mjs`: 0–100 km/h 2.2 s, 0–200 4.2 s, 300→80 km/h in 83 m at
  5.8 g, 1.8 g cornering at 60 km/h up to 5 g at 300 km/h, stable at full lock at any speed.
- **Driving like the F1 games** — full steering input maps to the front tyres' peak-grip angle at
  the current speed; keyboard steering is yaw-rate assisted (release a key and the car straightens);
  countersteer opens up when the rear slides. Assists: traction control Off/Medium/Full, ABS,
  stability, steering assist, braking assist, racing line Off/Corners/Full (the dynamic
  green/yellow/red line), auto/manual gears, DRS assist — as presets (Casual / Standard / Expert)
  or one by one.
- **F1-game mechanics** — flashback (rewind up to 12 s and resume), track-limit warnings and
  5-second penalties, DRS within a second, tow and dirty air, front-wing damage.
- **Tyres & pit stops** — Soft / Medium / Hard (grip vs life: ~9 / ~14 / ~23 laps), wear that
  costs grip, the two-compound rule for races of 10+ laps (+30 s if you don't), pit assist: request
  a stop, the car drives the pit lane at the 80 km/h limiter, ~2.5 s stop in the team's box (new
  tyres, front wing fixed), ~20 s lost overall. The AI runs its own one-stop strategies.
- **AI** — K1999 racing line, friction-ellipse speed profile, curvature-feedforward + Stanley
  steering capped at the grip limit, overtaking and defending, backs off in dirty air.

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
  dev/     dev pages for each module (car, track, world, audio, hud)
tools/     shot.mjs (headless screenshots), simtest.mjs (headless 20-car race), trackplot
```

Regression checks (all headless, no browser):
- `node tools/handling.mjs` — acceleration, top speed, braking, step steer, full lock, power oversteer.
- `node tools/kbbot.mjs 2` — a simulated keyboard player (binary keys, reaction delay) drives laps
  on each assist preset through the real control layer; reports off-tracks and spins.
- `node tools/simtest.mjs 20 3` / `node tools/racetest.mjs 3` — 20 AI cars racing: lap times,
  wall hits, off-tracks, penalties, classification.
