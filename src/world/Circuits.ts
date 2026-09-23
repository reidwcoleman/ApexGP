import type { CircuitDef } from './CircuitGen.ts';

/**
 * Autódromo Costa del Sol — a fictional clockwise coastal circuit.
 *
 * Pit straight along the cliff top, a heavy-braking T1 at the lighthouse, a
 * fast drop to the harbour and its hairpin, a climb through the pine esses,
 * the long Curva Grande sweeper, the Bus Stop chicane and the Parabólica back
 * onto the pit straight.
 */
export const COSTA_DEL_SOL: CircuitDef = {
  id: 'costa',
  name: 'Autódromo Costa del Sol',
  country: 'ESP',
  halfWidth: 7.5,
  startOffset: 640,
  pitSide: 1,
  sectors: [0.32, 0.67],
  segments: [
    /* 0 */ { type: 'straight', length: 1000, flex: 2, name: 'Recta Principal' },
    /* 1 */ { type: 'corner', angle: -90, radius: 36, name: 'Faro', runoff: 'asphalt', runoffDepth: 44 },
    /* 2 */ { type: 'straight', length: 70, flex: 0.3 },
    /* 3 */ { type: 'corner', angle: 62, radius: 38, name: 'Faro II', runoff: 'asphalt' },
    /* 4 */ { type: 'straight', length: 240 },
    /* 5 */ { type: 'corner', angle: -60, radius: 130, name: 'Mirador', runoff: 'gravel', runoffDepth: 46 },
    /* 6 */ { type: 'straight', length: 520, name: 'Bajada' },
    /* 7 */ { type: 'corner', angle: -165, radius: 17, name: 'Horquilla del Puerto', runoff: 'asphalt', runoffDepth: 32 },
    /* 8 */ { type: 'straight', length: 230, name: 'Puerto' },
    /* 9 */ { type: 'corner', angle: 90, radius: 70, name: 'Lonja', runoff: 'gravel' },
    /* 10 */ { type: 'straight', length: 380, flex: 1.5, name: 'Paseo' },
    /* 11 */ { type: 'corner', angle: 58, radius: 78, name: 'Pinos I', runoff: 'gravel' },
    /* 12 */ { type: 'straight', length: 25 },
    /* 13 */ { type: 'corner', angle: -74, radius: 70, name: 'Pinos II', runoff: 'gravel' },
    /* 14 */ { type: 'straight', length: 25 },
    /* 15 */ { type: 'corner', angle: 52, radius: 85, name: 'Pinos III', runoff: 'gravel' },
    /* 16 */ { type: 'straight', length: 30 },
    /* 17 */ { type: 'corner', angle: -28, radius: 260, name: 'Pinos IV', runoff: 'grass' },
    /* 18 */ { type: 'straight', length: 260 },
    /* 19 */ { type: 'corner', angle: -100, radius: 190, name: 'Curva Grande', runoff: 'gravel', runoffDepth: 52 },
    /* 20 */ { type: 'straight', length: 420, flex: 2, name: 'Recta del Sol' },
    /* 21 */ { type: 'corner', angle: -72, radius: 17, name: 'Bus Stop', runoff: 'asphalt' },
    /* 22 */ { type: 'straight', length: 14 },
    /* 23 */ { type: 'corner', angle: 72, radius: 17, name: 'Bus Stop II', runoff: 'asphalt' },
    /* 24 */ { type: 'straight', length: 200 },
    /* 25 */ { type: 'corner', angle: -80, radius: 110, name: 'Parabólica', runoff: 'asphalt', runoffDepth: 44 },
    /* 26 */ { type: 'straight', length: 120, flex: 1.5 },
  ],
  elevation: [
    [0.0, 22],
    [0.12, 23],
    [0.2, 18],
    [0.3, 8],
    [0.38, 3],
    [0.46, 4],
    [0.56, 12],
    [0.64, 20],
    [0.74, 26],
    [0.84, 25],
    [0.93, 23],
  ],
  drs: [
    { detect: [25, 0.5], start: [0, 0.12], end: [0, 0.97] },
    { detect: [19, 0.5], start: [20, 0.2], end: [20, 0.95] },
  ],
};

export const CIRCUITS = [COSTA_DEL_SOL];
