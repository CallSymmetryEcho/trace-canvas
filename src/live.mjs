// Live sessions: which Claude Code sessions are running right now, what each one is doing,
// and whether it is waiting for you. One small file per session in <data dir>/live/, written
// by the hooks without the data lock (it is status, not history) and read by the server.
// Each subagent gets a file of its own (<session>.agent-<id>.json): parallel subagents start
// at the same moment, and separate files mean none of them overwrites another.
import fs from 'node:fs';
import path from 'node:path';
import { home } from './store.mjs';
import { cleanPrompt, firstLine, headline } from './git-events.mjs';

export const liveDir = env => path.join(home(env), 'live');
const safe = s => String(s).replace(/[^\w.-]/g, '_');
const fileOf = (sid, env) => path.join(liveDir(env), safe(sid) + '.json');
const agentFile = (sid, id, env) => path.join(liveDir(env), `${safe(sid)}.agent-${safe(id)}.json`);
// ponytail: the newest 20 subagents per session are shown; older ones drop off the live view.
const MAX_AGENTS = 20;
// ponytail: a session silent this long counts as gone (killed without SessionEnd); a heartbeat is the upgrade.
export const STALE_MS = 12 * 3600e3;
const RANK = { waiting: 0, working: 1, idle: 2 };
// Tools that stop and wait for the person, so the session needs you while they run.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);

export function readLive(sid, env) { return readJson(fileOf(sid, env)); }
function writeJson(f, doc, env) {
  fs.mkdirSync(liveDir(env), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, f);
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export function dropLive(sid, env) {
  const pre = `${safe(sid)}.agent-`;
  let names = [];
  try { names = fs.readdirSync(liveDir(env)); } catch {}
  for (const n of names) if (n === `${safe(sid)}.json` || n.startsWith(pre)) { try { fs.unlinkSync(path.join(liveDir(env), n)); } catch {} }
}

// Running sessions, the ones that need you first, then the busiest. Each carries its subagents.
export function listLive(env, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(liveDir(env)).filter(n => n.endsWith('.json')); } catch {}
  const agents = new Map();
  for (const n of names.filter(n => n.includes('.agent-'))) {
    const a = readJson(path.join(liveDir(env), n));
    if (a && a.session && now - (a.lastSeen || 0) < STALE_MS) { if (!agents.has(a.session)) agents.set(a.session, []); agents.get(a.session).push(a); }
  }
  return names.filter(n => !n.includes('.agent-')).map(n => readJson(path.join(liveDir(env), n)))
    .filter(s => s && s.id && now - (s.lastSeen || 0) < STALE_MS)
    .map(s => ({ ...s, agents: (agents.get(s.id) || []).sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_AGENTS)
      // Claude Code writes the .meta.json just after SubagentStart, so a running subagent picks up its description here.
      .map(a => (a.description ? a : { ...a, description: metaOf(s.transcript, a.id).description || '' })) }))
    .sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || b.lastSeen - a.lastSeen);
}

// A subagent's files sit next to the session transcript: <session>/subagents/agent-<id>.{meta.json,jsonl}.
const subagentPath = (transcript, id, ext) => (transcript ? path.join(transcript.replace(/\.jsonl$/, ''), 'subagents', `agent-${id}.${ext}`) : '');
const metaOf = (transcript, id) => (transcript && readJson(subagentPath(transcript, id, 'meta.json'))) || {};

// A subagent's closing words, from the tail of its transcript: its last text reply, or the
// report it handed back with SubagentHandback (which leaves SubagentStop without a message).
export function lastWords(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size, n = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      let d;
      try { d = JSON.parse(line); } catch { continue; } // the first line of the tail may be cut
      const blocks = d.type === 'assistant' && d.message && Array.isArray(d.message.content) ? d.message.content : [];
      for (const b of [...blocks].reverse()) {
        if (b.type === 'text' && String(b.text || '').trim()) return b.text;
        if (b.type === 'tool_use' && b.name === 'SubagentHandback' && b.input && b.input.message) return String(b.input.message);
      }
    }
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return '';
}

// SubagentStart / SubagentStop: running, then done with the first sentence of its last message.
// The description and nesting depth come from the subagent's .meta.json next to the transcript.
function updateAgent(input, env, now) {
  const sid = input.session_id, id = String(input.agent_id || '');
  if (!id) return null;
  const f = agentFile(sid, id, env);
  const prev = readJson(f) || { id, session: sid, startedAt: now, status: 'running' };
  const t = input.transcript_path, meta = metaOf(t, id);
  const a = { ...prev, lastSeen: now, type: input.agent_type || prev.type || meta.agentType || '', description: prev.description || meta.description || '', depth: meta.spawnDepth || prev.depth || 1 };
  if (input.hook_event_name === 'SubagentStop') {
    a.status = 'done'; a.finishedAt = now;
    a.last = headline(input.last_assistant_message || '') || headline(lastWords(input.agent_transcript_path || subagentPath(t, id, 'jsonl'))) || prev.last || '';
  }
  else if (prev.status !== 'done') a.status = 'running'; // a late SubagentStart never reopens a finished one
  writeJson(f, a, env);
  return a;
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
export function updateLive(input, { info = null, key = null, env = process.env, now = Date.now(), agent = null, agentKey = null, resume = null, machine = null } = {}) {
  const ev = input.hook_event_name, sid = input.session_id;
  if (!sid) return null;
  if (ev === 'SessionEnd') { dropLive(sid, env); return null; }
  if (ev === 'SubagentStart' || ev === 'SubagentStop') return updateAgent(input, env, now);
  const prev = readLive(sid, env) || { id: sid, agent: 'Claude Code', startedAt: now, status: 'idle', activity: '', ts: 0 };
  const doc = { ...prev, lastSeen: now, cwd: input.cwd || prev.cwd || '', transcript: input.transcript_path || prev.transcript || '' };
  if (agent) Object.assign(doc, { agent, agentKey, resume });
  if (machine) doc.machine = machine;
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
  writeJson(fileOf(sid, env), doc, env);
  return doc;
}
