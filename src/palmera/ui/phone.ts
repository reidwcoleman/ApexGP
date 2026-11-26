// The phone: C to take it out. Arrow keys move, Enter picks, Backspace goes back, C puts it away.
// Contacts (call a job contact and they text you where to meet), Jobs (waypoints to races, stores,
// the gun shop), Radio (pick the station for the next drive) and Stats.
import { STATIONS } from '../audio/radio';
import { MISSIONS } from '../game/missions';
import { ANCHORS } from '../game/shop';
import type { Game } from '../game/game';

type Row = { label: string; sub?: string; act?: () => void };
type Screen = { title: string; rows: Row[] };

const CSS = `
#phone{position:fixed;right:34px;bottom:-560px;width:262px;height:520px;border-radius:38px;background:#0c0d10;padding:10px;box-shadow:0 24px 60px rgba(0,0,0,.55),inset 0 0 0 2px #2b2e35;transition:bottom .32s cubic-bezier(.2,.9,.25,1.1);z-index:30;font-family:inherit;color:#fff}
#phone.open{bottom:34px}
#phone .scr{position:relative;width:100%;height:100%;border-radius:30px;overflow:hidden;background:linear-gradient(170deg,#ff9a62 0%,#ef5d8b 38%,#5b3fa8 72%,#1b2350 100%)}
#phone .pbar{display:flex;justify-content:space-between;padding:12px 20px 4px;font-size:12px;font-weight:700;letter-spacing:.02em}
#phone .clock{text-align:center;font-size:52px;font-weight:300;margin-top:18px;text-shadow:0 2px 12px rgba(0,0,0,.25)}
#phone .date{text-align:center;font-size:13px;opacity:.85;margin-bottom:26px}
#phone .apps{display:grid;grid-template-columns:repeat(2,1fr);gap:18px 10px;padding:0 26px}
#phone .app{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:12px;font-weight:600}
#phone .ic{width:62px;height:62px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;box-shadow:0 6px 16px rgba(0,0,0,.25);transition:transform .12s}
#phone .app.sel .ic{transform:scale(1.12);box-shadow:0 0 0 3px #fff,0 8px 20px rgba(0,0,0,.35)}
#phone .page{position:absolute;inset:0;background:#f4f2ee;color:#1b1c20;display:flex;flex-direction:column}
#phone .page h3{margin:0;padding:44px 20px 10px;font-size:24px;font-weight:800}
#phone .rows{flex:1;overflow:hidden;padding:0 10px}
#phone .row{padding:11px 12px;border-radius:12px;margin-bottom:4px}
#phone .row .l{font-size:15px;font-weight:700}
#phone .row .s{font-size:12px;opacity:.6;margin-top:2px}
#phone .row.sel{background:#1b1c20;color:#fff}
#phone .row.sel .s{opacity:.75}
#phone .hint{font-size:11px;opacity:.55;text-align:center;padding:8px}
#phone .home .hint{position:absolute;bottom:16px;left:0;right:0;color:#fff;opacity:.8}
`;

export class Phone {
  open = false;
  private el: HTMLDivElement;
  private app = -1; // -1 home
  private sel = 0;
  private stack: Screen[] = [];
  private confirmReset = false;
  private readonly apps = [
    { name: 'Contacts', letter: 'C', bg: '#34c37a' },
    { name: 'Jobs', letter: 'J', bg: '#ffb020' },
    { name: 'Radio', letter: 'R', bg: '#ff4f6d' },
    { name: 'Stats', letter: 'S', bg: '#3d8bff' },
  ];

