/** the HUD: where you are, the keys, the prompt by a car, speed; and the fight: stars, health, the gun, the map */
export class Hud {
  private readonly el: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private readonly stars: HTMLDivElement;
  private readonly gun: HTMLDivElement;
  private readonly bars: HTMLDivElement;
  private readonly hp: HTMLElement;
  private readonly ar: HTMLElement;
  private readonly cross: HTMLDivElement;
  private readonly hurtEl: HTMLDivElement;
  private readonly big: HTMLDivElement;
  readonly map: HTMLCanvasElement;
  private shown = true;
  private helpT = 0;

  constructor(parent: HTMLElement) {
    const css = document.createElement('style');
    css.textContent = `
      #odhud { position: fixed; inset: 0; pointer-events: none; font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif; color: #fff; z-index: 5; transition: opacity .4s; }
      #odhud.off { opacity: 0; }
      #odhud .loc { position: absolute; right: 34px; bottom: 30px; text-align: right; text-shadow: 0 1px 12px rgba(0,0,0,.45); }
      #odhud .loc b { display: block; font-size: 30px; font-weight: 800; font-style: italic; letter-spacing: .02em; text-transform: uppercase; }
      #odhud .loc span { font-size: 15px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; opacity: .8; }
      #odhud .help { position: absolute; left: 30px; top: 46px; font-size: 14px; font-weight: 600; letter-spacing: .05em; opacity: .8; line-height: 1.65; text-shadow: 0 1px 8px rgba(0,0,0,.6); transition: opacity 1s; }
      #odhud .help.fade { opacity: 0; }
      #odhud .help kbd { display: inline-block; min-width: 18px; padding: 0 6px; margin-right: 4px; border: 1px solid rgba(255,255,255,.55); border-radius: 4px; font: 700 12px/18px "Barlow Condensed", sans-serif; text-align: center; }
      #odhud .prompt { position: absolute; left: 50%; bottom: 22%; transform: translateX(-50%); font-size: 20px; font-weight: 700; letter-spacing: .06em; padding: 8px 16px; background: rgba(8,10,14,.55); border-radius: 6px; opacity: 0; transition: opacity .2s; }
      #odhud .prompt.on { opacity: 1; }
      #odhud .speed { position: absolute; right: 36px; bottom: 96px; font-size: 54px; font-weight: 800; font-style: italic; opacity: 0; transition: opacity .3s; text-shadow: 0 2px 16px rgba(0,0,0,.4); }
      #odhud .speed small { font-size: 18px; margin-left: 4px; letter-spacing: .1em; }
      #odhud .speed.on { opacity: 1; }
      #odhud .sky { position: absolute; left: 50%; top: 9%; transform: translateX(-50%); text-align: center; opacity: 0; transition: opacity .6s; text-shadow: 0 2px 14px rgba(0,0,0,.5); }
      #odhud .sky.on { opacity: 1; }
      #odhud .sky b { display: block; font-size: 34px; font-weight: 800; font-style: italic; text-transform: uppercase; letter-spacing: .03em; }
      #odhud .sky span { font-size: 15px; font-weight: 600; letter-spacing: .2em; text-transform: uppercase; opacity: .85; }
      #odhud .credit { position: absolute; left: 30px; top: 22px; font-size: 12px; opacity: .45; letter-spacing: .04em; }
      #odhud .stars { position: absolute; right: 30px; top: 26px; display: flex; gap: 3px; }
      #odhud .stars svg { width: 30px; height: 30px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.7)); transition: transform .2s; }
      #odhud .stars svg path { fill: rgba(255,255,255,.14); stroke: rgba(0,0,0,.55); stroke-width: 1.3; }
      #odhud .stars svg.on path { fill: #fff; }
      #odhud .stars.search svg.on path { fill: #9aa0a6; }
      #odhud .stars.blink svg.on { opacity: .25; }
      #odhud .gun { position: absolute; right: 32px; top: 66px; text-align: right; text-shadow: 0 1px 8px rgba(0,0,0,.7); }
      #odhud .gun b { display: block; font-size: 22px; font-weight: 800; font-style: italic; text-transform: uppercase; letter-spacing: .03em; }
      #odhud .gun span { font-size: 26px; font-weight: 700; letter-spacing: .04em; }
      #odhud .gun span small { font-size: 16px; opacity: .7; margin-left: 4px; }
      #odhud .gun em { display: block; font-style: normal; font-size: 13px; letter-spacing: .2em; color: #ffd36b; }
      #odhud .mapw { position: absolute; left: 30px; bottom: 30px; width: 210px; }
      #odhud canvas.map { width: 210px; height: 150px; border-radius: 8px; display: block; box-shadow: 0 4px 18px rgba(0,0,0,.45); }
      #odhud .bars { display: flex; gap: 4px; margin-top: 5px; }
      #odhud .bars div { height: 7px; border-radius: 2px; background: rgba(0,0,0,.45); overflow: hidden; }
      #odhud .bars .h { flex: 2; } #odhud .bars .a { flex: 1; }
      #odhud .bars i { display: block; height: 100%; transition: width .25s; }
      #odhud .bars .h i { background: #5fcf72; } #odhud .bars .a i { background: #5a9bf0; }
      #odhud .bars.low .h i { background: #e14b4b; }
      #odhud .cross { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; opacity: 0; transition: opacity .15s; }
      #odhud .cross.on { opacity: .95; }
      #odhud .cross::before { content: ""; position: absolute; left: 9px; top: 9px; width: 4px; height: 4px; border-radius: 50%; background: #fff; box-shadow: 0 0 2px #000; }
      #odhud .cross::after { content: ""; position: absolute; inset: 0; border: 1.5px solid rgba(255,255,255,.55); border-radius: 50%; }
      #odhud .cross.hit::after { border-color: #ff4a4a; }
      #odhud .hurt { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(160,0,0,0) 45%, rgba(170,0,0,.55) 100%); opacity: 0; transition: opacity .5s; }
      #odhud .big { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; background: rgba(0,0,0,0); transition: background 1.2s, opacity .8s; opacity: 0; }
      #odhud .big.on { opacity: 1; background: rgba(0,0,0,.45); }
      #odhud .big b { font-size: 92px; font-weight: 800; font-style: italic; letter-spacing: .04em; text-transform: uppercase; text-shadow: 0 4px 24px rgba(0,0,0,.6); }
      #odhud .big span { font-size: 20px; font-weight: 600; letter-spacing: .3em; text-transform: uppercase; opacity: .85; }
    `;
    document.head.appendChild(css);
    const el = (this.el = document.createElement('div'));
    el.id = 'odhud';
    const star = '<svg viewBox="0 0 24 24"><path d="M12 2.2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.1l-6.1 3.5 1.5-6.8-5.2-4.6 6.9-.7z"/></svg>';
    el.innerHTML = `
      <div class="hurt"></div>
      <div class="loc"><b>Ocean Drive</b><span>7th – 8th Street · Miami Beach</span></div>
      <div class="help"><kbd>W A S D</kbd> move &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>C</kbd> stroll &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>F</kbd> car (pulls a driver out)<br><kbd>1</kbd> fists <kbd>2</kbd> pistol <kbd>3</kbd> shotgun <kbd>4</kbd> carbine &nbsp; <kbd>RMB</kbd> aim &nbsp; <kbd>LMB</kbd> fire / punch &nbsp; <kbd>R</kbd> reload<br><kbd>T</kbd> time of day &nbsp; <kbd>Y</kbd> weather &nbsp; <kbd>H</kbd> hide HUD &nbsp; (click first)</div>
      <div class="prompt"><kbd style="border:1px solid #fff;border-radius:4px;padding:0 7px;margin-right:8px">F</kbd><span>Get in</span></div>
      <div class="speed">0<small>KM/H</small></div>
      <div class="sky"><b></b><span></span></div>
      <div class="stars">${star.repeat(6)}</div>
      <div class="gun"><b></b><span></span><em></em></div>
      <div class="mapw"><canvas class="map" width="420" height="300"></canvas><div class="bars"><div class="h"><i></i></div><div class="a"><i></i></div></div></div>
      <div class="cross"></div>
      <div class="big"><b></b><span></span></div>
      <div class="credit">Map © OpenStreetMap contributors · scans: Poly Haven (CC0) · people: Microsoft Rocketbox · car: Ferrari 458 by vicent091036 (CC BY 4.0) · skies: Poly Haven (CC0)</div>`;
    parent.appendChild(el);
    this.prompt = el.querySelector('.prompt')!;
    this.speed = el.querySelector('.speed')!;
    this.help = el.querySelector('.help')!;
    this.stars = el.querySelector('.stars')!;
    this.gun = el.querySelector('.gun')!;
    this.bars = el.querySelector('.bars')!;
    this.hp = el.querySelector('.bars .h i')!;
    this.ar = el.querySelector('.bars .a i')!;
    this.cross = el.querySelector('.cross')!;
    this.hurtEl = el.querySelector('.hurt')!;
    this.big = el.querySelector('.big')!;
    this.map = el.querySelector('canvas.map')!;
  }

