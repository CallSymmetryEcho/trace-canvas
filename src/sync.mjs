// Syncs the canvas between machines through the location-map repository (~/agent-map). Each machine
// writes only its own canvas/<machine>.jsonl: a snapshot of every document with the time it last
// changed, deletions as tombstones. Syncing reads the other machines' files and takes, per document,
// whatever changed last. Session prompts go out as titles only, and public IPs and secret-looking
// text are blanked, so the files pass the map repository's pre-commit scan.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { COLS, canonicalize, dataFile, home, mutate, readConfig } from './store.mjs';

const KINDS = [...COLS, 'sessions'];
const RED = '[redacted]';

// JSON with sorted keys, so the same document always gives the same line.
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// Mirrors tools/where.py's leak scan (public IPv4, secret-like text), which the map repository's
// pre-commit hook runs on these files. A value after "token:" goes with its colon, or the scan still matches.
// The ranges Python's ipaddress calls private (100.64/10, used by Tailscale, is not among them).
const PRIVATE = ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/29', '192.0.0.170/31', '192.0.2.0/24',
  '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '240.0.0.0/4', '255.255.255.255/32'];
const num = ip => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);
function isPrivate(ip) {
  if (ip.split('.').some(x => Number(x) > 255)) return true; // not an address; where.py skips these too
  return PRIVATE.some(c => { const [net, bits] = c.split('/'), size = 2 ** (32 - Number(bits)); return Math.floor(num(ip) / size) === Math.floor(num(net) / size); });
}
export function redact(s) {
  return String(s)
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ip => (isPrivate(ip) ? ip : RED))
    .replace(/(password|passwd|token|api[_-]?key|secret)["']?\s*[:=]\s*\S+/gi, (_, k) => `${k} ${RED}`)
    .replace(/(ghp_|github_pat_|gho_|xox[bp]-)\S*|sk-[A-Za-z0-9]{16}\S*|AKIA[0-9A-Z]{12}\S*|-----BEGIN[^\n]*/gi, RED);
}
const deep = v => (typeof v === 'string' ? redact(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);

// What leaves this machine: a session's first prompt as its title only, then everything blanked.
const STRIPPED = c => c.kind === 'task' && c.actor === 'human' && c.session;
function exportDoc(k, doc) {
  const d = k === 'commits' && STRIPPED(doc) ? { ...doc, body: '' } : doc;
  return deep(d);
}

function readFile(file) {
  const docs = new Map();
  let head = null;
  if (!fs.existsSync(file)) return { head, docs };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.k === 'machine') head = j;
    else if (KINDS.includes(j.k) && j.id) docs.set(`${j.k}/${j.id}`, { ...j, h: j.del ? 'del' : canonical(j.doc) });
  }
  return { head, docs };
}

/**
 * Merges the other machines' files into d and returns the text of this machine's file. Per document:
 * changed here since this machine's last file → now; else a newer version from another machine is
 * taken with its own time (so it is not stamped again here); else it stays as it was.
 */
