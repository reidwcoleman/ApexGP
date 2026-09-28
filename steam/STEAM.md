# Shipping Apex GP on Steam

The game already runs as a desktop app: `desktop/` wraps the Vite build in Electron and adds the
Steam overlay and achievements (via `steamworks.js`). This is the checklist from here to a store page.

## 0. Blocker first: real team names and brands

Apex GP uses real team names and marks (Scuderia Ferrari, Mercedes, Red Bull Racing, McLaren, Aston
Martin, Alpine, Williams, Haas, Racing Bulls, Audi, Cadillac) on the cars, garage banners, menus and
stands, and real circuit names. That's fine for a free website; **selling it on Steam without licences
invites a takedown or a rejected review.** Before submitting, swap them for fictional teams and sponsors
(`src/race/Teams.ts` names/shorts, plus the painted text in `src/car/Livery.ts`,
`src/world/pitlane/textures.ts`, `src/world/env/grandstands.ts`, `src/game/Celebration.ts`), and
consider fictional circuit names ("Temple of Speed" instead of "Autodromo Nazionale Monza"). The
drivers are already parody names. Ask Claude: "make every team and sponsor fictional for Steam".

## 1. Steamworks account (you do this, ~1 day)

1. Sign up at https://partner.steamgames.com (Steamworks) with your Steam account.
2. Fill in the legal/company info, bank details and tax interview (W-9 in the US).
3. Pay the **Steam Direct fee: $100 per game** (recouped after $1,000 in sales).
4. You get an **App ID**. Put it in `desktop/steam_appid.txt` (replaces 480, Valve's Spacewar test app)
   and in `steam/app_build.vdf`.
5. Steamworks → your app → **SteamPipe → Depots**: create two depots (Windows, macOS) and copy their
   ids into `steam/app_build.vdf`, `steam/depot_windows.vdf`, `steam/depot_mac.vdf`.
6. **Installation → General**: launch options
   - Windows: `Apex GP.exe`
   - macOS: `Apex GP.app`

Valve requires 30 days between paying the fee and releasing, and the store page must be public as
"Coming Soon" for at least 2 weeks before launch. Start the page early: wishlists drive launch visibility.

## 2. Build and test locally

```sh
cd desktop
npm install
npm start            # builds the game and opens it in a desktop window (F11 = fullscreen)
npm run smoke        # boots hidden and exits 0 when the game is ready (CI-style check)
npm run dist:mac     # → release/mac-universal/Apex GP.app
npm run dist:win     # → release/win-unpacked/Apex GP.exe (build on Windows, or a Mac with Wine)
```

With the Steam client running and `steam_appid.txt` present, the overlay (Shift+Tab) and achievements
work in local builds too. Without Steam the game runs normally and achievements are skipped.

Mac builds for Steam don't need notarisation to launch from Steam, but signing is recommended:
set `CSC_NAME="Developer ID Application: …"` before `npm run dist:mac` (you have an Apple developer
account from the App Store apps).

## 3. Achievements (Steamworks → Stats & Achievements)

Create these with exactly these API names (the game unlocks them in `src/game/Game.ts`, ids in
`src/core/steam.ts`), then **Publish** the stats changes:

| API name | Display name | How |
|---|---|---|
| FIRST_RACE | Lights Out | Finish your first race |
| FIRST_POINTS | On the Board | Score points (top 10) |
| FIRST_PODIUM | Champagne | Finish on the podium |
| FIRST_WIN | Grand Prix Winner | Win a race |
| FASTEST_LAP | Purple Sector | Set the fastest lap of a race |
| GRAND_SLAM | Grand Slam | Pole, win and fastest lap in one race |
| UNLOCK_5 | On Tour | Open five rounds of the career |
| SEASON_OPEN | World Tour | Open every round of the career |
| ALL_MEDALS | Perfect Season | Win a gold medal at every round |
| FULL_DEV | Fully Developed | Max out every car upgrade |

Achievement icons: 256×256 JPG, a colour and a greyscale version each.

## 4. Upload a build

```sh
brew install --cask steamcmd
./steam/upload.sh <your steam username>     # builds win + mac, uploads with SteamPipe
```

Then Steamworks → SteamPipe → Builds → set the new build live on the `default` branch (or a `beta`
branch to test with friends first).

## 5. Store page

Art is generated in `steam/art/` from in-game frames (`node tools/steamart.mjs` for new frames with the
dev server on :5191, then `python3 tools/steam_capsules.py`):

| File | Size | Steamworks slot |
|---|---|---|
| header_capsule.png | 920×430 | Header capsule |
| small_capsule.png | 462×174 | Small capsule |
| main_capsule.png | 1232×706 | Main capsule |
| vertical_capsule.png | 748×896 | Vertical capsule |
| library_capsule.png | 600×900 | Library capsule |
| library_hero.png | 3840×1240 | Library hero |
| library_logo.png | 1280×720 | Library logo (transparent) |

Also needed: at least 5 screenshots (1920×1080; `tools/camsheet.mjs` and `tools/introshot.mjs` make good
ones), a trailer (30–90 s, gameplay first), a short description (≤300 characters), tags
(Racing, Simulation, Sports, Singleplayer, Automobile Sim, 3D, Controller), and system requirements.

Suggested short description:
> Race a 2026-spec Formula car through a 14-round career on a world map — dynamic weather and time of
> day at every circuit, rivals that fight back and develop their cars, a race engineer in your ear,
> and cockpit, helmet and TV cameras.

Minimum requirements (from testing on an M1 MacBook): macOS 12 / Windows 10, a GPU with WebGL 2
(Apple M1, GTX 1050, Radeon RX 560 or better), 8 GB RAM, 1 GB disk.

## 6. Before you press release

- [ ] Fictional teams/sponsors (section 0)
- [ ] App ID + depots filled in, `steam_appid.txt` updated
- [ ] Achievements published
- [ ] Controller: the game already supports gamepads — tick "Full controller support" only after
      playing a whole career with one (menus included)
- [ ] Coming Soon page live ≥ 2 weeks, build reviewed by Valve (they check the build + page, ~3–5 days)
- [ ] Price (similar indie racers: $9.99–$19.99) and a launch discount (10–20%)
