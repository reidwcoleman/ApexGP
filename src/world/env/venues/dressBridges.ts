/**
 * Where each venue's own footbridges cross the lap (s, m), for the circuits whose bridges are built
 * by their venue dressing (env/venues/*Dress.ts) instead of trackside/structures.ts. The trackside
 * reads it to keep its automatic sponsor arches away from them.
 *
 *   monza        the Rettifilo bridge in the braking zone for Turn 1, the bridge on the run from
 *                Ascari to the Parabolica
 *   spa          the footbridge on the run down to Eau Rouge by the old pits, the Kemmel bridge,
 *                the bridge on the run from Paul Frère toward Blanchimont
 *   silverstone  the Wellington Straight and Hangar Straight bridges
 *   suzuka       the bridge over the end of the main straight, the Dunlop arch at the top of the
 *                climb out of the Dunlop curve (the short run to Degner), the back-straight bridge
 *                on the run to 130R
 *   hungaroring  the back straight up to Turn 4, the run down to Turn 12
 */
export const DRESS_BRIDGES: Record<string, number[]> = {
  monza: [1040, 4700],
  spa: [1320, 2200, 6050],
  silverstone: [1800, 4850],
  suzuka: [905, 2500, 4560],
  hungaroring: [1990, 3790],
};
