import type { Race, RaceEvent } from './Race.ts';
import { fmtTime } from '../ui/HUD.ts';
import { COMPOUNDS } from './Pit.ts';
import { isWetKind } from '../world/Weather.ts';

/**
 * The race engineer: turns race state into short team-radio lines.
 * One line at a time, with a cooldown so it never chatters.
 */
export class Engineer {
  private cooldown = 3;
  private lastPos = 0;
  private lastLapSaid = -1;
  private behindWarned = -10;
  private lowErsWarned = false;
  private saidTyres = false;
  private saidRule = false;
  private lastStops = 0;
  private queue: string[] = [];
  /** weather calls already made (so each is said once per change) */
  private saidRainSoon = false;
  private wasWet = false;
  private tyreCall = -1;
  private tyreCallTimer = 0;

  reset(race: Race) {
    this.cooldown = 3;
    this.lastPos = race.player.position;
    this.lastLapSaid = -1;
    this.behindWarned = -10;
    this.lowErsWarned = false;
    this.saidTyres = false;
    this.saidRule = false;
    this.lastStops = 0;
    this.queue = [];
    this.saidRainSoon = false;
    this.wasWet = isWetKind(race.weatherState.kind);
    this.tyreCall = -1;
    this.tyreCallTimer = 0;
  }

