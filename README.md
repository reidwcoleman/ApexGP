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
  `node tools/dcflow.mjs` runs the real start → race → results → next round flow;
  `node tools/unlockflow.mjs` races the unlock chain for real (a slow attempt that leaves the next round locked,
  then a top-five one that opens it), `node tools/careermap.mjs` shoots the map in every state at 720p and 1080p.
- **Driver career season map** — the Career tab is the season as a world map, filling the hub: a pin per round,
  each **locked until the round before it is finished in the top 5** (the first is open). A finish outside the top
  5 (or a DNF) doesn't count: nothing is scored, the attempt is remembered ("Attempt 3 · best so far P7") and the
  results screen offers **Retry round**; a top-5 finish scores the round into the championship, the paddock and
  the ratings as before, and unlocks the next pin. Cleared pins carry the result ringed by its medal (gold = win,
  silver = podium, bronze = top 5), the next one pulses in the team colour, the rest wear a padlock; the route
  flown so far glows, the next leg draws itself. Click a pin (or ‹ ›) to glide to it: a card over the map shows
  the circuit, your result, what unlocks it, or — for the next round — the team's targets, the race distance and
  the call to action. The season's progress and a legend sit on the map, the paddock's latest message at its foot;
  Inbox, Standings, Driver and History stay as tabs. Without a career yet the tab shows the F2 season's map,
  locked but for round 1, and the way in (`DriverCareer.recordRound`, `CareerHub.ts` overview / `renderStart`).
- **Race distance** — 5 laps by default everywhere. Career races pick 5 / 10 / 15 / 20 / 30 laps (on the map's
  card or the race screen, kept with the career; saves from before default to 5), quick races 3 / 5 / 10 / 15 /
  20 / 30. Fuel is loaded for the distance (1.8 kg a lap + a reserve); under 8 laps nobody stops (softs), from 10
  the two-compound rule and the AI's planned stops, from 12 some two-stoppers, more of them the longer it gets.
  Career races take their weather and time of day from the circuit's climate (Sakhir and Yas at night, Spa and
  Interlagos changeable…), re-rolled after every race there; **Next round** on the results screen flies you
  straight on. **Quick race** keeps free laps and weather at any circuit your career has reached.
- **Garage first** — the boot builds only what the garage camera shows, at the circuit you race next (the career's
  next round, else the quick-race circuit you picked last): the track's data, the sky, your own garage alone
  (`buildGarageBox`: its interior, the lane in front of the door, and a haze across the lane at the pit wall,
  coloured like the air, in place of the world not yet built) and the two cars in it. The rest of the circuit then
  grows behind it a slice of main-thread work between garage frames (`Game.buildCore`, then `sceneryBuilder`,
  `env.adoptSteps`, `Game.completeWorld`): the trackside and the whole pit complex in a few steps each (the other
  garages, building, pit wall and every crew member, swapped in for the box and taking over its atlases), the rest
  of the field (several cars a frame when their liveries are cached), the skid marks and racing line, then
  terrain, woods, grandstands and crowds, the reflections re-captured a cube face a frame, the camera sight-line
  grid rasterised a few ms a frame — with a status chip in the garage. Every new piece is readied before it is
  shown (`src/world/prepare.ts` `ScenePrep`: its programs — the lit ones under each lighting set-up and the shadow
  pass's depth ones — queued a slice of objects per frame, its textures uploaded a few a frame, the driver's
  linking awaited behind a fence, each program's first-use queries asked in idle time; the slices grow when the
  garage's frames come slowly anyway, `frameClock`): `node tools/_bgtrace.mjs` (PORT env) lists the long frames and long tasks behind the garage
  with the WebGL calls in them, `tools/_bgprogs.mjs` the programs any of them linked in a draw. Starting a
  session sooner waits behind a short "Finishing" card. Picking another team before then moves the box to that team's garage; picking another circuit moves the garage there behind a
  short title card; no travel screen.
- **Fast boot** — the loading screen is painted before anything heavy runs (main.ts waits one frame before
  making the Game); the downloads and decodes (people, cached pixels, road scan, fonts) start on that frame and
  `buildWorld` awaits each only right before the step that needs it; the baked trees (~6 MB) and the fans' avatars
  only once the people are in (nothing the garage shows needs them; the landscape waits for the trees), the loading
  pictures one at a time ~3 s before their turn, and the highlights' production code (`career/clip/production.ts`)
  is a chunk of its own, imported once the garage is up. The ground textures' pixels are made off the
  main thread by two ground workers (`src/world/groundWorker.ts`, pure generators in `trackside/groundData.ts` and
  `env/textureData.ts`, byte-identical to the old main-thread code). Shaders are compiled with
  `compileAsync` (KHR_parallel_shader_compile: the driver's threads, never a blocked main thread): the world's
  garage-lit programs are queued before the cars are made, the landscape's (and the rest of the scene's in race
  light) before it is adopted, the race's in `warmUp` (with the soft smoke's scene and the sun shafts' passes, which
  only draw now and then). The podium's stage lights are the same set as the garage's work lights (two spots, one
  shadowed, two points: light counts are part of every program's key), so the ceremony draws the world with its
  garage-lit programs and only the stage's own few compile when a race ends; its fans are baked behind the garage
  (`prebakeFans`). Nothing the boot draws is left
  to be built on first use (each such program was a blocking compile + link, 0.1–0.6 s apiece on a cold D3D
  cache): the sky's programs (cloud noise and march, the dome, PMREM's filters: `env/skyPrewarm.ts`) and the post
  chain's (`Renderer.compilePasses`, a dry run of the chain) are queued the moment the boot starts, the particles'
  sky probe with the world, and the garage's first frame waits only for what it draws (`Game.compileSeen`: what
  the garage camera frames, and the floor mirror's own light set) — the rest of the garage's programs build
  behind it. `PORT=… node tools/_boottrace.mjs` (cold profile; `ALL=1 KEYS=1 USED=1 AFTER=1` for detail) lists every
  program and upload the boot still waits on and why, `tools/_bootshots.mjs <out>` shoots the boot's stages. three's per-program error check
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
- **Living trees** — every tree is one of Poly Haven's scans (`env/treeproto.ts`, baked by `tools/bake_trees.mjs`).
  Near the circuit they are 3D: the scan's trunk and limbs, and hundreds of small leaf sprays — one per k-means cell
  of the scan's real leaves, lying in the cell's own plane along its own axis, textured with real sprays of that
  tree's leaves (separate near / far sprays so leaves keep their real size at every LOD) — so a crown has gaps, a
  ragged edge, branches inside and a dark interior; a fir's sprays are flat stretches of bough, so it reads as
  layered drooping tiers from below. Three LODs (LOD2 also casts every near tree's shadow from a second,
  shadow-only BatchedMesh), hashed alpha once leaves get small, then 8-view impostors of the full scan (conifers
  hand over sooner, ~55 m). Every LOD change and the impostor hand-over is a matched dither over a few metres, and
  every distance is measured from the camera's look-ahead (the stretch its next half second of travel covers), so
  the trees the car is heading for are at full detail well before it reaches them, not as it passes. Wind is per vertex (`treematerial.ts`): trunks lean and swing (drag ∝ speed², bigger
  trees slower), gusts roll downwind through the woods, limbs swing at their own phase, leaves rock and flash;
  calm in fog, thrashing in a storm; impostors share the trunk sway. A car's wake (`feedCarWake`, fed from
  `Game`'s rigs) ruffles the verge grass, bushes and low branches it passes.
