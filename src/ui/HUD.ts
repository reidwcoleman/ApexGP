import type { Race, RaceEvent, Competitor } from '../race/Race.ts';
import type { Track } from '../world/Track.ts';
import { uiColor } from '../race/Teams.ts';

export function fmtTime(t: number, plusSign = false): string {
  if (!isFinite(t) || t <= 0) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const str = m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
  return plusSign ? `+${str}` : str;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

interface Row {
  el: HTMLDivElement;
  pos: HTMLSpanElement;
  bar: HTMLSpanElement;
  code: HTMLSpanElement;
  gap: HTMLSpanElement;
  key: string;
}

/**
 * Broadcast-style race HUD. DOM is built once; updates only touch text and
 * transforms that changed. The tower re-orders by translating rows, so
 * position changes animate like the TV graphics.
 */
export class HUD {
  readonly root: HTMLDivElement;
  private tower: HTMLDivElement;
  private towerHead: HTMLDivElement;
  private rows: Row[] = [];
  private rowByCar = new Map<number, Row>();
  private pbig: HTMLDivElement;
  private lapEl: HTMLDivElement;
  private curEl: HTMLDivElement;
  private sectorEls: HTMLElement[] = [];
  private lastEl: HTMLSpanElement;
  private bestEl: HTMLSpanElement;
  private leds: HTMLElement[] = [];
  private ledWrap: HTMLDivElement;
  private speedEl: HTMLSpanElement;
  private gearEl: HTMLDivElement;
  private thrEl: HTMLElement;
  private brkEl: HTMLElement;
  private ersEl: HTMLElement;
  private ersWrap: HTMLDivElement;
  private drsEl: HTMLDivElement;
  private aheadEl: HTMLDivElement;
  private behindEl: HTMLDivElement;
  private banner: HTMLDivElement;
  private bannerTimer = 0;
  private lights: HTMLDivElement;
  private lightCols: HTMLElement[] = [];
  private hint: HTMLDivElement;
  private camLabel: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private tyreEls: SVGRectElement[] = [];
  private wingEl!: SVGRectElement;
  private wearEl!: HTMLDivElement;
  private camLabelTimer = 0;
  private deltaEl: HTMLDivElement;
  private radioEl: HTMLDivElement;
  private radioTimer = 0;
  private dots = new Map<number, SVGCircleElement>();
  private mapScale = { minx: 0, minz: 0, k: 1, ox: 0, oz: 0 };
  private towerTimer = 0;
  private lastText = new WeakMap<HTMLElement, string>();

  constructor(parent: HTMLElement) {
    this.root = el('div', '', parent);
    this.root.id = 'hud';

    // tower
    this.tower = el('div', 'tower glass', this.root);
    this.towerHead = el('div', 'tower-head', this.tower, 'Lap <b>1/5</b>');
    el('div', 'tower-rows', this.tower);

    // timing
    const timing = el('div', 'timing glass', this.root);
    const posline = el('div', 'posline', timing);
    this.pbig = el('div', 'pbig', posline, 'P1');
    this.lapEl = el('div', 'lap', posline, 'Lap <b>1</b>');
    const curRow = el('div', 'currow', timing);
    this.curEl = el('div', 'cur', curRow, '0:00.000');
    this.deltaEl = el('div', 'delta', curRow, '');
    const sec = el('div', 'sectors', timing);
    for (let i = 0; i < 3; i++) this.sectorEls.push(el('i', '', sec));
    const l1 = el('div', 'tline', timing);
    el('span', '', l1, 'Last');
    this.lastEl = el('span', '', l1, '—');
    const l2 = el('div', 'tline', timing);
    el('span', '', l2, 'Best');
    this.bestEl = el('span', '', l2, '—');

    // cluster
    const cl = el('div', 'cluster glass', this.root);
    this.ledWrap = el('div', 'leds', cl);
    for (let i = 0; i < 15; i++) this.leds.push(el('i', i < 5 ? 'g' : i < 10 ? 'r' : 'b', this.ledWrap));
    const sr = el('div', 'speedrow', cl);
    const sp = el('div', 'speed', sr);
    this.speedEl = el('span', '', sp, '0');
    el('small', '', sp, 'KM/H');
    this.gearEl = el('div', 'gear', sr, 'N');
    const bars = el('div', 'bars', cl);
    const ped = el('div', 'pedals', bars);
    const thr = el('div', 'meter thr', ped);
    this.thrEl = el('b', '', thr);
    const brk = el('div', 'meter brk', ped);
    this.brkEl = el('b', '', brk);
    el('span', 'lbl', bars, '');
    this.ersWrap = el('div', 'meter ers', bars);
    this.ersEl = el('b', '', this.ersWrap);
    this.drsEl = el('div', 'drs', bars, 'DRS');

    // ahead / behind
    const gaps = el('div', 'gaps', this.root);
    this.aheadEl = el('div', 'glass', gaps);
    this.behindEl = el('div', 'glass', gaps);

    // banner, lights, hints
    this.banner = el('div', 'banner glass', this.root);
    this.lights = el('div', 'lights', this.root);
    for (let i = 0; i < 5; i++) {
      const c = el('div', 'col', this.lights);
      el('i', '', c);
      el('i', '', c);
      this.lightCols.push(c);
    }
    this.hint = el('div', 'hint glass', this.root);
    this.camLabel = el('div', 'camlabel glass', this.root);
    this.radioEl = el('div', 'radio glass', this.root);
    // car status: tyre wear and front-wing damage, like the F1 game's car diagram
    this.statusEl = el('div', 'carstatus glass', this.root);
    this.statusEl.innerHTML = `<svg viewBox="0 0 56 96" aria-hidden="true">
      <rect class="fw" x="6" y="3" width="44" height="6" rx="2"/>
      <path class="body" d="M24 10h8l3 22 5 8v30l-4 12h-16l-4-12V40l5-8z"/>
      <rect class="ty" data-i="0" x="3" y="14" width="11" height="18" rx="3"/>
      <rect class="ty" data-i="1" x="42" y="14" width="11" height="18" rx="3"/>
      <rect class="ty" data-i="2" x="1" y="60" width="13" height="22" rx="3"/>
      <rect class="ty" data-i="3" x="42" y="60" width="13" height="22" rx="3"/>
      <rect class="rw" x="12" y="88" width="32" height="5" rx="2"/>
    </svg><div class="wear">100%</div>`;
    this.tyreEls = Array.from(this.statusEl.querySelectorAll('.ty')) as SVGRectElement[];
    this.wingEl = this.statusEl.querySelector('.fw') as SVGRectElement;
    this.wearEl = this.statusEl.querySelector('.wear') as HTMLDivElement;
  }

  show(on: boolean) {
    this.root.classList.toggle('on', on);
  }

  /** build tower rows + minimap for a new race */
  setup(race: Race, track: Track) {
    const rowsWrap = this.tower.querySelector('.tower-rows') as HTMLDivElement;
    rowsWrap.innerHTML = '';
    this.rows = [];
    this.rowByCar.clear();
    const n = race.cars.length;
    const compact = window.innerHeight < 760;
    const rh = compact ? 21 : 25;
    rowsWrap.style.height = `${n * rh}px`;
    for (const c of race.cars) {
      const r = el('div', 'trow', rowsWrap) as HTMLDivElement;
      const row: Row = {
        el: r,
        pos: el('span', 'pos', r),
        bar: el('span', 'bar', r),
        code: el('span', 'code', r),
        gap: el('span', 'gap', r),
        key: '',
      };
      row.bar.style.background = uiColor(c.entry.team);
      row.code.textContent = c.entry.driver.code;
      if (c.isPlayer) r.classList.add('me');
      this.rows.push(row);
      this.rowByCar.set(c.id, row);
    }
    this.tower.style.display = race.isTimeTrial ? 'none' : '';
    (this.root.querySelector('.gaps') as HTMLElement).style.display = race.isTimeTrial ? 'none' : '';

    // minimap
    const mm = this.root.querySelector('.minimap');
    mm?.remove();
    const box = el('div', 'minimap glass', this.root);
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minx = Math.min(minx, track.px[i]); maxx = Math.max(maxx, track.px[i]);
      minz = Math.min(minz, track.pz[i]); maxz = Math.max(maxz, track.pz[i]);
    }
    const size = 100;
    const k = size / Math.max(maxx - minx, maxz - minz);
    const ox = (size - (maxx - minx) * k) / 2;
    const oz = (size - (maxz - minz) * k) / 2;
    this.mapScale = { minx, minz, k, ox, oz };
    let d = '';
    for (let i = 0; i < track.n; i += 6) {
      const [x, y] = this.mapXY(track.px[i], track.pz[i]);
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    d += 'Z';
    const [sx, sy] = this.mapXY(track.px[Math.floor(track.startS)], track.pz[Math.floor(track.startS)]);
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.innerHTML = `<path class="trk" d="${d}" vector-effect="non-scaling-stroke"/><path class="trk2" d="${d}" vector-effect="non-scaling-stroke"/><circle cx="${sx}" cy="${sy}" r="1.6" fill="#fff"/>`;
    box.appendChild(svg);
    this.dots.clear();
    const ordered = race.cars.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const c of ordered) {
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('r', c.isPlayer ? '3.4' : '2.3');
      dot.setAttribute('fill', c.isPlayer ? '#ffffff' : uiColor(c.entry.team));
      if (c.isPlayer) {
        dot.setAttribute('stroke', '#0a0c11');
        dot.setAttribute('stroke-width', '1.2');
      } else {
        dot.setAttribute('stroke', 'rgba(0,0,0,0.6)');
        dot.setAttribute('stroke-width', '0.6');
      }
      svg.appendChild(dot);
      this.dots.set(c.id, dot);
    }
    this.sectorEls.forEach((e) => (e.className = ''));
    this.lights.classList.remove('show');
    this.banner.classList.remove('show');
  }

  private mapXY(x: number, z: number): [number, number] {
    const m = this.mapScale;
    return [(x - m.minx) * m.k + m.ox, (z - m.minz) * m.k + m.oz];
  }

  private setText(e: HTMLElement, t: string) {
    if (this.lastText.get(e) !== t) {
      e.textContent = t;
      this.lastText.set(e, t);
    }
  }

  flash(title: string, sub = '', tone: '' | 'purple' | 'green' | 'red' = '', secs = 2.6) {
    this.banner.className = `banner glass show ${tone}`;
    this.banner.innerHTML = `<span class="k">${title}</span>${sub ? `<span class="sub">${sub}</span>` : ''}`;
    this.bannerTimer = secs;
  }

  setHint(html: string | null) {
    if (html) {
      this.hint.innerHTML = html;
      this.hint.classList.add('show');
    } else this.hint.classList.remove('show');
  }

  /** a line of team radio from the race engineer */
  radio(text: string, teamColor: string, secs = 4.5) {
    this.radioEl.innerHTML = `<span class="rbar" style="background:${teamColor}"></span><div><div class="rwho">Race engineer</div><div class="rmsg">${text}</div></div>`;
    this.radioEl.classList.add('show');
    this.radioTimer = secs;
  }

  cameraLabel(text: string) {
    this.camLabel.textContent = text;
    this.camLabel.classList.add('show');
    this.camLabelTimer = 1.4;
  }

  handleEvents(race: Race, events: RaceEvent[]) {
    for (const e of events) {
      const c = race.cars[e.car];
      switch (e.kind) {
        case 'lights-out':
          this.flash('Lights out', 'and away we go', 'red', 1.8);
          break;
        case 'fastest-lap':
          this.flash('Fastest lap', `${c.entry.driver.code}  ${fmtTime(e.value!)}`, 'purple', 3.2);
          break;
        case 'personal-best':
          this.flash('Personal best', fmtTime(e.value!), 'green');
          break;
        case 'drs-enabled':
          this.flash('DRS enabled', 'press Space in the zone', 'green', 2);
          break;
        case 'track-limits':
          this.flash('Track limits', e.value ? `warning ${e.value} of 3 · lap time deleted` : 'lap time deleted', 'red', 2.6);
          break;
        case 'penalty':
          this.flash(`${e.value} second penalty`, 'track limits', 'red', 3.2);
          break;
        case 'final-lap':
          this.flash('Final lap', '', '', 2.4);
          break;
        case 'finish':
          if (c.isPlayer) this.flash('Chequered flag', `P${c.position}`, '', 4);
          break;
        case 'sector':
          if (e.sector !== undefined) this.sectorEls[e.sector].className = e.color ?? '';
          break;
        case 'lap':
          break;
      }
    }
  }

  update(dt: number, race: Race) {
    const p = race.player;
    const car = p.car;

    // banner/labels
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('show');
    }
    if (this.camLabelTimer > 0) {
      this.camLabelTimer -= dt;
      if (this.camLabelTimer <= 0) this.camLabel.classList.remove('show');
    }

    // start lights
    const showLights = race.phase === 'lights' || (race.phase === 'racing' && race.raceTime < 1.2 && !race.isTimeTrial);
    this.lights.classList.toggle('show', showLights);
    this.lightCols.forEach((c, i) => c.classList.toggle('on', race.phase === 'lights' && i < race.lightsLit));

    // cluster
    const kmh = Math.max(0, Math.round(car.vx * 3.6));
    this.setText(this.speedEl, String(kmh));
    this.setText(this.gearEl, car.reverse ? 'R' : race.phase === 'grid' || race.phase === 'lights' ? 'N' : String(car.gear));
    const sp = car.spec;
    const frac = Math.max(0, (car.rpm - 8800) / (sp.rpmLimit - 250 - 8800));
    const lit = Math.min(15, Math.floor(frac * 15.99));
    for (let i = 0; i < 15; i++) this.leds[i].classList.toggle('on', i < lit);
    this.ledWrap.classList.toggle('flash', car.limiter || lit >= 15);
    this.thrEl.style.width = `${Math.round(car.throttle * 100)}%`;
    this.brkEl.style.width = `${Math.round(car.brake * 100)}%`;
    this.ersEl.style.width = `${Math.round(car.ers * 100)}%`;
    this.ersWrap.classList.toggle('deploy', car.ersDeploying);
    const zoneOn = p.drsEligible;
    this.drsEl.className = 'drs' + (car.drsAnim > 0.5 ? ' open' : zoneOn ? ' avail' : '');

    // tyres & damage (colour = meaning: fine / worn / critical)
    const tone = (w: number) => (w < 0.4 ? 'ok' : w < 0.7 ? 'warn' : 'bad');
    let avg = 0;
    for (let i = 0; i < 4; i++) {
      const cls = 'ty ' + tone(car.wear[i]);
      if (this.tyreEls[i].getAttribute('class') !== cls) this.tyreEls[i].setAttribute('class', cls);
      avg += car.wear[i] / 4;
    }
    const wcls = 'fw ' + (car.wingDamage < 0.15 ? 'ok' : car.wingDamage < 0.5 ? 'warn' : 'bad');
    if (this.wingEl.getAttribute('class') !== wcls) this.wingEl.setAttribute('class', wcls);
    this.setText(this.wearEl, `${Math.round((1 - avg) * 100)}%`);

    // timing
    const t = race.phase === 'racing' || race.phase === 'finished' ? race.raceTime : 0;
    const lapNo = Math.max(1, Math.min(race.opts.laps, p.laps + 1));
    this.setText(this.pbig, race.isTimeTrial ? 'TT' : `P${p.position}`);
    const lapHtml = race.isTimeTrial ? `Lap <b>${Math.max(1, p.laps + 1)}</b>` : p.lapValid ? '' : 'Lap deleted';
    if (this.lastText.get(this.lapEl) !== lapHtml) {
      this.lapEl.innerHTML = lapHtml;
      this.lastText.set(this.lapEl, lapHtml);
    }
    const cur = p.laps >= 0 ? t - p.lapStart : 0;
    this.setText(this.curEl, fmtTime(Math.max(0.0001, cur)).replace('—', '0.000'));
    this.curEl.classList.toggle('invalid', !p.lapValid);
    const dl = race.playerDelta;
    if (isFinite(dl) && p.laps >= 1 && p.lapValid) {
      this.setText(this.deltaEl, `${dl < 0 ? '−' : '+'}${Math.abs(dl).toFixed(3)}`);
      this.deltaEl.className = 'delta ' + (dl < 0 ? 'faster' : 'slower');
    } else if (this.deltaEl.className !== 'delta') {
      this.deltaEl.className = 'delta';
      this.setText(this.deltaEl, '');
    }
    // radio fade
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radioEl.classList.remove('show');
    }
    this.setText(this.lastEl, fmtTime(p.lastLap));
    this.setText(this.bestEl, fmtTime(p.bestLap));
    this.bestEl.className = p.bestLap < Infinity && p.bestLap <= race.bestLap ? 'purple' : p.bestLap < Infinity ? 'green' : '';
    // live sector marker
    this.sectorEls.forEach((e, i) => {
      if (i === p.sector && race.phase === 'racing') e.classList.add('live');
      else e.classList.remove('live');
      if (i > p.sector && e.className === '') return;
    });
    if (p.sector === 0 && cur < 0.2) this.sectorEls.forEach((e) => (e.className = ''));

    // tower + gaps at ~12 Hz
    this.towerTimer -= dt;
    if (this.towerTimer <= 0) {
      this.towerTimer = 0.08;
      this.updateTower(race);
      this.updateGaps(race);
    }

    // minimap dots
    for (const c of race.cars) {
      const dot = this.dots.get(c.id);
      if (!dot) continue;
      const [x, y] = this.mapXY(c.car.x, c.car.z);
      dot.setAttribute('cx', x.toFixed(1));
      dot.setAttribute('cy', y.toFixed(1));
    }
  }

  private updateTower(race: Race) {
    const compact = window.innerHeight < 760;
    const rh = compact ? 21 : 25;
    const head = race.isTimeTrial ? 'Time trial' : `Lap <b>${Math.max(1, Math.min(race.opts.laps, race.leaderLaps + 1))}/${race.opts.laps}</b>`;
    if (this.lastText.get(this.towerHead) !== head) {
      this.towerHead.innerHTML = head;
      this.lastText.set(this.towerHead, head);
    }
    for (const c of race.cars) {
      const row = this.rowByCar.get(c.id)!;
      row.el.style.transform = `translateY(${(c.position - 1) * rh}px)`;
      this.setText(row.pos, String(c.position));
      let gap: string;
      if (c.position === 1) gap = race.phase === 'racing' || race.phase === 'finished' ? 'Leader' : '';
      else if (c.gapLeader < 0) gap = `+${-c.gapLeader} Lap${c.gapLeader < -1 ? 's' : ''}`;
      else gap = race.phase === 'grid' || race.phase === 'lights' || c.gapLeader <= 0 ? '' : `+${c.gapLeader.toFixed(3)}`;
      if (c.finished) gap = c.position === 1 ? 'Winner' : gap;
      this.setText(row.gap, gap);
      const fl = c.id === race.bestLapCar;
      if (fl !== row.code.classList.contains('hasfl')) {
        row.code.classList.toggle('hasfl', fl);
        row.code.innerHTML = c.entry.driver.code + (fl ? '<span class="fl"></span>' : '');
      }
    }
  }

  private updateGaps(race: Race) {
    const p = race.player;
    const ahead = race.cars.find((c) => c.position === p.position - 1);
    const behind = race.cars.find((c) => c.position === p.position + 1);
    const fill = (box: HTMLDivElement, c: Competitor | undefined, sign: string, gap: number) => {
      if (!c || race.phase === 'grid' || race.phase === 'lights') {
        box.style.visibility = 'hidden';
        return;
      }
      box.style.visibility = '';
      const html = `<span class="bar" style="background:${uiColor(c.entry.team)}"></span><span class="code">${c.entry.driver.code}</span><span class="t">${sign}${gap.toFixed(3)}</span>`;
      if (this.lastText.get(box) !== html) {
        box.innerHTML = html;
        this.lastText.set(box, html);
      }
    };
    fill(this.aheadEl, ahead, '−', p.gapAhead);
    fill(this.behindEl, behind, '+', behind ? behind.gapAhead : 0);
  }
}
