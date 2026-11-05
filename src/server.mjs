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
import { COLS, addCommit, dataFile, home, mutate, readConfig, readData, toArrays, writeConfig } from './store.mjs';
import { demoData } from './demo.mjs';
import { liveDir, readLive, withCodexTerm } from './live.mjs';
import { awayCache, bindLiveSession, findThreadLoose, handTo, liveSessions, sessionList, startAutopilot, stopAutopilot } from './ops.mjs';
import { applyRetro, askAgent, retroRecord, runRetro } from './retro.mjs';
import { AGENTS, focusTab, launchRow, openTerminal, terminalCommand } from './agents.mjs';
import { draftLessons, rememberLesson } from './lessons.mjs';
import { otherMachines, remoteLive } from './remote.mjs';
import { commitDiff, commitInfo, readLinkedImage, readLinkedMd } from './git-view.mjs';
import { autopilotSig, runSync, syncSoon, syncStatus } from './sync.mjs';
import { doctor } from './doctor.mjs';
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
  const broadcast = (event = 'change') => {
    clearTimeout(pending[event]);
    pending[event] = setTimeout(() => { for (const res of clients) res.write(`event: ${event}\ndata: ${Date.now()}\n\n`); }, 80);
  };
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
        if (['/api/hand', '/api/focus', '/api/sync', '/api/ai', '/api/demo', '/api/retro', '/api/retro/apply', '/api/update', '/api/autopilot', '/api/lessons', '/api/lessons/save'].includes(p)) return send(res, 403, { error: 'Only on the computer itself' });
      }
      const write = req.method !== 'GET' && req.method !== 'HEAD';
      if (write && req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) return send(res, 200, page(readConfig(), ai), 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, version: VERSION, ai, dataFile: dataFile(), ...(!remote && phone ? { phone: phoneUrl(phone, port) } : {}) });
      if (req.method === 'GET' && p === '/api/data') {
        // desktopId: the Claude desktop app's id of a session, so the page can open its chat (claude://…).
        const d = readData(), desk = desktopSessions();
        return send(res, 200, { ...toArrays(d), sessions: sessionList(d).map(s => ({ ...s, desktopId: (desk.get(s.id) || {}).desktopId || null })), machine: readConfig().machine, platform: process.platform, remote, update, start: canStart(remote), awayLive: readConfig().awayLive, awayGit: readConfig().awayGit, sync: syncStatus(), machines: otherMachines(d) });
      }
      if (req.method === 'GET' && p === '/api/live') return send(res, 200, { ...liveSessions(readData()), away });
      // A report a record links (a local .md file), for the reader. Only files some record links, so the page
      // cannot be used to read anything else on the computer.
      if (req.method === 'GET' && p === '/api/md') {
        if (req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });
        return send(res, 200, readLinkedMd(readData(), url.searchParams.get('path')));
      }
      // An image for the reader: one a record links, or one a linked report shows (same rule as above).
      if (req.method === 'GET' && p === '/api/img') {
        if (req.headers['x-trace-canvas'] !== '1') return send(res, 403, { error: 'missing header' });
        const r = readLinkedImage(readData(), url.searchParams.get('path'), url.searchParams.get('from'));
        if (r.error) return send(res, 200, r);
        res.writeHead(200, { 'Content-Type': r.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
        return res.end(r.data);
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
        mutate(d => { if (doc) d[col][id] = { ...doc, id }; else delete d[col][id]; });
        return send(res, 200, { ok: true });
      }
      // Open in Terminal: the command is built here from the to-do, never taken from the request.
      if (req.method === 'POST' && p === '/api/hand') {
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
          try { startAutopilot(readData(), { thread, awayLive }); } catch {}
          const rows = mutate(d => startAutopilot(d, { thread, awayLive }));
          for (const r of rows) if (r.command && r.action !== 'busy') Object.assign(r, await launchRow(r));
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
      // ▶ Start: a Claude Code session on the line in a new Terminal window, with Remote Control on, so it
      // shows in the Claude app on the phone. Built from the line or to-do id like Open in Terminal; a line
      // that already has a session running gets none, the person is pointed at that one instead.
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
      if (req.method === 'POST' && p === '/api/update') { spawn(process.execPath, [CLI, 'update'], { detached: true, stdio: 'ignore' }).unref(); return send(res, 200, { ok: true }); }
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
      // and noted on the project's first line (the plaque counts them; Autopilot finds their records from there).
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
          const th = Object.values(d.threads).filter(t => t.group === group).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
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
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      port = server.address().port;
      // Where it runs, so trace-canvas update can restart it on the same port.
      try { fs.writeFileSync(path.join(home(), 'server.json'), JSON.stringify({ pid: process.pid, port })); } catch {}
      // With phone access on, a second listener on the Tailscale address (never 0.0.0.0 unless set).
      const phone = readConfig().phone;
      if (!phone || !phone.bind) return resolve({ server, url: `http://localhost:${port}/`, ai });
      const phoneServer = http.createServer(handle(true));
      phoneServer.once('error', e => { console.error(`Phone access: could not listen on ${phone.bind} (${e.code}); is Tailscale on?`); resolve({ server, url: `http://localhost:${port}/`, ai }); });
      phoneServer.listen(phone.port ?? port, phone.bind, () => resolve({ server, phoneServer, url: `http://localhost:${port}/`, ai, phone: phoneUrl(phone, phoneServer.address().port) }));
    });
  });
}
