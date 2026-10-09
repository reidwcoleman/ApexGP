import { unlockForever } from './Unlocks.ts';
import { POINTS } from '../race/Race.ts';
import { CIRCUITS } from '../world/Circuits.ts';
import { UNLOCK_POS } from './Career.ts';
import { ageOf, defaultMarket, f1Teams, f2Teams, makeRookie, type DriverData, type Market, type MarketTeam, type PlayerDriver, type SeriesId } from './Series.ts';

/**
 * The driver career: one driver's life in motor racing. A created driver starts in Formula 2 and
 * has to earn an F1 seat; a current F1 driver starts in their own car. Every round is raced in order
 * and scored into real championship tables (drivers and constructors). The season is a map: a round
 * only counts once it's finished in the top five, which unlocks the next one; anything lower is an
 * attempt (nothing scored) and the round is raced again. Around it:
 *
 *   ratings     pace, racecraft, awareness, experience, focus (0–100, an overall from them) that grow
 *               with what the driver does — the teams judge offers on them and the reputation
 *   objectives  the team's targets for each weekend (a finish, the teammate, the rival…), paid in
 *               research points, the team's trust and ratings
 *   rival       a driver a step ahead, head to head over the season; beat them clearly and a bigger
 *               one is picked
 *   R&D         the team's research points spent on the car (aero, power unit, chassis, ERS): the
 *               player's car gets faster, the teammate's too; every other team develops on its own
 *   contracts   offers come in the last third of a season; they can be signed, declined or
 *               negotiated (salary, length, status) against the team's interest and patience
 *   the market  every winter drivers age, retire, get dropped, graduate from F2, and rookies arrive
 *   the paddock the principal's verdicts, press conferences, headlines, milestones and trophies
 *
 * Pure data in localStorage, no scene.
 */

export type Status = 'lead' | 'equal' | 'second';
export interface Contract {
  series: SeriesId;
  team: string;
  seat: 0 | 1;
  /** last season of the deal (inclusive) */
  until: number;
  /** $M per season */
  salary: number;
  status: Status;
}
export interface Choice {
  label: string;
  rep?: number;
  hype?: number;
  rel?: number;
  /** research points for the team */
  rp?: number;
  /** a rating moved */
  attr?: [AttrId, number];
  /** what happens, shown once picked */
  reply: string;
}
export type MsgKind = 'principal' | 'press' | 'offer' | 'news' | 'season' | 'welcome' | 'milestone' | 'market' | 'rival' | 'event';
export interface Offer extends Contract {
  teamName: string;
  /** how much the team wants the driver (0 … ~40): how far it will move in talks */
  interest: number;
  /** rounds of talks left before the team walks away */
  patience: number;
}
export interface Msg {
  id: number;
  kind: MsgKind;
  from: string;
  title: string;
  body: string;
  round: number;
  read: boolean;
  choices?: Choice[];
  picked?: number;
  offer?: Offer;
}
export interface RoundResult {
  track: string;
  pos: number;
  dnf: boolean;
  points: number;
  fastest: boolean;
  /** the teammate's finish (99 = DNF) */
  mate: number;
}
export interface SeasonSummary {
  year: number;
  series: SeriesId;
  team: string;
  teamName: string;
  position: number;
  points: number;
  wins: number;
  podiums: number;
  champion: boolean;
  /** the constructors' position */
  teamPos?: number;
}

export type AttrId = 'pace' | 'racecraft' | 'awareness' | 'experience' | 'focus';
export const ATTRS: { id: AttrId; name: string; what: string }[] = [
  { id: 'pace', name: 'Pace', what: 'Results above what the car should do' },
  { id: 'racecraft', name: 'Racecraft', what: 'Beating the teammate and the rival' },
  { id: 'awareness', name: 'Awareness', what: 'Clean races, no retirements' },
  { id: 'experience', name: 'Experience', what: 'Every start, every season' },
  { id: 'focus', name: 'Focus', what: 'Hitting the team’s targets' },
];
export type Attrs = Record<AttrId, number>;

export interface Objective {
  id: 'target' | 'mate' | 'rival' | 'fastest' | 'finish' | 'points' | 'podium' | 'home';
  label: string;
  attr: AttrId;
  rp: number;
  rel: number;
  done?: boolean;
}

export type RdArea = 'aero' | 'power' | 'chassis' | 'ers';
export const RD_MAX = 8;
export const RD: { id: RdArea; name: string; step: string }[] = [
  { id: 'aero', name: 'Aerodynamics', step: '+0.7% downforce' },
  { id: 'power', name: 'Power unit', step: '+0.7% power' },
  { id: 'chassis', name: 'Chassis', step: '+0.35% mechanical grip' },
  { id: 'ers', name: 'Energy recovery', step: '+3% deployment' },
];
export function rdCost(level: number): number {
  return 60 + 45 * level;
}

export interface Trophy {
  id: string;
  title: string;
  detail: string;
  year: number;
}

/** what a round did to the career, for the results screen */
export interface RoundSummary {
  /**
   * false: outside the top five, so the round stays locked in front of the player (nothing else in
   * the summary is filled in). Missing on summaries saved before the unlock chain = cleared.
   */
  cleared?: boolean;
  track?: string;
  pos?: number;
  dnf?: boolean;
  /** the round this result opened (null: the season is over) */
  unlocked?: string | null;
  /** attempts at the round so far, this one included */
  tries?: number;
  objectives: { label: string; done: boolean; rp: number }[];
  rp: number;
  ovr: [number, number];
  attrs: Partial<Record<AttrId, number>>;
  champ: { pos: number; points: number };
  rival?: { name: string; me: number; them: number };
  trophies: string[];
}

export interface DCData {
  v: 2;
  driver: PlayerDriver;
  age: number;
  year: number;
  series: SeriesId;
  contract: Contract;
  /** signed for next season (takes effect when this one ends) */
  next: Contract | null;
  round: number;
  calendar: string[];
  results: RoundResult[];
  /** this season's points by driver code, and by team id */
  standings: Record<string, number>;
  teamPoints: Record<string, number>;
  /** names for the codes in the table (the grid changes between series) */
  names: Record<string, { name: string; team: string; color: string }>;
  teamNames: Record<string, { name: string; color: string }>;
  rep: number;
  hype: number;
  rel: number;
  money: number;
  h2h: { race: [number, number] };
  inbox: Msg[];
  history: SeasonSummary[];
  /** the season is over and the player has to pick next year's team */
  choosing: boolean;
  wins: number;
  podiums: number;
  starts: number;
  titles: number;
  points: number;
  msgSeq: number;
  /** every circuit the career has raced at (they open for quick races) */
  seen?: string[];
  attrs: Attrs;
  /** the next round's objectives (set when it becomes the next one) */
  objectives: Objective[] | null;
  rival: string | null;
  rivalH2H: [number, number];
  /** the team's research points and the player's car's development */
  rp: number;
  rd: Record<RdArea, number>;
  /** every team's development this season (pace on top of the car as shipped) */
  teamDev: Record<string, number>;
  market: Market;
  trophies: Trophy[];
  /** the last round's summary (the results screen) */
  last: RoundSummary | null;
  /** consecutive wins */
  streak: number;
  /** race distance the player picked for career rounds (missing: DEFAULT_LAPS) */
  laps?: number;
  /** failed attempts at the current round (finished outside the top five); best = best finish, 99 = DNF */
  tries?: { track: string; n: number; best: number } | null;
}

const KEY = 'apexgp.drivercareer';
export const F2_CALENDAR = ['monza', 'spa', 'silverstone', 'spielberg', 'zandvoort', 'hungaroring', 'sakhir', 'yasmarina'];
export const F1_CALENDAR = CIRCUITS.map((c) => c.id);
/**
 * Career race distances. Short by default: a 5-lap race is a full weekend's tension in ten minutes,
 * and a round may have to be raced more than once to finish in the top five. Longer races bring in
 * the strategy (fuel load scales with the laps; from 10 the two-compound rule and the AI's planned
 * stops, from 12 some two-stoppers).
 */
export const LAP_CHOICES = [5, 10, 15, 20, 30];
export const DEFAULT_LAPS = 5;
/** a finish that clears a round (and unlocks the next one) */
export const clears = (pos: number, dnf: boolean) => !dnf && pos <= UNLOCK_POS;
export const SERIES_NAME: Record<SeriesId, string> = { f1: 'Formula 1', f2: 'Formula 2' };

