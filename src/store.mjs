// File-backed store shared by the local server, the CLI and the Claude Code hooks.
// Everything lives in one JSON file guarded by a directory lock, so concurrent
// hook processes from parallel sessions never clobber each other.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const COLS = ['threads', 'commits', 'edges'];
export const INBOX = 'inbox';
export const KINDS = ['idea', 'task', 'agent', 'decision', 'note', 'fork', 'merge'];
export const LINE_COLORS = ['#E4002B', '#0072CE', '#00A651', '#F29F05', '#8E3A96', '#00A0B0', '#A0522D', '#E5007E', '#5B6B7F', '#6CA425'];

export function home(env = process.env) {
  return env.TRACE_CANVAS_HOME || path.join(os.homedir(), '.trace-canvas');
}
export const dataFile = env => path.join(home(env), 'data.json');
const lockDir = env => path.join(home(env), '.lock');
const configFile = env => path.join(home(env), 'config.json');

export const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// Stable ids: the same session captured twice, or the same repository's line on two machines, gets one id.
export function hashId(prefix, s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return prefix + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// sessions: the line each agent session stays on (see hook.mjs). Not a document collection: only the
// hooks and the bind tools write it.
export function emptyData() { return { version: 1, threads: {}, commits: {}, edges: {}, sessions: {} }; }

export function readData(env) {
  try {
    const d = JSON.parse(fs.readFileSync(dataFile(env), 'utf8'));
    for (const c of [...COLS, 'sessions']) if (!d[c] || typeof d[c] !== 'object' || Array.isArray(d[c])) d[c] = {};
    return d;
  } catch {
    return emptyData();
  }
}

function writeData(d, env) {
  const file = dataFile(env);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d));
  fs.renameSync(tmp, file);
}

export function withLock(fn, env) {
  fs.mkdirSync(home(env), { recursive: true });
  const dir = lockDir(env);
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(dir); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(dir).mtimeMs > 5000; } catch {}
      if (stale || Date.now() - start > 4000) { try { fs.rmdirSync(dir); } catch {} continue; }
      sleepSync(10);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(dir); } catch {} }
}

// Runs fn(data) under the lock. fn returns false to skip the write. While it runs, new records and
// lines are stamped with the machine of env's data folder.
let current = process.env;
export function mutate(fn, env) {
  return withLock(() => {
    const d = readData(env), prev = current;
    current = env || process.env;
    try {
      const r = fn(d);
      if (r !== false) writeData(d, env);
      return r;
    } finally { current = prev; }
  }, env);
}

export function readConfig(env = process.env) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(configFile(env), 'utf8')); } catch {}
  return {
    lang: env.TRACE_CANVAS_LANG || file.lang || 'en',
    group: env.TRACE_CANVAS_GROUP || file.group || 'branch',
    prompts: env.TRACE_CANVAS_PROMPTS || file.prompts || 'first',
    turns: env.TRACE_CANVAS_TURNS || file.turns || 'changes',
    // The location map (key_locations.yaml + tools/where.py); ~/agent-map when it exists.
    map: env.TRACE_CANVAS_MAP || file.map || (fs.existsSync(path.join(os.homedir(), 'agent-map', 'tools', 'where.py')) ? path.join(os.homedir(), 'agent-map') : ''),
    // Which computer this is, as the location map names it (setup --machine); records and sessions carry it.
    machine: env.TRACE_CANVAS_MACHINE || file.machine || os.hostname().split('.')[0].toLowerCase(),
    // Phone access (trace-canvas phone): { host, ip, bind, port?, token }, or null when off.
    phone: file.phone || null,
    // The live bar also shows other machines' running sessions, read over ssh (More → Other machines' sessions).
    awayLive: !!file.awayLive,
  };
}
const machines = new Map(); // data folder → machine name; ponytail: read once per process
export function machineName(env = process.env) {
  const h = home(env);
  if (!machines.has(h)) machines.set(h, readConfig(env).machine);
  return machines.get(h);
}
export function writeConfig(patch, env) {
  fs.mkdirSync(home(env), { recursive: true });
  let file = {};
  try { file = JSON.parse(fs.readFileSync(configFile(env), 'utf8')); } catch {}
  fs.writeFileSync(configFile(env), JSON.stringify({ ...file, ...patch }, null, 2));
}

