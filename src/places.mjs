// Where a project's folder is now and where copies of it are kept, so a file a record names still opens after the
// project moved (to a NAS, another disk) or its original was lost and a backup has it.
//
// A place is a decision record on a line, with `place`: { root, machine, role, path, on }:
//   root, machine  the project's folder as records name it, and the machine those paths are from
//   role           'moved' (the project is at `path` now) or 'backup' (a copy is kept at `path`)
//   path, on       the folder, and the machine on which that path is valid (a NAS has one path per machine)
// A copy keeps the project's layout: <path>/<the file's path inside the project>. Being records, places sync with the
// canvas, show on the line, and are taken back by deleting the record.
//
// Nothing here runs when the page loads. One file is looked for when it is opened; `trace-canvas backup-fix` checks
// whole lines. A place's folder is tried once before any file under it, with a timeout: a NAS that is not mounted or
// a cloud folder that hangs counts as out of reach, never as "the file is not there".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { INBOX, addCommit, readConfig, threadIdOf } from './store.mjs';

const home = p => String(p || '').replace(/^~(?=\/|$)/, os.homedir());
const under = (p, root) => p === root || p.startsWith(root.replace(/\/+$/, '') + '/');
export const ROLES = ['moved', 'backup'];

/** Every place on record, newest first; 'moved' before 'backup' (where the project is, then where copies are). */
export function placesOf(d) {
  return Object.values(d.commits || {}).filter(c => c.place && ROLES.includes(c.place.role) && c.place.root && c.place.path)
    .map(c => ({ ...c.place, at: c.ts, rec: c.id, thread: threadIdOf(d, c) }))
    .sort((a, b) => (a.role === b.role ? b.at - a.at : a.role === 'moved' ? -1 : 1));
}

// true: the folder is there; false: it is not; null: no answer in time (an unmounted share, a stalled cloud folder).
// ponytail: one `test -d` per place, remembered for a minute; stat in a worker if spawning ever shows up in a profile.
const seen = new Map();
export function reachable(dir, timeout = 2500) {
  const hit = seen.get(dir);
  if (hit && Date.now() - hit.at < 60000) return hit.ok;
  let ok;
  try { execFileSync('test', ['-d', dir], { timeout, stdio: 'ignore' }); ok = true; } catch (e) { ok = e.code === 'ETIMEDOUT' || e.signal ? null : false; }
  seen.set(dir, { ok, at: Date.now() });
  return ok;
}

/**
 * Where else on this machine the file `abs` (a full path, as machine `machine` names it) may be: one candidate per
 * place whose project holds it. [{ file, role, path, rec }].
 */
export function candidates(d, abs, machine, env = process.env) {
  const me = readConfig(env).machine || '', p = home(abs);
  return placesOf(d).filter(pl => (!pl.on || !me || pl.on === me) && (!pl.machine || !machine || pl.machine === machine) && under(p, home(pl.root)))
    .map(pl => ({ file: path.join(home(pl.path), path.relative(home(pl.root), p)), role: pl.role, path: pl.path, rec: pl.rec }));
}

/** The first candidate that is there: { file, role, path, rec }, or null; `out` collects the places out of reach. */
export function findCopy(d, abs, machine, env = process.env, out = []) {
  for (const c of candidates(d, abs, machine, env)) {
    const ok = reachable(home(c.path));
    if (ok === null) { if (!out.includes(c.path)) out.push(c.path); continue; }
    if (ok && fs.existsSync(c.file)) return c;
  }
  return null;
}

/** A line's project folder as its records name it: the folder the line keeps, else where its sessions here worked. */
export function projectRoot(d, th, env = process.env) {
  const note = String((th && th.note) || '').trim();
  if (/^\/\S*$/.test(note)) return note;
  const me = readConfig(env).machine || '';
  const onLine = x => th && x.thread === th.id, ofHere = x => !x.machine || !me || x.machine === me;
  const s = Object.values(d.sessions || {}).filter(x => onLine(x) && ofHere(x) && x.cwd).sort((a, b) => (b.last || 0) - (a.last || 0))[0];
  return s ? s.cwd : '';
}

