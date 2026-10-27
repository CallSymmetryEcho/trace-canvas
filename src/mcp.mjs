// Trace Canvas MCP server (stdio, newline-delimited JSON-RPC 2.0, no dependencies).
// Lets an agent put its session on the canvas, log moments, read threads and merge them.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, dataFile, ensureThread, importText, INBOX, mutate, readConfig, readData, threadById, threadIdOf } from './store.mjs';
import { whereFind } from './hook.mjs';
import { agentKey, agentOf } from './agents.mjs';
import { bindLiveSession, captureSession, forkThread, listTasks, listThreads, liveSessions, mergeDataset, mergeThreads, readThread, setTaskDone } from './ops.mjs';
import { currentSessionId, describeSession, findTranscript, findTranscripts, parseTranscript } from './transcript.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'bin', 'trace-canvas.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const projectDir = () => process.env.CLAUDE_PROJECT_DIR || process.cwd();
const port = () => Number(process.env.TRACE_CANVAS_PORT || 4777);

const INSTRUCTIONS = `Trace Canvas keeps a trace of parallel work as threads (like git branches) and records (like commits), shown as a canvas, a branch graph and a timeline.
Use trace_capture_session to put the current Claude Code session on the canvas; write 2-6 highlights (decisions, outcomes, next steps) and a short summary yourself, in the user's language.
Use trace_tasks at the start of work to read the goals and open to-dos of the thread you work on, and trace_task_done when you finish one, so the person can follow progress without asking. When the person gives a new goal, idea or next step, add it right away as a to-do: trace_log with kind "task" on the thread you work on.
Use trace_live to see which sessions are running now and whether one waits for the user; trace_bind puts a session on a thread.
Use trace_list_threads before trace_merge, and confirm with the user which threads to merge and how: "merge" keeps every line and draws merges; "combine" folds them into one line and removes the others.`;