export function toArrays(d) {
  return { threads: Object.values(d.threads), commits: Object.values(d.commits), edges: Object.values(d.edges) };
}

export function threadIdOf(d, c) { return c && c.thread && d.threads[c.thread] ? c.thread : INBOX; }

// A line by id or by key. A combine leaves the folded lines' ids and keys on the line that kept
// their records (aliases), so bindings and folders that pointed at them still find it.
const aliased = (d, ref) => Object.values(d.threads).find(t => (t.aliases || []).includes(ref)) || null;
export const threadById = (d, id) => (id && (d.threads[id] || aliased(d, id))) || null;
export const threadByKey = (d, key) => (key && (Object.values(d.threads).find(t => t.key === key) || aliased(d, key))) || null;
// The line that keeps a combine's records takes the first key if it had none; the folded lines'
// ids and other keys become its aliases. app/index.html does the same in mergeMany.
export function absorb(target, gone) {
  const keys = gone.map(g => g.key).filter(Boolean);
  if (!target.key && keys.length) target.key = keys.shift();
  target.aliases = [...new Set([...(target.aliases || []), ...keys, ...gone.flatMap(g => [g.id, ...(g.aliases || [])])])];
}

// Points everything that refers to line `from` at line `to`.
function retarget(d, from, to) {
  for (const c of Object.values(d.commits)) { if (c.thread === from) c.thread = to; if (c.mergeOf === from) c.mergeOf = to; }
  for (const t of Object.values(d.threads)) { if (t.parent === from) t.parent = to; if (t.mergedInto === from) t.mergedInto = to; }
  for (const e of Object.values(d.edges)) { if (e.from === from) e.from = to; if (e.to === from) e.to = to; if (e.from === e.to) delete d.edges[e.id]; }
  for (const s of Object.values(d.sessions || {})) if (s.thread === from) s.thread = to;
}
/**
 * Gives every line with a key the id hashId('t', key), so the same repository's line made on two
 * machines is one line once they sync. The old id stays as an alias. If that id is taken already
 * (the other machine's copy arrived first), the two are folded into one. Returns how many moved.
 */
export function canonicalize(d) {
  let n = 0;
  for (const t of Object.values(d.threads)) {
    const want = t.key ? hashId('t', t.key) : null;
    if (!want || t.id === want) continue;
    const old = t.id, there = d.threads[want];
    delete d.threads[old];
    if (there) absorb(there, [t]); else d.threads[want] = { ...t, id: want, aliases: [...new Set([...(t.aliases || []), old])] };
    retarget(d, old, want);
    n++;
  }
  return n;
}

export function lastCommit(d, tid) {
  let best = null;
  for (const c of Object.values(d.commits)) if (threadIdOf(d, c) === tid && (!best || c.ts > best.ts)) best = c;
  return best;
}

export function findThreadByName(d, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  if (n === INBOX || n === '收件箱') return INBOX;
  if (d.threads[name]) return name;
  for (const t of Object.values(d.threads)) if ((t.name || '').trim().toLowerCase() === n) return t.id;
  return null;
}

// Same placement rule as the page: inbox sits at (0,0), threads fill columns to its right.
function freeSpot(d, near) {
  const pts = Object.values(d.threads).map(t => [t.x || 0, t.y || 0]).concat([[0, 0]]);
  const free = (x, y) => pts.every(([px, py]) => Math.abs(px - x) > 220 || Math.abs(py - y) > 170);
  if (near) {
    for (let k = 0; k < 14; k++) {
      const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 190;
      const x = (near.x || 0) + 300, y = (near.y || 0) + dy;
      if (free(x, y)) return { x, y };
    }
  }
  for (let r = 0; r < 200; r++) for (let c = 1; c <= 4; c++) { const x = c * 300, y = r * 250; if (free(x, y)) return { x, y }; }
  return { x: 300, y: pts.length * 250 };
}

