// Local server: serves the page, a small JSON API over the data file, and a
// server-sent event stream so the page updates the moment a hook writes
// (`change` for the data file, `live` for the running sessions in live/).
// Binds to 127.0.0.1 only. Writes need a custom header, which a cross-site
// form or fetch cannot send without a preflight this server never approves.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COLS, dataFile, home, mutate, readConfig, readData, toArrays, writeConfig } from './store.mjs';
import { demoData } from './demo.mjs';
import { liveDir, readLive } from './live.mjs';
import { bindLiveSession, findThreadLoose, handTo, liveSessions, sessionList } from './ops.mjs';
import { applyRetro, askAgent, retroRecord, runRetro } from './retro.mjs';
import { focusScript, terminalScript } from './agents.mjs';
import { otherMachines, remoteLive } from './remote.mjs';
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

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// ▶ Start opens a Terminal window on this Mac: from the phone only after trace-canvas phone --allow-start.
const canStart = remote => process.platform === 'darwin' && (!remote || !!(readConfig().phone || {}).start);
export const phoneUrl = (phone, port) => `http://${phone.host}:${phone.port || port}/?k=${phone.token}`;
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
  // Other machines' running sessions, over ssh every 15 s while a page is open (src/remote.mjs); a change is a live event.
  let away = [], awaySig = '';
  const pollAway = async () => {
    if (!clients.size) return;
    const got = readConfig().awayLive ? await Promise.all(otherMachines(readData()).map(remoteLive)) : [];
    const sig = JSON.stringify(got.map(m => [m.machine, m.error ? 'x' : '', m.sessions.map(s => [s.id, s.status, s.activity, s.threadId])]));
    away = got;
    if (sig !== awaySig) { awaySig = sig; broadcast('live'); }
  };
  setInterval(pollAway, 15000).unref();

  // remote: the request came in on the phone listener (trace-canvas phone), not on 127.0.0.1.
  const handle = remote => async (req, res) => {
    try {
      const phone = readConfig().phone;
      const hostHeader = String(req.headers.host || '').replace(/:\d+$/, '');
      const hosts = ['127.0.0.1', 'localhost', '[::1]', ...(remote && phone ? [phone.host, phone.ip].filter(Boolean) : [])];
      if (!hosts.includes(hostHeader)) return send(res, 403, { error: 'host not allowed' });
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (remote) {
        // From the phone: its token, from ?k= the first time and from a cookie after that.
        const cookie = (String(req.headers.cookie || '').match(/(?:^|;\s*)tc_k=([^;]+)/) || [])[1], k = url.searchParams.get('k');
        if (!phone || !phone.token || !(same(cookie, phone.token) || same(k, phone.token))) return send(res, 403, { error: 'Open the address trace-canvas phone printed' });
        if (same(k, phone.token) && !same(cookie, phone.token)) res.setHeader('Set-Cookie', `tc_k=${phone.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
        // These act on the computer itself (a terminal, git pushes, the claude CLI, the whole data set).
        if (['/api/hand', '/api/focus', '/api/sync', '/api/ai', '/api/demo', '/api/retro', '/api/retro/apply'].includes(p)) return send(res, 403, { error: 'Only on the computer itself' });
      }
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page(readConfig(), ai), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: VERSION, ai, dataFile: dataFile(), ...(!remote && phone ? { phone: phoneUrl(phone, port) } : {}) });
      if (req.method === 'GET' && p === '/api/data') {
        // desktopId: the Claude desktop app's id of a session, so the page can open its chat (claude://…).
        const d = readData(), desk = desktopSessions();
        return send(res, 200, { ...toArrays(d), sessions: sessionList(d).map(s => ({ ...s, desktopId: (desk.get(s.id) || {}).desktopId || null })), machine: readConfig().machine, platform: process.platform, remote, start: canStart(remote), awayLive: readConfig().awayLive, machines: otherMachines(d) });
      }
      if (req.method === 'GET' && p === '/api/live') return send(res, 200, { ...liveSessions(readData()), away });
      // What a commit record changed, read from git on demand (src/git-view.mjs).
      if (req.method === 'GET' && p === '/api/git/commit') return send(res, 200, await commitInfo(readData(), url.searchParams.get('record'), url.searchParams.get('against')));
      if (req.method === 'GET' && p === '/api/git/diff') return send(res, 200, await commitDiff(readData(), url.searchParams.get('record'), url.searchParams.get('file'), url.searchParams.get('against')));
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write('retry: 2000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        if (clients.size === 1) pollAway(); // the first page open: other machines now, not in 15 s
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
      // Open in Terminal: the command is built here from the to-do, never taken from the request.
      if (req.method === 'POST' && p === '/api/hand') {
        if (process.platform !== 'darwin') return send(res, 200, { error: 'Opening a terminal works on macOS only; copy the command instead' });
        const body = JSON.parse(await readBody(req));
        const r = mutate(d => handTo(d, { ref: String(body.todo || ''), to: String(body.to || '') }));
        spawn('osascript', ['-e', terminalScript(r.command)], { stdio: 'ignore', detached: true }).unref();
        broadcast('change');
        return send(res, 200, { ok: true, command: r.command });
      }
      // Go to the terminal: brings a live session's Terminal or iTerm2 tab to the front, found by its tty.
      if (req.method === 'POST' && p === '/api/focus') {
        const body = JSON.parse(await readBody(req));
        const script = process.platform === 'darwin' && focusScript(readLive(String(body.session || '')) || {});
        if (!script) return send(res, 200, { error: 'no terminal' });
        execFile('osascript', ['-e', script], { timeout: 5000 }, (err, out) => send(res, 200, String(out).trim() === 'ok' ? { ok: true } : { error: 'not found' }));
        return;
      }
      // ▶ Start: a Claude Code session on the line in a new Terminal window, with Remote Control on, so it
      // shows in the Claude app on the phone. Built from the line or to-do id like Open in Terminal; a line
      // that already has a session running gets none, the person is pointed at that one instead.
      if (req.method === 'POST' && p === '/api/start') {
        if (!canStart(remote)) return send(res, 403, { error: remote ? 'Turn it on with trace-canvas phone --allow-start' : 'Starting works on macOS only' });
        const body = JSON.parse(await readBody(req)), args = { ref: String(body.todo || body.thread || ''), to: 'claude', remote: true };
        const busy = handTo(readData(), args).live[0];
        if (busy) return send(res, 200, { busy: { id: busy.id, title: busy.title || '', status: busy.status || '' } });
        const r = mutate(d => handTo(d, args));
        spawn('osascript', ['-e', terminalScript(r.command)], { stdio: 'ignore', detached: true }).unref();
        broadcast('change');
        return send(res, 200, { ok: true, name: r.thread.name });
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
        if (typeof body.awayLive === 'boolean') patch.awayLive = body.awayLive;
        writeConfig(patch);
        if ('awayLive' in patch) pollAway();
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
        const text = await askAgent(String(body.prompt || '').slice(0, 200000), { timeout: 240000 });
        return send(res, 200, { text });
      }
      // Retro: rank the line's work by rounds and suggest rules (minutes, through the local claude/codex);
      // a rule is written only when the person applies it.
      if (req.method === 'POST' && p === '/api/retro') {
        const body = JSON.parse(await readBody(req));
        const tid = findThreadLoose(readData(), String(body.thread || ''));
        if (!tid) return send(res, 404, { error: 'No such line' });
        const r = await runRetro(readData(), tid);
        return send(res, 200, { id: mutate(d => retroRecord(d, tid, r)).id });
      }
      if (req.method === 'POST' && p === '/api/retro/apply') {
        const body = JSON.parse(await readBody(req));
        return send(res, 200, mutate(d => applyRetro(d, { record: String(body.record || ''), n: Number(body.n), layer: String(body.layer || '') })));
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: String(e && e.message || e) });
    }
  };
  const server = http.createServer(handle(false));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      port = server.address().port;
      // With phone access on, a second listener on the Tailscale address (never 0.0.0.0 unless set).
      const phone = readConfig().phone;
      if (!phone || !phone.bind) return resolve({ server, url: `http://localhost:${port}/`, ai });
      const phoneServer = http.createServer(handle(true));
      phoneServer.once('error', e => { console.error(`Phone access: could not listen on ${phone.bind} (${e.code}); is Tailscale on?`); resolve({ server, url: `http://localhost:${port}/`, ai }); });
      phoneServer.listen(phone.port ?? port, phone.bind, () => resolve({ server, phoneServer, url: `http://localhost:${port}/`, ai, phone: phoneUrl(phone, phoneServer.address().port) }));
    });
  });
}
