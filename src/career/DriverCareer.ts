import { POINTS } from '../race/Race.ts';
import { CIRCUITS } from '../world/Circuits.ts';
import { f1Original, f1Teams, f2Teams, type PlayerDriver, type SeriesId } from './Series.ts';

/**
 * The driver career: one driver's life in motor racing. A created driver starts in Formula 2 and
 * has to earn an F1 seat; a current F1 driver starts in their own car. Every round of the season is
 * raced in order and scored into real championship tables (from the race classification). Between
 * rounds the inbox carries the team principal's verdict, press conferences (answers move reputation,
 * fan hype and the team's trust), the teammate battle, rivals' news and contract offers; a contract
 * signed during a season takes effect at the next one. Pure data in localStorage, no scene.
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
  /** what happens, shown once picked */
  reply: string;
}
export interface Msg {
  id: number;
  kind: 'principal' | 'press' | 'offer' | 'news' | 'season' | 'welcome';
  from: string;
  title: string;
  body: string;
  round: number;
  read: boolean;
  choices?: Choice[];
  picked?: number;
  offer?: Contract & { teamName: string };
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
}
export interface DCData {
  v: 1;
  driver: PlayerDriver;
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
  msgSeq: number;
  /** every circuit the career has raced at (they open for quick races) */
  seen?: string[];
}

const KEY = 'apexgp.drivercareer';
export const F2_CALENDAR = ['monza', 'spa', 'silverstone', 'spielberg', 'zandvoort', 'hungaroring', 'sakhir', 'yasmarina'];
export const F1_CALENDAR = CIRCUITS.map((c) => c.id);
export const LAPS: Record<SeriesId, number> = { f1: 10, f2: 7 };
export const SERIES_NAME: Record<SeriesId, string> = { f1: 'Formula 1', f2: 'Formula 2' };

export const NATIONS: [string, string][] = [
  ['GBR', 'United Kingdom'], ['NED', 'Netherlands'], ['MON', 'Monaco'], ['ESP', 'Spain'], ['MEX', 'Mexico'], ['AUS', 'Australia'],
  ['FRA', 'France'], ['GER', 'Germany'], ['ITA', 'Italy'], ['FIN', 'Finland'], ['DEN', 'Denmark'], ['CAN', 'Canada'],
  ['USA', 'United States'], ['BRA', 'Brazil'], ['ARG', 'Argentina'], ['JPN', 'Japan'], ['CHN', 'China'], ['THA', 'Thailand'],
  ['NZL', 'New Zealand'], ['BEL', 'Belgium'], ['AUT', 'Austria'], ['SUI', 'Switzerland'], ['POL', 'Poland'], ['IND', 'India'],
  ['RSA', 'South Africa'], ['UAE', 'United Arab Emirates'], ['IRL', 'Ireland'], ['SWE', 'Sweden'], ['NOR', 'Norway'], ['POR', 'Portugal'],
];

