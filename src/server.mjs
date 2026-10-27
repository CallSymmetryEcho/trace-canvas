// Local server: serves the page, a small JSON API over the data file, and a
// server-sent event stream so the page updates the moment a hook writes
// (`change` for the data file, `live` for the running sessions in live/).
// Binds to 127.0.0.1 only. Writes need a custom header, which a cross-site
// form or fetch cannot send without a preflight this server never approves.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COLS, dataFile, home, mutate, readConfig, readData, toArrays, writeConfig } from './store.mjs';
import { demoData } from './demo.mjs';
import { liveDir } from './live.mjs';
import { bindLiveSession, liveSessions, sessionList } from './ops.mjs';
import { commitDiff, commitInfo } from './git-view.mjs';
import { runSync } from './sync.mjs';
import { desktopSessions } from './desktop.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(here, '..', 'app', 'index.html');
const CLI = path.join(here, '..', 'bin', 'trace-canvas.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;

function claudeAvailable() {
  try { return spawnSync('claude', ['--version'], { timeout: 5000, stdio: 'ignore' }).status === 0; } catch { return false; }
}

function page(cfg, ai) {
  const body = fs.readFileSync(APP, 'utf8');
  const boot = JSON.stringify({ version: VERSION, ai, lang: cfg.lang, dataFile: dataFile(), cli: CLI });
  return `<!doctype html><html lang="${cfg.lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style><script>window.TRACE_CANVAS_SERVER=${boot.replace(/</g, '\\u003c')}</script></head><body>${body}</body></html>`;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function readBody(req, limit = 4 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--output-format', 'text'], { cwd: home(), env: { ...process.env, TRACE_CANVAS_DISABLE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('timeout')); }, 240000);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim() || `claude exited with ${code}`)); });
    child.stdin.end(prompt);
  });
}

export function startServer({ port = 4777, host = '127.0.0.1' } = {}) {
  fs.mkdirSync(home(), { recursive: true });
  const ai = claudeAvailable();
  const clients = new Set();
  const pending = {};
  const broadcast = (event = 'change') => {
    clearTimeout(pending[event]);
    pending[event] = setTimeout(() => { for (const res of clients) res.write(`event: ${event}\ndata: ${Date.now()}\n\n`); }, 80);
  };
  fs.watchFile(dataFile(), { interval: 400 }, (cur, prev) => { if (cur.mtimeMs !== prev.mtimeMs) broadcast(); });
  fs.mkdirSync(liveDir(), { recursive: true });
  // ponytail: fs.watch on the folder; poll its files if a platform ever drops these events.
  try { fs.watch(liveDir(), () => broadcast('live')).unref(); } catch {}
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostHeader)) return send(res, 403, { error: 'host not allowed' });
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page(readConfig(), ai), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: VERSION, ai, dataFile: dataFile() });
      if (req.method === 'GET' && p === '/api/data') {
        // desktopId: the Claude desktop app's id of a session, so the page can open its chat (claude://…).
        const d = readData(), desk = desktopSessions();
        return send(res, 200, { ...toArrays(d), sessions: sessionList(d).map(s => ({ ...s, desktopId: (desk.get(s.id) || {}).desktopId || null })), machine: readConfig().machine });
      }
      if (req.method === 'GET' && p === '/api/live') return send(res, 200, liveSessions(readData()));
      // What a commit record changed, read from git on demand (src/git-view.mjs).
      if (req.method === 'GET' && p === '/api/git/commit') return send(res, 200, await commitInfo(readData(), url.searchParams.get('record'), url.searchParams.get('against')));
      if (req.method === 'GET' && p === '/api/git/diff') return send(res, 200, await commitDiff(readData(), url.searchParams.get('record'), url.searchParams.get('file'), url.searchParams.get('against')));
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      const m = p.match(/^\/api\/docs\/(threads|commits|edges)\/([\w\-.~:@+]{1,180})$/);
      if (m && (req.method === 'PUT' || req.method === 'DELETE')) {
        const [, col, id] = m;
        let doc = null;
        if (req.method === 'PUT') {
          doc = JSON.parse(await readBody(req));
          if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return send(res, 400, { error: 'body must be an object' });
        }
        mutate(d => { if (doc) d[col][id] = { ...doc, id }; else delete d[col][id]; });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/sync') { const r = runSync(); broadcast('change'); return send(res, 200, r); }
      if (req.method === 'POST' && p === '/api/bind') {
        const body = JSON.parse(await readBody(req));
        const t = mutate(d => bindLiveSession(d, { sessionId: String(body.session || ''), thread: body.thread ? String(body.thread) : null }));
        broadcast('live');
        return send(res, 200, { ok: true, thread: t ? { id: t.id, name: t.name } : null });
      }
      if (req.method === 'POST' && p === '/api/config') {
        const body = JSON.parse(await readBody(req));
        const patch = {};
        if (body.lang === 'en' || body.lang === 'zh') patch.lang = body.lang;
        writeConfig(patch);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/demo') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const demo = demoData(body.lang === 'zh' ? 'zh' : 'en');
        mutate(d => { for (const col of COLS) for (const doc of demo[col]) d[col][doc.id] = doc; });
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/ai') {
        if (!ai) return send(res, 501, { error: 'claude CLI not found' });
        const body = JSON.parse(await readBody(req));
        const text = await askClaude(String(body.prompt || '').slice(0, 200000));
        return send(res, 200, { text });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e && e.message || e) });
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({ server, url: `http://localhost:${server.address().port}/`, ai }));
  });
}
