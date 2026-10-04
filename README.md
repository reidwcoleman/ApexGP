# APEX GP

A Formula 1 racing game in the browser. Three.js + WebGL2, TypeScript, Vite.

**▶ Play: https://reidwcoleman.github.io/ApexGP/** (desktop Chrome/Safari/Edge; keyboard or gamepad)

Every push to `main` is built and deployed to GitHub Pages by `.github/workflows/pages.yml`.

**Almost everything is generated in code at startup** — the circuits, the cars and their liveries,
the parks, the weather, the engine note. The one exception is the people: drivers, mechanics and
fans are the Microsoft Rocketbox avatars and animations (MIT; `public/models/rocketbox/`, 13 MB,
about half of it loaded up front, the fans behind), dressed in team kit and posed in code.

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
- **Nine real circuits**, each from a surveyed centreline, with real elevation, named corners,
  DRS zones and landmarks: Monza, Spa-Francorchamps (Eau Rouge), Silverstone (the Wing, Maggotts–
  Becketts), Suzuka (the figure-8 bridge, the Ferris wheel), Montréal (Wall of Champions, the
  Biosphère, the rowing basin, the skyline across the river), the Red Bull Ring (the Styrian Alps
  and the steel bull), Zandvoort (banked Hugenholtz and Arie Luyendijk, dunes, the North Sea and
  the orange army), Circuit of the Americas (the Turn 1 hill, the tower) and Interlagos (the bowl,
  the Senna S, São Paulo all around). Switching circuit rebuilds the world in-page — no reload.
