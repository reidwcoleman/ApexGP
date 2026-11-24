/** a quiet HUD: where you are, what the keys do, the prompt by a car, the speed while driving (H hides it all) */
export class Hud {
  private readonly el: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly help: HTMLDivElement;
  private shown = true;

  constructor(parent: HTMLElement) {
    const css = document.createElement('style');
    css.textContent = `
      #odhud { position: fixed; inset: 0; pointer-events: none; font-family: "Barlow Condensed", "Arial Narrow", Arial, sans-serif; color: #fff; z-index: 5; transition: opacity .4s; }
      #odhud.off { opacity: 0; }
      #odhud .loc { position: absolute; right: 34px; bottom: 30px; text-align: right; text-shadow: 0 1px 12px rgba(0,0,0,.45); }
      #odhud .loc b { display: block; font-size: 30px; font-weight: 800; font-style: italic; letter-spacing: .02em; text-transform: uppercase; }
      #odhud .loc span { font-size: 15px; font-weight: 600; letter-spacing: .18em; text-transform: uppercase; opacity: .8; }
      #odhud .help { position: absolute; left: 30px; bottom: 28px; font-size: 14px; font-weight: 600; letter-spacing: .05em; opacity: .78; line-height: 1.6; text-shadow: 0 1px 8px rgba(0,0,0,.5); }
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
    `;
    document.head.appendChild(css);
    const el = (this.el = document.createElement('div'));
    el.id = 'odhud';
    el.innerHTML = `
      <div class="loc"><b>Ocean Drive</b><span>7th – 8th Street · Miami Beach</span></div>
      <div class="help"><kbd>W A S D</kbd> move &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>C</kbd> stroll &nbsp; <kbd>Space</kbd> jump<br><kbd>Mouse</kbd> look (click first) &nbsp; <kbd>F</kbd> get in / out of a car &nbsp; <kbd>T</kbd> time of day &nbsp; <kbd>Y</kbd> weather &nbsp; <kbd>H</kbd> hide HUD</div>
      <div class="prompt"><kbd style="border:1px solid #fff;border-radius:4px;padding:0 7px;margin-right:8px">F</kbd>Get in</div>
      <div class="speed">0<small>KM/H</small></div>
      <div class="sky"><b></b><span></span></div>
      <div class="credit">Map © OpenStreetMap contributors · scans: Poly Haven (CC0) · people: Microsoft Rocketbox · car: Ferrari 458 by vicent091036 (CC BY 4.0) · skies: Poly Haven (CC0)</div>`;
    parent.appendChild(el);
    this.prompt = el.querySelector('.prompt')!;
    this.speed = el.querySelector('.speed')!;
    this.help = el.querySelector('.help')!;
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

  update(driving: boolean, nearCar: boolean, kmh: number) {
    this.prompt.classList.toggle('on', nearCar);
    this.speed.classList.toggle('on', driving);
    if (driving) this.speed.firstChild!.textContent = String(Math.round(kmh));
    this.help.style.display = driving ? 'none' : '';
  }
}