- **City skylines** — Melbourne's CBD and Southbank and downtown Montréal are built tower by tower
  (`Merge.tower` in `env/venues/montrealCity.ts`): podium, shaft (square or with its corners cut), maybe a
  setback, then a plant room, glazed crown or mast. `cityMaterial` counts storeys and bays from each building's own
  base (aWin = curtain, reflectivity, seed, base y): punched windows or curtain walls with spandrels and mullions,
  each pane its own interior and bend, shopfronts and the darker street canyon at the foot, coated glass mirroring
  more sky up high, the pattern fading to its average where it would alias.
- **Monza's own landmarks** (`env/venues/monzaScenery.ts`) — the Villa Reale at the park's southern end
  (Piermarini's corps de logis with its giant order and pediment, the wings round the cour d'honneur, cornices,
  attic, hipped grey roofs, the parterres and fountain behind; `cityMaterial`'s classical mode: aWin.x ≥ 1.5
  gives tall piano-nobile storeys and windows, no shopfronts) and Milan in 3D 13–15 km to the south-west
  (Unicredit and its spire, Solaria, the Diamond, Bosco Verticale, the Pirelli tower, CityLife's straight,
  twisting and curving towers, Torre Velasca, the Duomo and its spire, the city round them) in front of the
  horizon's painted sprawl. `tools/_monzalm.mjs` frames them.
- **Spa's own landmarks** (`env/venues/spaScenery.ts`, worldmap `ARDENNES_TOWNS`) — Francorchamps north-east of
  La Source and the hamlets of Burnenville and Ster: Belgian houses (grey rubble stone, whitewash, steep slate) in
  garden clearings (terrain `uTownYard` = 1: lawns, no painted roofs), each village with its stone church under a
  slate spire. Raidillon has gravel on the outside and the big covered stand at the top (2022); Les Combes gravel;
  the Ardennes forest is about three-quarters spruce.
- **Silverstone on a race weekend** (`env/venues/silverstoneScenery.ts`, placed by `planSilverstone` as landmark
  kinds `carpark` / `campsite` / `hangar` / `controlTower`) — instanced grass car parks out on the airfield (rows nose
  to nose, two-thirds full), campsites by the corners (ridge tents, cars, the odd motorhome), three WWII T2 hangars
  beside the Hangar Straight on whichever side has room, and the old watch office with its glazed control room.
- **Who advertises where** (`world/partners.ts`, research in `docs/F1_ADVERTISING.md`) — every circuit carries 20
  fictional brands combined the way the real ones are: 14 series partners at every race (a timekeeper, the VELTRA
  tyres, express freight, a 0.0 lager, champagne, an energy drink, an airline, a bank, cloud, an energy company, a
  luxury house, a crypto exchange, a cruise line, a laptop maker — each in the colour block of the kind of board that
  holds that contract) and 6 local partners sold by the promoter (the host's bank, telecom, beer, airline, tourism
  board, car maker…). Each race has a title partner that names it ("VELTRA GRAN PREMIO D'ITALIA", `EVENT.titled` in
  `event.ts`) following the 2026 calendar's pattern (the tyre maker at Monza and Silverstone, the laptop maker at
  Montréal and Spielberg, the cruise line at Austin and São Paulo, the energy company at Suzuka, cloud at the
  Hungaroring, champagne at Spa, the lager at Zandvoort, the airline at Albert Park, the national airlines in the
  Gulf; Mexico City has none, "presented by" the lager): its banner on the start gantry, the podium and the
  footbridges, its paint in the big first-corner run-offs, and the most contracts in the board runs. `setEvent`
  picks the circuit's roster; every board painter reads `roster()`: the trackside atlas (`ad0`…`ad19` + the series'
  own board; `adMixed` draws barrier runs by contract weight, the gantry alternates the title banner with the
  timekeeper, each generic footbridge face is one contract, stair towers carry local partners, tyre-wall belts the
  title partner / tyre maker / freight, the braking boards the title partner's strip, run-off decals its word mark),
  the grandstand fascias (`signage.ts`, local partners on every other board, repainted on a circuit switch), the
  pit building and podium, and the venue dressings. Word marks are drawn on canvas (`brands.ts`: weight, case,
  tracking, slant, stretch and one of 13 emblems). LED perimeter boards show a `LedReel` (`venues/ledReel.ts`):
  every venue's LED boards roll together through its partners (8 s a slide, the title partner every fourth),
  so a run belongs to one brand at a time. `tools/_brandshots.mjs <out> <track> [--atlases]` frames the gantry,
  the main straight and Turn 1 and dumps every board atlas.