  /** returns a message to show, or null */
  update(dt: number, race: Race, events: RaceEvent[]): string | null {
    const p = race.player;
    const code = (id: number) => race.cars[id].entry.driver.code;
    const cornerName = () => {
      let best = race.track.corners[0];
      let bd = Infinity;
      for (const c of race.track.corners) {
        const d = Math.abs(race.track.delta(c.sApex, p.car.s));
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best.name;
    };

    for (const e of events) {
      if (e.car !== p.id && e.kind !== 'fastest-lap') continue;
      switch (e.kind) {
        case 'lights-out':
          this.say(
            race.isTimeTrial
              ? ''
              : race.weatherState.wetness > 0.25
                ? "Lights out! It's slippery — easy on the throttle, lots of spray into Turn 1."
                : 'Lights out! Clean start, tyres are cold — careful into Turn 1.',
            true,
          );
          break;
        case 'fastest-lap':
          if (e.car === p.id) this.say(`That's the fastest lap. ${fmtTime(e.value!)} — mega.`, true);
          break;
        case 'personal-best':
          this.say(`Personal best, ${fmtTime(e.value!)}. Keep that rhythm.`);
          break;
        case 'track-limits':
          this.say(e.value === 3 ? `That's your last warning for track limits. Keep it inside the white lines.` : `Track limits at ${cornerName()}.${e.value ? ` Warning ${e.value}.` : ' That lap is gone.'}`);
          break;
        case 'penalty':
          this.say(`We have a ${e.value} second penalty for track limits. Push, we need to pull a gap.`, true);
          break;
        case 'final-lap':
          this.say('Final lap. Bring it home.', true);
          break;
        case 'finish':
          this.say(
            p.position === 1
              ? 'P1! You won the Grand Prix! Unbelievable drive!'
              : p.position <= 3
                ? `P${p.position}, that's a podium! Great job.`
                : p.position <= 10
                  ? `P${p.position}, points on the board. Good job.`
                  : `P${p.position}. We'll learn from that one.`,
            true,
          );
          break;
        case 'pit-stop':
          this.say(`${(e.value ?? 0).toFixed(1)} second stop, good job boys. ${race.player.compound[0].toUpperCase() + race.player.compound.slice(1)}s are on — bring them in gently.`, true);
          break;
        case 'pit-out':
          this.say(`Out of the pits in P${race.player.position}. Push now.`);
          break;
        case 'contact':
          if ((e.value ?? 0) > 6) this.say('Contact! Check the car — we see no damage, keep going.');
          break;
        case 'blue-flag':
          this.say("Blue flags — you're being lapped. Let them through on the straight.");
          break;
        case 'drs-enabled':
          this.say(`DRS enabled, you're within a second of ${code(race.cars.find((c) => c.position === p.position - 1)?.id ?? 0)}.`);
          break;
      }
    }

    if (race.phase === 'racing' && !race.isTimeTrial) {
      // position changes
      if (p.position !== this.lastPos && race.raceTime > 4) {
        if (p.position < this.lastPos) {
          this.say(p.position === 1 ? "You're leading the race!" : `Nice move, P${p.position}.`);
        } else {
          const by = race.cars.find((c) => c.position === p.position - 1);
          this.say(`Lost a place${by ? ` to ${by.entry.driver.code}` : ''}. Stay close for DRS.`);
        }
        this.lastPos = p.position;
      }
      // lap summaries
      if (p.laps >= 1 && p.laps !== this.lastLapSaid && p.laps < race.opts.laps - 1) {
        this.lastLapSaid = p.laps;
        const ahead = race.cars.find((c) => c.position === p.position - 1);
        const behind = race.cars.find((c) => c.position === p.position + 1);
        if (ahead) this.queue.push(`P${p.position}. Gap to ${ahead.entry.driver.code} is ${p.gapAhead.toFixed(1)}.${behind && behind.gapAhead < 1 ? ` ${behind.entry.driver.code} is right behind.` : ''}`);
        else if (behind) this.queue.push(`Leading by ${behind.gapAhead.toFixed(1)}. Manage the gap.`);
      }
      // pressure from behind
      const behind = race.cars.find((c) => c.position === p.position + 1);
      if (behind && behind.gapAhead > 0 && behind.gapAhead < 0.5 && race.raceTime - this.behindWarned > 40) {
        this.behindWarned = race.raceTime;
        this.say(`${behind.entry.driver.code} is right on your gearbox. Defend.`);
      }
      if (p.car.ers < 0.08 && !this.lowErsWarned) {
        this.lowErsWarned = true;
        this.say('Battery is low. Lift and coast a little, it recharges on the brakes.');
      }
      if (p.car.ers > 0.5) this.lowErsWarned = false;

      // weather
      const w = race.weatherState;
      const wetNow = isWetKind(w.kind);
      if (wetNow && !this.wasWet) this.say(w.rain > 0.45 ? 'Rain is here, and it is heavy. Careful.' : "It's starting to rain.", true);
      if (!wetNow && this.wasWet) this.say('Rain has stopped. The line will start to dry.');
      this.wasWet = wetNow;
      if (!wetNow && !this.saidRainSoon) {
        for (let ahead = 30; ahead <= 300; ahead += 30) {
          if (isWetKind(race.weather.forecast(ahead))) {
            this.saidRainSoon = true;
            const min = Math.max(1, Math.round(ahead / 60));
            this.say(`Radar shows rain in about ${min} minute${min === 1 ? '' : 's'}.`);
            break;
          }
        }
      }
      if (wetNow) this.saidRainSoon = false;
      // tyre calls: the conditions want a different kind of tyre from ours
      this.tyreCallTimer -= dt;
      const want = race.conditionsType();
      const have = COMPOUNDS[p.compound].type;
      if (want !== have && p.pit.phase === 'none' && !race.playerPitRequest && !p.finished && this.tyreCallTimer <= 0 && want !== this.tyreCall) {
        const lapsLeft = race.opts.laps - Math.max(0, p.laps);
        if (lapsLeft > 1) {
          this.tyreCall = want;
          this.tyreCallTimer = 20;
          this.say(
            want === 1
              ? have === 0
                ? 'Track is getting wet. Box for inters — press I.'
                : 'Rain is easing, the inter is the tyre now. Box when ready — press I.'
              : want === 2
                ? 'Standing water out there. Box for full wets — press I.'
                : 'The dry line is quick now. Slicks — box, box, press I.',
            true,
          );
        }
      }
      if (want === have) this.tyreCall = -1;

      // strategy calls
      if (p.stops !== this.lastStops) {
        this.lastStops = p.stops;
        this.saidTyres = false;
      }
      if (p.pit.phase === 'none' && !race.playerPitRequest && !p.finished) {
        const lapsLeft = race.opts.laps - Math.max(0, p.laps);
        const wear = race.wearOf(p);
        if (wear > 0.55 && lapsLeft > 2 && !this.saidTyres) {
          this.saidTyres = true;
          this.say(`The tyres are going off — ${Math.round(wear * 100)}% worn. Box this lap, press I.`, true);
        }
        if (race.owesSecondCompound(p) && lapsLeft <= Math.ceil(race.opts.laps * 0.4) && lapsLeft > 1 && !this.saidRule) {
          this.saidRule = true;
          this.say('We still have to run a second compound. Box, box — press I.', true);
        }
      }
    }

    this.cooldown -= dt;
    if (this.cooldown <= 0 && this.queue.length) {
      this.cooldown = 6;
      return this.queue.shift()!;
    }
    return null;
  }

  private say(text: string, urgent = false) {
    if (!text) return;
    if (urgent) {
      this.queue.unshift(text);
      this.cooldown = Math.min(this.cooldown, 0);
    } else if (this.queue.length < 3) this.queue.push(text);
  }
}