export const NATIONS: [string, string][] = [
  ['GBR', 'United Kingdom'], ['NED', 'Netherlands'], ['MON', 'Monaco'], ['ESP', 'Spain'], ['MEX', 'Mexico'], ['AUS', 'Australia'],
  ['FRA', 'France'], ['GER', 'Germany'], ['ITA', 'Italy'], ['FIN', 'Finland'], ['DEN', 'Denmark'], ['CAN', 'Canada'],
  ['USA', 'United States'], ['BRA', 'Brazil'], ['ARG', 'Argentina'], ['JPN', 'Japan'], ['CHN', 'China'], ['THA', 'Thailand'],
  ['NZL', 'New Zealand'], ['BEL', 'Belgium'], ['AUT', 'Austria'], ['SUI', 'Switzerland'], ['POL', 'Poland'], ['IND', 'India'],
  ['RSA', 'South Africa'], ['UAE', 'United Arab Emirates'], ['IRL', 'Ireland'], ['SWE', 'Sweden'], ['NOR', 'Norway'], ['POR', 'Portugal'],
  ['HUN', 'Hungary'], ['BHR', 'Bahrain'],
];

/** a team's level 0 (back) … 1 (front) within its series, from its pace (and its development, if given) */
export function levelOf(series: SeriesId, team: string, dev?: Record<string, number>): number {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  const pace = (t: { id: string; pace: number }) => t.pace + (dev?.[t.id] ?? 0);
  const t = list.find((x) => x.id === team);
  if (!t) return 0.5;
  const ps = list.map(pace);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  const l = hi > lo ? (pace(t) - lo) / (hi - lo) : 0.5;
  // (F2 is a spec series: the teams are close)
  return series === 'f2' ? 0.3 + 0.4 * l : l;
}
export function teamIndex(series: SeriesId, team: string): number {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  return Math.max(0, list.findIndex((t) => t.id === team));
}
export function teamName(series: SeriesId, team: string): string {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  return list.find((t) => t.id === team)?.name ?? team;
}
const DARK = new Set(['#111214', '#101010', '#1b1d22', '#0b1e3f']);
export function teamColor(series: SeriesId, team: string): string {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  const t = list.find((x) => x.id === team);
  return t ? (DARK.has(t.primary) ? t.secondary : t.primary) : '#888';
}
/** the overall rating from the five */
export function overall(a: Attrs): number {
  return Math.round(a.pace * 0.3 + a.racecraft * 0.22 + a.awareness * 0.16 + a.experience * 0.16 + a.focus * 0.16);
}
const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const fullName = (d: { first: string; last: string }) => `${d.first} ${d.last}`;
/** how much of a gain a rating takes at this level (1 at 60, ½ at 80, ¼ at 90) */
const grow = (v: number) => Math.max(0.1, (100 - v) / 40);

// ------------------------------------------------------------------ press
interface PressQ {
  when: 'win' | 'podium' | 'good' | 'bad' | 'dnf' | 'beatMate' | 'lostMate' | 'any';
  q: string;
  choices: Choice[];
}
const PRESS: PressQ[] = [
  { when: 'win', q: 'A brilliant win. Is this the start of a title charge?', choices: [
    { label: 'One race at a time.', rep: 1, rel: 2, reply: 'The team liked the calm answer.' },
    { label: "We're here to win the championship.", hype: 6, rep: 1, rel: -1, reply: 'The fans love it; the factory feels the pressure.' },
    { label: 'Credit to every single person in the team.', rel: 4, hype: 1, reply: 'Your mechanics have it printed on the garage wall.' },
  ] },
  { when: 'podium', q: 'Another podium. What was missing today to win?', choices: [
    { label: 'Pace. The car needs more.', rel: -3, hype: 2, reply: 'The engineers took that personally.' },
    { label: 'I made a couple of mistakes. On me.', rep: 2, rel: 2, reply: 'Honesty goes a long way in the paddock.' },
    { label: "Nothing. We'll take it and push on.", rel: 1, reply: 'A safe answer. Nobody quotes it.' },
  ] },
  { when: 'good', q: 'A strong result in that car. Are you outperforming it?', choices: [
    { label: 'I think people are noticing, yes.', rep: 2, hype: 3, rel: -2, reply: 'Other teams noticed too.' },
    { label: 'The car is better than people think.', rel: 3, reply: 'Your team principal shook your hand in the motorhome.' },
    { label: "I'm just doing my job.", rep: 1, reply: 'Understated. It reads well.' },
  ] },
  { when: 'bad', q: 'A tough afternoon. What went wrong?', choices: [
    { label: "The car wasn't there today.", rel: -4, hype: 1, reply: 'The team read the quotes. They are not happy.' },
    { label: "I wasn't good enough. I'll be back.", rep: 1, rel: 3, reply: 'The paddock respects drivers who own it.' },
    { label: "We'll go through the data first.", rel: 1, reply: 'Nothing to see here, says every headline.' },
  ] },
  { when: 'dnf', q: 'Your race ended early. How frustrating is that?', choices: [
    { label: 'Very. Those points mattered.', hype: 1, reply: 'Raw, and the fans felt it with you.' },
    { label: 'These things happen in racing.', rel: 2, reply: 'Measured. The team appreciates it.' },
    { label: 'Someone needs to look at what happened.', rel: -3, hype: 2, reply: 'It became the story of the weekend.' },
  ] },
  { when: 'beatMate', q: 'You beat your teammate again. Who leads the team now?', choices: [
    { label: 'The stopwatch decides that.', rep: 2, hype: 2, rel: -1, reply: 'Cold. Fair. The media ran with it.' },
    { label: "We push each other. That's good for the team.", rel: 3, reply: 'Diplomatic. The team principal smiled.' },
    { label: "I'm the one they should build around.", hype: 4, rel: -3, rep: 1, reply: 'Bold. Your teammate will remember it.' },
  ] },
  { when: 'lostMate', q: 'Your teammate had the upper hand today. Worried?', choices: [
    { label: "No. I'll be ahead next time.", hype: 2, reply: 'Confidence. We will see.' },
    { label: 'They did a great job. I need to learn from it.', rep: 1, rel: 2, reply: 'Gracious, and the team noticed.' },
    { label: 'We were on different strategies.', rel: -1, reply: 'The journalists were not convinced.' },
  ] },
  { when: 'any', q: 'There are rumours another team wants you. Comment?', choices: [
    { label: "I'm fully committed to this team.", rel: 4, reply: 'Your team principal sent a thumbs-up.' },
    { label: 'My focus is on driving. My manager handles the rest.', rep: 1, reply: 'Professional. The rumours carry on.' },
    { label: "It's nice to be wanted.", hype: 3, rel: -4, rep: 2, reply: 'Every team on the grid read that one.' },
  ] },
];

