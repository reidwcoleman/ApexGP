import { TEAMS } from '../../race/Teams.ts';
import type { Track } from '../Track.ts';
import { PIT_HANDOFF } from '../trackside/context.ts';

/**
 * Plan of the pit complex in track space: s along the lap, `l` = |lateral|
 * measured toward the pit side (the pit side is track.pit.side; l is always
 * positive), `h` = height above the road plane.
 *
 * Cross-section through the garages (l, metres from the centreline):
 *
 *   0 ─ road ─ 6.3 │ verge │ 9.5 WALL 10.1 │ stands │ 11.4 ── fast lane ── 16.9 ── working lane ── 22.3 │ apron │ 25.3 GARAGES … 42.8 │ corridor │ 47.5 │ paddock … 125
 *
 * The trackside module builds only the road (l ≤ 6.3) for s in [HANDOFF_S0, HANDOFF_S1];
 * everything beyond it there is built here.
 */

/** the trackside hand-off: on the pit side, lateral > road edge, s in [sStart − before, sEnd + after] is ours */
export const HANDOFF = PIT_HANDOFF;

export const L = {
  /** debris-fence posts and wall: face toward the track */
  wall: 9.5,
  wallT: 0.6,
  wallH: 1.05,
  /** white line bounding the pit-wall stands strip */
  standLine: 11.5,
  fast: 13.7,
  /** fast / working lane divider */
  divider: 16.9,
  box: 19.1,
  laneOuter: 22.3,
  front: 25.3,
  garageBack: 42.8,
  bldgBack: 47.5,
  paddockEnd: 125,
};

export const GARAGE_W = 18;
export const TEAM_COUNT = TEAMS.length;

export interface PitPlan {
  track: Track;
  side: 1 | -1;
  sStart: number;
  sEnd: number;
  mid: number;
  /** road edge |lateral| */
  road: number;
  /** where the entry spur leaves the road edge (inside the trackside's range; overlaid) */
  entryS: number;
  /** hand-off range where lateral > road is ours */
  s0: number;
  s1: number;
  /** pit building span */
  bldgS0: number;
  bldgS1: number;
  /** team garages span */
  teamS0: number;
  teamS1: number;
  limitStart: number;
  limitEnd: number;
  podiumS0: number;
  podiumS1: number;
  /** |lateral| of the podium's tip: it overhangs the pit lane, the wall and half the track */
  podiumTip: number;
  towerS0: number;
  towerS1: number;
  boxS(k: number): number;
  /** outer boundary of the lane / apron (face of the outer wall where there is no building) */
  outer(s: number): number;
  /** painted pit entry line (|lateral|), s in [s0, sStart] */
  entryLine(s: number): number;
  /** painted pit exit line, s in [sEnd, exitLineEnd] */
  exitLine(s: number): number;
  exitLineEnd: number;
}

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function makePlan(track: Track): PitPlan {
  const p = track.pit;
  const mid = (p.sStart + p.sEnd) / 2;
  const road = track.halfWidthAt(mid);
  const s0 = p.sStart - HANDOFF.before;
  const s1 = p.sEnd + HANDOFF.after;
  const bEntry = track.barrierAt(s0, p.side);
  const exitLineEnd = p.sEnd + 40;
  const entryS = p.sStart - 180;
  return {
    entryS,
    track,
    side: p.side,
    sStart: p.sStart,
    sEnd: p.sEnd,
    mid,
    road,
    s0,
    s1,
    bldgS0: mid - 240,
    bldgS1: mid + 258,
    teamS0: mid - (TEAM_COUNT / 2) * GARAGE_W,
    teamS1: mid + (TEAM_COUNT / 2) * GARAGE_W,
    limitStart: p.sStart + 150,
    limitEnd: p.sEnd - 150,
    podiumS0: track.startS + 26,
    podiumS1: track.startS + 54,
    podiumTip: 1.5,
    towerS0: mid + 196,
    towerS1: mid + 216,
    boxS: (k: number) => mid + (k - (TEAM_COUNT - 1) / 2) * GARAGE_W,
    outer(s: number) {
      if (s < s0) return road + (bEntry - road) * sm(entryS, s0, s);
      if (s < mid) return bEntry + (L.front - bEntry) * sm(p.sStart - 70, p.sStart + 20, s);
      // the trackside barrier resumes at s1; near the wall end its value is still the pit wall's, so clamp
      return L.front + (track.barrierAt(Math.min(Math.max(s, p.sEnd + 50), s1), p.side) - L.front) * sm(p.sEnd - 40, p.sEnd + 50, s);
    },
    entryLine(s: number) {
      return road + 0.15 + (L.wall - road - 0.15) * sm(entryS + 50, p.sStart, s);
    },
    exitLine(s: number) {
      return L.wall - (L.wall - road - 0.15) * sm(p.sEnd, exitLineEnd, s);
    },
    exitLineEnd,
  };
}
