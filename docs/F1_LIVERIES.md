# How F1 teams build liveries and sell space on the car

Research behind `src/race/TeamPartners.ts` and the partner placement in `src/car/Livery.ts`. Real brands appear here as references only; every partner in the game is fictional.

## Tiers and where they go

Sources: [RTR Sports, liveries](https://rtrsports.com/en/blog/f1-liveries/), [RTR Sports, McLaren partners](https://rtrsports.com/en/blog/becoming-a-mclaren-formula-1-sponsor-what-you-need-to-know/), [Motorsport.com, Haas 2026](https://www.motorsport.com/f1/news/haas-unveils-car-design-for-f1-2026/10791084/).

| Tier | Typical price | What it gets |
|---|---|---|
| Title partner | $50–100M+ a year | Its name in the team's official title. The biggest spaces: sidepods, engine cover, rear wing. Also suits, kit and communications. |
| Principal partners | $5–30M | The other high-exposure surfaces: engine cover, sidepods, rear wing, race suits. |
| Associate / technical partners | $0.5–5M | Halo, mirrors, nose, front wing, endplates, small chassis decals, sleeves, caps. |

- The engine cover and the sidepods are the most valuable space, because they dominate the side-on trackside shot and the onboard framing.
- Example: when Toyota became Haas's title partner (2026), it got the engine cover, the front wing and the front of the halo.
- Most teams also show:
  - a fuel and lubricants partner on the front wing and the rear of the cover;
  - the power-unit maker's badge behind the cockpit;
  - a dozen or more small technical-partner decals, often as white or black tiles in each brand's own colour.
- Partners overlap across the grid:
  - the energy drink owns two teams and sponsors both;
  - F1's energy partner is the green team's title partner;
  - a home car maker supplies power units.

## How the cars are finished

Sources: [GPFans, 2026 livery rule](https://www.gpfans.com/en/f1-news/1075858/f1-rule-demands-cars-look-better-paint-matte-gloss/), [Fluid Jobs, livery process](https://fluidjobs.com/blog/f1-liveries-explained-the-design-process), [Racing Bulls VCARB 03](https://en.wikipedia.org/wiki/Racing_Bulls_VCARB_03).

- **Weight.** Matte paint is lighter than gloss, and teams left more carbon bare to save weight.
- **55 % rule.** From 2026, at least 55 % of the car's surface seen from the side and above must be painted or stickered rather than bare carbon.
- **Paint vs vinyl.** Base colours are painted. Sponsor marks are increasingly vinyl, because vinyl adds the same weight all season; repainting builds weight up.
- **Design brief.** Liveries are built around the title partner's colours and must keep every contracted mark readable from the TV cameras.

## What the game does

Each team has a portfolio in `TeamPartners.ts`:
- **title:** `Team.sponsor`
- **two principal partners**
- **a fuel partner**
- **a power unit:** works teams build their own; customers buy Rossa, Stellar or Fortis.
- **eight technical partners**

Placement (`Livery.ts`):

| Partner | Where on the car |
|---|---|
| Title | Sidepod flanks, large; rear wing flap and endplates |
| Principal 1 | Engine cover |
| Principal 2 | Nose, and the rear wing's underside |
| Fuel | Rear of the engine cover; front-wing flap |
| Power unit | Badge behind the cockpit |
| Technical partners | Small decals and tiles, each in its own colour where that reads on the tile |