- **Each Grand Prix's own boards** (`env/venues/venueAds.ts`, plans in `venueAdPlans.ts`) — on top of the
  paddock-wide wall paint, fence wraps and bridges, Albert Park, Mexico City, Sakhir and Yas Marina carry their
  race weekend's partners (`partners.ts`: the title partner's banner, the local lager, airline, telco, bank):
  LED perimeter boards along the foot of the main grandstands (self-lit),
  printed hoardings on posts round the backs of the run-offs (Melbourne's gravel traps, Mexico's and Sakhir's
  Turn 1, Yas's hairpin), the title banner across the top of every footbridge, big word marks painted on the
  Tilke run-offs (laid along the track, reading from the outside camera, worn by tyres), Mexico's rosa mexicano
  round the Foro Sol and Bahrain's serrated red-and-white. Yas Marina's stands sit under white sail canopies on
  raked masts (uplit after dark); Mexico City's Reforma towers (Torre Reforma, BBVA, Mayor, Chapultepec Uno,
  the Latinoamericana, the WTC, Mítikah) stand 5–10 km west at their real bearings; Sakhir is lined with light
  poles every ~50 m a side.
- **Race-weekend dressing** (`env/venues/dressKit.ts`, one `<venue>Dress.ts` each, dispatched by `venues/dress.ts`) —
  each venue's own boards laid out where the broadcast shows them rather than from the paddock-wide pool: a canvas
  atlas per venue (its partners from `partners.ts` and the event's own banners), rows of printed or LED hoardings on posts behind the barrier (clear of marshal posts, stands, fan banks,
  screens and footbridges; brands in contract runs), big braced boards at the ends of run-offs, a banner gantry
  over a straight (the generic arches keep clear: `VENUE_PROPS.keepClear` / `arches` in `trackside/structures.ts`),
  painted logos in the tarmac run-offs (only where it really is tarmac run-off) and the pit building's roof:
  Montréal's white canopy over the roof terrace with GRAND PRIX DU CANADA on its fascia and boards down the Casino
  straight; Spielberg's graphite roof blade sweeping up over the pit lane with its red leading edge and the energy
  drink's logos painted across the Niki Lauda, Remus and Schlossgold run-offs; Zandvoort's glazed Paddock Club
  pavilion under an orange fascia and the orange gantry into Tarzan; COTA's white Paddock Club blade with its fin
  screen and the court-sized logos in the Turn 1 run-off; Interlagos's big boards up the Subida dos Boxes and the
  painted S do Senna. Seat colours per venue (`VENUE_SEATS`).
