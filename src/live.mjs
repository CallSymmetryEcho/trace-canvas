// Live sessions: which Claude Code sessions are running right now, what each one is doing,
// and whether it is waiting for you. One small file per session in <data dir>/live/, written
// by the hooks without the data lock (it is status, not history) and read by the server.
import fs from 'node:fs';
import path from 'node:path';
import { home } from './store.mjs';
import { cleanPrompt, firstLine, headline } from './git-events.mjs';

export const liveDir = env => path.join(home(env), 'live');
const fileOf = (sid, env) => path.join(liveDir(env), String(sid).replace(/[^\w.-]/g, '_') + '.json');
// ponytail: a session silent this long counts as gone (killed without SessionEnd); a heartbeat is the upgrade.
export const STALE_MS = 12 * 3600e3;
const RANK = { waiting: 0, working: 1, idle: 2 };
// Tools that stop and wait for the person, so the session needs you while they run.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function readLive(sid, env) {
  try { return JSON.parse(fs.readFileSync(fileOf(sid, env), 'utf8')); } catch { return null; }
}
function writeLive(doc, env) {
  fs.mkdirSync(liveDir(env), { recursive: true });
  const f = fileOf(doc.id, env);
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, f);
}
export function dropLive(sid, env) { try { fs.unlinkSync(fileOf(sid, env)); } catch {} }

// Running sessions, the ones that need you first, then the busiest.
export function listLive(env, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(liveDir(env)).filter(n => n.endsWith('.json')); } catch {}
  return names.map(n => { try { return JSON.parse(fs.readFileSync(path.join(liveDir(env), n), 'utf8')); } catch { return null; } })
    .filter(s => s && s.id && now - (s.lastSeen || 0) < STALE_MS)
    .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || b.lastSeen - a.lastSeen);
}

// A short line for what a tool call is doing: "Edit hook.mjs", "$ npm test", "Agent: find callers".
// MCP tools show their own name: mcp__Claude_Browser__navigate becomes "navigate".
export function activityOf(rawTool, input = {}) {
  const tool = String(rawTool || '').replace(/^mcp__.+?__/, '');
  const f = input.file_path || input.notebook_path;
  if (f) return `${tool} ${path.basename(String(f))}`;
  if (tool === 'Bash') return `$ ${firstLine(input.command, 80)}`;
  const what = input.description || input.pattern || input.url || input.query || input.prompt;
  return what ? `${tool}: ${firstLine(what, 80)}` : tool;
}

/**
 * Updates the live file for one hook event and returns it (null once the session ended).
 * working while Claude acts, waiting when it needs you, idle when its turn is done.
 * info and key come from the hook (repository, branch, thread key) when it computed them.
 */
export function updateLive(input, { info = null, key = null, env = process.env, now = Date.now() } = {}) {
  const ev = input.hook_event_name, sid = input.session_id;
  if (!sid) return null;
  if (ev === 'SessionEnd') { dropLive(sid, env); return null; }
  const prev = readLive(sid, env) || { id: sid, agent: 'Claude Code', startedAt: now, status: 'idle', activity: '', ts: 0 };
  const doc = { ...prev, lastSeen: now, cwd: input.cwd || prev.cwd || '', transcript: input.transcript_path || prev.transcript || '' };
  if (info) Object.assign(doc, { repo: info.repo, branch: info.branch, root: info.root });
  if (key) doc.key = key;
  if (input.session_title) doc.title = String(input.session_title).slice(0, 120);
  if (input.model) doc.model = String(input.model);

  let status = null, activity = null;
  if (ev === 'SessionStart') status = 'idle';
  else if (ev === 'UserPromptSubmit') {
    status = 'working';
    const p = cleanPrompt(input.prompt);
    if (p) { activity = firstLine(p, 120); if (!p.startsWith('/')) doc.prompt = activity; }
  } else if (ev === 'PreToolUse') {
    status = ASKS.has(input.tool_name) ? 'waiting' : 'working';
    activity = activityOf(input.tool_name, input.tool_input || {});
  } else if (ev === 'PostToolUse') status = 'working';
  else if (ev === 'Notification') {
    // permission prompts and MCP questions need you; idle_prompt and auth_success change nothing.
    if (input.notification_type === 'permission_prompt' || input.notification_type === 'elicitation_dialog') {
      status = 'waiting';
      activity = firstLine(input.message, 120);
    }
  } else if (ev === 'Stop') { status = 'idle'; activity = headline(input.last_assistant_message || '') || ''; }

  // Async hooks of one session can finish out of order; an older event never replaces a newer status.
  if (status && now >= (prev.ts || 0)) { doc.status = status; doc.ts = now; if (activity !== null) doc.activity = activity; }
  writeLive(doc, env);
  return doc;
}