- **Driver career** — the game's main mode, like the F1 games' My Driver: create a driver (name, nationality,
  number, helmet colours, skin and hair) and start in Formula 2 with one of three junior teams, or take over a
  current F1 driver's seat. The hub (Overview · Inbox · Standings · Driver · History) runs the life around the races:
  - **Ratings** — pace, racecraft, awareness, experience and focus (an overall from them) grow with what you do,
    harder the higher they get; teams weigh them with your reputation when they make offers.
  - **Team targets** every weekend (a finish for the car's level, beat the teammate, beat the rival, a home race…),
    paid in research points, team trust and ratings; shown on the race screen and scored on the results screen.
  - **Rival** — a driver a step ahead, head to head over the season; lead by four and a bigger one is picked.
  - **R&D** — the Car development tab spends the team's research points on aero, power unit, chassis and ERS. Your
    car is as fast as the team's car really is (a backmarker is down on power and downforce) plus the parts; the
    teammate gets them too, and every other team develops through the season on its own.
  - **Contracts** — offers in the last third of a season: sign, decline, or negotiate salary, length and status
    against the team's interest and patience.
  - **The driver market** — every winter drivers age, retire or get dropped, F2's best graduate into the open F1
    seats and rookies fill the rest; a silly-season message lists the moves.
  - **The paddock** — principal verdicts, press conferences, race headlines, events between rounds (sponsor days,
    simulator work, upgrade direction…) with visible trade-offs, milestones, a trophy cabinet and season history.
  The grid is swapped in place (`src/career/Series.ts` `applyGrid` writes the market and each team's development
  into the shared Team/Driver objects, so every entry and rig follows); state in `localStorage` `apexgp.drivercareer`
  (`src/career/DriverCareer.ts`, v1 saves migrate), hub, talks and wizard in `src/ui/CareerHub.ts`.
  `node tools/dcsim.mjs [rounds] [pos] [out] [--existing]` simulates seasons and shoots every screen;
  `node tools/dcflow.mjs` runs the real start → race → results → next round flow.
- **Driver career season map** — the career hub's Overview is the season as a world map: the route flown so
  far in the team colour, the next leg drawing itself, every finish on its pin (gold/silver/bronze for a podium)
  and the next round pulsing; click a pin (or ‹ ›) to glide to it and see that round — your result, or the
  team's targets for the next one — with one call to action, always the next round (CareerHub.ts overview).
- **Career on a world map** — the 14 rounds as pins on a map of the season: a top-5 finish unlocks
  the next round, and your best result earns a medal (gold = win, silver = podium, bronze = top 5).
  Career races are always 10 laps and take their weather and time of day from the circuit's climate
  (Sakhir and Yas at night, Spa and Interlagos changeable…), re-rolled after every race there;
  **Next round** on the results screen flies you straight on. The rivals develop their cars through
  the season too. **Quick race** keeps free laps and weather at any circuit you've opened.
- **Garage first** — the boot opens the garage at the circuit you race next (the career's next round) as soon
  as its pit building, track, sky and cars exist; terrain, woods, grandstands and crowds grow behind it one slice
  per frame (`sceneryBuilder`, `env.adoptScenery`, `Game.completeWorld`), with a status chip in the garage. Picking
  another circuit moves the garage there behind a short title card; no travel screen.
- **Fast boot** — the loading screen is painted before anything heavy runs (main.ts waits one frame before
  making the Game); the downloads and decodes (people, cached pixels, road scan, fonts) start on that frame and
  `buildWorld` awaits each only right before the step that needs it. The ground textures' pixels are made off the
  main thread by two ground workers (`src/world/groundWorker.ts`, pure generators in `trackside/groundData.ts` and
  `env/textureData.ts`, byte-identical to the old main-thread code). Shaders are compiled with
  `compileAsync` (KHR_parallel_shader_compile: the driver's threads, never a blocked main thread): the world's
  garage-lit programs are queued before the cars are made, the landscape's before it is adopted, the race's in
  `warmUp`; the podium's (one more light = ~80 programs) only when a race ends. three's per-program error check
  is off in production builds (`?shadercheck` turns it on). IndexedDB (`src/core/pixelCache.ts`, keyed by the
  build) keeps, besides the liveries / fan atlas / leaf atlas, the ground pixels and each circuit's sight-line
  grid, so a returning player's boot and circuit switches skip them. Measure with `tools/loadbench.mjs`.
- **Backdrops in depth** — beyond the barriers the land recedes in layers like circuit footage: verge → parkland
  and fields → tree lines → hills → hazy horizon. The far countryside (beyond the 6 km square, painted, no trees)
  is wooded on steep ground first, a venue's own share of woodland and pasture (`TERRAIN_PALETTES` `forest` /
  `pasture`), hedged fields split by fences into different crops with tramlines and soil patches, deserts in
  gravel plains, sand sheets, wadis and vehicle tracks (terrain.ts); the Ardennes cut by deep wooded valleys
  (worldmap.ts). The horizon ring (horizon.ts) is lit per pixel: spurs and gullies, stands of trees, hedged
  pasture on the lower slopes (`fields`), rock, a broken snow line, the same clouds' shadows as the ground,
  a milkier foot on every range, tree lines with single crowns cut into their tops, standing on the real
  terrain. Lakes and the sea reflect the sky (not the env map's captured grandstands) and the far bank's line.
  Beyond the square the painted woods throw a shadow over the fields away from the sun, their canopy
  and the hillsides carry a per-pixel relief (spurs, folds, crowns) the 256 m mesh can't, mountains are a
  mosaic of dark forest and alpine pasture, country lanes run between the hedged fields, and hedges/lanes
  fade to their share of the pixel far off (no ruled-paper horizon). Far land and the horizon ring ease
  their haze beyond 5 km (`HAZE_EASE`, ∝ √distance; off at Interlagos, whose city is real geometry), so
  hills 10–50 km away read as layered silhouettes, each fold a step paler, instead of one pale band.
- **City skylines** — Melbourne's CBD and Southbank and downtown Montréal are built tower by tower
  (`Merge.tower` in `env/venues/montrealCity.ts`): podium, shaft (square or with its corners cut), maybe a
  setback, then a plant room, glazed crown or mast. `cityMaterial` counts storeys and bays from each building's own
  base (aWin = curtain, reflectivity, seed, base y): punched windows or curtain walls with spandrels and mullions,
  each pane its own interior and bend, shopfronts and the darker street canyon at the foot, coated glass mirroring
  more sky up high, the pattern fading to its average where it would alias.
- **Trackside weathering** — props and printed surfaces carry a weathering class (`WEATHER` in
  `trackside/builder.ts`, the integer part of the roughness channel): concrete (patina, rain-run streaks, pour
  joints, lichen on top), painted steel (mottle, chips, rust runs), painted walls (rubber scuffs where cars
  touched, grime, section joints) and plastic (TecPro, tyre belts). Footbridges are Warren-truss spans on open
  steel stair towers; marshal posts are steel-framed shelters with their kit. Pit-building rooms read dim behind
  the glass by day and glow after dark. `tools/_spots.mjs` / `_posts.mjs` / `_ring.mjs` frame free-camera shots.
- **Pit buildings in each circuit's own materials** — `pitStyle` (pitlane/building.ts): trim, cladding, core,
  frame and glass tint per venue (Spa's and Mexico's dark grey, Sakhir's sandstone, Spielberg's graphite) and the
  top floor's shading: vertical fins (Monza, Yas), horizontal louvres on outriggers (Suzuka, Hungaroring,
  Melbourne, Zandvoort, Sakhir) or a flush curtain wall (Spa, Austin, Mexico). The end elevations — what the
  long lens sees down the straight — wrap the curtain wall round the corner, carry the slab edges round as
  bands, a framed event board in the host's colours, a stair core rising past the roof, a glazed lobby under a
  canopy, a roller shutter and a louvred plant enclosure. Race control's glazing is raked outward under a deep
  overhang with aerials on top. Curtain-wall glass is coated (a tinted ~9 % reflection, Fresnel to a mirror at
  grazing) and every 1.5 m pane bends the reflection its own fraction of a degree. Team motorhomes are glazed
  full width in a team-colour frame with roof-terrace shades. Prints and boards carry a polygon offset (they
  z-fought into stripes down long lenses). Hospitality pavilions and the Suzuka hotel are real buildings
  (colonnade, set-back terrace, balconies and party walls, interior-mapped rooms lit at night) in the stands'
  archMaterial, which gained a RENDER class and roof-top laps, grime and rooflights. Village houses lay their
  windows out per house (bays, storeys, a door, sills, shutters, eaves shadow, gravel flat roofs, lit rooms at
  night). `tools/_bldg.mjs` frames the pit building (grid, TV long lens, ends, tower, paddock), `tools/_lm.mjs`
  every cluster of a mesh (landmarks, villages), `tools/_bench_bldg.mjs` their GPU cost (min of many frames).
- **Materials like footage** — surfaces keep to what real ones reflect: livery paint between ~2 % and ~75 %
  (a screen-pure red or white read as neon next to footage) under a lacquer softened by orange peel and dust,
  tyre rubber a charcoal ~2.5 % rather than a hole, white road and kerb paint ~60 % with a road film and rubber
  streaks on the ridden half of the kerb. The asphalt's polished chip tops are the high-pass of the scan's
  height (a raw threshold made glossy islands, a camouflage pattern against the sun); the racing line is laid
  in streaks, some stretches have relaid repair patches with sealed seams, painted run-off follows the grain and
  wears off the chip tops, gravel rakes wander. The wet road takes the env map's light but not its colour (the
  env map is one spot's view: a red grandstand mirrored round the lap); the screen-space march supplies what is
  really beside the road. Carbon weave and paint flake within ~2 m of an onboard lens read as their average
  (the lens's defocus can't resolve them). `node tools/_matshots.mjs <out> <track> <weather> <time> [car|road|glare]`
  (PORT env) shoots frozen close-ups of the player's car, the road at several distances and the road into and
  away from the sun; `WXSET='{"wetness":0.7,"rain":0,"dryLine":0.8}'` sets a drying track.
- **Loading screens** — key art from the game itself (Yas at dusk, Spa in the rain, Suzuka at
  sunset…, `public/loading/`): the boot crossfades through them every 5 s (1.2 s fades) on pure CSS animations (they
  keep moving while a build step blocks the main thread), a circuit switch shows the destination's own. New ones: `node tools/keyart.mjs` then `python3 tools/steam_capsules.py loading`.
- **Race intros** — a directed broadcast opening (`src/game/IntroDirector.ts`, ~28 s, letterboxed,
  lower-third captions): the helicopter over the start/finish complex under the title card (round,
  circuit, laps, conditions, the layout drawing itself), the venue's signature (Eau Rouge, the Foro Sol,
  the Yas hotel, the Observation Tower, the Ferris wheel, Monza's banking bridge, the city skylines…),
  a crane past the main grandstand, a crane up the pit building onto the grid, a low shot skimming a
  kerb, the long lens down the grid in the heat haze, the pole sitter, then a match cut to your car and
  the drop into your race camera. Every move is chosen from candidates tested against the terrain and
  the Sightlines grid (never under the ground or in a building, subject in view); after dark the cars
  are filmed from behind (headlights) and the kerb shot is dropped. Cuts tell the motion blur. A
  restart gets the short orbit of your car. Enter / click skips. `node tools/introshot.mjs <track>`.
- **The garage** — your garage is the menu: your driver stands by the car in race suit with his
  helmet in his hand while the crew work on it with wrenches (hubs, front wing flaps, rear wing).
  Click a part (cockpit, front wing, front corner, sidepod, rear wing, floor) to fly the camera to it
  with a line about it; tune the set-up with hotspots on the car; your best moments play on the
  video wall behind it.
- **Team radio** — text calls from the engineer (damage, box this lap, rain, gaps) with a radio blip; no spoken voice.
- **Weather, different every race** — Random by default, and every session (a restart too) rolls a
  new sky and time of day, never the last race's: clear, light cloud, overcast, drizzle,
  rain, heavy rain, thunderstorm (forked lightning), sunny showers (with a rainbow), mist and fog,
  hazy heat (shimmer over the asphalt), windy, or changeable, at dawn, morning, midday, afternoon,
  golden hour, twilight (floodlit) or a night race (**Night race: On** in the race setup's Conditions — no
  floodlights at all: the moon, the city on the horizon and every car's modest headlights, which light
  the road ahead, flare head-on and catch the rain). The track gets wet and dries again, a dry line appears once the
  rain stops, spray and aquaplaning in standing water, the radar and your engineer warn you.
- **Race** — 20 cars, standing start with five red lights, 3/5/10/20 laps, Dynamic AI (keeps pace
  with you, adjusts properly after each race) or four fixed levels, start
  from pole / midfield / the back, or **qualify** with a one-shot flying lap against the AI's times. **Time trial** — flying laps against your own best with a live delta.
- **Timing like the broadcast** — position tower with intervals, sectors in purple/green/yellow,
  fastest lap, DRS detection (within 1.0 s at the detection line), track limits delete the lap,
  race-engineer radio.
- **Car physics** — four-wheel model: per-tyre loads (weight, aero, longitudinal and lateral load
  transfer), combined-slip tyres with load sensitivity (wider, stiffer rears), wheel-spin dynamics so
  wheelspin and lock-ups come from the physics, downforce/drag with DRS, slipstream tow and dirty
  air, 8-speed seamless box, launch clutch, ERS overtake, gravity on slopes and banking, kerb chatter
  and kerb strikes (the wheel spikes, hops light for a few hundredths and the ramp shoves it back toward
  the track), grass and gravel, impulse-based contact with walls and cars, front-wing damage, tyre wear.
  The chassis moves like a stiff F1 car (~2.5° of dive at 5 g, ~1.5° of roll, springs that settle with a
  little overshoot) over each circuit's own fixed road relief (`roadBump`: rougher braking zones, Austin
  and Montreal bumpier than Monza), which also drives the cameras' vibration (`roadVel`, `strike`).
  Validated with `tools/handling.mjs`: 0–100 km/h 2.0 s, 0–200 3.9 s, top 336 (343 with DRS), 300→80 km/h in 78 m at
  6.2 g peak (63 m with the assisted handling's brakes), 1.8 g cornering at 100 km/h up to ~5 g at 300 km/h, stable at full lock at any speed;
  trail-braking rotates the car ~1.8× more than coasting into the same turn, full throttle at a 2nd-gear apex
  steps the rear out ~18° with no assists (≈6° on Standard), and the wet table drops cornering grip to
  ~63 % on slicks / ~77 % on inters at half-wet.
  An AI flying lap of Monza is ~78.5 s dry (real pole ≈ 79 s), ~84 s on inters in a drizzle,
  ~88 s on wets in the rain.
- **Driving like the F1 games** — full steering input maps to the front tyres' peak-grip angle at
  the current speed; keyboard steering is yaw-rate assisted (release a key and the car straightens);
  countersteer opens up when the rear slides. Handling "Arcade" (Casual / Standard) is the full
  simulation on 13 % grippier tyres with a slide catcher of limited authority (`ARCADE_*` in
  CarPhysics.ts: the rear may slide ~6° freely, more is pulled back — less so on a wet or cold track)
  and turn-in help once the front tyres pass their peak, so weight transfer, trail-brake rotation,
  wheelspin on the exit, kerbs and the wet all come through while a keyboard can still hold it;
  "Simulation" removes the net. Traction control Medium lets the rear slide (more where grip is low). Assists: traction control Off/Medium/Full, ABS,
  stability, steering assist, braking assist (Medium by default: the car slows itself for the corners),
  racing line Off/Corners/Full (the dynamic green/yellow/red line), auto/manual gears, DRS assist —
  as presets (Casual / Standard / Expert) or one by one.
- **Races that are never the same** — driver form day to day, simulated qualifying, varied tyre
  strategies with undercuts and overcuts, good and bad launches, driver mistakes, rare mechanical
  failures and a virtual safety car after big crashes.
- **Broadcast highlights** — after each race the best moments (overtakes, lead changes, battles,
  crashes, the flag, the podium) are re-filmed offscreen from TV cameras and encoded as smooth 30 fps
  video with broadcast graphics, played on the garage video wall and in the Highlights tab.
- **Watch and rewatch** — simulate a race (pick the circuit, laps, weather, time, grid and more,
  or randomise everything) with an automatic TV director (calm 7–13 s shots, in real time at any sim speed) and 29 cameras
  (onboards, chase and long-lens chase, trackside towers, long lens, pit wall, heli, blimp, drone, tactical), change car and
  camera, up to 8× speed; replay your full race afterwards with a timeline, moments and any camera.
- **2026 cars** — the new regulations' car: 280 / 375 mm tyres, a shorter nose on the front wing's
  mainplane, three-element front and rear wings whose flaps move (straight mode opens both on the
  straights), no beam wing, a narrower flatter floor with wheel-wake boards, bigger mirrors,
  lateral and endplate lights; baked ambient occlusion on every car.
- **Camera footage look** — per-pixel camera motion blur like a film shutter (depth reprojection: the grass,
  kerbs and barriers streak past while your own car and the cars racing alongside stay sharp, a panning TV
  camera keeps its car crisp; Settings → Motion blur Off / Subtle / Cinematic), a photographic grade layer
  over every weather and time of day (`FILM` in Environment.ts: a little under-exposed, colour pulled back, greens
  tamed toward olive, a warm yellow cast that is full in sunshine, eased off under cloud and gone in the blue hour,
  where footage is cool; a camera that meters a flat grey day almost back up so a wet sky goes near white, while a
  sunny frame keeps its dark shade; darker nights), a print stage after tone mapping (`FilmEffect` in Renderer.ts:
  a warm black floor that is crushed to black at night, colourless deepest shadows, a warm clip), warm halation
  round every bright light (the bloom), and a low sun's glow that builds over kilometres of air rather
  than veiling a car down a long lens. Inside the cockpit (cockpit, helmet, halo cam: `INSIDE_CAR`) the lens is exposed for
  the bright world outside: the car's own cockpit is shaded and defocused by distance (`OnboardEffect`, from
  depth + the car's box; lit LEDs keep their glow, sun glints in the lacquer don't), no rear-view mirror
  overlay (real onboard footage has none), and night races are lit by a faint moon only, so the headlights,
  rain lights and the lights round the track carry the picture. The cockpit eye sits low and back in the tub
  (`COCKPIT_EYE_*` in Cameras.ts) so the halo's hoop rides the top edge as in onboard footage; long lenses thin
  the haze (`aerialLens` in fog.ts) so telephoto shots stay contrasty; camera cuts reach the motion blur through
  `Cameras.cuts`. Engine/wind mixes are balanced against real V6 turbo-hybrid footage by band energy
  (`tools/audiocheck.mjs --bands`: cockpit ≈ 22 % < 150 Hz, 58 % 150–600 Hz, 16 % 600–2k, 3 % 2–6k). `node tools/_lookshots.mjs <out>` shoots the reference scenes;
  `node tools/_mbbench.mjs` times the blur pass.
- **Racing cameras** — 18 to race with (C cycles them, Settings → Camera picks one): chase / far / low
  chase a hand's width over the road (surge, G lean, brake pitch, look to the apex, glide between them),
  a long-lens chase (a camera car 30–45 m back on the circuit holding the car on a 6–9° lens, the field
  stacked behind it in a shallow focus; it cuts to a closer camera car when a bend comes between them),
  the chase drone, and onboards placed against the body's measured shape (`MOUNTS` in Cameras.ts, each
  with its own lens, bracket stiffness, housing flex, roll and corner look): the T-cam on the roll hoop,
  the broadcast halo cam low in the tub (the centre pillar splitting a wide picture), the cockpit eye,
  the helmet cam, the nose pod, the bumper cam over the front wing, the front-wheel cam, the sidepod,
  the rear-facing T-cam and rear sidepod; the helicopter, trackside, and a **TV director** for your own
  race that cuts every 3–8 s between long lenses, onboards and the chase cameras like the TikTok edits
  (`Cameras.view` is the shot on air). The helmet cam rides the driver's head, framed by the visor;
  every lens rides with the car vibrating like its mount (`CamShake` in Cameras.ts: noise-rung
  resonators — the head or bracket sway at 4–11 Hz, the structure's buzz at 11–22 Hz — driven by the
  speed, the road relief under the wheels, kerb ridges and strikes, the grass and contacts; calibrated
  against the reference onboards with `node tools/camshake.mjs`: the cockpit moves ≈0.4 % of the frame
  height per 30 fps frame on a straight at 300 km/h, ≈1 % on kerbs with sharper strike jolts), the
  cockpit eye thrown about by the G on a sprung neck (outward in corners, forward and down with a nod
  on the brakes, back into the seat on the power), a lens that widens with speed (mostly above 150 km/h),
  a live steering-wheel screen and shift lights in the onboards,
  and Camera tuning (FOV, dynamic FOV, chase distance / height, shake, look into corners, horizon
  lock). The cockpit view sits at the driver's eyes (halo hoop across the top, the pillar
  in the middle, front tyres at the sides, a full 2026 wheel with dome buttons, rotaries and paddles
  at the bottom); every onboard gets a tight fine-texel shadow cascade, and on High/Ultra the frame is
  upscaled to native resolution (bicubic + contrast-adaptive sharpening). The front and rear
  suspension links are live: they run from the chassis pickups to the upright clevises and follow
  the steering and the body's motion.
