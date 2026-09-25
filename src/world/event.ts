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
};

/** set once per world build (before the trackside and pit textures are painted) */
export const EVENT: EventNames = { ...EVENTS.monza };

export function setEvent(def: CircuitDef) {
  Object.assign(EVENT, EVENTS[def.id] ?? { place: def.short.toUpperCase(), gp: `${def.short.toUpperCase()} GRAND PRIX`, colours: ['#ffffff', '#cccccc', '#ffffff'] });
}