export function createThread(d, { id, name, key = null, parent = null, forkOf = null, note = '', extra = {} }) {
  const used = new Set(Object.values(d.threads).map(t => t.color));
  const color = LINE_COLORS.find(c => !used.has(c)) || LINE_COLORS[Object.keys(d.threads).length % LINE_COLORS.length];
  const near = parent && d.threads[parent] ? d.threads[parent] : null;
  const pos = freeSpot(d, near);
  const t = { id: id || uid('t'), name: String(name || 'Thread').slice(0, 120), color, status: 'active', createdAt: Date.now(), parent, forkOf, mergedInto: null, x: pos.x, y: pos.y, note, ...(key ? { key } : {}), machine: machineName(current), ...extra };
  d.threads[t.id] = t;
  return t;
}

export function ensureThread(d, name) {
  const t = threadById(d, name); // an id, also one a line had before it got a stable one
  return t ? t.id : findThreadByName(d, name) || createThread(d, { name: String(name).trim() }).id;
}

export function addCommit(d, { thread, kind = 'idea', title, body = '', links = [], agent = '', ts = Date.now(), parents, extra = {} }) {
  const tid = thread === INBOX ? INBOX : (threadById(d, thread) || { id: INBOX }).id;
  const prev = lastCommit(d, tid);
  const c = {
    id: uid('c'), thread: tid, kind: KINDS.includes(kind) ? kind : 'agent',
    title: String(title || '').slice(0, 500), body: String(body || '').slice(0, 8000),
    links: (links || []).map(String).slice(0, 20), agent: String(agent || ''), ts,
    parents: parents || (prev ? [prev.id] : []), done: false, machine: machineName(current), ...extra,
  };
  d.commits[c.id] = c;
  const t = d.threads[tid];
  if (t && t.status === 'parked' && kind !== 'merge') t.status = 'active';
  return c;
}

export function parseTs(v) {
  if (typeof v === 'number' && isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') { const t = Date.parse(v); if (!isNaN(t)) return t; }
  return Date.now();
}

// Accepts a full export ({threads, commits, edges}) or agent records
// (one JSON object, an array of them, or JSON lines).
export function importText(d, text, { defaultThread = INBOX } = {}) {
  text = String(text || '').trim();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  const validId = id => typeof id === 'string' && /^[\w\-.~:@+]{1,180}$/.test(id);
  if (data && !Array.isArray(data) && typeof data === 'object' && (Array.isArray(data.threads) || Array.isArray(data.commits))) {
    let n = 0;
    for (const col of COLS) for (const doc of data[col] || []) if (doc && validId(doc.id)) { d[col][doc.id] = { ...doc }; n++; }
    return n;
  }
  let recs;
  if (Array.isArray(data)) recs = data;
  else if (data && typeof data === 'object') recs = [data];
  else recs = text.split('\n').map(l => { const s = l.trim().replace(/,$/, ''); if (!s.startsWith('{')) return null; try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  let n = 0;
  for (const r of recs) {
    if (!r || typeof r !== 'object') continue;
    const title = String(r.title || r.summary || r.text || '').trim();
    if (!title) continue;
    addCommit(d, {
      thread: r.thread ? ensureThread(d, String(r.thread)) : defaultThread,
      kind: ['idea', 'task', 'agent', 'decision', 'note'].includes(r.kind) ? r.kind : 'agent',
      title,
      body: typeof r.body === 'string' ? r.body : (r.body ? JSON.stringify(r.body) : ''),
      links: Array.isArray(r.links) ? r.links : (r.link ? [r.link] : []),
      agent: r.agent || '', ts: parseTs(r.ts),
    });
    n++;
  }
  return n;
}

// A thread's goal has its own field. Older data kept it in `note`, which also holds system notes
// (the repository path hooks stored, "Combined from …" after a combine); those lines are not a goal.
const SYSTEM_NOTE = /^(\/|~\/)\S*$|^(\/|~\/).*\/.*$|^Combined from |^由 .+ 合并而来$/;
export const goalOf = th => {
  if (!th) return '';
  if (th.goal != null) return String(th.goal).trim();
  return String(th.note || '').split('\n').map(l => l.trim()).filter(l => l && !SYSTEM_NOTE.test(l)).join('\n');
};
