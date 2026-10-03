// Serves dist/ the way GitHub Pages does (gzip for text types, `Cache-Control: max-age=600`, ETag +
// 304 revalidation), so tools/loadbench.mjs can time a production boot with realistic transfer sizes
// and HTTP caching (vite preview sends everything uncompressed with `no-cache`).
//   npm run build && node tools/pagesserve.mjs [port=5217] [dir=dist]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const port = Number(process.argv[2] ?? 5217);
const root = path.resolve(process.argv[3] ?? 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
};
const GZIP = /^(text\/|application\/(javascript|json)|image\/svg)/;
const memo = new Map();
function load(file) {
  const st = fs.statSync(file);
  const hit = memo.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit;
  const body = fs.readFileSync(file);
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const gz = GZIP.test(type) ? zlib.gzipSync(body, { level: 6 }) : null;
  const etag = '"' + crypto.createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
  const e = { mtime: st.mtimeMs, body, gz, type, etag };
  memo.set(file, e);
  return e;
}
http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const e = load(file);
    const h = { 'Content-Type': e.type, 'Cache-Control': 'max-age=600', ETag: e.etag, Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === e.etag) {
      res.writeHead(304, h).end();
      return;
    }
    const gz = e.gz && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const body = gz ? e.gz : e.body;
    res.writeHead(200, { ...h, ...(gz ? { 'Content-Encoding': 'gzip' } : {}), 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  })
  .listen(port, () => console.log(`pages-like server: ${root} on http://localhost:${port}`));