// ------------------------------------------------------------------ paddock life between rounds
interface PaddockEvent {
  from: string;
  title: string;
  body: string;
  choices: Choice[];
}
const EVENTS: PaddockEvent[] = [
  { from: 'Commercial department', title: 'Sponsor day', body: 'The title sponsor wants you at their headquarters on Thursday: photos, a factory tour, a hundred handshakes.', choices: [
    { label: 'Go, and give it everything.', hype: 4, rel: 2, attr: ['focus', -0.6], reply: 'The sponsor loved it. You arrive at the track a little tired.' },
    { label: 'Ask to keep it short.', hype: 1, reply: 'An hour, a smile, back to work.' },
    { label: "Decline: I'm preparing for the race.", rel: -3, attr: ['focus', 0.6], reply: 'The commercial team is not amused. Your engineer is.' },
  ] },
  { from: 'Race engineer', title: 'Simulator time', body: 'There is a free day in the simulator before the next round. Long runs, set-up work, or a rest?', choices: [
    { label: 'Long runs on the race set-up.', attr: ['experience', 0.6], rp: 10, reply: 'Pages of data for the engineers.' },
    { label: 'Qualifying laps, chase the limit.', attr: ['pace', 0.5], reply: 'You found a tenth in the last sector.' },
    { label: 'Take the day off.', attr: ['awareness', 0.4], reply: 'Fresh legs, clear head.' },
  ] },
  { from: 'Technical director', title: 'Upgrade direction', body: 'The aero department has two concepts for the next package and wants the driver’s view.', choices: [
    { label: 'More rear stability, please.', rp: 25, rel: 2, reply: 'They went with your call. The package is on its way.' },
    { label: 'Sharper front end, I can handle it.', rp: 15, attr: ['pace', 0.3], reply: 'A riskier concept, but you believe in it.' },
    { label: 'Trust the engineers.', rel: 3, reply: 'The technical director appreciated the confidence.' },
  ] },
  { from: 'Media team', title: 'Documentary crew', body: 'A streaming documentary wants cameras in your driver room for the next weekend.', choices: [
    { label: 'Let them in. Show who I am.', hype: 6, attr: ['focus', -0.4], reply: 'The trailer has a million views already.' },
    { label: 'Only outside the car.', hype: 2, reply: 'A fair compromise.' },
    { label: 'No cameras this weekend.', rel: 1, reply: 'The producers will ask again.' },
  ] },
  { from: 'Fitness coach', title: 'Training camp', body: 'Your coach wants three days of heat training before the next race.', choices: [
    { label: 'Do the full camp.', attr: ['awareness', 0.6], reply: 'Hard work. You will feel it in the last laps.' },
    { label: 'A lighter week.', reply: 'Fine. Nothing gained, nothing lost.' },
  ] },
  { from: 'Team principal', title: 'A word about the teammate', body: 'There was tension in the debrief between you and your teammate. The principal wants it settled.', choices: [
    { label: 'Clear the air over dinner.', rel: 3, attr: ['racecraft', -0.2], reply: 'The garage feels calmer already.' },
    { label: 'I race to win. That’s all.', hype: 2, rel: -2, attr: ['racecraft', 0.4], reply: 'The principal sighed. The rivalry carries on.' },
  ] },
  { from: 'Junior programme', title: 'Kart track visit', body: 'Your old karting club asks you to present the trophies at their championship final.', choices: [
    { label: 'Of course.', hype: 3, rep: 1, reply: 'A hundred kids with your number on their helmets.' },
    { label: 'Send a video message.', hype: 1, reply: 'They played it on the big screen.' },
  ] },
];

// ------------------------------------------------------------------ the career
export interface Ask {
  salary: number;
  years: number;
  status: Status;
}
type Row = { code: string; name: string; team: string; teamId: string; color: string; pos: number; dnf: boolean; fastest: boolean; isPlayer: boolean; seatMate?: boolean };
const RANK: Record<Status, number> = { second: 0, equal: 1, lead: 2 };
const ZERO_RD = (): Record<RdArea, number> => ({ aero: 0, power: 0, chassis: 0, ers: 0 });