  constructor(private game: Game) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.el = document.createElement('div');
    this.el.id = 'phone';
    document.body.appendChild(this.el);
  }

  toggle() {
    this.open = !this.open;
    this.app = -1;
    this.sel = 0;
    this.stack = [];
    this.confirmReset = false;
    this.el.classList.toggle('open', this.open);
    this.game.audio.cue('cash');
    this.render();
  }

  update() {
    const g = this.game;
    const inp = g.input;
    if (inp.hit('KeyC') && g.mode === 'play' && !g.player.dead) this.toggle();
    if (!this.open) return;
    const screen = this.stack[this.stack.length - 1];
    const n = screen ? screen.rows.length : this.apps.length;
    const cols = screen ? 1 : 2;
    let moved = false;
    if (inp.hit('ArrowDown')) (this.sel = Math.min(n - 1, this.sel + cols)), (moved = true);
    if (inp.hit('ArrowUp')) (this.sel = Math.max(0, this.sel - cols)), (moved = true);
    if (!screen && inp.hit('ArrowRight')) (this.sel = Math.min(n - 1, this.sel + 1)), (moved = true);
    if (!screen && inp.hit('ArrowLeft')) (this.sel = Math.max(0, this.sel - 1)), (moved = true);
    if (inp.hit('Backspace')) {
      if (this.stack.length) this.stack.pop();
      this.sel = 0;
      moved = true;
    }
    if (inp.hit('Enter')) {
      if (!screen) this.stack.push(this.openApp(this.sel));
      else screen.rows[this.sel]?.act?.();
      this.sel = 0;
      moved = true;
    }
    if (moved || g.elapsed % 1 < 0.02) this.render();
  }

  private waypoint(x: number, z: number, what: string) {
    this.game.hud.waypoint = { x, z };
    this.game.hud.toast(`Waypoint set: ${what}`);
    this.toggle();
  }

  private nearest<T extends { x: number; z: number }>(list: T[]): T | null {
    const p = this.game.player.pos;
    let best: T | null = null, bd = 1e9;
    for (const it of list) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < bd) (bd = d), (best = it);
    }
    return best;
  }

  private openApp(i: number): Screen {
    const g = this.game;
    switch (i) {
      case 0:
        return {
          title: 'Contacts',
          rows: MISSIONS.map((m) => ({
            label: m.contact,
            sub: g.missions.done.has(m.id) ? `${m.title} · done` : `${m.title} · $${m.reward.toLocaleString()}`,
            act: () => {
              if (g.missions.done.has(m.id)) {
                g.hud.subtitle(`${m.contact.split(' ')[0].toUpperCase()}: We're square. Call me if I need you.`, 4);
                this.toggle();
                return;
              }
              g.hud.subtitle(`${m.contact.split(' ')[0].toUpperCase()}: Got work for you. Meet me, I'll put it on your map.`, 4);
              this.waypoint(m.start.x, m.start.z, m.title);
            },
          })),
        };
      case 1: {
        const races = g.activities ? (g.activities as unknown as { starts: { node: { x: number; z: number }; name: string }[] }).starts : [];
        const r = this.nearest(races.map((s) => ({ x: s.node.x, z: s.node.z, name: s.name })));
        const stores = g.robbery.stores.filter((s) => s.cooldown <= 0).map((s) => ({ x: s.pos.x, z: s.pos.z, name: s.name }));
        const st = this.nearest(stores);
        const gun = this.nearest(ANCHORS.map((a) => ({ ...a, name: 'Sunbelt Arms' })));
        const rows: Row[] = [];
        if (r) rows.push({ label: 'Street race', sub: `${r.name} · nearest`, act: () => this.waypoint(r.x, r.z, r.name) });
        if (st) rows.push({ label: 'Corner store', sub: `${st.name} · nearest`, act: () => this.waypoint(st.x, st.z, st.name) });
        if (gun) rows.push({ label: 'Gun shop', sub: 'Sunbelt Arms · nearest', act: () => this.waypoint(gun.x, gun.z, 'Sunbelt Arms') });
        const body = this.nearest(g.bodyShop.bays);
        if (body) rows.push({ label: 'Body & paint', sub: 'Sundown · repair, respray, lose the heat · $150', act: () => this.waypoint(body.x, body.z, 'Sundown Body & Paint') });
        rows.push({ label: 'Taxi work', sub: 'Get in any cab and press T', act: () => this.toggle() });
        rows.push({ label: 'Paramedic work', sub: 'Get in an ambulance and press T', act: () => this.toggle() });
        rows.push({ label: 'Clear waypoint', act: () => ((g.hud.waypoint = null), this.toggle()) });
        return { title: 'Jobs', rows };
      }
      case 2:
        return {
          title: 'Radio',
          rows: [
            ...STATIONS.map((s, k) => ({ label: s.name, sub: s.tag + (g.audio.radio.station === k + 1 ? ' · on' : ''), act: () => this.tune(k + 1) })),
            { label: 'Radio off', sub: g.audio.radio.station === 0 ? 'on' : '', act: () => this.tune(0) },
          ],
        };
      default: {
        const s = g.stats;
        return {
          title: 'Stats',
          rows: [
            { label: `$${g.cash.toLocaleString()}`, sub: 'Cash' },
            { label: `${g.missions.done.size} / ${MISSIONS.length}`, sub: 'Jobs done' },
            { label: String(s.carsStolen), sub: 'Cars taken' },
            { label: String(s.kills), sub: 'Takedowns' },
            { label: String(s.shots), sub: 'Shots fired' },
            {
              label: this.confirmReset ? 'Press Enter again to wipe it' : 'Start over',
              sub: this.confirmReset ? 'Cash, jobs and weapons go back to the start' : 'Deletes the saved game',
              act: () => {
                if (!this.confirmReset) {
                  this.confirmReset = true;
                  this.stack.pop();
                  this.stack.push(this.openApp(3));
                  this.sel = 5;
                  return;
                }
                g.saveGame.reset();
                g.saveGame.enabled = false;
                location.reload();
              },
            },
          ],
        };
      }
    }
  }

  private tune(station: number) {
    const r = this.game.audio.radio;
    let guard = 0;
    while (r.station !== station && guard++ < 8) r.tune(1);
    this.game.hud.toast(station === 0 ? 'Radio off' : `Radio: ${STATIONS[station - 1].name}`);
    this.stack.pop();
    this.stack.push(this.openApp(2));
  }

  private render() {
    if (!this.open) return;
    const g = this.game;
    const h = g.sky.time;
    const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
    const clock = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}`;
    const bar = `<div class="pbar"><span>${clock}</span><span>Palm 5G &nbsp;▮▮▮▯</span></div>`;
    const screen = this.stack[this.stack.length - 1];
    let html: string;
    if (!screen) {
      html = `<div class="scr home">${bar}<div class="clock">${clock}</div><div class="date">${hh < 12 ? 'Morning' : hh < 18 ? 'Afternoon' : 'Evening'} in Port Palmera</div><div class="apps">${this.apps
        .map((a, i) => `<div class="app ${i === this.sel ? 'sel' : ''}"><div class="ic" style="background:${a.bg}">${a.letter}</div>${a.name}</div>`)
        .join('')}</div><div class="hint">Arrows · Enter · C to put away</div></div>`;
    } else {
      html = `<div class="scr"><div class="page">${bar.replace('class="pbar"', 'class="pbar" style="color:#1b1c20"')}<h3>${screen.title}</h3><div class="rows">${screen.rows
        .map((r, i) => `<div class="row ${i === this.sel ? 'sel' : ''}"><div class="l">${r.label}</div>${r.sub ? `<div class="s">${r.sub}</div>` : ''}</div>`)
        .join('')}</div><div class="hint">Enter · Backspace back · C close</div></div></div>`;
    }
    this.el.innerHTML = html;
  }
}
