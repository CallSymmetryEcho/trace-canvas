// Local server: serves the page, a small JSON API over the data file, and a
// server-sent event stream so the page updates the moment a hook writes
// (`change` for the data file, `live` for the running sessions in live/).
// Binds to 127.0.0.1 only. Writes need a custom header, which a cross-site
// form or fetch cannot send without a preflight this server never approves.
import fs from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COLS, addCommit, dataFile, home, mutate, readConfig, readData, regroup, toArrays, writeConfig } from './store.mjs';
import { demoData } from './demo.mjs';
import { liveDir, readLive, withCodexTerm } from './live.mjs';
import { awayCache, bindLiveSession, findThreadLoose, handTo, liveSessions, sessionList, startAutopilot, stopAutopilot, threadSessions } from './ops.mjs';
import { applyRetro, askAgent, retroRecord, runRetro } from './retro.mjs';
import { AGENTS, deliverRow, focusTab, openTerminal, terminalCommand } from './agents.mjs';
import { draftLessons, rememberLesson } from './lessons.mjs';
import { otherMachines, remoteLive } from './remote.mjs';
import { commitDiff, commitInfo, explainCommit, pullFile, readLinkedImage, readLinkedMd } from './git-view.mjs';
import { autopilotSig, runSync, syncSoon, syncStatus } from './sync.mjs';
import { doctor } from './doctor.mjs';
import { createCard, refreshCard, resumeCommand, returnRun, startRun, workbenches } from './research.mjs';
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
  const boot = JSON.stringify({ version: VERSION, ai, lang: cfg.lang, langSet: cfg.langSet, dataFile: dataFile(), cli: CLI });
  return `<!doctype html><html lang="${cfg.lang === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style><script>window.TRACE_CANVAS_SERVER=${boot.replace(/</g, '\\u003c')}</script></head><body>${body}</body></html>`;
}

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// ▶ Start opens a Terminal window on this Mac: from the phone only after trace-canvas phone --allow-start.
// A terminal to open here: Terminal on macOS, a Linux desktop's terminal (agents.mjs terminalCommand).
const canStart = remote => !!terminalCommand('') && (!remote || !!(readConfig().phone || {}).start);
export const phoneUrl = (phone, port) => `http://${phone.host}:${phone.port || port}/?k=${phone.token}`;
function send(res, status, body, type = 'application/json; charset=utf-8') {
  let out = typeof body === 'string' ? body : JSON.stringify(body);
  const head = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
  // /api/data is ~3 MB and is fetched again on every change: gzipped it is a tenth of that over Tailscale to a phone.
  if (out.length > 8192 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) { out = zlib.gzipSync(out, { level: 4 }); head['Content-Encoding'] = 'gzip'; }
  res.writeHead(status, head);
  res.end(out);
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
  const explaining = new Map(); // record id → its explanation being written, so two clicks ask once
  const broadcast = (event = 'change') => {
    clearTimeout(pending[event]);
    pending[event] = setTimeout(() => { for (const res of clients) res.write(`event: ${event}\ndata: ${Date.now()}\n\n`); }, 80);
  };
  // Research runs end on their own: their cards catch up every 10 s, whether or not a page is open.
  const activeCards = d => Object.values(d.commits).filter(c => c.research && (c.research.runs || []).some(r => r.status === 'submitted' || r.status === 'running')).map(c => c.id);
  setInterval(() => {
    const ids = activeCards(readData());
    if (ids.length && mutate(d => ids.map(id => refreshCard(d, id)).some(Boolean) || false)) broadcast('change');
  }, 10e3).unref();
  // An Autopilot switch that changed here (asked, taken up by a session, stopped, ended by its summary) goes to the
  // other machines at once, not with the next 2-minute sync, so their pages show it too.
  let apSig = autopilotSig(readData());
  fs.watchFile(dataFile(), { interval: 400 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    broadcast();
    const sig = autopilotSig(readData());
    if (sig !== apSig) { apSig = sig; syncSoon(CLI, process.env, { now: true }); }
  });
  fs.mkdirSync(liveDir(), { recursive: true });
  // ponytail: fs.watch on the folder; poll its files if a platform ever drops these events.
  try { fs.watch(liveDir(), () => broadcast('live')).unref(); } catch {}
  setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();
  // A newer version on this clone's remote, looked up at start and twice a day; the page offers it under More.
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), CLI = path.join(ROOT, 'bin', 'trace-canvas.mjs');
  let update = null;
  const checkUpdate = () => execFile('git', ['-C', ROOT, 'fetch', '-q'], { timeout: 30000 }, err => {
    if (!err) execFile('git', ['-C', ROOT, 'rev-list', '--count', 'HEAD..@{u}'], (e, out) => { const n = Number(out) || 0; if (n !== ((update && update.behind) || 0)) { update = n ? { behind: n } : null; broadcast(); } });
  });
  checkUpdate();
  setInterval(checkUpdate, 12 * 3600e3).unref();
  // A pull this server did not make (an agent's git pull) leaves it on old code: when src/ or bin/ changed since it started,
  // trace-canvas update --restart starts it again on the same port (the page reloads by itself); a page-only change needs nothing.
  const gitHead = () => { try { return spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch { return ''; } };
  const HEAD0 = gitHead();
  let restarting = false;
  if (HEAD0 && !process.env.TRACE_CANVAS_NO_RESTART) setInterval(() => {
    const now = gitHead();
    if (restarting || !now || now === HEAD0 || spawnSync('git', ['-C', ROOT, 'diff', '--quiet', HEAD0, now, '--', 'src', 'bin']).status !== 1) return;
    restarting = true;
    spawn(process.execPath, [CLI, 'update', '--restart'], { detached: true, stdio: 'ignore' }).unref();
  }, 60e3).unref();
  // The other machines' changes come in (and this one's go out) every 2 minutes; the page refreshes when data.json changes.
  setInterval(() => syncSoon(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'trace-canvas.mjs')), 120000).unref();
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
        if (['/api/hand', '/api/focus', '/api/resume', '/api/sync', '/api/ai', '/api/demo', '/api/retro', '/api/retro/apply', '/api/update', '/api/autopilot', '/api/lessons', '/api/lessons/save', '/api/git/explain'].includes(p)) return send(res, 403, { error: 'Only on the computer itself' });
      }
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page(readConfig(), ai), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: VERSION, ai, dataFile: dataFile(), ...(!remote && phone ? { phone: phoneUrl(phone, port) } : {}) });
      if (req.method === 'GET' && p === '/api/data') {
        // desktopId: the Claude desktop app's id of a session, so the page can open its chat (claude://…).
        const d = readData(), desk = desktopSessions();
        return send(res, 200, { ...toArrays(d), sessions: sessionList(d).map(s => ({ ...s, desktopId: (desk.get(s.id) || {}).desktopId || null })), machine: readConfig().machine, platform: process.platform, remote, update, start: canStart(remote), awayLive: readConfig().awayLive, detach: readConfig().detach, awayGit: readConfig().awayGit, sync: syncStatus(), machines: otherMachines(d) });
      }
      if (req.method === 'GET' && p === '/api/live') return send(res, 200, { ...liveSessions(readData()), away });
      // A report a record links (a local .md file), for the reader. Only files some record links, so the page
      // cannot be used to read anything else on the computer.
      if (req.method === 'GET' && p === '/api/md') {
        if (req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });
        return send(res, 200, readLinkedMd(readData(), url.searchParams.get('path'), url.searchParams.get('record')));
      }
      // An image for the reader: one a record links, or one a linked report shows (same rule as above).
      if (req.method === 'GET' && p === '/api/img') {
        if (req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });
        const r = readLinkedImage(readData(), url.searchParams.get('path'), url.searchParams.get('from'), url.searchParams.get('record'));
        if (r.error) return send(res, 200, r);
        res.writeHead(200, { ...(r.from ? { 'X-From-Machine': r.from, 'X-Pulled-At': String(Math.round(r.at)) } : {}), 'Content-Type': r.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        return res.end(r.data);
      }
      // A file a record names that only the machine that wrote it has: pulled over ssh into this computer's copy (the same rule as above).
      if (req.method === 'POST' && p === '/api/pull') {
        const b = JSON.parse(await readBody(req));
        return send(res, 200, await pullFile(readData(), b.path, b.record));
      }
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
        mutate(d => {
          const was = col === 'threads' && doc && d.threads[id];
          if (doc) d[col][id] = { ...doc, id }; else delete d[col][id];
          if (was && (was.group || '') !== (doc.group || '')) regroup(d, id, was.group || '', doc.group || '');
        });
        return send(res, 200, { ok: true });
      }
      // Open in Terminal: the command is built here from the to-do, never taken from the request.
      if (req.method === 'POST' && p === '/api/hand') {
        // copy: only the command, for the page's Copy button (one writer for it, so the page's own cannot fall behind).
        if (url.searchParams.get('copy')) { const b = JSON.parse(await readBody(req)); return send(res, 200, { command: handTo(readData(), { ref: String(b.todo || ''), to: String(b.to || '') }).command }); }
        if (!terminalCommand('')) return send(res, 200, { error: 'No terminal to open on this machine (macOS, or a Linux desktop); copy the command instead' });
        const body = JSON.parse(await readBody(req));
        const r = mutate(d => handTo(d, { ref: String(body.todo || ''), to: String(body.to || '') }));
        const failed = await openTerminal(r.command);
        broadcast('change');
        return send(res, 200, failed ? { error: failed, command: r.command } : { ok: true, command: r.command });
      }
      // Autopilot (beta) on a line, until it is turned off (trace-canvas autopilot). A stopped or new session opens in a terminal tab;
      // a running one takes the prompt only from the person or another agent, so it comes back to be copied.
      if (req.method === 'POST' && p === '/api/autopilot') {
        const body = JSON.parse(await readBody(req)), thread = String(body.thread || '');
        try {
          if (body.stop) { mutate(d => stopAutopilot(d, { thread })); broadcast('change'); return send(res, 200, { ok: true }); }
          // Other machines are read over ssh in a dry run first, never under the data lock (awayCache in src/ops.mjs).
          const awayLive = awayCache();
          const evolve = body.evolve || null;
          try { startAutopilot(readData(), { thread, awayLive, evolve }); } catch {}
          const rows = mutate(d => startAutopilot(d, { thread, awayLive, evolve }));
          for (const r of rows) Object.assign(r, await deliverRow(r));
          broadcast('change');
          return send(res, 200, { rows });
        } catch (e) { return send(res, 200, { error: e.message }); }
      }
      // Go to the terminal: brings a live session's tab to the front (Terminal or iTerm2, GNOME Terminal or Konsole).
      if (req.method === 'POST' && p === '/api/focus') {
        const body = JSON.parse(await readBody(req));
        const sid = String(body.session || ''), far = away.flatMap(m => m.sessions).find(s => s.id === sid && s.attach);
        if (far) { const failed = await openTerminal(far.attach); return send(res, 200, failed ? { error: failed, command: far.attach } : { ok: true }); }
        return send(res, 200, await focusTab(withCodexTerm()(readLive(sid)) || {}) ? { ok: true } : { error: 'not found' });
      }
      // Resume in a terminal: a session that is not running opens in a new terminal tab here, resumed from its folder;
      // another machine's over ssh, in tmux there. The command is the server's own (threadSessions), never the page's.
      if (req.method === 'POST' && p === '/api/resume') {
        const sid = String(JSON.parse(await readBody(req)).session || ''), s = threadSessions(readData(), null).find(x => x.id === sid);
        if (!s) return send(res, 200, { error: 'No such session' });
        const failed = terminalCommand('') ? await openTerminal(s.command) : 'No terminal to open on this machine (macOS, or a Linux desktop); copy the command instead';
        return send(res, 200, failed ? { error: failed, command: s.command } : { ok: true, command: s.command });
      }
      // ▶ Start: a Claude Code session on the line in a new Terminal window, with Remote Control on, so it
      // shows in the Claude app on the phone. Built from the line or to-do id like Open in Terminal; a line
      // that already has a session running gets none, the person is pointed at that one instead.
      // Research question cards (src/research.mjs). A run starts an agent on this computer, so not from the phone.
      if (p.startsWith('/api/research/')) {
        if (remote) return send(res, 403, { error: 'Only on the computer itself' });
        if (req.method === 'GET' && p === '/api/research/workbenches') return send(res, 200, { workbenches: workbenches() });
        if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
        // A file picked or dropped on the page: the browser cannot give its path, so its bytes come here, into a folder of
        // its own, and the form uses that path. At most 500 MB.
        if (p === '/api/research/upload') {
          const name = path.basename(String(url.searchParams.get('name') || '')).replace(/[\u0000-\u001f]/g, '');
          if (!name || name === '.' || name === '..') return send(res, 400, { error: 'name' });
          const dir = path.join(home(), 'research', 'uploads', crypto.randomBytes(6).toString('hex')), file = path.join(dir, name);
          fs.mkdirSync(dir, { recursive: true });
          const ok = await new Promise(done => {
            let size = 0; const out = fs.createWriteStream(file);
            req.on('data', c => { size += c.length; if (size > 500 << 20) { req.destroy(); out.destroy(); done(false); } });
            req.pipe(out); out.on('finish', () => done(true)); out.on('error', () => done(false)); req.on('error', () => done(false));
          });
          if (!ok) { fs.rmSync(dir, { recursive: true, force: true }); return send(res, 200, { error: 'big' }); }
          return send(res, 200, { path: file });
        }
        const b = JSON.parse((await readBody(req)) || '{}'), card = String(b.card || '');
        const act = fn => { try { const r = mutate(fn); broadcast('change'); return send(res, 200, r); } catch (e) { return send(res, 200, { error: String(e.message || e) }); } };
        // Save, and with a workbench run it once. A retried save (same key) returns the card it made; a run that
        // cannot start leaves the card saved and says why.
        if (p === '/api/research/new') return act(d => {
          const had = b.key && Object.values(d.commits).find(c => c.research && c.research.key === b.key);
          if (had) return { id: had.id, again: true };
          const c = createCard(d, { question: b.question, thread: b.thread, inputs: Array.isArray(b.inputs) ? b.inputs : [] });
          if (b.key) c.research.key = String(b.key);
          if (!b.workbench) return { id: c.id };
          try { return { id: c.id, run: startRun(d, c.id, { workbench: String(b.workbench), mode: 'single', key: c.id + ':v1:single' }).run }; } catch (e) { return { id: c.id, runError: String(e.message || e) }; }
        });
        if (p === '/api/research/run') return act(d => startRun(d, card, { workbench: String(b.workbench || ''), mode: b.mode === 'control' ? 'control' : 'single', key: String(b.key || '') }));
        if (p === '/api/research/return') return act(d => ({ run: returnRun(d, card, String(b.run || ''), b) }));
        if (p === '/api/research/refresh') { const changed = mutate(d => refreshCard(d, card) || false); if (changed) broadcast('change'); return send(res, 200, { changed: !!changed }); }
        if (p === '/api/research/open') {
          const r = ((readData().commits[card] || {}).research || { runs: [] }).runs.find(x => x.id === b.run), cmd = r && resumeCommand(r);
          if (!cmd) return send(res, 200, { error: 'nosession' });
          const failed = await openTerminal(cmd);
          return send(res, 200, failed ? { error: failed, command: cmd } : { ok: true, command: cmd });
        }
        return send(res, 404, { error: 'not found' });
      }
      if (req.method === 'POST' && p === '/api/start') {
        if (!canStart(remote)) return send(res, 403, { error: remote ? 'Turn it on with trace-canvas phone --allow-start' : 'No terminal to open on this machine (macOS, or a Linux desktop)' });
        // A to-do handed to Codex or Gemini starts that agent; handTo would otherwise reassign it to Claude Code.
        const body = JSON.parse(await readBody(req)), todo = body.todo && readData().commits[String(body.todo)];
        const to = todo && AGENTS[todo.assignee] ? todo.assignee : 'claude';
        const args = { ref: String(body.todo || body.thread || ''), to, remote: to === 'claude' };
        const busy = handTo(readData(), args).live[0];
        if (busy) return send(res, 200, { busy: { id: busy.id, title: busy.title || '', status: busy.status || '' } });
        const r = mutate(d => handTo(d, args));
        const failed = await openTerminal(r.command);
        broadcast('change');
        return send(res, 200, failed ? { error: failed, command: r.command } : { ok: true, name: r.thread.name });
      }
      // Update: trace-canvas update pulls the newest version and restarts this server; the page reloads after it.
      // A refused update (local changes in the way, no network) exits at once with its reason, which the page shows; a good one
      // restarts this server, so the answer never comes and the page reloads. Its output goes to a file so it outlives this server.
      if (req.method === 'POST' && p === '/api/update') {
        const log = path.join(home(), 'update.log'), fd = fs.openSync(log, 'w');
        const ch = spawn(process.execPath, [CLI, 'update'], { detached: true, stdio: ['ignore', fd, fd] }); fs.closeSync(fd); ch.unref();
        ch.on('exit', code => { if (res.writableEnded) return; if (!code) return send(res, 200, { ok: true }); let why = ''; try { why = fs.readFileSync(log, 'utf8').trim().split('\n').pop(); } catch {} send(res, 500, { error: why.replace(/^Could not update: /, ''), failed: true }); });
        return;
      }
      if (req.method === 'GET' && p === '/api/doctor') return send(res, 200, { checks: remote ? [] : doctor() });
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
        if (typeof body.awayGit === 'boolean') patch.awayGit = body.awayGit;
        if (typeof body.detach === 'boolean' && !remote) patch.detach = body.detach;
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
      // Lessons from an archived project: drafted by the local claude, written to Theatrum only for the ticked ones,
      // and noted on its latest archived line (the plaque counts them; Autopilot finds their records from there).
      // What a commit changes, in plain words, by the person's own claude: asked once (the page's button), kept on the record as gxNotes.
      if (req.method === 'POST' && p === '/api/git/explain') {
        const body = JSON.parse(await readBody(req)), id = String(body.record || ''), had = (readData().commits[id] || {}).gxNotes;
        if (had) return send(res, 200, { notes: had });
        if (!explaining.has(id)) explaining.set(id, explainCommit(readData(), id, String(body.lang || 'zh'), askAgent).finally(() => explaining.delete(id)));
        const r = await explaining.get(id);
        if (r.notes && !(readData().commits[id] || {}).gxNotes) { mutate(d => { if (d.commits[id]) d.commits[id].gxNotes = r.notes; }); broadcast('change'); }
        return send(res, 200, r);
      }
      if (req.method === 'POST' && p === '/api/lessons') {
        const body = JSON.parse(await readBody(req));
        try { return send(res, 200, { lessons: await draftLessons(readData(), String(body.group || ''), String(body.lang || 'zh')) }); }
        catch (e) { return send(res, 200, { error: e.message }); }
      }
      if (req.method === 'POST' && p === '/api/lessons/save') {
        const body = JSON.parse(await readBody(req)), group = String(body.group || '');
        const ls = (Array.isArray(body.lessons) ? body.lessons : []).slice(0, 8).map(l => ({ title: String(l.title || '').slice(0, 140), body: String(l.body || '').slice(0, 1200), from: (l.from || []).map(String).slice(0, 6) })).filter(l => l.title);
        const failed = [];
        for (const l of ls) { const e = await rememberLesson(l, group); if (e) failed.push(e); }
        const saved = ls.length - failed.length;
        if (saved) mutate(d => {
          const th = Object.values(d.threads).filter(t => t.group === group && t.archived).sort((a, b) => b.archived - a.archived)[0];
          if (th) addCommit(d, { thread: th.id, kind: 'note', title: `Lessons (${saved}): ${group}`, body: ls.map(l => `- ${l.title}\n  ${l.body}${l.from.length ? `\n  (${l.from.join(', ')})` : ''}`).join('\n'), agent: 'Trace Canvas', extra: { lessons: saved } });
        });
        broadcast('change');
        return send(res, 200, failed.length ? { saved, error: failed[0] } : { saved });
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
        // since: a time (0 for everything), or left out for "since the last retro"; until: a time, or now.
        const num = v => (v == null || v === '' ? undefined : Number(v));
        const r = await runRetro(readData(), tid, { since: num(body.since), until: num(body.until) });
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
  server.on('close', () => fs.unwatchFile(dataFile())); // a closed server (a test) must not keep the process alive
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      port = server.address().port;
      // Where it runs, so trace-canvas update can restart it on the same port.
      try { fs.writeFileSync(path.join(home(), 'server.json'), JSON.stringify({ pid: process.pid, port, head: HEAD0 })); } catch {}
      // With phone access on, a second listener on the Tailscale address (never 0.0.0.0 unless set).
      const phone = readConfig().phone;
      if (!phone || !phone.bind) return resolve({ server, url: `http://localhost:${port}/`, ai });
      const phoneServer = http.createServer(handle(true));
      phoneServer.once('error', e => { console.error(`Phone access: could not listen on ${phone.bind} (${e.code}); is Tailscale on?`); resolve({ server, url: `http://localhost:${port}/`, ai }); });
      phoneServer.listen(phone.port ?? port, phone.bind, () => resolve({ server, phoneServer, url: `http://localhost:${port}/`, ai, phone: phoneUrl(phone, phoneServer.address().port) }));
    });
  });
}