export class DriverCareer {
  data: DCData | null = null;
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = this.migrate(JSON.parse(raw));
    } catch {
      this.data = null;
    }
  }
  get active(): boolean {
    return !!this.data;
  }
  onChange(fn: () => void) {
    this.listeners.push(fn);
  }
  private save() {
    try {
      if (this.data) localStorage.setItem(KEY, JSON.stringify(this.data));
      else localStorage.removeItem(KEY);
    } catch {
      /* this session only */
    }
    for (const f of this.listeners) f();
  }
  /** a v1 save (before ratings, objectives, R&D and the market): fill the new parts in */
  private migrate(raw: Partial<DCData> & { v: number }): DCData {
    const d = raw as DCData;
    if (raw.v === 2) return d;
    const lvl = Math.min(1, (d.rep ?? 20) / 100);
    d.v = 2;
    d.age = d.driver.from ? ageOf({ code: d.driver.from } as never) + (d.history?.length ?? 0) : 19 + (d.history?.length ?? 0);
    d.attrs = { pace: 60 + 25 * lvl, racecraft: 58 + 25 * lvl, awareness: 60 + 20 * lvl, experience: 50 + 30 * lvl, focus: 58 + 20 * lvl };
    d.objectives = null;
    d.rival = null;
    d.rivalH2H = [0, 0];
    d.rp = 0;
    d.rd = ZERO_RD();
    d.teamDev = {};
    d.market = defaultMarket();
    this.seatPlayer(d, d.contract);
    d.trophies = [];
    d.last = null;
    d.streak = 0;
    d.teamNames = {};
    d.points = d.history?.reduce((a, h) => a + h.points, 0) ?? 0;
    return d;
  }

  /** a new career: a created driver signs for a Formula 2 team, a current driver keeps their F1 seat */
  start(driver: PlayerDriver, contract: Contract) {
    const year = new Date().getFullYear();
    const existing = !!driver.from;
    const lvl = existing ? levelOf('f1', contract.team) : 0;
    const base = existing ? 76 + lvl * 12 : 0;
    this.data = {
      v: 2,
      driver,
      age: existing ? ageOf({ code: driver.from } as never) : 19,
      year,
      series: contract.series,
      contract,
      next: null,
      round: 0,
      calendar: contract.series === 'f2' ? F2_CALENDAR.slice() : F1_CALENDAR.slice(),
      results: [],
      standings: {},
      teamPoints: {},
      names: {},
      teamNames: {},
      rep: existing ? 55 : 18,
      hype: existing ? 50 : 10,
      rel: 60,
      money: existing ? 4 : 0.1,
      h2h: { race: [0, 0] },
      inbox: [],
      history: [],
      choosing: false,
      wins: 0,
      podiums: 0,
      starts: 0,
      titles: 0,
      points: 0,
      msgSeq: 1,
      attrs: existing
        ? { pace: base + 4, racecraft: base + 1, awareness: base, experience: Math.min(95, base + 6), focus: base - 1 }
        : { pace: 64, racecraft: 60, awareness: 62, experience: 48, focus: 58 },
      objectives: null,
      rival: null,
      rivalH2H: [0, 0],
      rp: 0,
      rd: ZERO_RD(),
      teamDev: {},
      market: defaultMarket(),
      trophies: [],
      last: null,
      streak: 0,
    };
    const d = this.data;
    this.seatPlayer(d, contract);
    this.pickRival();
    const tn = teamName(contract.series, contract.team);
    this.post({
      kind: 'welcome',
      from: tn,
      title: existing ? `Welcome back, ${driver.first}` : `Welcome to ${tn}`,
      body: existing
        ? `A new season with ${tn}. The calendar is ${d.calendar.length} rounds long and the paddock expects big things. Your contract runs to the end of ${contract.until}. The team sets targets for every weekend; hit them and the factory gets research points to make the car faster.`
        : `You've signed with ${tn} for the ${year} Formula 2 season: ${d.calendar.length} rounds on the Grand Prix weekends. Hit the team's targets, beat your rival, and Formula 1 will come calling. Every result, every interview counts.`,
    });
    this.save();
  }
  reset() {
    this.data = null;
    this.save();
  }

  // ---------------------------------------------------------------- the season
  get nextTrack(): string | null {
    const d = this.data;
    if (!d || d.choosing || d.round >= d.calendar.length) return null;
    return d.calendar[d.round];
  }
  /** the career has reached this circuit (raced there, or it's the next round) */
  visited(id: string): boolean {
    const d = this.data;
    return !!d && (d.seen?.includes(id) || this.nextTrack === id);
  }
  get laps(): number {
    const n = this.data?.laps;
    return n !== undefined && LAP_CHOICES.includes(n) ? n : DEFAULT_LAPS;
  }
  setLaps(n: number) {
    if (!this.data || !LAP_CHOICES.includes(n)) return;
    this.data.laps = n;
    this.save();
  }
  /** the failed attempts at the next round so far (0: none yet) */
  get tries(): { n: number; best: number } {
    const t = this.data?.tries;
    return t && t.track === this.nextTrack ? { n: t.n, best: t.best } : { n: 0, best: 99 };
  }
  get ovr(): number {
    return this.data ? overall(this.data.attrs) : 0;
  }
  unread(): number {
    return this.data?.inbox.filter((m) => !m.read || (m.choices && m.picked === undefined)).length ?? 0;
  }
  /** championship position (1-based) and points */
  position(code = this.data?.driver.code ?? ''): { pos: number; points: number } {
    const d = this.data;
    if (!d) return { pos: 0, points: 0 };
    const rows = this.table();
    const i = rows.findIndex((r) => r.code === code);
    return { pos: i + 1, points: d.standings[code] ?? 0 };
  }
  table(): { code: string; points: number; name: string; team: string; color: string }[] {
    const d = this.data;
    if (!d) return [];
    return Object.keys(d.names)
      .map((code) => ({ code, points: d.standings[code] ?? 0, ...d.names[code] }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }
  /** the constructors' table */
  teamTable(): { id: string; points: number; name: string; color: string }[] {
    const d = this.data;
    if (!d) return [];
    return Object.keys(d.teamNames ?? {})
      .map((id) => ({ id, points: d.teamPoints[id] ?? 0, ...d.teamNames[id] }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- the grid, the car
  /** every team's development (pace on top of the car as shipped), the player's R&D included */
  devMap(): Record<string, number> {
    const d = this.data;
    if (!d) return {};
    const m = { ...d.teamDev };
    m[d.contract.team] = (m[d.contract.team] ?? 0) + this.rdPaceBonus();
    return m;
  }
  /** what the player's R&D adds to the team's pace (the teammate's car gets the parts too) */
  rdPaceBonus(): number {
    const d = this.data;
    return d ? (d.rd.aero + d.rd.power + d.rd.chassis + d.rd.ers) * 0.0006 : 0;
  }
  rdLevel(a: RdArea): number {
    return this.data?.rd[a] ?? 0;
  }
  canUpgrade(a: RdArea): boolean {
    const n = this.rdLevel(a);
    return !!this.data && n < RD_MAX && this.data.rp >= rdCost(n);
  }
  upgrade(a: RdArea): boolean {
    const d = this.data;
    if (!d || !this.canUpgrade(a)) return false;
    d.rp -= rdCost(d.rd[a]);
    d.rd[a]++;
    this.save();
    return true;
  }
  /** this seat's car as raced: power and downforce from the team's level, then the R&D parts */
  carFactors(teamPace: number): { power: number; clA: number; mu: number; ers: number } {
    const d = this.data;
    const f = 1 - (1 - Math.min(1, teamPace - this.rdPaceBonus())) * 0.45;
    const rd = d?.rd ?? ZERO_RD();
    return {
      power: (1 - (1 - f) * 1.6) * (1 + 0.007 * rd.power),
      clA: (1 - (1 - f) * 1.4) * (1 + 0.007 * rd.aero),
      mu: 1 + 0.0035 * rd.chassis,
      ers: 1 + 0.03 * rd.ers,
    };
  }
  /** where a car like the player's should finish in a 22-car field */
  expected(): number {
    const d = this.data!;
    return Math.max(1, Math.round(17 - 14 * levelOf(d.series, d.contract.team, this.devMap())));
  }
  private seatOf(series: SeriesId, team: string, seat: 0 | 1): DriverData | null {
    return this.data?.market[series].find((t) => t.team === team)?.drivers[seat] ?? null;
  }
  /** the teammate (from the market) */
  mate(): DriverData | null {
    const d = this.data;
    return d ? this.seatOf(d.series, d.contract.team, (1 - d.contract.seat) as 0 | 1) : null;
  }
  /** a driver in the player's series by code, and their team */
  find(code: string): { driver: DriverData; team: string } | null {
    const d = this.data;
    if (!d) return null;
    for (const t of d.market[d.series]) for (const dr of t.drivers) if (dr.code === code) return { driver: dr, team: t.team };
    return null;
  }
  rivalInfo(): { driver: DriverData; team: string } | null {
    const d = this.data;
    return d?.rival ? this.find(d.rival) : null;
  }
  /** a driver a step ahead of the player (a better car, or the same level and older), not the teammate */
  private pickRival(exclude?: string) {
    const d = this.data!;
    const dev = d.teamDev;
    const mine = levelOf(d.series, d.contract.team, dev);
    const target = Math.min(1, mine + 0.15);
    let best: { code: string; s: number } | null = null;
    for (const t of d.market[d.series]) {
      if (t.team === d.contract.team) continue;
      const l = levelOf(d.series, t.team, dev);
      for (const dr of t.drivers) {
        if (dr.code === exclude || dr.code === d.driver.code) continue;
        const s = Math.abs(l - target) + Math.abs((dr.age ?? 25) - d.age) * 0.012 + Math.random() * 0.05;
        if (!best || s < best.s) best = { code: dr.code, s };
      }
    }
    d.rival = best?.code ?? null;
    d.rivalH2H = [0, 0];
  }
  /** put the player in a seat of the market (its occupant leaves it) and out of any other; returns who was displaced */
  private seatPlayer(d: DCData, c: Contract): DriverData | null {
    const me: DriverData = { first: d.driver.first, last: d.driver.last, code: d.driver.code, number: d.driver.number, helmet: [d.driver.helmet[0], d.driver.helmet[1]], look: { ...d.driver.look }, skill: 0.975, aggression: 0.6, age: d.age };
    let displaced: DriverData | null = null;
    for (const s of ['f1', 'f2'] as SeriesId[])
      for (const t of d.market[s])
        for (const k of [0, 1] as const) {
          const here = s === c.series && t.team === c.team && k === c.seat;
          if (here) {
            if (t.drivers[k].code !== me.code) displaced = t.drivers[k];
            t.drivers[k] = me;
          } else if (t.drivers[k].code === me.code || (d.driver.from && t.drivers[k].code === d.driver.from && !here)) {
            // the seat the player leaves: filled in the winter (a placeholder until then)
            t.drivers[k] = { ...t.drivers[k], code: `~${k}${t.team}` };
          }
        }
    return displaced;
  }

  // ---------------------------------------------------------------- objectives
  /** the team's targets for the next round */
  objectives(): Objective[] {
    const d = this.data;
    if (!d || !this.nextTrack) return [];
    if (!d.objectives) {
      d.objectives = this.makeObjectives();
      this.save();
    }
    return d.objectives;
  }
  private makeObjectives(): Objective[] {
    const d = this.data!;
    const exp = this.expected();
    // (a lead driver is asked for a bit more)
    const tgt = Math.max(1, exp - (d.contract.status === 'lead' ? 1 : 0));
    const out: Objective[] = [{ id: 'target', label: tgt === 1 ? 'Win the race' : tgt <= 3 ? `Finish on the podium (P${tgt} or better)` : `Finish P${tgt} or better`, attr: 'pace', rp: 40, rel: 3 }];
    const mate = this.mate();
    if (mate && !mate.code.startsWith('~')) out.push({ id: 'mate', label: `Finish ahead of ${fullName(mate)}`, attr: 'racecraft', rp: 25, rel: 2 });
    const cd = CIRCUITS.find((c) => c.id === this.nextTrack);
    const riv = this.rivalInfo();
    if (cd && cd.country === d.driver.nationality) out.push(exp <= 5 ? { id: 'home', label: 'Home race: finish on the podium', attr: 'focus', rp: 35, rel: 2 } : { id: 'home', label: 'Home race: score points', attr: 'focus', rp: 30, rel: 2 });
    else if (riv) out.push({ id: 'rival', label: `Beat your rival ${fullName(riv.driver)}`, attr: 'racecraft', rp: 30, rel: 1 });
    else if (exp <= 4) out.push({ id: 'fastest', label: 'Set the fastest lap', attr: 'pace', rp: 30, rel: 1 });
    else if (exp <= 11) out.push({ id: 'points', label: 'Score points', attr: 'experience', rp: 30, rel: 1 });
    else out.push({ id: 'finish', label: 'Bring the car home', attr: 'awareness', rp: 20, rel: 1 });
    return out;
  }

  // ---------------------------------------------------------------- a round raced
  /**
   * A round raced: the whole classification (finishing order, codes, teams) is scored into the
   * tables; objectives, ratings, R&D, the rival and the paddock react; the inbox fills.
   */
  recordRound(track: string, rows: Row[]): RoundSummary | null {
    const d = this.data;
    if (!d || d.calendar[d.round] !== track) return null;
    const me = rows.find((r) => r.isPlayer);
    if (!me) return null;
    if (!clears(me.pos, me.dnf)) {
      // outside the top five: the round isn't cleared, so nothing is scored (the championship, the
      // ratings, the paddock all wait for the result that counts); only the attempt is remembered
      const t = this.tries;
      d.tries = { track, n: t.n + 1, best: Math.min(t.best, me.dnf ? 99 : me.pos) };
      this.save();
      return { cleared: false, track, pos: me.pos, dnf: me.dnf, tries: d.tries.n, objectives: [], rp: 0, ovr: [overall(d.attrs), overall(d.attrs)], attrs: {}, champ: this.position(), trophies: [] };
    }
    const tries = this.tries.n + 1;
    d.tries = null;
    const objs = this.objectives();
    const ovr0 = overall(d.attrs);
    const a0 = { ...d.attrs };
    const pts = (r: Row) => (r.dnf ? 0 : (POINTS[r.pos - 1] ?? 0) + (r.fastest && r.pos <= 10 ? 1 : 0));
    for (const r of rows) {
      d.names[r.code] = { name: r.name, team: r.team, color: r.color };
      d.teamNames[r.teamId] = { name: r.team, color: r.color };
      d.standings[r.code] = (d.standings[r.code] ?? 0) + pts(r);
      d.teamPoints[r.teamId] = (d.teamPoints[r.teamId] ?? 0) + pts(r);
    }
    const mate = rows.find((r) => r.seatMate);
    const myPts = pts(me);
    d.results.push({ track, pos: me.pos, dnf: me.dnf, points: myPts, fastest: me.fastest, mate: mate ? (mate.dnf ? 99 : mate.pos) : 99 });
    d.starts++;
    d.points += myPts;
    d.seen = Array.from(new Set([...(d.seen ?? []), track]));
    unlockForever(track);
    if (d.calendar[d.round + 1]) unlockForever(d.calendar[d.round + 1]);
    const won = !me.dnf && me.pos === 1;
    if (won) d.wins++;
    if (!me.dnf && me.pos <= 3) d.podiums++;
    d.streak = won ? d.streak + 1 : 0;
    const ahead = (a: Row, b: Row | undefined) => !!b && !a.dnf && (b.dnf || a.pos < b.pos);
    const beatMate = ahead(me, mate);
    if (mate) d.h2h.race[beatMate ? 0 : 1]++;
    d.money += d.contract.salary / d.calendar.length + (myPts > 0 ? myPts * 0.02 * (d.series === 'f1' ? 1 : 0.2) : 0);

    // ---- objectives
    const rivalRow = d.rival ? rows.find((r) => r.code === d.rival) : undefined;
    const exp = this.expected();
    const tgt = Math.max(1, exp - (d.contract.status === 'lead' ? 1 : 0));
    let rpGain = Math.round(20 + 20 * levelOf(d.series, d.contract.team, d.teamDev) + myPts * 1.5);
    const sumObj: RoundSummary['objectives'] = [];
    for (const o of objs) {
      o.done =
        o.id === 'target' ? !me.dnf && me.pos <= tgt
        : o.id === 'mate' ? beatMate
        : o.id === 'rival' ? ahead(me, rivalRow)
        : o.id === 'fastest' ? me.fastest
        : o.id === 'points' ? !me.dnf && me.pos <= 10
        : o.id === 'home' ? !me.dnf && (o.label.includes('podium') ? me.pos <= 3 : me.pos <= 10)
        : !me.dnf;
      if (o.done) {
        rpGain += o.rp;
        d.rel = clamp(d.rel + o.rel);
        d.attrs[o.attr] = clamp(d.attrs[o.attr] + 1.0 * grow(d.attrs[o.attr]), 30, 99);
      } else if (o.id === 'target') d.attrs.focus = clamp(d.attrs.focus - 0.4, 30, 99);
      sumObj.push({ label: o.label, done: !!o.done, rp: o.rp });
    }
    d.rp += rpGain;

    // ---- ratings: what the weekend showed
    const perf = me.dnf ? -3 : exp - me.pos;
    const A = d.attrs;
    // (the higher a rating, the harder it is to raise: grow())
    A.experience = clamp(A.experience + 0.6 * grow(A.experience), 30, 99);
    A.pace = clamp(A.pace + Math.max(-0.6, Math.min(1, perf * 0.2)) * (perf > 0 ? grow(A.pace) : 1), 30, 99);
    A.awareness = clamp(A.awareness + (me.dnf ? -1 : 0.2 * grow(A.awareness)), 30, 99);
    if (mate) A.racecraft = clamp(A.racecraft + (beatMate ? 0.4 * grow(A.racecraft) : -0.2), 30, 99);

    // ---- reputation, hype and the team's trust: against what this car should do
    const cap = d.series === 'f2' ? 72 : 100;
    d.rep = clamp(d.rep + Math.max(-4, Math.min(6, perf * 0.8)) + (me.dnf ? 0 : me.pos === 1 ? 3 : me.pos <= 3 ? 1.5 : 0) + (beatMate ? 0.8 : -0.4), 0, cap);
    d.hype = clamp(d.hype + (me.dnf ? -1 : me.pos === 1 ? 6 : me.pos <= 3 ? 3 : perf > 2 ? 1.5 : -0.5));
    d.rel = clamp(d.rel + Math.max(-3, Math.min(3, perf * 0.35)));

    const roundNo = d.round + 1;
    const tn = teamName(d.series, d.contract.team);
    const cd = CIRCUITS.find((c) => c.id === track);
    const place = me.dnf ? 'a retirement' : `P${me.pos}`;
    const hit = sumObj.filter((o) => o.done).length;
    const verdict = me.dnf
      ? 'A DNF hurts. Reset, and we go again at the next one.'
      : perf >= 4
        ? `That's above what this car should do — expectations were around P${exp}. The whole factory is buzzing.`
        : perf >= 0
          ? `Solid. Around where we expected (P${exp}). Keep stacking these up.`
          : `Below target — we expected around P${exp}. Let's understand why before the next round.`;
    this.post({ kind: 'principal', from: `${tn} · Team principal`, title: `Round ${roundNo}: ${place}`, body: `${verdict} ${hit}/${sumObj.length} targets hit: ${rpGain} research points to the factory.` });

    // ---- the race in the headlines
    const win = rows.find((r) => r.pos === 1 && !r.dnf);
    if (win && cd) {
      const p2 = rows.find((r) => r.pos === 2), p3 = rows.find((r) => r.pos === 3);
      const title = win.isPlayer ? `${d.driver.last.toUpperCase()} WINS IN ${cd.short.toUpperCase()}` : `${win.name} wins in ${cd.short}`;
      const body = win.isPlayer
        ? `${fullName(d.driver)} takes the chequered flag ahead of ${p2?.name ?? '—'} and ${p3?.name ?? '—'}. ${d.wins === 1 ? 'A first career win — the paddock will remember this one.' : `Win number ${d.wins} of the career.`}`
        : `${win.name} (${win.team}) beat ${p2?.name ?? '—'} and ${p3?.name ?? '—'}. ${me.dnf ? `${d.driver.last} retired.` : `${d.driver.last} finished P${me.pos}.`}`;
      this.post({ kind: 'news', from: 'Paddock press', title, body });
    }

    // ---- the rival
    let rivalSum: RoundSummary['rival'];
    const riv = this.rivalInfo();
    if (riv && rivalRow) {
      d.rivalH2H[ahead(me, rivalRow) ? 0 : 1]++;
      const [a, b] = d.rivalH2H;
      rivalSum = { name: fullName(riv.driver), me: a, them: b };
      if (a - b >= 4) {
        d.rep = clamp(d.rep + 4, 0, cap);
        d.hype = clamp(d.hype + 3);
        this.trophy(`rival-${riv.driver.code}`, `Beat ${fullName(riv.driver)}`, `Won the rivalry ${a}–${b} in ${d.year}`);
        this.post({ kind: 'rival', from: 'Rivalry', title: `You've beaten ${fullName(riv.driver)}`, body: `${a}–${b} head to head. The paddock has a new benchmark for you.` });
        this.pickRival(riv.driver.code);
        const nr = this.rivalInfo();
        if (nr) this.post({ kind: 'rival', from: 'Rivalry', title: `New rival: ${fullName(nr.driver)}`, body: `${fullName(nr.driver)} of ${teamName(d.series, nr.team)} is the next driver to beat.` });
      } else if (b - a >= 4 && (a + b) % 2 === 0) {
        this.post({ kind: 'rival', from: 'Rivalry', title: `${fullName(riv.driver)} has the upper hand`, body: `${b}–${a} to them this season. Time to turn it around.` });
      }
    }

    // ---- the press, after notable results (and now and then otherwise)
    const when: PressQ['when'] = me.dnf ? 'dnf' : me.pos === 1 ? 'win' : me.pos <= 3 ? 'podium' : perf >= 3 ? 'good' : perf <= -4 ? 'bad' : mate && beatMate ? 'beatMate' : mate && !beatMate ? 'lostMate' : 'any';
    if (when !== 'any' || Math.random() < 0.4) {
      const pool = PRESS.filter((p) => p.when === when);
      const q = pick(pool.length ? pool : PRESS);
      this.post({ kind: 'press', from: 'Press conference', title: 'The media pen', body: q.q, choices: q.choices.map((c) => ({ ...c })) });
    }
    // paddock life between rounds, now and then (never two waiting at once)
    if (d.round + 1 < d.calendar.length && Math.random() < 0.35 && !d.inbox.some((x) => x.kind === 'event' && x.picked === undefined)) {
      const e = pick(EVENTS);
      this.post({ kind: 'event', from: e.from, title: e.title, body: e.body, choices: e.choices.map((c) => ({ ...c, attr: c.attr ? [c.attr[0], c.attr[1]] : undefined })) });
    }
    // the teammate battle
    if (mate && d.results.length % 3 === 0) {
      const [a, b] = d.h2h.race;
      this.post({ kind: 'news', from: 'Paddock news', title: `Team battle: ${a}–${b}`, body: a >= b ? `You lead ${mate.name} ${a}–${b} in races this season. The team is watching closely.` : `${mate.name} leads you ${b}–${a} in races this season. Time to turn it around.` });
    }

    // ---- milestones
    const got: string[] = [];
    const t = (id: string, title: string, detail: string) => this.trophy(id, title, detail) && got.push(title);
    const at = cd?.short ?? track;
    if (myPts > 0) t(`points-${d.series}`, d.series === 'f1' ? 'First F1 points' : 'First points', `${at}, ${d.year}`);
    if (!me.dnf && me.pos <= 3) t(`podium-${d.series}`, d.series === 'f1' ? 'First F1 podium' : 'First podium', `P${me.pos} at ${at}, ${d.year}`);
    if (won) t(`win-${d.series}`, d.series === 'f1' ? 'First Grand Prix win' : 'First Formula 2 win', `${at}, ${d.year}`);
    if (won && cd?.country === d.driver.nationality) t(`home-${d.year}-${track}`, 'Home win', `${at}, ${d.year}`);
    if (d.streak === 3) t(`hattrick-${d.year}-${d.round}`, 'Hat-trick', `Three wins in a row, ${d.year}`);
    for (const n of [10, 25, 50]) if (won && d.wins === n) t(`wins-${n}`, `${n} wins`, `${at}, ${d.year}`);
    for (const n of [25, 50, 100]) if (d.starts === n) t(`starts-${n}`, `${n} starts`, `${at}, ${d.year}`);
    for (const g of got) this.post({ kind: 'milestone', from: 'Milestone', title: g, body: `${at}, ${d.year}. It goes in the trophy cabinet.` });

    // ---- every team develops through the season (the player's R&D comes on top)
    for (const s of ['f1', 'f2'] as SeriesId[])
      for (const tm of d.market[s]) {
        const l = levelOf(s, tm.team, d.teamDev);
        d.teamDev[tm.team] = (d.teamDev[tm.team] ?? 0) + (s === 'f2' ? 0.4 : 1) * (0.0003 + Math.random() * 0.0011 * (0.7 + 0.6 * l));
      }

    d.round++;
    d.objectives = null;
    // offers once the market opens (the last third of a season), and at its end
    const tt = d.round / d.calendar.length;
    if (tt >= 0.6 && !d.next && (d.round === Math.ceil(d.calendar.length * 0.6) || d.round === d.calendar.length)) this.makeOffers();
    const summary: RoundSummary = { cleared: true, track, pos: me.pos, dnf: me.dnf, unlocked: d.calendar[d.round] ?? null, tries, objectives: sumObj, rp: rpGain, ovr: [ovr0, overall(d.attrs)], attrs: {}, champ: this.position(), rival: rivalSum, trophies: got };
    for (const k of Object.keys(a0) as AttrId[]) {
      const dv = d.attrs[k] - a0[k];
      if (Math.abs(dv) >= 0.05) summary.attrs[k] = +dv.toFixed(1);
    }
    d.last = summary;
    if (d.round >= d.calendar.length) this.endSeason();
    this.save();
    return summary;
  }

  /** answer a press question / an offer (0 = sign, 1 = decline) */
  choose(msgId: number, i: number) {
    const d = this.data;
    const m = d?.inbox.find((x) => x.id === msgId);
    if (!d || !m || m.picked !== undefined) return;
    m.picked = i;
    m.read = true;
    if (m.kind === 'offer' && m.offer) {
      if (i === 0) {
        const { teamName: _n, interest: _i, patience: _p, ...c } = m.offer;
        d.next = c;
        // the other offers lapse
        for (const o of d.inbox) if (o.kind === 'offer' && o !== m && o.picked === undefined) o.picked = 1;
        if (d.choosing) this.newSeason();
      }
    } else if (m.choices) {
      const c = m.choices[i];
      d.rep = clamp(d.rep + (c.rep ?? 0));
      d.hype = clamp(d.hype + (c.hype ?? 0));
      d.rel = clamp(d.rel + (c.rel ?? 0));
      d.rp += c.rp ?? 0;
      if (c.attr) d.attrs[c.attr[0]] = clamp(d.attrs[c.attr[0]] + c.attr[1], 30, 99);
    }
    this.save();
  }
  /** every message without a pending answer counts as seen */
  markAllRead() {
    const d = this.data;
    if (!d) return;
    let n = 0;
    for (const m of d.inbox)
      if (!m.read && !(m.choices && m.picked === undefined)) {
        m.read = true;
        n++;
      }
    if (n) this.save();
  }
  markRead(msgId: number) {
    const m = this.data?.inbox.find((x) => x.id === msgId);
    if (m && !m.read) {
      m.read = true;
      this.save();
    }
  }

  // ---------------------------------------------------------------- contract talks
  /** how likely the team is to accept these terms (0 … 1) */
  acceptance(msgId: number, ask: Ask): number {
    const d = this.data;
    const o = d?.inbox.find((x) => x.id === msgId)?.offer;
    if (!d || !o) return 0;
    const max = o.salary * (1.15 + o.interest / 50) + 0.2;
    const over = ask.salary <= o.salary ? 0 : (ask.salary - o.salary) / Math.max(0.05, max - o.salary);
    const up = Math.max(0, RANK[ask.status] - RANK[o.status]);
    const down = Math.max(0, RANK[o.status] - RANK[ask.status]);
    // (a lead seat is hardest to get from a team that already has a strong driver)
    const st = up * (o.interest > 20 ? 0.2 : 0.32) - down * 0.12;
    const offered = o.until - d.year;
    const yrs = (ask.years - offered) * (o.interest > 15 ? -0.04 : 0.08);
    return Math.max(0, Math.min(1, 1 - over * 0.55 - Math.max(0, over - 1) * 1.6 - st - yrs));
  }
  /** put terms to the team: they sign, refuse (patience runs down) or walk away */
  propose(msgId: number, ask: Ask): 'signed' | 'refused' | 'walked' {
    const d = this.data;
    const m = d?.inbox.find((x) => x.id === msgId);
    const o = m?.offer;
    if (!d || !m || !o || m.picked !== undefined) return 'walked';
    const p = this.acceptance(msgId, ask);
    if (Math.random() < p) {
      o.salary = +ask.salary.toFixed(1);
      o.until = d.year + ask.years;
      o.status = ask.status;
      o.seat = this.seatFor(o.series, o.team, ask.status);
      m.choices = [{ label: 'Signed after talks', reply: `${o.teamName}: ${statusLabel(o.status).toLowerCase()}, to ${o.until}, $${o.salary.toFixed(1)}M a season.` }, { label: 'Decline', reply: 'Declined.' }];
      this.choose(msgId, 0);
      return 'signed';
    }
    o.patience--;
    o.interest = Math.max(0, o.interest - 3);
    if (o.patience <= 0) {
      m.picked = 1;
      m.read = true;
      m.choices = [{ label: 'Sign', reply: '' }, { label: 'Talks broke down', reply: `${o.teamName} withdrew the offer.` }];
      if (d.choosing && !d.inbox.some((x) => x.kind === 'offer' && x.picked === undefined)) this.fallback();
      this.save();
      return 'walked';
    }
    this.save();
    return 'refused';
  }
  /** the seat a deal puts the player in: the lead seat for a lead deal, else the weaker driver's */
  private seatFor(series: SeriesId, team: string, status: Status): 0 | 1 {
    if (status === 'lead') return 0;
    const t = this.data!.market[series].find((x) => x.team === team);
    if (!t) return 1;
    return t.drivers[0].skill >= t.drivers[1].skill ? 1 : 0;
  }

  private post(m: Omit<Msg, 'id' | 'round' | 'read'>) {
    const d = this.data!;
    d.inbox.unshift({ ...m, id: d.msgSeq++, round: d.round, read: false });
    if (d.inbox.length > 60) d.inbox.length = 60;
  }
  /** a trophy (once per id); true when it's new */
  private trophy(id: string, title: string, detail: string): boolean {
    const d = this.data!;
    if (d.trophies.some((t) => t.id === id)) return false;
    d.trophies.push({ id, title, detail, year: d.year });
    return true;
  }

  /** teams that want the player now (they come as inbox offers) */
  private makeOffers() {
    const d = this.data!;
    const year = d.year + 1;
    const made: string[] = [];
    const champ = this.position().pos;
    const ovr = overall(d.attrs);
    const f1 = f1Teams();
    // (from F2, the front-running teams are out of reach: you earn them in F1)
    const f1Bar = (lvl: number) => (d.series === 'f2' ? 50 + 42 * lvl : 38 + 50 * lvl);
    const contractEnds = d.contract.until <= d.year;
    if (d.series === 'f2' || contractEnds || d.rep > 70) {
      for (const t of f1) {
        if (t.id === d.contract.team && d.series === 'f1') continue;
        const lvl = levelOf('f1', t.id, d.teamDev);
        const bonus = d.series === 'f2' ? (champ === 1 ? 14 : champ <= 3 ? 7 : 0) : 0;
        const interest = d.rep + bonus + (ovr - 66) * 0.8 + d.hype * 0.05 - f1Bar(lvl) + (Math.random() - 0.5) * 12;
        if (interest <= 0 || made.length >= 3) continue;
        made.push(t.id);
        const status: Status = interest > 18 && lvl < 0.7 ? 'lead' : interest > 6 ? 'equal' : 'second';
        this.offer('f1', t.id, year, 1 + Math.floor(Math.random() * 3), +((0.8 + 11 * lvl) * (0.6 + d.rep / 120)).toFixed(1), status, interest);
      }
    }
    // the current team wants to keep them (if the deal is ending and they've earned it)
    if (contractEnds && d.rel >= 35) this.offer(d.series, d.contract.team, year, 1 + Math.floor(Math.random() * 2), +(d.contract.salary * (1 + (d.rep - 50) / 200)).toFixed(1), d.rel > 70 ? 'lead' : d.contract.status, 6 + d.rel / 5);
    // F2: the junior teams for another year if F1 hasn't come
    if (d.series === 'f2' && made.length === 0) {
      for (const t of f2Teams().slice().sort(() => Math.random() - 0.5).slice(0, 2)) if (t.id !== d.contract.team) this.offer('f2', t.id, year, 1, 0.2, 'equal', 8);
    }
  }
  private offer(series: SeriesId, team: string, from: number, years: number, salary: number, status: Status, interest: number) {
    const d = this.data!;
    // (one standing offer per team)
    if (d.inbox.some((m) => m.kind === 'offer' && m.picked === undefined && m.offer?.team === team && m.offer.series === series)) return;
    const tn = teamName(series, team);
    const seat = this.seatFor(series, team, status);
    const until = from + years - 1;
    const statusText = status === 'lead' ? 'as the lead driver' : status === 'equal' ? 'with equal status' : 'as the second driver';
    const t = d.market[series].find((x) => x.team === team);
    // (renewing at the player's own team: the teammate is whoever isn't the player)
    const mate = t ? (t.drivers[1 - seat].code === d.driver.code ? t.drivers[seat] : t.drivers[1 - seat]) : null;
    this.post({
      kind: 'offer',
      from: `${tn}`,
      title: `${series === 'f1' && d.series === 'f2' ? 'Formula 1 offer' : 'Contract offer'} · ${tn}`,
      body: `${tn} offers a ${years}-year deal from ${from} ${statusText}, $${salary.toFixed(1)}M a season. ${series === 'f1' ? `Level: ${levelLabel(levelOf('f1', team, d.teamDev))}.` : 'Another year in Formula 2.'}${mate && !mate.code.startsWith('~') ? ` Teammate: ${fullName(mate)}.` : ''}`,
      choices: [{ label: 'Sign', reply: `Signed. You race for ${tn} from ${from}.` }, { label: 'Decline', reply: 'Declined.' }],
      offer: { series, team, seat, until, salary, status, teamName: tn, interest: Math.max(2, interest), patience: interest > 15 ? 3 : 2 },
    });
  }

  private endSeason() {
    const d = this.data!;
    const { pos, points } = this.position();
    const champion = pos === 1;
    if (champion) d.titles++;
    const wins = d.results.filter((r) => !r.dnf && r.pos === 1).length;
    const podiums = d.results.filter((r) => !r.dnf && r.pos <= 3).length;
    const teamPos = this.teamTable().findIndex((t) => t.id === d.contract.team) + 1;
    d.history.push({ year: d.year, series: d.series, team: d.contract.team, teamName: teamName(d.series, d.contract.team), position: pos, points, wins, podiums, champion, teamPos });
    d.rep = clamp(d.rep + (champion ? 12 : pos <= 3 ? 5 : 0));
    if (champion) this.trophy(`champ-${d.series}-${d.year}`, `${SERIES_NAME[d.series]} champion`, `${d.year}, ${points} points, ${wins} win${wins === 1 ? '' : 's'}`);
    if (teamPos === 1) this.trophy(`teams-${d.series}-${d.year}`, 'Constructors’ title', `${teamName(d.series, d.contract.team)}, ${d.year}`);
    const [a, b] = d.h2h.race;
    this.post({
      kind: 'season',
      from: SERIES_NAME[d.series],
      title: champion ? `${d.year} ${SERIES_NAME[d.series]} champion!` : `${d.year} season: P${pos} in the championship`,
      body: champion
        ? `World champion material: ${points} points, ${wins} win${wins === 1 ? '' : 's'}. The whole paddock knows your name now.`
        : `${points} points, ${wins} win${wins === 1 ? '' : 's'}, ${podiums} podium${podiums === 1 ? '' : 's'}; the team finished P${teamPos || '—'} in the constructors'. Teammate battle ${a}–${b}. ${d.next ? `Next year: ${teamName(d.next.series, d.next.team)}.` : 'Time to decide next year.'}`,
    });
    const ends = d.contract.until <= d.year;
    if (d.next || !ends) this.newSeason();
    else if (d.inbox.some((m) => m.kind === 'offer' && m.picked === undefined)) d.choosing = true;
    else this.fallback();
  }
  /** nobody came (or every talk failed): the current team keeps the player on a one-year deal */
  private fallback() {
    const d = this.data!;
    d.next = { ...d.contract, until: d.year + 1, salary: +(d.contract.salary * 0.8).toFixed(1) };
    this.newSeason();
  }
  private newSeason() {
    const d = this.data!;
    d.choosing = false;
    const prev = d.contract;
    const next = d.next ?? d.contract;
    this.winter(next);
    d.contract = next;
    d.next = null;
    d.year++;
    d.age++;
    // a year older: experience comes, and past the early thirties the raw pace starts to go
    d.attrs.experience = clamp(d.attrs.experience + 2 * grow(d.attrs.experience), 30, 99);
    if (d.age >= 33) d.attrs.pace = clamp(d.attrs.pace - (d.age - 32) * 0.6, 30, 99);
    d.series = d.contract.series;
    // the parts stay with the team: another team's car starts from its own baseline
    if (prev.team !== next.team || prev.series !== next.series) d.rd = ZERO_RD();
    else for (const k of Object.keys(d.rd) as RdArea[]) d.rd[k] = Math.floor(d.rd[k] * 0.5);
    // (the rules settle the field down over the winter)
    for (const k of Object.keys(d.teamDev)) d.teamDev[k] *= 0.4;
    d.calendar = d.series === 'f2' ? F2_CALENDAR.slice() : F1_CALENDAR.slice();
    d.round = 0;
    d.tries = null;
    d.results = [];
    d.standings = {};
    d.teamPoints = {};
    d.names = {};
    d.teamNames = {};
    d.h2h = { race: [0, 0] };
    d.objectives = null;
    d.streak = 0;
    this.pickRival();
    const tn = teamName(d.series, d.contract.team);
    const mate = this.mate();
    const riv = this.rivalInfo();
    if (prev.series === 'f2' && d.series === 'f1') this.trophy('f1-debut', 'Formula 1 debut', `${tn}, ${d.year}`);
    this.post({
      kind: 'welcome',
      from: tn,
      title: `${d.year}: a new season with ${tn}`,
      body: `${SERIES_NAME[d.series]}, ${d.calendar.length} rounds. Contract to the end of ${d.contract.until}, ${statusLabel(d.contract.status).toLowerCase()}.${mate ? ` Your teammate: ${fullName(mate)}.` : ''}${riv ? ` The rival to beat: ${fullName(riv.driver)}.` : ''}`,
    });
  }

  /**
   * The winter's driver market: everyone a year older (the young improve, the old fade), retirements
   * and drops in F1, the player's move, F2's best graduating into the open F1 seats, rookies for the
   * rest. One "silly season" message lists the moves.
   */
  private winter(next: Contract) {
    const d = this.data!;
    const m = d.market;
    const r = Math.random;
    const news: string[] = [];
    const me = d.driver.code;
    const tName = (s: SeriesId, id: string) => teamName(s, id);
    for (const s of ['f1', 'f2'] as SeriesId[])
      for (const t of m[s])
        for (const dr of t.drivers) {
          if (dr.code === me) continue;
          dr.age = (dr.age ?? 24) + 1;
          dr.skill = Math.max(0.9, Math.min(1, dr.skill + (dr.age <= 24 ? 0.003 : dr.age >= 34 ? -0.004 : 0) + (r() - 0.5) * 0.004));
        }
    type Seat = { s: SeriesId; t: MarketTeam; k: 0 | 1 };
    const open: Seat[] = [];
    const pool: DriverData[] = [];
    // F1: retirements and drops (placeholders from the player's old seats open too)
    for (const t of m.f1)
      for (const k of [0, 1] as const) {
        const dr = t.drivers[k];
        if (dr.code === me) continue;
        if (dr.code.startsWith('~')) {
          open.push({ s: 'f1', t, k });
          continue;
        }
        const age = dr.age ?? 30;
        if (age >= 35 && r() < (age - 34) * 0.22) {
          news.push(`${fullName(dr)} retires from Formula 1 at ${age}.`);
          open.push({ s: 'f1', t, k });
        } else if (dr.skill < 0.957 && r() < (levelOf('f1', t.team, d.teamDev) > 0.5 ? 0.33 : 0.18)) {
          pool.push(dr);
          open.push({ s: 'f1', t, k });
        }
      }
    // the player: out of their old seat, into the new one (its occupant joins the market)
    for (const s of ['f1', 'f2'] as SeriesId[])
      for (const t of m[s])
        for (const k of [0, 1] as const)
          if (t.drivers[k].code === me && !(s === next.series && t.team === next.team && k === next.seat)) {
            t.drivers[k] = { ...t.drivers[k], code: `~${k}${t.team}` };
            open.push({ s, t, k });
          }
    const target = m[next.series].find((t) => t.team === next.team);
    if (target) {
      const occ = target.drivers[next.seat];
      const oi = open.findIndex((o) => o.t === target && o.k === next.seat);
      if (oi >= 0) open.splice(oi, 1);
      else if (occ.code !== me && !occ.code.startsWith('~') && next.series === 'f1') pool.push(occ);
      target.drivers[next.seat] = { first: d.driver.first, last: d.driver.last, code: me, number: d.driver.number, helmet: [d.driver.helmet[0], d.driver.helmet[1]], look: { ...d.driver.look }, skill: 0.975, aggression: 0.6, age: d.age + 1 };
    }
    // F2's best (by this season's table when the player raced there, else by skill)
    const f2: { dr: DriverData; t: MarketTeam; k: 0 | 1; score: number }[] = [];
    for (const t of m.f2)
      for (const k of [0, 1] as const) {
        const dr = t.drivers[k];
        if (dr.code === me || dr.code.startsWith('~') || (dr.age ?? 20) > 25) continue;
        f2.push({ dr, t, k, score: dr.skill + (d.series === 'f2' ? (d.standings[dr.code] ?? 0) / 4000 : 0) + r() * 0.006 });
      }
    f2.sort((a, b) => b.score - a.score);
    const grads = f2.slice(0, 4);
    // fill F1 seats, the best cars first
    const f1Open = open.filter((o) => o.s === 'f1').sort((a, b) => levelOf('f1', b.t.team, d.teamDev) - levelOf('f1', a.t.team, d.teamDev));
    for (const o of f1Open) {
      const cands = [...pool.map((dr) => ({ dr, from: null as (typeof grads)[number] | null, score: dr.skill - Math.max(0, (dr.age ?? 30) - 32) * 0.004 + r() * 0.004 })), ...grads.map((g) => ({ dr: g.dr, from: g, score: g.dr.skill + 0.004 + r() * 0.004 }))];
      cands.sort((a, b) => b.score - a.score);
      const c = cands[0];
      if (c) {
        if (c.from) {
          grads.splice(grads.indexOf(c.from), 1);
          c.from.t.drivers[c.from.k] = { ...c.dr, code: `~${c.from.k}${c.from.t.team}` };
          open.push({ s: 'f2', t: c.from.t, k: c.from.k });
          c.dr.skill = Math.max(c.dr.skill, 0.955);
          news.push(`${fullName(c.dr)} graduates from Formula 2 to ${tName('f1', o.t.team)}.`);
        } else {
          pool.splice(pool.indexOf(c.dr), 1);
          news.push(`${fullName(c.dr)} joins ${tName('f1', o.t.team)}.`);
        }
        o.t.drivers[o.k] = c.dr;
      } else {
        const rk = makeRookie(r, m, 0.952, 20);
        o.t.drivers[o.k] = rk;
        news.push(`${tName('f1', o.t.team)} signs rookie ${fullName(rk)}.`);
      }
    }
    for (const dr of pool) news.push(`${fullName(dr)} is left without a Formula 1 seat.`);
    // F2: the old hands move on; rookies fill every open seat
    for (const t of m.f2)
      for (const k of [0, 1] as const) {
        const dr = t.drivers[k];
        if (dr.code !== me && !dr.code.startsWith('~') && (dr.age ?? 20) > 25 && !open.some((o) => o.t === t && o.k === k)) open.push({ s: 'f2', t, k });
      }
    for (const o of open.filter((x) => x.s === 'f2')) o.t.drivers[o.k] = makeRookie(r, m, 0.93 + r() * 0.035, 18 + Math.floor(r() * 3));
    if (news.length)
      this.post({ kind: 'market', from: 'Silly season', title: `The ${d.year + 1} grid takes shape`, body: news.slice(0, 9).join(' ') + (news.length > 9 ? ` …and ${news.length - 9} more moves.` : '') });
  }
}

export function levelLabel(l: number): string {
  return l > 0.8 ? 'front-runner' : l > 0.55 ? 'podium contender' : l > 0.3 ? 'midfield' : 'backmarker';
}
export function statusLabel(s: Status): string {
  return s === 'lead' ? 'Lead driver' : s === 'equal' ? 'Equal status' : 'Second driver';
}
