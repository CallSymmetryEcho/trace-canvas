// Other machines, over ssh (machine names are the ssh aliases): their running sessions, read with their own
// trace-canvas in their login shell. One shared connection per machine (ControlMaster), so polling stays cheap.
import { execFile, execFileSync } from 'node:child_process';
import { readConfig } from './store.mjs';
import { q } from './agents.mjs';

const ARGS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'ControlMaster=auto', '-o', 'ControlPath=/tmp/tc-ssh-%C', '-o', 'ControlPersist=120'];
const CMD = `exec "$SHELL" -lc 'trace-canvas live --json'`;
const parse = (machine, out) => {
  const sessions = JSON.parse(out);
  return { machine, sessions: sessions.map(s => ({ ...s, machine, away: true })) };
};

/** A machine's running sessions: { machine, sessions } or { machine, error }. */
export function remoteLive(machine) {
  return new Promise(resolve => execFile('ssh', [...ARGS, machine, CMD], { timeout: 12000, maxBuffer: 1 << 20 }, (err, out) => {
    try { if (err) throw err; resolve(parse(machine, out)); } catch (e) { resolve({ machine, sessions: [], error: String(e.message || e).split('\n')[0].slice(0, 160) }); }
  }));
}
export function remoteLiveSync(machine) {
  try { return parse(machine, execFileSync('ssh', [...ARGS, machine, CMD], { encoding: 'utf8', timeout: 12000, stdio: ['ignore', 'pipe', 'ignore'] })); }
  catch (e) { return { machine, sessions: [], error: String(e.message || e).split('\n')[0].slice(0, 160) }; }
}

/** The machines this canvas has heard of (its sessions and records say where they ran), other than this one. */
export function otherMachines(d, env = process.env) {
  const me = readConfig(env).machine, seen = new Set();
  for (const s of Object.values(d.sessions || {})) if (s.machine) seen.add(s.machine);
  for (const c of Object.values(d.commits)) if (c.machine) seen.add(c.machine);
  seen.delete(me);
  return [...seen].sort();
}

/** What the person typed in these sessions, read on that machine by its own trace-canvas (Retro): { prompts } or { error }. */
export function remotePrompts(machine, ids) {
  const cmd = `exec "$SHELL" -lc ${q(`trace-canvas prompts ${ids.map(q).join(' ')}`)}`;
  try { return { prompts: JSON.parse(execFileSync('ssh', [...ARGS, machine, cmd], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] })) }; }
  catch (e) {
    // An older trace-canvas there answers an unknown command with its help.
    if (/a transit map/.test(String(e.stdout || ''))) return { error: `trace-canvas there is older and cannot read them; update it on ${machine}` };
    return { error: String((e.stderr && String(e.stderr).trim()) || e.message || e).split('\n').filter(Boolean).pop().slice(0, 160) };
  }
}
