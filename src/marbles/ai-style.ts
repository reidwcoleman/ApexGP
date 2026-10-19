/**
 * How the bots race: a style each (what it's willing to risk, whether it shoves, when it spends
 * its dashes) and the show's difficulty (the field's spread of skill, and an edge on top of it
 * for the hardest settings). A style only bends the bot's judgement; skill still sets how well it
 * carries that out.
 */

export type StyleId = 'racer' | 'bruiser' | 'daredevil' | 'steady' | 'closer';

export interface Style {
  id: StyleId;
  name: string;
  /** added to the top speed it dares (m/s) and to its share of each corner's limit */
  nerve: number;
  corner: number;
  /** the clearance it leaves the obstacles (×) and how much it fears an open edge (×) */
  margin: number;
  edge: number;
  /** how much it minds the others close by (×) */
  crowd: number;
  /** its aggression range, how often it shoves (×), and whether it shoves where there are walls */
  aggr: [number, number];
  shove: number;
  walls: boolean;
  /** how freely it dashes (×); a closer saves them for the last stretch */
  dash: number;
  late: boolean;
  /** lapses of concentration (×) */
  lapse: number;
  /** on a plate: how far out it likes to stand (m) */
  ring: number;
}

export const STYLES: Record<StyleId, Style> = {
  racer: { id: 'racer', name: 'Racer', nerve: 0, corner: 0, margin: 1, edge: 1, crowd: 1, aggr: [0.2, 0.7], shove: 1, walls: false, dash: 1, late: false, lapse: 1, ring: 0 },
  bruiser: { id: 'bruiser', name: 'Bruiser', nerve: -1, corner: -0.02, margin: 1, edge: 1, crowd: 0.3, aggr: [0.85, 1], shove: 3.2, walls: true, dash: 1.2, late: false, lapse: 1, ring: -0.6 },
  daredevil: { id: 'daredevil', name: 'Daredevil', nerve: 5, corner: 0.08, margin: 0.6, edge: 0.55, crowd: 0.8, aggr: [0.3, 0.8], shove: 1, walls: false, dash: 1.6, late: false, lapse: 1.3, ring: 1.2 },
  steady: { id: 'steady', name: 'Steady', nerve: -2, corner: -0.05, margin: 1.45, edge: 1.5, crowd: 1.3, aggr: [0, 0.2], shove: 0, walls: false, dash: 0.7, late: false, lapse: 0.35, ring: -1 },
  closer: { id: 'closer', name: 'Closer', nerve: 0, corner: 0, margin: 1, edge: 1, crowd: 1, aggr: [0.2, 0.6], shove: 1, walls: false, dash: 1, late: true, lapse: 0.8, ring: 0 },
};

export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';

export interface Level {
  id: Difficulty;
  name: string;
  blurb: string;
  /** the field's skill spread */
  skill: [number, number];
  /** an edge on top of skill: quicker reactions, sharper timing, more nerve (0..1) */
  boost: number;
  /** how likely each style is */
  mix: Record<StyleId, number>;
}

export const LEVELS: Level[] = [
  { id: 'easy', name: 'Easy', blurb: 'A gentle crowd. They wobble, wait and fall off.', skill: [0.25, 0.65], boost: 0, mix: { racer: 3, bruiser: 0.5, daredevil: 2, steady: 3, closer: 1 } },
  { id: 'normal', name: 'Normal', blurb: 'A real race. A few of them are very good.', skill: [0.58, 0.97], boost: 0.15, mix: { racer: 3, bruiser: 2, daredevil: 2, steady: 2, closer: 2 } },
  { id: 'hard', name: 'Hard', blurb: 'Sharp, fast and pushy. You will need the shortcuts.', skill: [0.78, 1], boost: 0.55, mix: { racer: 3, bruiser: 3, daredevil: 3, steady: 1, closer: 2 } },
  { id: 'insane', name: 'Insane', blurb: 'Near-perfect lines, every dash spent, no mercy.', skill: [0.92, 1], boost: 1, mix: { racer: 2, bruiser: 4, daredevil: 3, steady: 0.5, closer: 2 } },
];

export function level(id: string | null | undefined): Level {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[1];
}

/** a contestant's skill and style for this difficulty (a few naturals at the top, as ever) */
export function roll(l: Level, rnd: () => number): { skill: number; style: StyleId } {
  const [lo, hi] = l.skill;
  const u = rnd() < 0.15 ? 0.85 + rnd() * 0.15 : rnd();
  const skill = lo + (hi - lo) * u;
  const ids = Object.keys(l.mix) as StyleId[];
  let total = 0;
  for (const k of ids) total += l.mix[k];
  let x = rnd() * total;
  let style: StyleId = 'racer';
  for (const k of ids) if ((x -= l.mix[k]) < 0) {
    style = k;
    break;
  }
  return { skill, style };
}
