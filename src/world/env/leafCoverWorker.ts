/**
 * The leaf atlas's coverage-preserving alpha gains (treeproto.ts leafCoverage), worked out off the
 * main thread: decoding the 2048² atlas again and reading its alpha back is ~200 ms of work that
 * would otherwise land as one long task in the garage's frames while the trees load behind it.
 * One message (the atlas's file, its grid), one reply (the gains), then the worker is dropped.
 */
import { leafCoverGains } from './leafCover.ts';

export interface LeafCoverRequest {
  blob: Blob;
  cols: number;
  rows: number;
}
export interface LeafCoverReply {
  gain: Float32Array | null;
  levels: number;
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<LeafCoverRequest>) => void) | null; postMessage(m: unknown, transfer?: Transferable[]): void };

scope.onmessage = async (e) => {
  try {
    const { blob, cols, rows } = e.data;
    // (the same orientation and raw alpha as the texture: treeproto.ts bitmap)
    const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const cx = cv.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(bmp, 0, 0);
    const px = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const r = leafCoverGains(px, bmp.width, bmp.height, cols, rows);
    bmp.close();
    scope.postMessage({ gain: r.gain, levels: r.levels } satisfies LeafCoverReply, [r.gain.buffer]);
  } catch (err) {
    console.warn('[trees] leaf coverage worker', err);
    scope.postMessage({ gain: null, levels: 0 } satisfies LeafCoverReply);
  }
};
