// Render the race engineer's radio lines with ElevenLabs into public/audio/radio/<id>.mp3.
// Key: ELEVENLABS_API_KEY (env) or ~/.config/explainer-video/.env. Skips lines already rendered
// unless FORCE=1. node tools/engineer_voice.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
const cfg = JSON.parse(fs.readFileSync(new URL('./engineer_lines.json', import.meta.url)));
let key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  const f = path.join(os.homedir(), '.config/explainer-video/.env');
  if (fs.existsSync(f)) key = /ELEVENLABS_API_KEY=(.+)/.exec(fs.readFileSync(f, 'utf8'))?.[1]?.trim();
}
if (!key) throw new Error('no ELEVENLABS_API_KEY');
const out = new URL('../public/audio/radio/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
for (const [id, text] of Object.entries(cfg.lines)) {
  const file = new URL(`${id}.mp3`, out);
  if (fs.existsSync(file) && !process.env.FORCE) continue;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${cfg.voice}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: cfg.model, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true } }),
  });
  if (!r.ok) {
    console.error(id, r.status, (await r.text()).slice(0, 200));
    process.exitCode = 1;
    continue;
  }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log('rendered', id);
}