  private skyT = 0 as unknown as ReturnType<typeof setTimeout>;
  /** announce the time of day and the weather for a moment */
  flash(time: string, weather: string) {
    const el = this.el.querySelector('.sky') as HTMLElement;
    const T: Record<string, string> = { day: 'Afternoon', sunset: 'Golden hour', dusk: 'Blue hour', night: 'Night' };
    const W: Record<string, string> = { clear: 'Clear skies', clouds: 'Clouds rolling in', rain: 'Tropical storm' };
    el.querySelector('b')!.textContent = T[time] ?? time;
    el.querySelector('span')!.textContent = W[weather] ?? weather;
    el.classList.add('on');
    clearTimeout(this.skyT);
    this.skyT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  toggle() {
    this.shown = !this.shown;
    this.el.classList.toggle('off', !this.shown);
  }

  private hurtV = 0;
  /** a hit: the edges flush red */
  hurt(k: number) {
    this.hurtV = Math.min(1, this.hurtV + k);
  }

  private crossT = 0;
  hitMarker() {
    this.crossT = 0.18;
  }

  /** the big word in the middle (null clears it) */
  banner(word: string | null, sub = '') {
    if (!word) {
      this.big.classList.remove('on');
      return;
    }
    this.big.querySelector('b')!.textContent = word;
    this.big.querySelector('span')!.textContent = sub;
    this.big.classList.add('on');
  }

  update(dt: number, driving: boolean, nearCar: boolean, kmh: number, jack = false) {
    this.prompt.classList.toggle('on', nearCar);
    this.prompt.querySelector('span')!.textContent = jack ? 'Pull them out' : 'Get in';
    this.speed.classList.toggle('on', driving);
    if (driving) this.speed.firstChild!.textContent = String(Math.round(kmh));
    this.helpT += dt;
    this.help.classList.toggle('fade', this.helpT > 25);
    this.hurtV = Math.max(0, this.hurtV - dt * 1.4);
    this.hurtEl.style.opacity = String(this.hurtV);
    this.crossT -= dt;
    this.cross.classList.toggle('hit', this.crossT > 0);
  }

  fight(o: { stars: number; searching: boolean; t: number; hp: number; maxHp: number; armor: number; weapon: string; mag: number; reserve: number; reloading: boolean; aim: number; armed: boolean }) {
    const svgs = this.stars.querySelectorAll('svg');
    svgs.forEach((s, i) => s.classList.toggle('on', i < o.stars));
    this.stars.classList.toggle('search', o.searching);
    this.stars.classList.toggle('blink', o.searching && Math.floor(o.t * 2.5) % 2 === 0);
    this.stars.style.opacity = o.stars > 0 ? '1' : '0.35';
    const names: Record<string, string> = { fists: 'Fists', pistol: 'Pistol', shotgun: 'Pump shotgun', rifle: 'Carbine' };
    this.gun.querySelector('b')!.textContent = names[o.weapon] ?? o.weapon;
    this.gun.querySelector('span')!.innerHTML = o.armed ? `${o.mag}<small>/ ${o.reserve}</small>` : '';
    this.gun.querySelector('em')!.textContent = o.reloading ? 'RELOADING' : o.armed && o.mag === 0 && o.reserve === 0 ? 'EMPTY' : '';
    this.hp.style.width = `${(100 * o.hp) / o.maxHp}%`;
    this.ar.style.width = `${o.armor}%`;
    this.bars.classList.toggle('low', o.hp < o.maxHp * 0.25);
    this.cross.classList.toggle('on', o.armed && o.aim > 0.3);
  }
}
