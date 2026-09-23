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
- **Race** — 20 cars, standing start with five red lights, 3/5/10/20 laps, four AI levels, choose
  your grid slot. **Time trial** — flying laps against your own best with a live delta.
- **Timing like the broadcast** — position tower with intervals, sectors in purple/green/yellow,
  fastest lap, DRS detection (within 1.0 s at the detection line), track limits delete the lap,
  race-engineer radio.
- **Car physics** — bicycle model with Pacejka-style tyres, load sensitivity, downforce and drag
  (DRS changes both), friction circle per axle, longitudinal load transfer, 8-speed seamless
  gearbox, ERS deploy/harvest, traction control / ABS / stability assists, kerbs, grass and gravel.
- **AI** — K1999 racing line, grip-limited speed profile, curvature-feedforward + Stanley steering,
  overtaking and defending.

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
| Reset onto the track | R | View / Share |
| Pause | Esc / P | Menu / Options |

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

`node tools/simtest.mjs 20 3` runs a 20-car, 3-lap race headlessly and reports lap times,
wall hits and off-tracks — the regression check for physics and AI changes.