const KIND = { type: 'string', enum: ['idea', 'task', 'agent', 'decision', 'note'] };
const TOOLS = [
  {
    name: 'trace_capture_session',
    title: 'Put a session on the canvas',
    description: 'Adds a Claude Code session to the Trace Canvas: its first instruction, turns that changed files, git commits, pushes and pull requests, plus the highlights and summary you pass. With no session_id it captures the session that is calling. Safe to call again: records already on the canvas are skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '2-3 sentences on what this session did and where it ended.' },
        highlights: { type: 'array', description: 'Key moments you write yourself: decisions, outcomes, open next steps.', items: { type: 'object', properties: { kind: KIND, title: { type: 'string' }, body: { type: 'string' }, links: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
        session_id: { type: 'string', description: 'Capture a past session instead of the current one (see trace_list_sessions).' },
        thread: { type: 'string', description: 'Thread id or name to put it on. A name that does not exist yet creates the thread.' },
        name: { type: 'string', description: 'A short name for the work (2-6 words). Used when the session gets its own line, and renames that line if it already exists.' },
        separate: { type: 'boolean', description: 'Give this session its own line, moving records the hooks already logged for it.' },
        detail: { type: 'string', enum: ['key', 'all'], description: '"key" (default): first instruction, turns that changed something, git moments, the last turn. "all": every turn.' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'trace_list_sessions',
    title: 'List Claude Code sessions',
    description: 'Lists recent Claude Code sessions of a project from their transcripts, newest first, and whether each is already on the canvas.',
    inputSchema: { type: 'object', properties: { project_dir: { type: 'string', description: 'Defaults to the current project.' }, limit: { type: 'number', description: 'Default 15.' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_list_threads',
    title: 'List threads',
    description: 'Lists the threads on the canvas with status, record count, last update and latest record. Pass query to find threads by name or record text.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, include_done: { type: 'boolean', description: 'Include done and merged threads (default true).' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_read_thread',
    title: 'Read a thread',
    description: 'Returns the records on one thread, oldest first, and the sessions on it (newest first) with the command that resumes each. To continue work on a line, resume its session rather than starting a new one.',
    inputSchema: { type: 'object', properties: { thread: { type: 'string', description: 'Thread id or name; "inbox" for the inbox.' }, limit: { type: 'number', description: 'Most recent records to return (default 50).' } }, required: ['thread'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_merge',
    title: 'Merge threads',
    description: 'Merges any number of threads (for example several sessions) into one. mode "merge" keeps every source line, marks it merged and draws the merge, like git. mode "combine" moves all records onto the target in time order and removes the source threads. target is an existing thread id or name; if it does not exist, a new thread with that name (or new_name) is created.',
    inputSchema: {
      type: 'object',
      properties: {
        sources: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Thread ids or names to merge.' },
        target: { type: 'string', description: 'Thread id or name to merge into.' },
        new_name: { type: 'string', description: 'Name for a new target thread when target is omitted.' },
        mode: { type: 'string', enum: ['merge', 'combine'], description: 'Default "merge".' },
      },
      required: ['sources'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'trace_log',
    title: 'Log one record',
    description: 'Adds one record to a thread (created if the name is new) or to the inbox.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, kind: KIND, thread: { type: 'string' }, body: { type: 'string' }, links: { type: 'array', items: { type: 'string' } }, agent: { type: 'string' }, assignee: { type: 'string', enum: ['claude', 'codex', 'gemini'], description: 'Hand this to-do to an agent (kind defaults to task).' } }, required: ['title'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'trace_import_data',
    title: 'Merge another data set',
    description: 'Merges another Trace Canvas data set into this one: an export file, data.json copied from another computer, or JSON lines from an agent. Threads with the same repository/branch or session key, or the same name, become one line; records already present are skipped.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File to read.' }, json: { type: 'string', description: 'Or the data itself.' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'trace_fork',
    title: 'Fork a thread',
    description: 'Starts a new thread that branches off an existing one, drawn as a fork in the Branches view. from is a record id, or a thread id or name (then it forks from that thread\'s newest record). bind: true also puts the calling session on the new thread, so its records land there.',
    inputSchema: { type: 'object', properties: { from: { type: 'string', description: 'Record id, or thread id or name.' }, name: { type: 'string', description: 'Name of the new thread.' }, bind: { type: 'boolean' }, session_id: { type: 'string', description: 'Session to bind instead of the calling one.' } }, required: ['from'] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'trace_tasks',
    title: 'Goals and to-dos',
    description: 'Returns the goal and the to-dos of each thread (or of one thread), with how many are done. Read it before working on a thread; tick to-dos with trace_task_done when they are finished.',
    inputSchema: { type: 'object', properties: { thread: { type: 'string', description: 'Thread id or name; omit for all threads (or the thread this session was handed).' }, include_done: { type: 'boolean', description: 'Also list finished to-dos (default false).' }, mine: { type: 'boolean', description: 'Only the to-dos assigned to you.' }, assignee: { type: 'string', enum: ['claude', 'codex', 'gemini'] } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_task_done',
    title: 'Tick a to-do',
    description: 'Marks a to-do as done (or open again with done: false) and records who ticked it. task is the id from trace_tasks, or its title.',
    inputSchema: { type: 'object', properties: { task: { type: 'string', description: 'Task id or title.' }, thread: { type: 'string', description: 'Thread to look in when task is a title.' }, done: { type: 'boolean', description: 'Default true.' }, agent: { type: 'string', description: 'Who ticked it. Default "Claude".' } }, required: ['task'] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'trace_live',
    title: 'Running sessions',
    description: 'Lists the Claude Code sessions running right now: status (working, waiting for the user, idle), what each is doing, its repository and branch, the thread it belongs to, the session that started it, and its subagents.',
    inputSchema: { type: 'object', properties: { project_dir: { type: 'string', description: 'Only sessions working in this folder.' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_bind',
    title: 'Put a session on a thread',
    description: 'Binds a running session to a thread, so the canvas shows it there and its records land on that line. With no session_id it binds the session that is calling. A thread name that does not exist yet creates the thread. unbind: true goes back to the repository/branch line.',
    inputSchema: { type: 'object', properties: { thread: { type: 'string', description: 'Thread id or name.' }, session_id: { type: 'string' }, unbind: { type: 'boolean' } } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'trace_open',
    title: 'Open the canvas',
    description: 'Starts the local Trace Canvas page if it is not running and returns its address. open_browser opens it in the default browser.',
    inputSchema: { type: 'object', properties: { open_browser: { type: 'boolean' }, view: { type: 'string', enum: ['canvas', 'git', 'timeline'] } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trace_where',
    title: 'Where things are',
    description: 'Looks things up in the location map (~/agent-map): repositories, data folders, NAS paths, and which machine has them where. Every word of query must match; machine (e.g. "mac", "bsuperstation") keeps only that computer\'s places.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, machine: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
  },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function healthy(url) {
  try { const r = await fetch(url + 'api/health', { signal: AbortSignal.timeout(800) }); return r.ok; } catch { return false; }
}
async function ensureServer() {
  const url = `http://localhost:${port()}/`;
  if (await healthy(url)) return { url, started: false };
  spawn(process.execPath, [CLI, 'serve', '--no-open', '--port', String(port())], { detached: true, stdio: 'ignore', env: process.env }).unref();
  for (let i = 0; i < 40; i++) { await sleep(150); if (await healthy(url)) return { url, started: true }; }
  throw new Error(`The page did not start on port ${port()}. Run: node "${CLI}" serve`);
}
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
const pageUrl = async () => { const url = `http://localhost:${port()}/`; return (await healthy(url)) ? url : null; };

async function callTool(name, a = {}) {
  switch (name) {
    case 'trace_capture_session': {
      const sid = currentSessionId({ sessionId: a.session_id, projectDir: projectDir() });
      const file = sid ? findTranscript({ sessionId: sid, projectDir: projectDir() }) : null;
      if (a.session_id && !file) throw new Error(`No transcript found for session ${a.session_id}`);
      const parsed = file ? parseTranscript(file) : null;
      const r = mutate(d => captureSession(d, parsed, {
        sessionId: sid || (parsed && parsed.sessionId), thread: a.thread, name: a.name, separate: !!a.separate,
        summary: a.summary, highlights: Array.isArray(a.highlights) ? a.highlights : [], detail: a.detail === 'all' ? 'all' : 'key',
      }));
      const url = `http://localhost:${port()}/`;
      const running = !!(await pageUrl());
      return {
        text: `Added ${r.added} record${r.added === 1 ? '' : 's'} to "${r.thread.name}"${r.skipped ? ` (${r.skipped} already there)` : ''}. ${running ? `The page is open at ${url}` : `The page is not running; trace_open starts it at ${url}`}.`,
        data: { thread: { id: r.thread.id, name: r.thread.name }, added: r.added, skipped: r.skipped, sessionId: r.sessionId, transcript: file || null, url, pageRunning: running },
      };
    }
    case 'trace_list_sessions': {
      const dir = a.project_dir || projectDir();
      const files = findTranscripts(dir).slice(0, Math.max(1, Math.min(50, Number(a.limit) || 15)));
      const d = readData();
      const onCanvas = new Map();
      for (const c of Object.values(d.commits)) if (c.session && !onCanvas.has(c.session)) onCanvas.set(c.session, d.threads[c.thread] ? d.threads[c.thread].name : 'Inbox');
      const sessions = files.map((f, i) => {
        const s = describeSession(f.path);
        return { sessionId: s.sessionId, current: i === 0, title: s.title, started: s.startedAt ? new Date(s.startedAt).toISOString() : null, lastActivity: s.lastActivity ? new Date(s.lastActivity).toISOString() : null, prompts: s.prompts, filesChanged: s.filesChanged, commits: s.commits, branch: s.branch, onCanvas: onCanvas.get(s.sessionId) || null };
      });
      return { text: sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} in ${dir}. The first is the newest (usually the current one).` : `No Claude Code transcripts found for ${dir}.`, data: { sessions } };
    }
    case 'trace_list_threads': {
      const rows = listThreads(readData(), { query: a.query, includeDone: a.include_done !== false });
      return { text: `${rows.length} thread${rows.length === 1 ? '' : 's'}.`, data: { threads: rows } };
    }
    case 'trace_read_thread': {
      const t = readThread(readData(), a.thread, { limit: Math.max(1, Math.min(200, Number(a.limit) || 50)) });
      return { text: `"${t.name}": ${t.total} record${t.total === 1 ? '' : 's'}.`, data: t };
    }
    case 'trace_merge': {
      const sources = Array.isArray(a.sources) ? a.sources.map(String) : [];
      if (!sources.length) throw new Error('sources must list at least one thread');
      const mode = a.mode === 'combine' ? 'combine' : 'merge';
      const r = mutate(d => mergeThreads(d, { sources, target: a.target, newName: a.new_name, mode }));
      return { text: `${mode === 'combine' ? 'Combined' : 'Merged'} ${r.sources.map(s => `"${s}"`).join(', ')} into "${r.target.name}".`, data: { target: { id: r.target.id, name: r.target.name }, sources: r.sources, mode } };
    }
    case 'trace_log': {
      if (!String(a.title || '').trim()) throw new Error('title is required');
      // Agents are reminded of new to-dos on every message, so the same open to-do twice stays one.
      const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
      let dup = false;
      const c = mutate(d => {
        const thread = a.thread ? ensureThread(d, a.thread) : INBOX, kind = a.kind || (a.assignee ? 'task' : 'agent');
        const same = kind === 'task' && Object.values(d.commits).find(x => x.kind === 'task' && !x.done && threadIdOf(d, x) === thread && norm(x.title) === norm(a.title));
        if (same) { dup = true; return same; }
        return addCommit(d, { thread, kind, title: a.title, body: a.body || '', links: Array.isArray(a.links) ? a.links : [], agent: a.agent || agentOf(agentKey()).name, extra: a.assignee ? { assignee: a.assignee } : {} });
      });
      const where = c.thread === INBOX ? 'the inbox' : `"${readData().threads[c.thread].name}"`;
      return { text: dup ? `Already an open to-do on ${where}.` : `Logged to ${where}.`, data: { id: c.id, thread: c.thread, ...(dup ? { existing: true } : {}) } };
    }
    case 'trace_import_data': {
      const text = a.path ? fs.readFileSync(a.path, 'utf8') : String(a.json || '');
      if (!text.trim()) throw new Error('Pass path or json');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (parsed && !Array.isArray(parsed) && (parsed.threads || parsed.commits)) {
        const r = mutate(d => mergeDataset(d, parsed));
        return { text: `Merged ${r.commits} record${r.commits === 1 ? '' : 's'}, ${r.threads} new thread${r.threads === 1 ? '' : 's'} and ${r.edges} link${r.edges === 1 ? '' : 's'}; ${r.unified} thread${r.unified === 1 ? '' : 's'} joined an existing line.`, data: r };
      }
      const n = mutate(d => importText(d, text));
      return { text: `Imported ${n} record${n === 1 ? '' : 's'}.`, data: { records: n } };
    }
    case 'trace_fork': {
      const sessionId = a.bind ? currentSessionId({ sessionId: a.session_id, projectDir: projectDir() }) : null;
      if (a.bind && !sessionId) throw new Error('No session to bind; pass session_id');
      const r = mutate(d => { const f = forkThread(d, { from: a.from, name: a.name, agent: agentOf(agentKey()).name }); if (sessionId) bindLiveSession(d, { sessionId, thread: f.thread.id }); return f; });
      return { text: `Forked "${r.thread.name}"${sessionId ? `; session ${sessionId} is on it now` : ''}.`, data: { thread: { id: r.thread.id, name: r.thread.name }, forkOf: r.thread.forkOf, record: r.record.id, sessionId } };
    }
    case 'trace_tasks': {
      const d = readData();
      const thread = a.thread || (process.env.TRACE_CANVAS_THREAD && threadById(d, process.env.TRACE_CANVAS_THREAD) ? process.env.TRACE_CANVAS_THREAD : undefined);
      const rows = listTasks(d, { thread, includeDone: !!a.include_done, assignee: a.mine ? agentKey() : a.assignee });
      const open = rows.reduce((n, r) => n + (r.total - r.done), 0);
      return { text: `${open} open to-do${open === 1 ? '' : 's'} on ${rows.length} thread${rows.length === 1 ? '' : 's'}.`, data: { threads: rows } };
    }
    case 'trace_task_done': {
      const done = a.done !== false;
      const c = mutate(d => setTaskDone(d, { task: a.task, thread: a.thread, done, by: a.agent || agentOf(agentKey()).name }));
      return { text: `${done ? 'Ticked' : 'Reopened'} "${c.title}".`, data: { id: c.id, title: c.title, done: c.done, doneBy: c.doneBy || null } };
    }
    case 'trace_live': {
      const d = readData();
      const dir = a.project_dir ? path.resolve(a.project_dir) : null;
      const sessions = liveSessions(d).sessions.filter(s => !dir || (s.cwd || '').startsWith(dir)).map(s => ({
        sessionId: s.id, status: s.status, activity: s.activity, title: s.title || s.prompt || '', repo: s.repo, branch: s.branch, cwd: s.cwd,
        thread: s.threadId ? d.threads[s.threadId].name : null, bound: s.bound, startedBy: s.parent,
        subagents: s.agents.map(a => ({ type: a.type, description: a.description, status: a.status, last: a.last || '' })),
        startedAt: new Date(s.startedAt).toISOString(), lastSeen: new Date(s.lastSeen).toISOString(),
      }));
      const waiting = sessions.filter(s => s.status === 'waiting').length;
      return { text: `${sessions.length} running session${sessions.length === 1 ? '' : 's'}${waiting ? `, ${waiting} waiting for the user` : ''}.`, data: { sessions } };
    }
    case 'trace_bind': {
      const sessionId = currentSessionId({ sessionId: a.session_id, projectDir: projectDir() });
      if (!sessionId) throw new Error('No session to bind; pass session_id');
      if (!a.unbind && !String(a.thread || '').trim()) throw new Error('Pass thread, or unbind: true');
      const t = mutate(d => bindLiveSession(d, { sessionId, thread: a.unbind ? null : a.thread }));
      return { text: t ? `Session ${sessionId} is on "${t.name}" now.` : `Session ${sessionId} follows its repository/branch line again.`, data: { sessionId, thread: t ? { id: t.id, name: t.name } : null } };
    }
    case 'trace_where': {
      const rows = whereFind(readConfig(), a.query, a.machine || '');
      const text = rows.map(r => `${r.title} [${r.id}]${r.notes ? ` — ${String(r.notes).split('\n')[0]}` : ''}\n${r.where.map(w => `  ${w.host}${w.role ? ` ${w.role}` : ''}: ${w.local || w.path || ''}`).join('\n')}`).join('\n');
      return { text: text || 'Nothing in the location map matches.', data: { entries: rows } };
    }
    case 'trace_open': {
      const { url, started } = await ensureServer();
      const full = url + (a.view && a.view !== 'canvas' ? `#${a.view}` : '');
      if (a.open_browser) openBrowser(full);
      return { text: `${started ? 'Started' : 'Running'} at ${full}${a.open_browser ? ' (opened in the browser)' : ''}.`, data: { url: full, dataFile: dataFile() } };
    }
    default: throw Object.assign(new Error(`Unknown tool ${name}`), { rpc: -32602 });
  }
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  const reply = result => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, result });
  const fail = (code, message) => (id === undefined || id === null ? null : { jsonrpc: '2.0', id, error: { code, message } });
  switch (method) {
    case 'initialize': {
      const want = params && params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'trace-canvas', title: 'Trace Canvas', version: VERSION }, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = params && params.name;
      if (!TOOLS.some(t => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const r = await callTool(name, (params && params.arguments) || {});
        return reply({ content: [{ type: 'text', text: `${r.text}\n${JSON.stringify(r.data, null, 2)}` }], structuredContent: r.data });
      } catch (e) {
        return reply({ content: [{ type: 'text', text: String(e && e.message || e) }], isError: true });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${method}`);
  }
}

export function runMcp(input = process.stdin, output = process.stdout) {
  let buf = '';
  let chain = Promise.resolve();
  const send = m => { if (m) output.write(JSON.stringify(m) + '\n'); };
  // Messages are handled one at a time, in order, so writes to the data file never interleave.
  const process1 = async line => {
    let msg;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (Array.isArray(msg)) { const out = []; for (const m of msg) { const r = await handle(m); if (r) out.push(r); } if (out.length) send(out); }
    else send(await handle(msg));
  };
  const enqueue = line => { chain = chain.then(() => process1(line)).catch(e => console.error('[trace-canvas mcp]', e)); };
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) enqueue(line); }
  });
  input.on('end', () => { const line = buf.trim(); if (line) enqueue(line); chain.then(() => process.exit(0)); });
}