export function syncDocs(d, { dir, machine, host = os.hostname(), now = Date.now() }) {
  const moved = canonicalize(d);
  for (const k of KINDS) d[k] = d[k] || {};
  const own = readFile(path.join(dir, `${machine}.jsonl`)).docs;
  const theirs = new Map(); // newest version from any other machine
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl') && f !== `${machine}.jsonl`).sort() : []) {
    const m = f.slice(0, -6);
    for (const [key, v] of readFile(path.join(dir, f)).docs) {
      const cur = theirs.get(key);
      if (!cur || v.t > cur.t || (v.t === cur.t && m > cur.m)) theirs.set(key, { ...v, m });
    }
  }
  const local = new Map();
  for (const k of KINDS) for (const [id, doc] of Object.entries(d[k])) { const x = exportDoc(k, doc); local.set(`${k}/${id}`, { k, id, doc: x, h: canonical(x) }); }

  const out = [];
  let imported = 0, changed = 0;
  for (const key of new Set([...local.keys(), ...own.keys(), ...theirs.keys()])) {
    const L = local.get(key), O = own.get(key), R = theirs.get(key);
    const [k, id] = [key.slice(0, key.indexOf('/')), key.slice(key.indexOf('/') + 1)];
    const here = L ? !O || O.h !== L.h : O && !O.del; // created, edited or deleted here since the last file
    if (here && !(R && R.t > now)) {
      changed++;
      out.push(L ? { k, id, t: now, doc: L.doc } : { k, id, t: now, del: true });
      continue;
    }
    if (R && (!O || R.t > O.t || (R.t === O.t && R.m > machine && R.h !== O.h)) && R.h !== (L ? L.h : 'del')) {
      imported++;
      if (R.del) delete d[k][id];
      // A first prompt keeps its full text here; only its title travelled.
      else d[k][id] = k === 'commits' && d[k][id] && STRIPPED(R.doc) ? { ...R.doc, body: d[k][id].body } : R.doc;
      out.push(R.del ? { k, id, t: R.t, del: true } : { k, id, t: R.t, doc: R.doc });
      continue;
    }
    if (O) out.push(O.del ? { k, id, t: O.t, del: true } : { k, id, t: O.t, doc: O.doc });
    else if (R) out.push(R.del ? { k, id, t: R.t, del: true } : { k, id, t: R.t, doc: R.doc });
  }
  out.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const text = [canonical({ k: 'machine', id: machine, host }), ...out.map(x => canonical(x.del ? { del: true, id: x.id, k: x.k, t: x.t } : { doc: x.doc, id: x.id, k: x.k, t: x.t }))].join('\n') + '\n';
  return { text, imported, changed, moved };
}

function git(cwd, args, timeout = 20000) {
  try { return { ok: true, out: execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, out: String((e.stderr || '') + (e.stdout || '') || e.message).trim() }; }
}

/** The machine whose file this is, if another host already writes it; setup refuses that name. */
export function machineOwner(mapDir, machine) {
  const { head } = readFile(path.join(mapDir, 'canvas', `${machine}.jsonl`));
  return head && head.host && head.host !== os.hostname() ? head.host : null;
}

/**
 * Pull, merge, write this machine's file, commit only that file, push (once more after a rejected
 * push). Offline is a result, not an error: the merge still happens and the commit waits for the
 * next sync. Never throws; one sync at a time per data folder.
 */
export function runSync(env = process.env) {
  const cfg = readConfig(env), mapDir = cfg.map, machine = cfg.machine;
  if (!mapDir || !fs.existsSync(path.join(mapDir, '.git'))) return { error: 'No location map repository (setup --map, or clone it to ~/agent-map)' };
  const lock = path.join(home(env), '.sync-lock');
  try { fs.mkdirSync(lock); } catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs < 120000) return { busy: true }; } catch {}
  }
  try {
    const dir = path.join(mapDir, 'canvas'), file = path.join(dir, `${machine}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
    const pulled = git(mapDir, ['pull', '-q', '--rebase', '--autostash']);
    // Keep a copy before the first sync rewrites line ids.
    const bak = `${dataFile(env)}.before-first-sync`;
    if (!fs.existsSync(file) && fs.existsSync(dataFile(env)) && !fs.existsSync(bak)) fs.copyFileSync(dataFile(env), bak);
    let res;
    mutate(d => { res = syncDocs(d, { dir, machine }); return res.imported || res.moved ? undefined : false; }, env);
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (res.text !== before) fs.writeFileSync(file, res.text);
    let committed = false, pushed = false, error = null;
    if (git(mapDir, ['status', '--porcelain', '--', `canvas/${machine}.jsonl`]).out) {
      git(mapDir, ['add', '--', `canvas/${machine}.jsonl`]);
      const c = git(mapDir, ['commit', '-q', '-m', `canvas: ${machine}`, '--', `canvas/${machine}.jsonl`]);
      committed = c.ok;
      if (!c.ok) error = c.out.split('\n').slice(-3).join(' ');
    }
    if (!error && git(mapDir, ['rev-list', '--count', '@{u}..HEAD']).out !== '0') {
      pushed = git(mapDir, ['push', '-q']).ok || (git(mapDir, ['pull', '-q', '--rebase', '--autostash']).ok && git(mapDir, ['push', '-q']).ok);
    }
    fs.writeFileSync(path.join(home(env), '.sync-last'), String(Date.now()));
    return { machine, imported: res.imported, changed: res.changed, moved: res.moved, committed, pushed, offline: !pulled.ok, error };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally {
    try { fs.rmdirSync(lock); } catch {}
  }
}