/** a team's level 0 (back) … 1 (front) within its series, from its pace */
export function levelOf(series: SeriesId, team: string): number {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  const paces = list.map((t) => t.pace).sort((a, b) => a - b);
  const t = list.find((x) => x.id === team);
  if (!t) return 0.5;
  // (F2 is a spec series: the teams are close)
  const l = paces.length > 1 ? paces.indexOf(t.pace) / (paces.length - 1) : 0.5;
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
export function teamColor(series: SeriesId, team: string): string {
  const list = series === 'f2' ? f2Teams() : f1Teams();
  const t = list.find((x) => x.id === team);
  return t ? (t.primary === '#111214' || t.primary === '#101010' || t.primary === '#1b1d22' || t.primary === '#0b1e3f' ? t.secondary : t.primary) : '#888';
}
/** where a car like this should finish in a 22-car field */
function expected(series: SeriesId, team: string): number {
  return Math.round(17 - 14 * levelOf(series, team));
}
const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

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

// ------------------------------------------------------------------ the career
export class DriverCareer {
  data: DCData | null = null;
  private listeners: (() => void)[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = JSON.parse(raw) as DCData;
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

  /** a new career: a created driver signs for a Formula 2 team, a current driver keeps their F1 seat */
  start(driver: PlayerDriver, contract: Contract) {
    const year = new Date().getFullYear();
    const existing = !!driver.from;
    this.data = {
      v: 1,
      driver,
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
      msgSeq: 1,
    };
    const tn = teamName(contract.series, contract.team);
    this.post({
      kind: 'welcome',
      from: tn,
      title: existing ? `Welcome back, ${driver.first}` : `Welcome to ${tn}`,
      body: existing
        ? `A new season with ${tn}. The car is ready, the calendar is ${this.data.calendar.length} rounds long, and the paddock expects big things. Your contract runs to the end of ${contract.until}.`
        : `You've signed with ${tn} for the ${year} Formula 2 season: ${this.data.calendar.length} rounds on the Grand Prix weekends. Win, and Formula 1 will come calling. Every result, every interview counts.`,
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
    return LAPS[this.data?.series ?? 'f1'];
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

  /**
   * A round raced: the whole classification (finishing order, codes, teams) is scored into the
   * tables, then the inbox fills — the principal's verdict, maybe a press conference, maybe offers.
   */
  recordRound(track: string, rows: { code: string; name: string; team: string; teamId: string; color: string; pos: number; dnf: boolean; fastest: boolean; isPlayer: boolean; seatMate?: boolean }[]) {
    const d = this.data;
    if (!d || d.calendar[d.round] !== track) return;
    const me = rows.find((r) => r.isPlayer);
    if (!me) return;
    for (const r of rows) {
      d.names[r.code] = { name: r.name, team: r.team, color: r.color };
      const pts = r.dnf ? 0 : (POINTS[r.pos - 1] ?? 0) + (r.fastest && r.pos <= 10 ? 1 : 0);
      d.standings[r.code] = (d.standings[r.code] ?? 0) + pts;
      d.teamPoints[r.teamId] = (d.teamPoints[r.teamId] ?? 0) + pts;
    }
    const mate = rows.find((r) => r.seatMate);
    const myPts = me.dnf ? 0 : (POINTS[me.pos - 1] ?? 0) + (me.fastest && me.pos <= 10 ? 1 : 0);
    d.results.push({ track, pos: me.pos, dnf: me.dnf, points: myPts, fastest: me.fastest, mate: mate ? (mate.dnf ? 99 : mate.pos) : 99 });
    d.starts++;
    d.seen = Array.from(new Set([...(d.seen ?? []), track]));
    if (!me.dnf && me.pos === 1) d.wins++;
    if (!me.dnf && me.pos <= 3) d.podiums++;
    const beatMate = mate ? (me.dnf ? false : mate.dnf || me.pos < mate.pos) : false;
    if (mate) d.h2h.race[beatMate ? 0 : 1]++;
    d.money += d.contract.salary / d.calendar.length + (myPts > 0 ? myPts * 0.02 * (d.series === 'f1' ? 1 : 0.2) : 0);

    // reputation, hype and the team's trust: against what this car should do
    const exp = expected(d.series, d.contract.team);
    const perf = me.dnf ? -3 : exp - me.pos;
    const cap = d.series === 'f2' ? 72 : 100;
    d.rep = clamp(d.rep + Math.max(-4, Math.min(6, perf * 0.8)) + (me.dnf ? 0 : me.pos === 1 ? 3 : me.pos <= 3 ? 1.5 : 0) + (beatMate ? 0.8 : -0.4), 0, cap);
    d.hype = clamp(d.hype + (me.dnf ? -1 : me.pos === 1 ? 6 : me.pos <= 3 ? 3 : perf > 2 ? 1.5 : -0.5));
    d.rel = clamp(d.rel + Math.max(-5, Math.min(5, perf * 0.6)));

    const roundNo = d.round + 1;
    const tn = teamName(d.series, d.contract.team);
    const place = me.dnf ? 'a retirement' : `P${me.pos}`;
    const verdict = me.dnf
      ? 'A DNF hurts. Reset, and we go again at the next one.'
      : perf >= 4
        ? `That's above what this car should do — expectations were around P${exp}. The whole factory is buzzing.`
        : perf >= 0
          ? `Solid. Around where we expected (P${exp}). Keep stacking these up.`
          : `Below target — we expected around P${exp}. Let's understand why before the next round.`;
    this.post({ kind: 'principal', from: `${tn} · Team principal`, title: `Round ${roundNo}: ${place}`, body: verdict });

    // the press, after notable results (and now and then otherwise)
    const when: PressQ['when'] = me.dnf ? 'dnf' : me.pos === 1 ? 'win' : me.pos <= 3 ? 'podium' : perf >= 3 ? 'good' : perf <= -4 ? 'bad' : mate && beatMate ? 'beatMate' : mate && !beatMate ? 'lostMate' : 'any';
    if (when !== 'any' || Math.random() < 0.4) {
      const pool = PRESS.filter((p) => p.when === when);
      const q = pick(pool.length ? pool : PRESS);
      this.post({ kind: 'press', from: 'Press conference', title: 'The media pen', body: q.q, choices: q.choices.map((c) => ({ ...c })) });
    }
    // the teammate battle
    if (mate && d.results.length % 3 === 0) {
      const [a, b] = d.h2h.race;
      this.post({ kind: 'news', from: 'Paddock news', title: `Team battle: ${a}–${b}`, body: a >= b ? `You lead ${mate.name} ${a}–${b} in races this season. The team is watching closely.` : `${mate.name} leads you ${b}–${a} in races this season. Time to turn it around.` });
    }
    d.round++;
    // offers once the market opens (the last third of a season), and at its end
    const t = d.round / d.calendar.length;
    if (t >= 0.6 && !d.next && (d.round === Math.ceil(d.calendar.length * 0.6) || d.round === d.calendar.length)) this.makeOffers();
    if (d.round >= d.calendar.length) this.endSeason();
    this.save();
  }

  /** answer a press question / an offer */
  choose(msgId: number, i: number) {
    const d = this.data;
    const m = d?.inbox.find((x) => x.id === msgId);
    if (!d || !m || m.picked !== undefined) return;
    m.picked = i;
    m.read = true;
    if (m.kind === 'offer' && m.offer) {
      if (i === 0) {
        const { teamName: _n, ...c } = m.offer;
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
    }
    this.save();
  }
  markRead(msgId: number) {
    const m = this.data?.inbox.find((x) => x.id === msgId);
    if (m && !m.read) {
      m.read = true;
      this.save();
    }
  }

  private post(m: Omit<Msg, 'id' | 'round' | 'read'>) {
    const d = this.data!;
    d.inbox.unshift({ ...m, id: d.msgSeq++, round: d.round, read: false });
    if (d.inbox.length > 40) d.inbox.length = 40;
  }

  /** teams that want the player now (they come as inbox offers) */
  private makeOffers() {
    const d = this.data!;
    const year = d.year + 1;
    const made: string[] = [];
    const champ = this.position().pos;
    // F1 teams: the higher the team, the more reputation it needs
    const f1 = f1Teams();
    // (from F2, the front-running teams are out of reach: you earn them in F1)
    const f1Bar = (lvl: number) => (d.series === 'f2' ? 50 + 42 * lvl : 38 + 50 * lvl);
    const contractEnds = d.contract.until <= d.year;
    if (d.series === 'f2' || contractEnds || d.rep > 70) {
      for (const t of f1) {
        if (t.id === d.contract.team && d.series === 'f1') continue;
        const lvl = levelOf('f1', t.id);
        const bonus = d.series === 'f2' ? (champ === 1 ? 14 : champ <= 3 ? 7 : 0) : 0;
        const interest = d.rep + bonus - f1Bar(lvl) + (Math.random() - 0.5) * 12;
        if (interest <= 0 || made.length >= 3) continue;
        made.push(t.id);
        const status: Status = interest > 18 && lvl < 0.7 ? 'lead' : interest > 6 ? 'equal' : 'second';
        this.offer('f1', t.id, year, 1 + Math.floor(Math.random() * 3), +((0.8 + 11 * lvl) * (0.6 + d.rep / 120)).toFixed(1), status);
      }
    }
    // the current team wants to keep them (if the deal is ending and they've earned it)
    if (contractEnds && d.rel >= 35) this.offer(d.series, d.contract.team, year, 1 + Math.floor(Math.random() * 2), +(d.contract.salary * (1 + (d.rep - 50) / 200)).toFixed(1), d.rel > 70 ? 'lead' : d.contract.status);
    // F2: the junior teams for another year if F1 hasn't come
    if (d.series === 'f2' && made.length === 0) {
      for (const t of f2Teams().slice().sort(() => Math.random() - 0.5).slice(0, 2)) if (t.id !== d.contract.team) this.offer('f2', t.id, year, 1, 0.2, 'equal');
    }
  }
  private offer(series: SeriesId, team: string, from: number, years: number, salary: number, status: Status) {
    const d = this.data!;
    // (one standing offer per team)
    if (d.inbox.some((m) => m.kind === 'offer' && m.picked === undefined && m.offer?.team === team && m.offer.series === series)) return;
    const tn = teamName(series, team);
    // the seat: the weaker driver's (the lead seat's on a 'lead' deal)
    const seat: 0 | 1 = status === 'lead' ? 0 : series === 'f1' ? (f1Original(teamIndex('f1', team)).drivers[0].skill >= f1Original(teamIndex('f1', team)).drivers[1].skill ? 1 : 0) : 1;
    const until = from + years - 1;
    const statusText = status === 'lead' ? 'as the lead driver' : status === 'equal' ? 'with equal status' : 'as the second driver';
    this.post({
      kind: 'offer',
      from: `${tn}`,
      title: `${series === 'f1' && d.series === 'f2' ? 'Formula 1 offer' : 'Contract offer'} · ${tn}`,
      body: `${tn} offers a ${years}-year deal from ${from} ${statusText}, $${salary.toFixed(1)}M a season. ${series === 'f1' ? `Level: ${levelLabel(levelOf('f1', team))}.` : 'Another year in Formula 2.'}`,
      choices: [{ label: 'Sign', reply: `Signed. You race for ${tn} from ${from}.` }, { label: 'Decline', reply: 'Declined.' }],
      offer: { series, team, seat, until, salary, status, teamName: tn },
    });
  }

  private endSeason() {
    const d = this.data!;
    const { pos, points } = this.position();
    const champion = pos === 1;
    if (champion) d.titles++;
    const wins = d.results.filter((r) => !r.dnf && r.pos === 1).length;
    const podiums = d.results.filter((r) => !r.dnf && r.pos <= 3).length;
    d.history.push({ year: d.year, series: d.series, team: d.contract.team, teamName: teamName(d.series, d.contract.team), position: pos, points, wins, podiums, champion });
    d.rep = clamp(d.rep + (champion ? 12 : pos <= 3 ? 5 : 0));
    this.post({
      kind: 'season',
      from: SERIES_NAME[d.series],
      title: champion ? `${d.year} ${SERIES_NAME[d.series]} champion!` : `${d.year} season: P${pos} in the championship`,
      body: champion
        ? `World champion material: ${points} points, ${wins} win${wins === 1 ? '' : 's'}. The whole paddock knows your name now.`
        : `${points} points, ${wins} win${wins === 1 ? '' : 's'}, ${podiums} podium${podiums === 1 ? '' : 's'}. ${d.next ? `Next year: ${teamName(d.next.series, d.next.team)}.` : 'Time to decide next year.'}`,
    });
    const ends = d.contract.until <= d.year;
    if (d.next || !ends) this.newSeason();
    else if (d.inbox.some((m) => m.kind === 'offer' && m.picked === undefined)) d.choosing = true;
    else {
      // nobody came: the current team keeps you on a one-year deal
      d.next = { ...d.contract, until: d.year + 1, salary: +(d.contract.salary * 0.8).toFixed(1) };
      this.newSeason();
    }
  }
  private newSeason() {
    const d = this.data!;
    d.choosing = false;
    if (d.next) {
      d.contract = d.next;
      d.next = null;
    }
    d.year++;
    d.series = d.contract.series;
    d.calendar = d.series === 'f2' ? F2_CALENDAR.slice() : F1_CALENDAR.slice();
    d.round = 0;
    d.results = [];
    d.standings = {};
    d.teamPoints = {};
    d.names = {};
    d.h2h = { race: [0, 0] };
    const tn = teamName(d.series, d.contract.team);
    this.post({ kind: 'welcome', from: tn, title: `${d.year}: a new season with ${tn}`, body: `${SERIES_NAME[d.series]}, ${d.calendar.length} rounds. Contract to the end of ${d.contract.until}, ${statusLabel(d.contract.status).toLowerCase()}.` });
  }
}

export function levelLabel(l: number): string {
  return l > 0.8 ? 'front-runner' : l > 0.55 ? 'podium contender' : l > 0.3 ? 'midfield' : 'backmarker';
}
export function statusLabel(s: Status): string {
  return s === 'lead' ? 'Lead driver' : s === 'equal' ? 'Equal status' : 'Second driver';
}
