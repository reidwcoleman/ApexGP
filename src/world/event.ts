import type { CircuitDef } from './CircuitGen.ts';
import { roster, setRoster } from './partners.ts';

/** The race weekend being built: names printed on boards, banners and the podium. */
export interface EventNames {
  /** big trackside name ("MONZA") */
  place: string;
  /** "GRAN PREMIO D'ITALIA" */
  gp: string;
  /** national colours for bands on boards, left to right */
  colours: [string, string, string];
  /** the title partner's name ('' when the race has none) */
  title: string;
  /**
   * the race's full title as the title partner buys it — "<partner> <race name>", the race name
   * left in the host's language ("VELTRA GRAN PREMIO D'ITALIA"; docs/F1_ADVERTISING.md §2)
   */
  titled: string;
}

const EVENTS: Record<string, Omit<EventNames, 'title' | 'titled'>> = {
  monza: { place: 'MONZA', gp: 'GRAN PREMIO D’ITALIA', colours: ['#008c45', '#f4f5f0', '#cd212a'] },
  spa: { place: 'SPA', gp: 'BELGIAN GRAND PRIX', colours: ['#1a1a1a', '#fdda24', '#ef3340'] },
  silverstone: { place: 'SILVERSTONE', gp: 'BRITISH GRAND PRIX', colours: ['#012169', '#ffffff', '#c8102e'] },
  suzuka: { place: 'SUZUKA', gp: 'JAPANESE GRAND PRIX', colours: ['#ffffff', '#bc002d', '#ffffff'] },
  interlagos: { place: 'INTERLAGOS', gp: 'GRANDE PRÊMIO DE SÃO PAULO', colours: ['#009c3b', '#ffdf00', '#002776'] },
  austin: { place: 'AUSTIN', gp: 'UNITED STATES GRAND PRIX', colours: ['#b22234', '#ffffff', '#3c3b6e'] },
  zandvoort: { place: 'ZANDVOORT', gp: 'DUTCH GRAND PRIX', colours: ['#ae1c28', '#ffffff', '#21468b'] },
  spielberg: { place: 'SPIELBERG', gp: 'GROSSER PREIS VON ÖSTERREICH', colours: ['#c8102e', '#ffffff', '#c8102e'] },
  montreal: { place: 'MONTRÉAL', gp: 'GRAND PRIX DU CANADA', colours: ['#d52b1e', '#ffffff', '#d52b1e'] },
  melbourne: { place: 'MELBOURNE', gp: 'AUSTRALIAN GRAND PRIX', colours: ['#00247d', '#ffffff', '#cf142b'] },
  sakhir: { place: 'SAKHIR', gp: 'BAHRAIN GRAND PRIX', colours: ['#ffffff', '#ce1126', '#ce1126'] },
  yasmarina: { place: 'YAS MARINA', gp: 'ABU DHABI GRAND PRIX', colours: ['#00732f', '#ffffff', '#000000'] },
  mexico: { place: 'MÉXICO', gp: 'GRAN PREMIO DE LA CIUDAD DE MÉXICO', colours: ['#006847', '#ffffff', '#ce1126'] },
  hungaroring: { place: 'HUNGARORING', gp: 'MAGYAR NAGYDÍJ', colours: ['#ce2939', '#ffffff', '#477050'] },
};

const titledOf = (gp: string): Pick<EventNames, 'title' | 'titled'> => {
  const t = roster().title;
  const name = t ? t.name.toUpperCase() : '';
  return { title: name, titled: name ? `${name} ${gp}` : gp };
};

/** set once per world build (before the trackside and pit textures are painted) */
export const EVENT: EventNames = { ...EVENTS.monza, ...titledOf(EVENTS.monza.gp) };

export function setEvent(def: CircuitDef) {
  // (the circuit's partners first: the title partner names the race)
  setRoster(def.id);
  const e = EVENTS[def.id] ?? { place: def.short.toUpperCase(), gp: `${def.short.toUpperCase()} GRAND PRIX`, colours: ['#ffffff', '#cccccc', '#ffffff'] as [string, string, string] };
  Object.assign(EVENT, e, titledOf(e.gp));
}
