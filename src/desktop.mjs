// Which session started which, from the Claude desktop app's own session records
// (~/Library/Application Support/Claude/claude-code-sessions/<…>/<…>/local_<id>.json).
// Read-only and best-effort: the format is the app's, not a public API, so anything
// unexpected means "no links", never an error. Without the desktop app this returns nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const desktopDir = env => env.TRACE_CANVAS_DESKTOP_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const cache = new Map(); // file -> { mtime, rec }

function records(dir) {
  const out = [];
  const walk = (d, depth) => {
    let names = [];
    try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n.name);
      if (n.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (n.isFile() && /^local_.*\.json$/.test(n.name)) out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

/**
 * Desktop sessions keyed by their Claude Code session id (cliSessionId):
 * { desktopId, title, parent (the parent's Claude Code session id, if known), archived }.
 */
export function desktopSessions(env = process.env) {
  const files = records(desktopDir(env));
  const byDesktop = new Map();
  for (const f of files) {
    let mtime = 0;
    try { mtime = fs.statSync(f).mtimeMs; } catch { continue; }
    let hit = cache.get(f);
    if (!hit || hit.mtime !== mtime) {
      let rec = null;
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (d.sessionId && d.cliSessionId) rec = { desktopId: d.sessionId, cli: d.cliSessionId, title: String(d.title || ''), parentDesktop: d.spawnedFrom && d.spawnedFrom.sessionId || null, archived: !!d.isArchived };
      } catch {}
      hit = { mtime, rec };
      cache.set(f, hit);
    }
    if (hit.rec) byDesktop.set(hit.rec.desktopId, hit.rec);
  }
  const byCli = new Map();
  for (const r of byDesktop.values()) {
    const parent = r.parentDesktop && byDesktop.get(r.parentDesktop);
    byCli.set(r.cli, { desktopId: r.desktopId, title: r.title, parent: parent ? parent.cli : null, archived: r.archived });
  }
  return byCli;
}
