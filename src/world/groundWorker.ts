/**
 * The ground worker: makes the circuit's procedural ground textures' pixels off the main thread
 * while the boot builds the track (trackside/textures.ts loadAsphaltScan starts two of them,
 * splitting the jobs, and makeGroundTextures uses what they have sent back by then). The macro /
 * macroN / gravel / fence and the shared env noise run the very code the main thread would
 * (groundData.ts, env/textureData.ts: deterministic, so the same bytes). Every array is
 * transferred, not copied. One message per worker, then it is terminated.
 */
import { fenceData, gravelData, macroData, macroNData, type PackedAsphalt } from './trackside/groundData.ts';
import { detailNormalData, noiseData } from './env/textureData.ts';

export interface GroundPixels {
  /** the scan (made on the main thread; null: it failed to load — the procedural surface is drawn) */
  asphalt: PackedAsphalt | null;
  macro: Uint8Array | null;
  macroN: Uint8Array | null;
  gravel: { albedo: Uint8Array; normal: Uint8Array } | null;
  fence: Uint8Array | null;
  noise: Uint8Array | null;
  detailNormal: Uint8Array | null;
}
export type GroundJob = 'macro' | 'macroN' | 'gravel' | 'fence' | 'noise' | 'detailNormal';
export interface GroundRequest {
  jobs: GroundJob[];
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<GroundRequest>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

scope.onmessage = (e) => {
  try {
    const { jobs } = e.data;
    const out: Partial<GroundPixels> & { ms?: Record<string, number> } = { ms: {} };
    const timed = <T,>(k: string, f: () => T): T => {
      const t = performance.now();
      const v = f();
      out.ms![k] = Math.round(performance.now() - t);
      return v;
    };
    if (jobs.includes('macro')) out.macro = timed('macro', () => macroData(1024));
    if (jobs.includes('macroN')) out.macroN = timed('macroN', () => macroNData(512));
    if (jobs.includes('gravel')) out.gravel = timed('gravel', () => gravelData(512));
    if (jobs.includes('fence')) out.fence = timed('fence', () => fenceData());
    if (jobs.includes('noise')) out.noise = timed('noise', () => noiseData());
    if (jobs.includes('detailNormal')) out.detailNormal = timed('detailNormal', () => detailNormalData());
    const transfer = [out.macro, out.macroN, out.gravel?.albedo, out.gravel?.normal, out.fence, out.noise, out.detailNormal]
      .filter((a): a is Uint8Array => !!a)
      .map((a) => a.buffer as ArrayBuffer);
    scope.postMessage(out, transfer);
  } catch (err) {
    scope.postMessage({ error: String((err as Error)?.message ?? err) });
  }
};