- **Venue dressing for Monza, Spa, Silverstone, Suzuka and the Hungaroring** (`env/venues/*Dress.ts` on
  `venueDressKit.ts`, planned with the layout so trees and stands keep off, built with the scenery) — each venue's own
  footbridges where the real ones cross (`dressBridges.ts`; the trackside's automatic arches keep clear): Monza's
  Rettifilo bridge and the one before the Parabolica, Spa's bridge by the old pits on the run to Eau Rouge, the Kemmel
  bridge and the run toward Blanchimont, Silverstone's Wellington and Hangar Straight bridges, Suzuka's main-straight
  bridge, the yellow Dunlop arch and the back straight, the Hungaroring's back straight and Turn 12 run — enclosed box
  girders, open trusses or (Dunlop) an arch, one title sponsor across each face as the real ones are sold, stair
  towers wherever the stands and fans' banks leave room. Self-lit LED boards along the main grandstand walls. Spa's
  old pits stepping down the hill to Eau Rouge (fans on the roof rail, the old timekeepers' box at the top), the old
  National pits and the drivers' clubhouse at Woodcote at Silverstone, Suzuka's big boards round 130R, painted
  run-off logos at more corners (`trackside/markings.ts` `RUNOFF_LOGOS`). Its own banner atlas of the venue's
  partners: the title partner on the first bridge's face, the series' timekeeper, freight and lager on the others,
  the promoter's partners on the far faces and the old pits' fascias.
- **Trackside weathering** — props and printed surfaces carry a weathering class (`WEATHER` in
  `trackside/builder.ts`, the integer part of the roughness channel): concrete (patina, rain-run streaks, pour
  joints, lichen on top), painted steel (mottle, chips, rust runs), painted walls (rubber scuffs where cars
  touched, grime, section joints) and plastic (TecPro, tyre belts). Footbridges are Warren-truss spans on open
  steel stair towers; marshal posts are steel-framed shelters with their kit. Pit-building rooms read dim behind
  the glass by day and glow after dark. `tools/_spots.mjs` / `_posts.mjs` / `_ring.mjs` frame free-camera shots.
- **Pit buildings in each circuit's own materials** — `pitStyle` (pitlane/building.ts): trim, cladding, core,
  frame and glass tint per venue (Spa's and Mexico's dark grey, Sakhir's sandstone, Spielberg's graphite) and the
  top floor's shading: vertical fins (Monza, Yas), horizontal louvres on outriggers (Suzuka, Hungaroring,
  Melbourne, Zandvoort, Sakhir) or a flush curtain wall (Spa, Austin, Mexico, Montréal). The end elevations — what the
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
  wears off the chip tops, gravel rakes wander.
  Road wear is baked per metre from the racing line and the AI's speed profile (`trackside/context.ts`
  `analyseWear`, so every circuit gets its own): rubber heaviest where the tyres work (braking, lateral
  load, traction), the loaded outside tyre's track darker, polished to a satin sheen in streaks (it catches
  a low sun; in the wet it sheds water and goes slick first); lock-up film into the braking zones;
  acceleration "elevens" out of the slow corners; marbles flung to the outside of the line from the apex
  on; dirt and stones dragged back onto the edge (and across the kerb) where the outside is grass or
  gravel; inside kerbs rubbered and scuffed hardest; a season of launch marks off every grid box. The
  session's own rubber (`uRaceRubber`) deepens all of it. The wet road takes the env map's light but not its colour (the
  env map is one spot's view: a red grandstand mirrored round the lap); the screen-space march supplies what is
  really beside the road. Carbon weave and paint flake within ~2 m of an onboard lens read as their average
  (the lens's defocus can't resolve them). `node tools/_matshots.mjs <out> <track> <weather> <time> [car|road|glare]`
  (PORT env) shoots frozen close-ups of the player's car, the road at several distances and the road into and
  away from the sun; `WXSET='{"wetness":0.7,"rain":0,"dryLine":0.8}'` sets a drying track.
  The aggregate fades by what its 16× anisotropic filter really averages (the footprint's short axis, not its
  long one), so the grain carries on down the road from a chase cam, under a quarter-mip LOD bias that keeps it
  from crawling; edge-line paint and kerbs show the surface under the coat (grain, pin-holes, a ragged edge, the
  dark joint where the kerb meets the road). `node tools/_roadalias.mjs <out> [track] [views]` (PORT env) measures
  road shimmer: frozen views rendered at 1× (turned a quarter pixel at a time) against a 2× reference.
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
  The dry skies each read differently (`weatherLook` in env/presets.ts, the cloud march in env/skyClouds.ts):
  clear is a deep blue paling to a near-white horizon; at dawn and golden hour the low sky runs from the sun's
  orange through a pale cream to the blue above, never the mint or olive an RGB-only atmosphere makes of it (the
  sky LUT is folded back onto the daylight locus and its multiple scattering is lit by the sky, not the reddened
  beam: `toDaylightLocus` in atmosphere.ts); light cloud is separate sunlit cumulus — white flanks
  (multiple-scattering octaves), blue-grey bases lit by the sky, lit orange on the sun's side and lavender-grey
  in their own shade at golden hour — whose shadows are cast by the clouds that are drawn: the panorama's own
  density is integrated up the sun ray over a 24 km map round the camera (`bakeShadow` in skyClouds.ts, a strip a
  frame), read by the ground, every lit material and the horizon ring (`cloudShadowAmount` in lightShadows.ts),
  so a cumulus over the back straight has its shadow under it, displaced away from the sun; windy is the clean, saturated air behind a
  front, the cumulus dragged out and torn by the wind aloft (`uShear`), racing, and every pole flag flying
  straight out downwind (limp in a calm); hazy sun is a deep milky layer that swallows the far hills, with a
  pale luminous sky and a softened sun; overcast has no sun at all — flat, shadowless light under a soft grey
  deck that the camera meters up to a bright grey-white, with the soft lighter and darker patches of a
  stratocumulus underside and a brighter patch where the sun is hidden (the light diffused through the deck
  follows its thickness).
  Fog and mist are a ground layer under the haze (`aerialGround` in fog.ts: an analytic exponential anchored at the
  circuit's level, thicker in the hollows, drifting in banks): fog ~45 m deep with ~400 m visibility, the sun a pale
  disc through it at best and the murk glowing round it (a droplet phase function, shared with the sky dome), trees,
  stands and cars fading to grey silhouettes; morning mist shallow (~14 m) and bright under a pale blue sky (clean
  air above the inversion), ~600 m visibility, burning off through the session — the helicopter looks down
  through a sunlit sheen, the treetops stand out of it and it pools in the low ground of a hilly circuit. After
  dark the murk is lit by what shines into it: the cars' beams are a glowing wedge ahead and an oncoming car a
  ball of light (`aerialLamps`), and at twilight the air over the track glows under the floodlights and darkens
  away from them (`aerialFlood`, from the flood field) — both integrated along each view ray in fog.ts. The sun gets
  through what the layer's slant depth leaves (a high sun casts shadows in mist, a low one is gone); AO fades behind
  the fog; rain lights glow in it. A drying track starts with a line already cleared and dries unevenly: the line goes
  to dry, lighter asphalt with a ragged edge, the braking zones keep damp blotches, the stretches by the trees (the park
  mask's tree cover) stay wet, the open surface dries in patches; the wet half keeps a smooth sheen that fades as the
  film thins; spray comes only off the wettest parts, light, and next to none off the dry line. The rain itself
  changes with the rate (drizzle: fine, slow, faint streaks; a downpour: thick fast ones falling in wind-driven
  sheets), lightning lights the land by how dark it is and how close it struck (a flicker at noon, the circuit
  flooded white at night), and its thunder arrives ~3 s per kilometre later. Onboard lenses carry defocused,
  ragged drops that sit at low speed and are blown streaming off the glass flat out (the chase cameras stay dry).
  A downpour under a full deck is heavy: the camera doesn't meter the gloom back up to a bright day and its sky is
  held back to a dark, lumpy slate (`FILM.stormSky` / `stormExposure`), the murk greys instead of glowing, and darker
  rain curtains hang from the deck along the horizon, leaning with the wind and marching across it (`uCurtain` in
  sky.ts). In standing water a few rivers run across the road each lap — slanted bands of flowing, rippled water
  (visual only). Seen from above (helicopter, long lenses) a plume's puffs are drawn as trails smeared along their
  drift, not balls; water flung off the front tyres' tread streams back over them on the close onboards; a car's
  headlights light the rain only in their beams' low wedge; foliage keeps no ambient-occlusion pepper in the veil.
- **Race** — 20 cars, standing start with five red lights, 3/5/10/15/20/30 laps (5 by default), Dynamic AI (keeps pace
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
  the track), grass and gravel, impulse-based contact with walls and cars, front-wing damage (a tough car:
  rubs, taps and wheel-banging under ~45 km/h are free, 7× tougher than the original tuning, and only a
  big hit (~80 km/h square on) bends the suspension), tyre wear.
  Past the peak the tyre curve falls away gently sideways but harder for a lock-up or wheelspin
  (`SLIDE_DROP_*`: a locked tyre keeps ~80 % of its peak, a sideways slide ~90 %, as ACC's tyres do).
  Tyre pressures as in ACC: the carcass soaks up the tread's heat over ~25 s and the gas follows it
  (ideal gas, hot targets ~27 / 25 psi front / rear), so pressures build over the first lap out of the
  blankets — under target the tyre is lazy and slippery, over target it is stiffer and pointier
  (`tyreCore`, `tyrePress`; a time-trial / qualifying lap starts with them up, as after an out-lap).
  Kerbs unseal the floor: a wheel on a kerb costs its axle downforce, a strike more for a moment
  (`KERB_AERO*`), and a strike leaves the wheel running light for most of a tenth — an exit kerb on
  the power takes grip off the rear.
  The chassis moves like a stiff F1 car (~2.5° of dive at 5 g, ~1.5° of roll, springs that settle with a
  little overshoot) over each circuit's own fixed road relief (`roadBump`: rougher braking zones, Austin
  and Montreal bumpier than Monza), which also drives the cameras' vibration (`roadVel`, `strike`).
  Validated with `tools/handling.mjs`: 0–100 km/h 1.9 s, 0–200 3.7 s, top 336 (343 with DRS), 300→80 km/h in 68 m at
  6.8 g peak with ABS (86 m locked up without it, 56 m with the assisted handling's brakes), 2.1 g cornering at 100 km/h up to ~5 g at 280 km/h, stable at full lock at any speed;
  trail-braking rotates the car ~1.6× more than coasting into the same turn, full throttle at a 2nd-gear apex
  steps the rear out ~27° with no assists (≈5° on Standard), an exit kerb on the power at 200 km/h kicks
  the yaw rate ~15°/s, and the wet table drops cornering grip to ~63 % on slicks / ~78 % on inters at half-wet.
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
- **The big screens carry the world feed** (`game/ScreenFeed.ts`, `world/env/bigScreens.ts`) — every giant screen round
  the circuit shows the live race as the TV director cuts it (its own lens and `Director`, sharing the placed trackside
  cameras, 4–8 s shots: onboards, chase, long lenses, the heli, the leader, battles; your car when the feed is on it),
  under the broadcast graphics (the timing tower with the lap count, the driver's name as the feed moves to him, speed
  and gear on the onboards). One shared picture: the live scene drawn into a 384×216 HDR target at 12 Hz (8 Medium,
  15 Ultra; half that while the screens are small) only while some screen faces the main view in plain sight (frustum,
  viewing angle and the cameras' sight-line grid), without the post chain or a new shadow pass, the trees as impostors,
  no grass, rain streaks, particles or the main view's extras, cars at the LOD their size in the feed calls for; then
  exposed with the main view's exposure and tone curve and burned in with the graphics at the wall's 768×432 LEDs. The
  panels are LED walls: the picture per LED up close (round dies, RGB chips at arm's length, moiré in the hand-over to
  the average), the louvres' viewing angle (dark from above), held at a steady level against the grade by day and
  glowing after dark, a wet glossy face with beads and runs that smear the picture in the rain. Low quality keeps the
  event's holding graphic under the live timing. `__game.screenFeed` (`force`, `enabled`, `stats`) for dev.
- **2026 cars** — the new regulations' car: 280 / 375 mm tyres, a shorter nose on the front wing's
  mainplane, three-element front and rear wings whose flaps move (straight mode opens both on the
  straights), no beam wing, a narrower flatter floor with wheel-wake boards, bigger mirrors,
  lateral and endplate lights; baked ambient occlusion on every car. Tyres (`car/carTyres.ts`) squash
  under load from the physics: the contact patch goes flat and the sidewall bulges over it, at the
  bottom however the wheel has rolled. A new slick is matte with its wear-indicator dimples, a used one's
  running band polished to a satin sheen between grained, scrubbed shoulders; the fictional VELTRA
  sidewall (VX-18 slicks, TORRENTA rain tyres) carries moulded technical markings that show in the relief.
  The details a close lens finds:
  floor stays, inlet scoops on all four brake ducts, the rear flaps' actuator pod, a telemetry antenna
  ahead of the cockpit, the T-cam pod's lenses on a roll hoop ~1 m up (proud of the helmet by the
  rollover line's ~70 mm, so the T-cam looks down over the helmet's crown and the halo's ring), a
  slimmer halo pillar, a moulded headrest round the helmet and a black padded roll along the
  cockpit's rim, mirrors on stalks off the sidepods ~0.4 m ahead of the driver's eyes, toed in so
  his own rear tyre fills their inner third (their glass ray-traces the road, the own sidepods and
  tyres and up to four cars behind as boxes and cylinders, lit like the scene, over the env
  reflection: `makeMirrorMaterial` / `feedMirrors` in CarModel.ts — no second render), a helmet
  with a chin bar and a gloss-carbon rear spoiler whose livery is drawn per pixel from the shell's
  shape (`HELMET_GLSL`: one of six painters' designs per driver — stripe, arrows, crown cap, wave,
  twin stripes, split — with pinstripes, the number across the crown and the sponsor across the
  back, sharp 30 cm from the T-cam), and the driver's arms and gloved hands on the wheel (`car/carHands.ts`: one skinned mesh,
  upper arm / forearm / hand bones a side): palms cupped round the grips, fingers wrapped round their backs
  onto the shift paddles, thumbs on the face by the top buttons, so they sit on the grips at any lock;
  the elbows are a two-bone IK from the shoulders and the gauntlet bends at the wrist; race gloves with
  the team's colours, a sponsor patch, tonal stitching and a suede palm (sheen, a shared stitch/padding
  normal map, baked finger occlusion). The cockpit cameras keep them when the driver is hidden
  (`setDriverVisible(false, true)`). Carbon is anisotropic (each tow's sheen stretched across it, warp
  and weft at right angles, under the isotropic lacquer; it fades to the weave's average once a pixel
  spans a tow), plate edges (endplates, fences, fins, the wheel) shade rounded, and the front wing's
  first flaps carry a partner's wordmark read from the onboards. (No over-wheel deflectors: 2026
  dropped them for the wheel-wake boards.)
- **Two looks, one light** (`Renderer.broadcast`, set per camera in Game.updateMotionBlur): the cameras you drive
  with (chase, onboards) get the sim look — Assetto Corsa Competizione's clean, crisp HDR image: an ACES-fitted
  filmic curve, white balance to the light, saturated but natural colour, clean blacks, no grain, lens distortion
  or chromatic aberration, a hint of vignette, even sharpening, a restrained neutral bloom, a cockpit in shade but
  readable and sharp. The TV director, the trackside and aerial cameras and the replays keep the camera footage
  look below. On High/Ultra both get temporal anti-aliasing (`src/core/taa.ts`: Halton-jittered projection,
  depth + tracked-car reprojection, Catmull-Rom history, variance clipping; sparks pass through) in place of SMAA,
  so fences, kerb stripes, thin flaps and hashed-alpha foliage stop crawling.
- **Camera footage look** — camera + per-object motion blur like a film shutter (`src/core/motionBlur.ts`: a
  half-res velocity buffer from depth reprojection, tile/neighbour max and a McGuire-style reconstruction, so the
  grass, kerbs and barriers streak past while your own car and the cars racing alongside stay sharp, a car
  flashing past a fixed camera smears beyond its own outline, the halo never smears or is smeared into, and the
  frame's edges don't streak; long lenses get a faster shutter; the shutter opens up with speed, to 2.6× flat out;
  Settings → Motion blur Off / Subtle / Cinematic),
  a camera's auto exposure (`autoExposure.ts`: metered on the GPU, it opens up a beat late under a bridge or the
  trees and is briefly over-exposed coming back out, but leaves the grade alone in steady light), sensor grain
  that follows the metered gain (all but clean on a sunny day, visible on a wet morning or at night), a lens:
  soft-knee bloom (no glow disc round a low sun), warm wide halation, soft lens-flare ghosts and veiling glare
  into the sun, mild barrel distortion + lateral CA on the wide lenses and footage-soft sharpening, a photographic grade layer
  over every weather and time of day (`FILM` in Environment.ts: a little under-exposed, colour pulled back, greens
  tamed toward olive, a warm yellow cast that is full in sunshine, eased off under cloud and gone in the blue hour,
  where footage is cool; a camera that meters a flat grey day almost back up so a wet sky goes near white, while a
  sunny frame keeps its dark shade; darker nights), a print stage after tone mapping (`FilmEffect` in Renderer.ts:
  a warm black floor that is crushed to black at night, colourless deepest shadows, a warm clip), warm halation
  round every bright light (the bloom), and a low sun's glow that builds over kilometres of air rather
  than veiling a car down a long lens. Inside the cockpit (cockpit, helmet, halo cam: `INSIDE_CAR`) the lens is exposed for
  the bright world outside: the car's own cockpit is shaded and defocused by distance (`OnboardEffect`, from
  depth + the car's box; lit LEDs keep their glow, sun glints in the lacquer don't), no rear-view mirror
  than veiling a car down a long lens. Onboard (cockpit, helmet, T-cam, nose, wheel) the lens is exposed for
  the bright world outside: the car's own cockpit is shaded and defocused by distance (`OnboardEffect` in
  onboard.ts, from depth + the car's box, blurred from both sides of its edge so the halo's outline is soft and
  the sky glows into it; lit LEDs keep their glow, sun glints in the lacquer don't, sunlit stretches of the
  halo, the rim and the gloves keep most of their light so the sun rakes across them), no rear-view mirror
  overlay (real onboard footage has none), and night races are lit by a faint moon only, so the headlights,
  rain lights and the lights round the track carry the picture. The cockpit eye sits low and back in the tub
  (`COCKPIT_EYE_*` in Cameras.ts) so the halo's hoop rides the top edge as in onboard footage; long lenses thin
  the haze (`aerialLens` in fog.ts) so telephoto shots stay contrasty; camera cuts reach the motion blur through
  `Cameras.cuts`. Engine/wind mixes are balanced against real V6 turbo-hybrid footage by band energy
  (`tools/audiocheck.mjs --bands`: cockpit ≈ 22 % < 150 Hz, 58 % 150–600 Hz, 16 % 600–2k, 3 % 2–6k). `node tools/_lookshots.mjs <out>` shoots the reference scenes;
  `node tools/_mbbench.mjs` times the blur pass.