- **F1-game mechanics** — flashback (rewind up to 30 s, press R again to go further back, Enter to
  resume), tyre marks that build up through the race (and marbles: rubber the tyres scrub off in the corners
  gathers just outside the line, lap after lap), plank sparks wherever the floor is pressed onto the road
  (compressions like Eau Rouge, heavy braking, kerbs, a stray one flat out), pit stops where the crew really change the
  wheels, track-limit warnings and
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
  capped at the grip limit, single file through chicanes, backs off (and gets buffeted) in dirty air.
- **Racecraft** — every car races the car ahead and behind it (`Race.battles()`: within 1.2 s / 1 s on
  the road, same lap), not just you. Followers sit in the tow down the straight and pull out when the run
  will carry them alongside before the braking point, to the inside of the next corner if there's a car's
  width there (`AIDriver.scan` finds the braking point and the corner's inside), round the outside if not,
  and switch sides once if the car ahead moves to cover them. Defenders make one move to the inside
  while the attacker is still behind (never into a car alongside) and hold it to the apex. Side by side,
  each car's path keeps a car's width from the other's (the inside car takes the apex, the outside car the
  long way round, nobody is pushed off the road); the car less than half alongside — or round the outside
  of a chicane — backs out; down the inside the attacker brakes late (now and then too late: a lock-up,
  running wide), and the car out-braked round the outside brakes early and cuts back behind it for the
  exit. Stricken cars (spun, stopped, crawling, retired) bring a local yellow — no racing near them, a
  lift, and every driver steers round on the side with more road or stops behind (no pile-ups); a car
  put back on the road after a moment rejoins at the edge, away from the line. Fights with you are fought
  a little harder (both cars find a touch of pace while they last). `node tools/racecraft.mjs [laps]`
  (`TRACK=`, `SEED=`) measures it: overtakes per lap, gaps in the pack, side-by-side time, contacts,
  offs and the lap-time spread. Dynamic difficulty now ranges to
  106% of the limit and moves ±2.5% during a race (`node tools/aipace.mjs [track]` shows where the
  AI's pace tops out).

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
  fx/      Particles (tyre smoke, dust, sparks, plank sparks), CarEffects (per-car fx from the physics),
           Spray (rain plumes: a translucent grey mist, darker than the sky so a bright wet exposure never
           clips it), SkidMarks (rubber, offs, braking film, marbles)
  ui/      HUD, Menu, design tokens
  core/    Renderer (post chain: N8AO, bloom, speed blur + CA, grade, PBR Neutral, SMAA, sharpen;
           adaptive resolution that never trusts Apple's GPU timer), Input, Audio
  people/  Humans (bodies, clothing shader, faces, props), Crowd (GPU-skinned instanced fans),
           drivers, poses
  career/  Career (progress, upgrades, set-up), Highlights (recorded race moments, IndexedDB)
  dev/     dev pages for each module (car, track, world, audio, hud, people, crowd, drivers)
tools/     shot.mjs (headless screenshots), simtest.mjs (headless 20-car race), trackplot
```

Regression checks (all headless, no browser):
- `node tools/handling.mjs` — acceleration, top speed, braking, step steer, full lock, power oversteer.
- `node tools/kbbot.mjs 2` — a simulated keyboard player (binary keys, reaction delay) drives laps
  on each assist preset through the real control layer; reports off-tracks and spins (`GAME=1` uses the
  game's own presets, `PAD=1` an analog stick, `WET=0.6` a wet track, `TRACK=<id>` another circuit).
- `node tools/simtest.mjs 20 3` / `node tools/racetest.mjs 3 [weather]` — 20 AI cars racing: lap
  times, wall hits, off-tracks, penalties, weather and tyre calls, classification
  (`SEED=6 node tools/racetest.mjs 8 changeable` brings rain mid-race).
- `node tools/camshake.mjs [track]` — how much each car-mounted camera vibrates per frame (% of the frame height) on straights, kerbs and the grass over an AI lap.
- `node tools/diag.mjs 2 rain wet` — one AI car: lap times, tyre temperatures, grip, wear, fuel.
- `node tools/limits.mjs 3` — where AI cars run wide in a race.

In the browser (dev server on :5191, `npx vite --config vite.stable.config.mjs`):
- `node tools/bench.mjs [track]` — GPU cost per post pass / scenery group / cars (steady throughput timing; `DPR=2` for Retina).
- `node tools/ab.mjs <track> "<on js>" "<off js>"` — alternating A/B frame timing of one change (use it when another app loads the GPU).
- `node tools/bootwarm.mjs [track]` / `node tools/pixcheck.mjs` — cold vs warm boot steps + a CPU profile / the image cache filling, against `npx vite preview --port 5194` after `npm run build`.
- `node tools/tris.mjs`, `tools/cartris.mjs`, `tools/casters.mjs`, `tools/raceprof.mjs` — triangles/draw calls by group, per car LOD, shadow casters, a race-frame CPU profile.
- `node tools/perfnow.mjs [track] [cam]` — fps, render scale and draw calls in a live race at Retina 2×.
- `node tools/cuts.mjs [secs] [track] [speed]` — how often the TV director cuts in a simulated race.
- `node tools/fanprobe.mjs <ids…>` — fans standing on a road or inside the barriers (should be 0).
- `node tools/flow.mjs` — garage → race → pause → restart → simulated race (with travel): page errors.
- `node tools/tour.mjs <track> [n]`, `tools/camsheet.mjs`, `tools/shot2x.mjs` — screenshots.
- `node tools/tvsheet.mjs <track>` (TV director frames), `tools/horizon.mjs <track> <bearings>`, `tools/lookat.mjs`,
  `tools/carshots.mjs [team]` (studio angles) — more screenshots.
- `node tools/console.mjs <track>` — shader / page errors while a circuit boots and races (run it for all 14 after shader edits).
- `node tools/bootprof.mjs`, `tools/bootcache.mjs` — boot profile; cold vs cached (IndexedDB liveries + fan atlas) boot.
- `node tools/liveryhash.mjs [port]` — hash of every painted livery (proves a Livery.ts refactor is pixel-identical).
- `node tools/careerflow.mjs` — career map → round → results → Next round (travel) → next round's race screen.
- `node tools/introshot.mjs [track]`, `tools/menushot.mjs`, `tools/garageshot.mjs`, `tools/personshot.mjs` — intro / hub / garage part / garage person screenshots.
- `node tools/faceshot.mjs [outDir] [idx,…]` (garage faces, the line-of-sight hiding off), `tools/helmetshot.mjs` (pit-crew helmets in a stop), `tools/rb_scenes.mjs <garage|podium|grid|race|pit>` — people close-ups and their draw cost.
- `python3 tools/trees_fetch.py && node tools/bake_trees.mjs [--port 5191] [--preview id,…] [--encode]` — rebuild the trees (`public/trees/`) from the Poly Haven scans; `--preview` renders single scans, `--encode` only re-encodes the last bake's PNGs.
- `python3 tools/build_asphalt.py` / `python3 tools/build_grass.py` — rebuild the scanned road / grass textures (`tools/asphstats.mjs`, `tools/grassstats.mjs` print the procedural statistics they are matched to).
- `node tools/loadtime.mjs [track] [to,…]`, `tools/cpuprof.mjs <from> <to>` — boot and circuit-switch timings, CPU profile of a switch.
- `npm run build && node tools/pagesserve.mjs 5217 &` then `node tools/loadbench.mjs --ports 5217[,5218] --runs 2 --warm 3` — the
  load benchmark on a production build served like GitHub Pages (gzip, `max-age=600`, ETag): a cold visit (empty
  caches), warm visits, a circuit switch and a race start; first paint, garage, complete circuit (`__ready` without
  the settle), long tasks, bytes, and renderer / GPU-process CPU time (steadier than wall time on a busy machine).
  Several ports interleave A/B builds (e.g. an older `dist` copied elsewhere on a second port). `--net <Mbit/s>` throttles.
- `node tools/texhash.mjs [port] [track] [--warm]` — hashes of every 8-bit DataTexture in the finished circuit (diff
  two builds to prove texture-generation changes are pixel-identical; `--warm` hashes the cached copies).

## Steam (desktop build)

`desktop/` wraps the build in Electron with the Steam overlay and achievements (`steamworks.js`,
`src/core/steam.ts`); `cd desktop && npm install && npm start` runs it, `npm run dist:mac|win` packages
it into `release/`. `steam/STEAM.md` is the full checklist (Steamworks account, App ID, depots,
achievements, SteamPipe upload via `steam/upload.sh`, store page); store capsules are generated into
`steam/art/` by `tools/steamart.mjs` + `tools/steam_capsules.py`.

## Credits

All nine circuit centrelines are derived from the [TUMFTM racetrack-database](https://github.com/TUMFTM/racetrack-database)
(Technical University of Munich, LGPL-3.0), traced from satellite imagery.

People: avatars and animations from the [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox)
(MIT, see `public/models/rocketbox/LICENSE.txt`), fetched by `tools/rocketbox_fetch.py` and converted by
`tools/build_rocketbox.mjs` (headless Chrome, `src/dev/rbconvert.ts`); team kits, head swaps, crowds and
poses are done in code. Teams, drivers and sponsors in the game are fictional.

Ground: the track asphalt is Poly Haven's [Asphalt Track](https://polyhaven.com/a/asphalt_track) scan and the
grass ambientCG's [Grass 001](https://ambientcg.com/view?id=Grass001), both CC0, packed by `tools/build_asphalt.py`
and `tools/build_grass.py` into `public/textures/`.

Trees: Poly Haven's CC0 scanned / modelled trees — [Jacaranda Tree](https://polyhaven.com/a/jacaranda_tree),
[Island Tree 01](https://polyhaven.com/a/island_tree_01) and [02](https://polyhaven.com/a/island_tree_02),
[Tree Small 02](https://polyhaven.com/a/tree_small_02), [Fir Tree 01](https://polyhaven.com/a/fir_tree_01),
[Fir Sapling Medium](https://polyhaven.com/a/fir_sapling_medium) and [Searsia lucida](https://polyhaven.com/a/searsia_lucida).
`python3 tools/trees_fetch.py` downloads them (millions of triangles: offline only) and `node tools/bake_trees.mjs`
(headless Chrome, `src/dev/treebake.ts`) bakes what the game draws into `public/trees/` (≈ 6 MB): 8-view impostor
frames of each full-resolution tree, clumps of its real leaves for the near trees' leaf cards, and two near LODs
(the scan's trunk decimated with meshoptimizer + one leaf card per k-means cluster of its leaves).
