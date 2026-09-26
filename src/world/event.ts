import type { CircuitDef } from './CircuitGen.ts';

/** The race weekend being built: names printed on boards, banners and the podium. */
export interface EventNames {
  /** big trackside name ("MONZA") */
  place: string;
  /** "GRAN PREMIO D'ITALIA" */
  gp: string;
  /** national colours for bands on boards, left to right */
  colours: [string, string, string];
}

const EVENTS: Record<string, EventNames> = {
  monza: { place: 'MONZA', gp: 'GRAN PREMIO D’ITALIA', colours: ['#008c45', '#f4f5f0', '#cd212a'] },
  spa: { place: 'SPA', gp: 'BELGIAN GRAND PRIX', colours: ['#1a1a1a', '#fdda24', '#ef3340'] },
  silverstone: { place: 'SILVERSTONE', gp: 'BRITISH GRAND PRIX', colours: ['#012169', '#ffffff', '#c8102e'] },
  suzuka: { place: 'SUZUKA', gp: 'JAPANESE GRAND PRIX', colours: ['#ffffff', '#bc002d', '#ffffff'] },
  interlagos: { place: 'INTERLAGOS', gp: 'GRANDE PRÊMIO DE SÃO PAULO', colours: ['#009c3b', '#ffdf00', '#002776'] },
  austin: { place: 'AUSTIN', gp: 'UNITED STATES GRAND PRIX', colours: ['#b22234', '#ffffff', '#3c3b6e'] },
  zandvoort: { place: 'ZANDVOORT', gp: 'DUTCH GRAND PRIX', colours: ['#ae1c28', '#ffffff', '#21468b'] },
  spielberg: { place: 'SPIELBERG', gp: 'GROSSER PREIS VON ÖSTERREICH', colours: ['#c8102e', '#ffffff', '#c8102e'] },
  montreal: { place: 'MONTRÉAL', gp: 'GRAND PRIX DU CANADA', colours: ['#d52b1e', '#ffffff', '#d52b1e'] },
};

/** set once per world build (before the trackside and pit textures are painted) */
export const EVENT: EventNames = { ...EVENTS.monza };

export function setEvent(def: CircuitDef) {
  Object.assign(EVENT, EVENTS[def.id] ?? { place: def.short.toUpperCase(), gp: `${def.short.toUpperCase()} GRAND PRIX`, colours: ['#ffffff', '#cccccc', '#ffffff'] });
}
