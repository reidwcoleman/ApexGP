// The highlights' production code as a chunk of its own: the offscreen studio, the moment finder,
// the WebCodecs encoders and the MP4 / WebM muxers. Nothing of it runs before a race has finished,
// so the boot doesn't download or parse it; Highlights.attach imports it once the garage is up.
export { Studio } from './studio.ts';
export { planMoments } from './moments.ts';
export { createSink, pickFormat } from './encoder.ts';
