/**
 * What a player's car is equipped with: the body, the accent paint, a decal, a finish, the boost
 * trail and the goal explosion. All of it rides in the one `color` number every roster already
 * carries (lobbies, the start message, the world), so online opponents see your loadout and the host
 * builds your car's hitbox from it:
 *
 *   bits  0–23  accent (rgb)       bits 32–35  body
 *   bits 24–27  decal              bits 36–39  boost trail
 *   bits 28–31  finish             bits 40–43  goal explosion
 *
 * (arithmetic, not bit operators: the number runs past 32 bits)
 */

export interface Body {
  name: string;
  blurb: string;
  /** RocketSim's hitbox class: 0 octane, 1 dominus, 2 plank, 3 breakout, 4 hybrid, 5 merc */
  preset: number;
}

/** original cars, one on each of the genre's hitbox classes */
export const BODIES: Body[] = [
  { name: 'Striker', blurb: 'Tall, balanced all-rounder', preset: 0 },
  { name: 'Mako', blurb: 'Long, low muscle coupe', preset: 1 },
  { name: 'Stingray', blurb: 'Flat wedge, huge rear tyres', preset: 2 },
  { name: 'Viper', blurb: 'Long pointed nose, narrow body', preset: 3 },
  { name: 'Comet', blurb: 'Sleek fastback, finned tail', preset: 4 },
  { name: 'Bulldog', blurb: 'Tall armoured truck', preset: 5 },
];
export const DECALS = ['Twin stripes', 'Blade', 'Le Mans', 'Two-tone', 'Hex', 'Clean'];
export const FINISHES = ['Gloss', 'Matte', 'Metallic', 'Pearl'];
export const TRAILS = ['Classic', 'Plasma', 'Rainbow', 'Lightning', 'Inferno', 'Stardust'];
export const BOOMS = ['Supernova', 'Shockwave', 'Fireworks', 'Vortex', 'Confetti', 'Black hole'];

export interface Loadout {
  accent: number;
  decal: number;
  finish: number;
  body: number;
  trail: number;
  boom: number;
}

const B24 = 2 ** 24;
const B32 = 2 ** 32;
const pick = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v) || 0));

export function packLoadout(l: Partial<Loadout>): number {
  const accent = (l.accent ?? 0xffffff) % B24;
  const lo = pick(l.decal ?? 0, 16) + pick(l.finish ?? 0, 16) * 16;
  const hi = pick(l.body ?? 0, 16) + pick(l.trail ?? 0, 16) * 16 + pick(l.boom ?? 0, 16) * 256;
  return accent + lo * B24 + hi * B32;
}

export function unpackLoadout(color: number): Loadout {
  const c = Math.max(0, Math.floor(color) || 0);
  const lo = Math.floor(c / B24) % 256;
  const hi = Math.floor(c / B32);
  return {
    accent: c % B24,
    decal: pick(lo % 16, DECALS.length),
    finish: pick(Math.floor(lo / 16), FINISHES.length),
    body: pick(hi % 16, BODIES.length),
    trail: pick(Math.floor(hi / 16) % 16, TRAILS.length),
    boom: pick(Math.floor(hi / 256) % 16, BOOMS.length),
  };
}
