// Local hosting for the OneAbility AI frontend (PRD 13: Node.js server.js).
// Role: serve static files from /frontend and reverse-proxy /api + /health to the FastAPI backend.
// It has no business logic and never touches payments, keys or credentials. Node built-ins only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frontend');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const BACKEND = new URL(process.env.BACKEND_URL || 'http://127.0.0.1:8000');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

function send(res, status, headers, body) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

function proxy(req, res) {
  const upstream = http.request({
    hostname: BACKEND.hostname, port: BACKEND.port || 80, path: req.url, method: req.method,
    headers: { ...req.headers, host: BACKEND.host },
  }, (up) => {
    res.writeHead(up.statusCode || 502, { ...up.headers, ...SECURITY });
    up.pipe(res);
  });
  upstream.setTimeout(15000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, { 'content-type': 'application/json' }, JSON.stringify({ error: { code: 'BACKEND_DOWN', message: 'The API server is not running.' } }));
    else res.end();
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, {}, 'Bad request'); }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) return send(res, 403, {}, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const noCache = pathname === '/sw.js' || pathname === '/index.html' || pathname.endsWith('.webmanifest');
    res.writeHead(200, { ...SECURITY, 'content-type': type, 'content-length': st.size, 'cache-control': noCache ? 'no-cache' : 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
    return undefined;
  });
  return undefined;
}

export function createServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/health') return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { allow: 'GET, HEAD' }, 'Method not allowed');
    return serveStatic(req, res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(PORT, HOST, () => {
    console.log(`OneAbility AI frontend: http://${HOST}:${PORT}  (proxying /api to ${BACKEND.origin})`);
  });
}