- **Racing cameras** — 12 to drive with (C cycles them, Settings → Camera picks one: `CAMERA_ORDER`, the chase
  cameras and the forward-looking onboards; the long-lens chase, the drone, the rear-facing onboards, the helicopter,
  blimp, tactical map, trackside lenses and the TV director are for simulated races, spectating and replays, where
  every camera cycles — `ALL_CAMERAS`; an older save holding one of those falls back to the chase): chase / far / low
  chase a hand's width over the road (surge, brake pitch, look to the apex, glide between them; the horizon
  held all but level as in ACC — the G lean is what the horizon lock leaves, ≤1° by default),
  a long-lens chase (a camera car 30–45 m back on the circuit holding the car on a 6–9° lens, the field
  stacked behind it in a shallow focus; it cuts to a closer camera car when a bend comes between them),
  the chase drone, and onboards placed against the body's measured shape (`MOUNTS` in Cameras.ts, each
  with its own lens, bracket stiffness, housing flex, roll and corner look): the T-cam on the roll hoop
  (1.03 m up, tipped ~8° down, a ~95° lens: the helmet's crown inside the halo's ring at the bottom, the
  nose under the hoop between the front tyres, the mirrors at the sides),
  the broadcast halo cam low in the tub (the centre pillar splitting a wide picture), the cockpit eye,
  the helmet cam, the bonnet cam (ACC's: on the tub's centre line ahead of the halo pillar, the nose
  running away down the middle), the nose pod, the bumper cam over the front wing, the front-wheel cam, the sidepod,
  the rear-facing T-cam and rear sidepod; the helicopter, trackside, and a **TV director** for your own
  race that cuts every 3–8 s between long lenses, onboards and the chase cameras like the TikTok edits
  (`Cameras.view` is the shot on air). The helmet cam rides the driver's head, framed by the visor;
  every lens rides with the car vibrating like its mount (`CamShake` in Cameras.ts: noise-rung
  resonators — the head or bracket sway at 4–11 Hz, the structure's buzz at 11–22 Hz — driven by the
  speed, the road relief under the wheels, kerb ridges and strikes, the grass and contacts; calibrated
  against the reference onboards with `node tools/camshake.mjs`: the T-cam moves ≈0.5 % of the frame
  height per 30 fps frame on a straight at 300 km/h, ≈1 % on kerbs with sharper strike jolts; the
  cockpit eye, steadied by the driver's own gaze as in the sims, ≈0.3 % and ≈0.9 %), the
  cockpit eye thrown about by the G on a sprung neck (outward in corners, forward and down with a nod
  on the brakes, back into the seat on the power) behind a fixed 60° lens (the top of the 55–60° range the sims use on a monitor, so the mirrors' inner
  edges sit at the frame's edges as in the helmet-cam footage and the inside one swings in with the look
  into a corner; the
  other cameras' lenses widen with speed, mostly above 150 km/h),
  a live steering-wheel screen and shift lights in the onboards (a 1024-texel screen texture of its own,
  mipmapped and anisotropic, repainted at 15 Hz like a 2026 wheel's / ACC's dash: gear, speed, delta,
  lap and position, tyre temperatures, brake balance, battery and boost, aero mode, last lap; held at a
  constant brightness on the display whatever the grade's exposure (`SCREEN_GLOW`); kept sharp by the
  onboard defocus, untouched by the motion blur, and reprojected through the wheel's own turn by the TAA,
  its pixels flagged responsive so changing digits don't ghost), printed legends and position ticks on
  the face, LED lenses, knurled rotaries,
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
- **AI that learns** (`src/sim/AILearning.ts`) — each AI driver learns every circuit corner by corner: new
  to a track they brake early and carry a little less speed, then each clean pass moves their braking point and
  corner speed toward the limit (back off after running wide or arriving too fast, push on with grip to spare,
  give it back if it didn't pay); someone — you too — quicker through a corner shows there's time there (the
  learning never slows anyone for your sake). Long fights push drivers past what they know (that's where mistakes come from). What they
  learn, and a slow development over the races they drive, is kept in localStorage (`apexgp.ailearn`), capped by
  the difficulty so the AI stays beatable.

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

Steering wheels and pedals (any USB wheel the browser exposes as a gamepad, pedals on the same or a separate
device): Settings → Controls → Wheel and pedals binds and calibrates them by moving them (inverted and
combined-axis pedals included), with the wheel's rotation (mapped 1:1 onto the car's ±180° lock), steering
and brake linearity, pedal deadzone and live meters. Pads get deadzone, linearity, an adaptive (1€) steering
filter, speed sensitivity and force-feedback-style vibration (kerbs, gravel, lock-ups, wheelspin, impacts;
impulse triggers on Xbox pads in Chrome / Edge).

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
           Spray (rain plumes: compact at the tyres, fading in and spreading into a hanging trail — taller,
           wider and longer-lived on a flooded track — lit by the whole sky dome, a little under the haze;
           soft puffs fade by how much of their ball lies in front of a surface, and the half-res layer is
           upsampled depth-aware so cars in spray keep clean outlines), SkidMarks (rubber, offs, braking
           film, marbles)
  ui/      HUD, Menu, design tokens
  core/    Renderer (post chain: N8AO, TAA, motion blur, onboard lens, bloom, speed blur + CA, grade + auto exposure,
           PBR Neutral / ACES-fit by look, film print + grain, SMAA below High, lens + sharpen;
           adaptive resolution that never trusts Apple's GPU timer), Input, Audio
  people/  Humans (bodies, clothing shader, faces, props), Crowd (GPU-skinned instanced fans),
           drivers, poses
  career/  Career (progress, upgrades, set-up), Highlights (recorded race moments, IndexedDB)
  dev/     dev pages for each module (car, track, world, audio, hud, people, crowd, drivers)
tools/     shot.mjs (headless screenshots), simtest.mjs (headless 20-car race), trackplot
```

Regression checks (all headless, no browser):
- `node tools/handling.mjs` — acceleration, top speed, braking, step steer, full lock, power oversteer.
- `node tools/controlstest.mjs` — the control layer: wheel / pedal mapping and binding, the pad filter, device
  switching with a stubbed Gamepad API, rumble.
- `node tools/kbbot.mjs 2` — a simulated keyboard player (binary keys, reaction delay) drives laps
  on each assist preset through the real control layer; reports off-tracks and spins (`GAME=1` uses the
  game's own presets, `PAD=1` an analog stick, `WET=0.6` a wet track, `TRACK=<id>` another circuit).
- `node tools/simtest.mjs 20 3` / `node tools/racetest.mjs 3 [weather]` — 20 AI cars racing: lap
  times, wall hits, off-tracks, penalties, weather and tyre calls, classification
  (`SEED=6 node tools/racetest.mjs 8 changeable` brings rain mid-race).
- `node tools/camshake.mjs [track]` — how much each car-mounted camera vibrates per frame (% of the frame height) on straights, kerbs and the grass over an AI lap.
- `PORT=… node tools/_studiocam.mjs <out> 'name=px,py,pz/dx,dy,dz/fov[/&query]' …` — onboard lens framings on the studio car (car frame, e.g. the T-cam mount); `PORT=… [SKIP=s N=k] node tools/_mirrorprobe.mjs <out> [weather] [time]` — a live race with the cockpit lens swung onto each rear-view mirror (14°), and where the cars behind are.
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
- `node tools/_wetshots.mjs <out> [track] [weather:time,…] [cams]` — each wet scene booted once and shot through the
  cameras (`FLASH=1` also shoots a lightning strike's peak); `node tools/_quickab.mjs <out> <weather> <time> <cam> '{"name":"js"}'`
  — runtime toggles shot back to back in one live race.
- `node tools/raceshots.mjs <out> [track] [cams]` — one live race shot through a list of cameras (dev server :5190;
  `PORT`, `WEATHER`, `TIME`); `node tools/abshots.mjs <out> <track> <cam> '{"name":"js"}'` — the same moment with renderer toggles.
- `node tools/gpuab.mjs 5217,5218` / `node tools/frametimes.mjs 5217,5218` — GPU ms and uncapped frame-time percentiles
  (p50/p95/p99, frames over 33 ms) in a race, A/B across two served builds.
- `node tools/_progtrace.mjs` / `node tools/_linktrace.mjs` — per-frame shader program count and which programs a long
  boot frame linked (a frame that compiles synchronously); `node tools/_profsub.mjs <fn>` — CPU time under one function
  during a boot; `node tools/_progmap.mjs` — programs per material family.
- Every headless tool finds Chrome through `tools/chrome.mjs` (macOS Metal, Windows D3D11, Linux GL; `CHROME=` overrides).
- `node tools/_lookmatrix.mjs <out> [track] [look|weather:time,…]` + `python3 tools/lookcompare.py --pairs <file>` — every time of day × weather (race cam + a vista down the valley) and the TikTok reference scenes, and their tone / colour statistics against the footage (black and white point, percentiles, saturation, hue of shadows / mids / highlights, sky-to-ground, haze).
- `PORT=… node tools/_wxsweep.mjs <out> [track] weather:time,… [chase,vista,up]` — many weather × time conditions from one boot (the live forecast swapped per condition, same seed so the clouds stay put): the chase camera, a frozen vista and a look up at the sky. For tuning the sky; confirm with real boots.
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
frames of each full-resolution tree, sprays of its real leaves (every leaf and twig of one k-means cell, seen
face-on) for the near trees' leaf cards, and three near LODs (the scan's trunk and limbs decimated with
meshoptimizer + one oriented leaf card per k-means cell of its leaves, with shared wind weights).