/** Notes a place on a line (see the top of this file). Returns the record. */
export function addPlace(d, { thread, root, machine = '', role, dir, on = '', agent = '', lang = 'en' }) {
  if (!ROLES.includes(role)) throw new Error(`A place is one of: ${ROLES.join(', ')}`);
  if (!root || !path.isAbsolute(home(root))) throw new Error('Which project? Give its folder as a full path (--project)');
  if (!dir || !path.isAbsolute(home(dir))) throw new Error(`Give the ${role === 'moved' ? 'new' : 'backup'} folder as a full path`);
  const name = path.basename(root), zh = lang === 'zh';
  const title = role === 'moved'
    ? (zh ? `项目目录「${name}」搬到了 ${dir}` : `The project folder "${name}" moved to ${dir}`)
    : (zh ? `项目目录「${name}」在 ${dir} 有备份` : `The project folder "${name}" has a backup at ${dir}`);
  const body = [zh ? `原位置：${root}${machine ? `（${machine}）` : ''}` : `Was: ${root}${machine ? ` (${machine})` : ''}`,
    zh ? `${role === 'moved' ? '现在' : '备份'}：${dir}${on ? `（在 ${on} 上的路径）` : ''}` : `${role === 'moved' ? 'Now' : 'Backup'}: ${dir}${on ? ` (its path on ${on})` : ''}`,
    zh ? '文件按项目内的相对路径对应。删掉这条记录即撤销。' : 'Files match by their path inside the project. Delete this record to take it back.'].join('\n');
  const rec = addCommit(d, { thread: thread || INBOX, kind: 'decision', title, body, agent, extra: { place: { root, machine, role, path: dir, on } } });
  // A line that keeps the old folder as its own now keeps the new one (new sessions start there).
  if (role === 'moved') for (const t of Object.values(d.threads || {})) if (String(t.note || '').trim() === root && (!on || on === machine || !machine) && fs.existsSync(home(dir))) t.note = dir;
  return rec;
}

// Paths a record names that are files of the project: its links that are paths and the files it changed. Conversations
// (~/.claude, ~/.codex) and the canvas's own data are not project files.
const NOT_PROJECT = /\/\.(claude|codex|gemini|trace-canvas)\/|^\/(private\/)?tmp\/claude-\d+\//; // nor are an agent's scratch files (Claude Code's scratchpad under /tmp)
function pathsOf(d, c) {
  const out = (c.links || []).map(l => String(l).trim()).filter(l => /^[/~]/.test(l) && !/\s/.test(l));
  // A changed file is listed from the root its record keeps. An older record kept none (its files were listed from the
  // repository's root, which is not always the session's folder): those cannot be placed, so they are not judged.
  for (const f of c.files || []) if (path.isAbsolute(f)) out.push(f); else if (c.root) out.push(path.posix.join(c.root, f));
  // Under another person's or machine's home folder (/Users/ann on a Linux machine): written elsewhere, whatever the
  // record says about its machine (older records say nothing).
  const mine = p => { const h = (/^\/(?:Users|home)\/[^/]+/.exec(p) || [])[0]; return !h || h === os.homedir(); };
  return [...new Set(out.map(home))].filter(p => !NOT_PROJECT.test(p) && mine(p));
}

/**
 * The files this machine's records name, on the given lines (all when none): which are missing here, and where a copy
 * is. { items: [{ file, thread, rec, copy: { file, role, path } | null }], missing, total, unreachable: [paths] }.
 * A file whose project moved and is at the new place is not missing: it opens from there.
 */
export function checkFiles(d, tids = null, env = process.env) {
  const me = readConfig(env).machine || '', items = [], unreachable = [], done = new Set();
  let total = 0;
  for (const c of Object.values(d.commits || {})) {
    const tid = threadIdOf(d, c), s = (d.sessions || {})[c.session], machine = c.machine || (s && s.machine) || '';
    if ((tids && !tids.includes(tid)) || (machine && me && machine !== me)) continue;
    for (const file of pathsOf(d, c)) {
      if (done.has(file)) continue;
      done.add(file); total++;
      if (fs.existsSync(file)) continue;
      const copy = findCopy(d, file, machine || me, env, unreachable);
      if (copy && copy.role === 'moved') continue;
      items.push({ file, thread: tid, rec: c.id, copy });
    }
  }
  return { items, missing: items.length, total, unreachable };
}

/**
 * Copies each missing file back from its backup. Never overwrites, moves or deletes: a file that is there by now is
 * skipped. Returns { restored: [files], skipped: [files], failed: [{ file, error }] }.
 */
export function restoreFiles(items) {
  const restored = [], skipped = [], failed = [];
  for (const it of items) {
    if (!it.copy || it.copy.role !== 'backup') continue;
    try {
      fs.mkdirSync(path.dirname(it.file), { recursive: true });
      fs.cpSync(it.copy.file, it.file, { recursive: true, errorOnExist: true, force: false });
      restored.push(it.file);
    } catch (e) { if (e.code === 'EEXIST' || e.code === 'ERR_FS_CP_EEXIST') skipped.push(it.file); else failed.push({ file: it.file, error: e.code || e.message }); }
  }
  return { restored, skipped, failed };
}

/** Projects of this machine's open lines with no backup on record: [{ root, lines: [names] }]. Reads records only. */
export function unbackedProjects(d, env = process.env) {
  const backed = placesOf(d).filter(p => p.role === 'backup').map(p => home(p.root)), by = new Map();
  for (const th of Object.values(d.threads || {})) {
    if (th.archived || th.status === 'merged' || th.status === 'done') continue;
    const root = projectRoot(d, th, env);
    if (!root || root === os.homedir() || backed.some(b => under(home(root), b))) continue;
    by.set(root, [...(by.get(root) || []), th.name]);
  }
  return [...by].map(([root, lines]) => ({ root, lines }));
}
