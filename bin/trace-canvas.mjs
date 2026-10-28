#!/usr/bin/env node
// Trace Canvas command line. Run `trace-canvas help` for the list of commands.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, dataFile, ensureThread, home, importText, INBOX, mutate, readConfig, writeConfig } from '../src/store.mjs';
import { execFileSync } from 'node:child_process';
import { handleHook, readStdin } from '../src/hook.mjs';
import { agentFiles, allowSafeTools, codexHooks, codexWritable, geminiHooks, hookCommand, install, installAgentMcp, installMcp, installSkill, linkCommand, onPath, settingsPath, uninstall } from '../src/install.mjs';
import { normalize } from '../src/agents.mjs';
import os from 'node:os';
import crypto from 'node:crypto';

const SELF = fileURLToPath(import.meta.url);

// After a session ends, sync with the other machines in the background, at most every 2 minutes.
// Only once this machine has synced by hand (its file exists), so the first sync is a choice.
function syncSoon() {
  const cfg = readConfig();
  if (!cfg.map || !fs.existsSync(path.join(cfg.map, 'canvas', `${cfg.machine}.jsonl`))) return;
  let last = 0;
  try { last = Number(fs.readFileSync(path.join(home(), '.sync-last'), 'utf8')) || 0; } catch {}
  if (Date.now() - last > 120000) spawn(process.execPath, [SELF, 'sync', '--quiet'], { detached: true, stdio: 'ignore' }).unref();
}
// This computer's name in the location map (tools/where.py --whoami), or '' without one.
function whoami(map) {
  const py = map && path.join(map, 'tools', 'where.py');
  try { return py && fs.existsSync(py) ? execFileSync('python3', [py, '--whoami'], { encoding: 'utf8', timeout: 5000 }).trim() : ''; } catch { return ''; }
}
const SKILL_DIR = path.join(path.dirname(SELF), '..', 'skill');
// This computer on Tailscale, or null when Tailscale is not running: { dns, ip }.
function tailscaleSelf() {
  for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const s = JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      const self = s.Self || {}, ip = (self.TailscaleIPs || []).find(a => a.includes('.'));
      return s.BackendState === 'Running' && self.DNSName && ip ? { dns: self.DNSName.replace(/\.$/, ''), ip } : null;
    } catch {}
  }
  return null;
}
// A QR code for the terminal, black on white whatever the terminal's colours, from the page's own encoder.
function terminalQr(text) {
  const src = fs.readFileSync(path.join(path.dirname(SELF), '..', 'app', 'index.html'), 'utf8');
  const { qrMatrix } = new Function(`${src.slice(src.indexOf('// <qr>'), src.indexOf('// </qr>'))}; return { qrMatrix };`)();
  const q = qrMatrix(text), n = q.length, dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && q[r][c];
  const lines = [];
  for (let r = -4; r < n + 4; r += 2) {
    let s = '';
    for (let c = -4; c < n + 4; c++) s += `\x1b[${dark(r, c) ? 30 : 97};${dark(r + 1, c) ? 40 : 107}m\u2580`;
    lines.push(`${s}\x1b[0m`);
  }
  return lines.join('\n');
}
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'serve';

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
}
const str = v => (v === true || v == null ? '' : String(v));
function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
function scope() {
  const user = flag('user', false), project = flag('project', null);
  return { user: !!user, project: project === true ? process.cwd() : project };
}

const HELP = `Trace Canvas — a transit map of your work

Page
  trace-canvas [serve] [--port 4777] [--no-open]   Start the local page and open it

Records
  trace-canvas log "title" [--thread name] [--kind agent|idea|task|decision|note]
                   [--body text] [--link url] [--agent name]
  trace-canvas capture [--session id] [--project dir] [--thread name] [--separate] [--all]
                                                   Put a Claude Code session on the canvas
  trace-canvas sessions [--project dir]            List Claude Code sessions of a project
  trace-canvas merge <thread>... --into <thread> [--combine]
                                                   Merge threads (combine folds them into one line)
  trace-canvas fork <record|thread> [--name N] [--bind] [--session id]
                                                   Branch a new thread off a record or a thread's tip
  trace-canvas import <file|->                     Merge an export, another data.json, or JSON lines

Goals and to-dos
  trace-canvas tasks [--thread T] [--all]          Each thread's goal and open to-dos (--all: finished too)
  trace-canvas done <task> [--thread T] [--agent A] [--undo]
                                                   Tick a to-do by id or title (--undo reopens it)
  trace-canvas hand <to-do|thread> --to claude|codex|gemini
                                                   Assign it and print the command that starts the agent on it
  trace-canvas dispatch [line|to-do...] [--all] [--print] [--json]
                                                   Hand each line's new to-dos (or the to-dos named) to the agent working on it and wake it
                                                   (resume or start in a new Terminal window; --print only prints)

Live sessions
  trace-canvas live                                Running sessions: status, activity, thread
  trace-canvas bind <thread> [--session id]        Put a running session on a thread (default: this one)
  trace-canvas bind --unbind [--session id]        Back to its repository/branch line
  trace-canvas resume <thread>                     The line's sessions, newest first, each with the command that resumes it
  trace-canvas group <thread>... --name G | --clear   Put lines in a group (on the canvas they sit in one frame)
  trace-canvas tokens [--days 7]                   How much of recent Claude Code sessions' tokens went to Trace Canvas
  trace-canvas retro <thread>                      Rank the line's work by back-and-forth (rounds, time, tokens)
                                                   and suggest rules, using your local claude or codex
  trace-canvas retro --apply <record> <n> [--layer project|line|memory]
                                                   Write suggestion n: CLAUDE.md/AGENTS.md, the line, or long-term memory

Setup (pass --user for every project, or --project dir for one)
  trace-canvas setup            Hooks + MCP server + /trace-canvas skill
  trace-canvas install-hooks    Automatic traces from Claude Code sessions
  trace-canvas install-mcp      MCP tools: trace_capture_session, trace_merge, …
  trace-canvas install-skill [--agents codex]
                               The skill for Claude Code, and optionally Codex
  trace-canvas uninstall-hooks
  trace-canvas mcp              Run the MCP server on stdio (Claude Code starts this)
  trace-canvas lang <en|zh>     Language of records the hooks write
  trace-canvas where            Show where data is stored
  trace-canvas phone [--off] [--rotate] [--allow-start|--deny-start]
                               Open the canvas on your phone over Tailscale (docs/phone.md)
  trace-canvas where <words> [--machine M]   Look things up in the location map (~/agent-map)
  trace-canvas sync             Sync the canvas with your other machines through the location map
  (setup also takes --machine NAME and --map DIR: this computer's name and the map repository)

Data: ${dataFile()}`;

async function main() {
  switch (cmd) {
    case 'serve': {
      const port = Number(flag('port', process.env.TRACE_CANVAS_PORT || 4777));
      const noOpen = flag('no-open', false);
      const { startServer } = await import('../src/server.mjs');
      try {
        const { url, ai } = await startServer({ port });
        console.log(`Trace Canvas is running at ${url}`);
        console.log(`Data: ${dataFile()}`);
        console.log(ai ? 'AI tidy-up: on (uses your local `claude` CLI)' : 'AI tidy-up: off (install Claude Code to enable it)');
        console.log('Press Ctrl+C to stop.');
        if (!noOpen) openBrowser(url);
      } catch (e) {
        if (e.code === 'EADDRINUSE') {
          console.log(`Port ${port} is in use; Trace Canvas may already be running at http://localhost:${port}/`);
          if (!noOpen) openBrowser(`http://localhost:${port}/`);
        } else throw e;
      }
      break;
    }
    case 'hook': {
      // Never break the Claude Code session: swallow everything, print nothing.
      // TRACE_CANVAS_DEBUG=1 appends each event and its outcome to <data dir>/debug.log.
      // --agent codex|gemini: that CLI's payload is turned into Claude's shape first. On SessionStart
      // the hook prints the context the session starts with, and on each instruction a reminder to
      // add new goals as to-dos; for anything else it prints nothing.
      const agent = str(flag('agent', '')) || 'claude';
      let raw = '', outcome, context = '', event = '';
      try {
        raw = await readStdin();
        if (raw.trim()) {
          const payload = JSON.parse(raw), input = normalize(agent, payload);
          event = payload.hook_event_name; // the CLI's own name for it, which its output must repeat
          outcome = handleHook(input);
          if (input.hook_event_name === 'SessionEnd' && process.env.TRACE_CANVAS_DISABLE !== '1') syncSoon();
          if (process.env.TRACE_CANVAS_DISABLE !== '1') {
            const { sessionStartContext, promptContext } = await import('../src/hook.mjs');
            if (input.hook_event_name === 'SessionStart') context = sessionStartContext(input);
            else if (input.hook_event_name === 'UserPromptSubmit') context = promptContext(input);
          }
        }
      } catch (e) { outcome = { error: String(e && e.stack || e) }; }
      if (context) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }));
      if (process.env.TRACE_CANVAS_DEBUG) {
        try { fs.appendFileSync(path.join(path.dirname(dataFile()), 'debug.log'), `${new Date().toISOString()} ${raw.slice(0, 4000)}\n  -> ${JSON.stringify(outcome ?? 'logged')}\n`); } catch {}
      }
      process.exit(0);
    }
    case 'mcp': {
      const { runMcp } = await import('../src/mcp.mjs');
      runMcp();
      break;
    }
    case 'log': {
      const thread = flag('thread', null), assignee = str(flag('assignee', '')), kind = flag('kind', assignee ? 'task' : 'agent'), body = flag('body', ''), link = flag('link', null), agent = flag('agent', '');
      const title = argv.join(' ').trim();
      if (!title) { console.error('Usage: trace-canvas log "title" [--thread name] [--kind agent] [--assignee codex]'); process.exit(1); }
      const c = mutate(d => addCommit(d, { thread: thread && thread !== true ? ensureThread(d, thread) : INBOX, kind: str(kind) || 'agent', title, body: str(body), links: str(link) ? [str(link)] : [], agent: str(agent), extra: assignee ? { assignee } : {} }));
      console.log(`Logged ${c.id}`);
      break;
    }
    case 'capture': {
      const { currentSessionId, findTranscript, parseTranscript } = await import('../src/transcript.mjs');
      const { captureSession } = await import('../src/ops.mjs');
      const project = str(flag('project', '')) || process.cwd(), thread = str(flag('thread', ''));
      const session = currentSessionId({ sessionId: str(flag('session', '')) || undefined, projectDir: project });
      const separate = !!flag('separate', false), all = !!flag('all', false);
      const file = session ? findTranscript({ sessionId: session, projectDir: project }) : null;
      if (!file) { console.error(session ? `No transcript for session ${session}` : `No Claude Code transcripts for ${project}`); process.exit(1); }
      const r = mutate(d => captureSession(d, parseTranscript(file), { sessionId: session || undefined, thread: thread || undefined, separate, detail: all ? 'all' : 'key' }));
      console.log(`Added ${r.added} record${r.added === 1 ? '' : 's'} to "${r.thread.name}"${r.skipped ? ` (${r.skipped} already there)` : ''}`);
      break;
    }
    case 'sessions': {
      const { findTranscripts, describeSession } = await import('../src/transcript.mjs');
      const project = str(flag('project', '')) || process.cwd();
      const files = findTranscripts(project).slice(0, 20);
      if (!files.length) { console.log(`No Claude Code transcripts for ${project}`); break; }
      for (const f of files) {
        const s = describeSession(f.path);
        const when = s.lastActivity ? new Date(s.lastActivity).toISOString().replace('T', ' ').slice(0, 16) : '';
        console.log(`${s.sessionId}  ${when}  ${String(s.prompts).padStart(3)} prompts  ${String(s.filesChanged).padStart(3)} files  ${s.title}`);
      }
      break;
    }
    case 'fork': {
      const { forkThread, bindLiveSession } = await import('../src/ops.mjs');
      const { currentSessionId } = await import('../src/transcript.mjs');
      const name = str(flag('name', '')), bind = !!flag('bind', false), session = str(flag('session', ''));
      const from = argv.join(' ').trim();
      if (!from) { console.error('Usage: trace-canvas fork <record|thread> [--name N] [--bind]'); process.exit(1); }
      const sid = bind ? currentSessionId({ sessionId: session || undefined, projectDir: process.cwd() }) : null;
      const r = mutate(d => { const f = forkThread(d, { from, name, agent: str(flag('agent', '')) }); if (sid) bindLiveSession(d, { sessionId: sid, thread: f.thread.id }); return f; });
      console.log(`Forked "${r.thread.name}"${sid ? ` and put session ${sid} on it` : ''}`);
      break;
    }
    case 'merge': {
      const { mergeThreads } = await import('../src/ops.mjs');
      const into = str(flag('into', '')), name = str(flag('name', '')), combine = !!flag('combine', false);
      if (!argv.length) { console.error('Usage: trace-canvas merge <thread>... --into <thread> [--combine]'); process.exit(1); }
      const r = mutate(d => mergeThreads(d, { sources: argv, target: into || undefined, newName: name || undefined, mode: combine ? 'combine' : 'merge' }));
      console.log(`${combine ? 'Combined' : 'Merged'} ${r.sources.map(s => `"${s}"`).join(', ')} into "${r.target.name}"`);
      break;
    }
    case 'import': {
      const src = argv[0];
      if (!src) { console.error('Usage: trace-canvas import <file|->'); process.exit(1); }
      const text = src === '-' ? await readStdin() : fs.readFileSync(src, 'utf8');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (parsed && !Array.isArray(parsed) && (parsed.threads || parsed.commits)) {
        const { mergeDataset } = await import('../src/ops.mjs');
        const r = mutate(d => mergeDataset(d, parsed));
        console.log(`Merged ${r.commits} records, ${r.threads} new threads, ${r.edges} links; ${r.unified} threads joined an existing line`);
      } else {
        const n = mutate(d => importText(d, text));
        console.log(`Imported ${n} item${n === 1 ? '' : 's'}`);
      }
      break;
    }
    case 'tasks': {
      const { listTasks } = await import('../src/ops.mjs');
      const { readData } = await import('../src/store.mjs');
      const rows = listTasks(readData(), { thread: str(flag('thread', '')) || undefined, includeDone: !!flag('all', false), assignee: str(flag('assignee', '')) || undefined });
      if (!rows.length) { console.log('No goals or to-dos yet.'); break; }
      for (const r of rows) {
        console.log(`${r.name}${r.group ? `  [${r.group}]` : ''}  (${r.done}/${r.total})${r.goal ? `\n  goal: ${r.goal}` : ''}`);
        for (const t of r.tasks) console.log(`  ${t.done ? '✓' : '□'} ${t.title}  [${t.id}]${t.assignee ? `  → ${t.assignee}` : ''}${t.doneBy && t.doneBy !== 'human' ? `  ticked by ${t.doneBy}` : ''}`);
      }
      break;
    }
    case 'hand': {
      const { handTo } = await import('../src/ops.mjs');
      const to = str(flag('to', '')), thread = str(flag('thread', ''));
      const ref = argv.join(' ').trim();
      if (!ref || !to) { console.error('Usage: trace-canvas hand <to-do or thread> --to claude|codex|gemini [--thread T]'); process.exit(1); }
      const r = mutate(d => handTo(d, { ref, to, thread: thread || undefined }));
      console.error(r.todo ? `"${r.todo.title}" is assigned to ${to}. Run this to start it:` : `Run this to start ${to} on "${r.thread.name}":`);
      console.log(r.command);
      break;
    }
    case 'dispatch': {
      // Dispatch: each line's new to-dos go to its agent. A stopped session is resumed and a line without one gets a
      // new session, each in a new Terminal window (macOS); a running Claude Code session is messaged by the agent
      // that called this (the skill), since only an agent can reach it.
      const { dispatch } = await import('../src/ops.mjs');
      const { AGENTS, terminalScript } = await import('../src/agents.mjs');
      const all = !!flag('all', false), json = !!flag('json', false), run = !flag('print', false) && process.platform === 'darwin';
      const rows = mutate(d => dispatch(d, { refs: argv.filter(Boolean), all, self: process.env.CLAUDE_CODE_SESSION_ID || null }));
      for (const r of rows) if (r.command && run) spawn('osascript', ['-e', terminalScript(r.command)], { stdio: 'ignore', detached: true }).unref();
      if (json) { console.log(JSON.stringify(rows, null, 2)); break; }
      if (!rows.length) { console.log('Nothing new to dispatch: every open to-do has an agent, or was logged by the agent working on its line (--all takes those too).'); break; }
      for (const r of rows) {
        const who = AGENTS[r.agent].name, s = r.session, name = s && `"${s.title.slice(0, 50) || s.id.slice(0, 8)}"`;
        console.log(`\n${r.thread.name}: ${r.todos.length} to-do${r.todos.length === 1 ? '' : 's'} for ${who}`);
        for (const c of r.todos) console.log(`  □ ${c.title}  [${c.id}]`);
        if (r.action === 'self') console.log('  → Your own line: they are yours.');
        else if (r.action === 'message') console.log(`  → Running session ${name} (${s.status}${s.desktopId ? `, ${s.desktopId}` : ''}): send it this message:\n    ${r.prompt}`);
        else if (r.action === 'busy') console.log(`  → ${who} session ${name} is working: send it this when it stops:\n    ${r.prompt}`);
        else console.log(`  → ${r.action === 'start' ? `A new ${who} session` : `Session ${name} resumed`}${run ? ' in a new Terminal window' : '; run'}:\n    ${r.command}`);
      }
      break;
    }
    case 'done': {
      const { setTaskDone } = await import('../src/ops.mjs');
      const thread = str(flag('thread', '')), agent = str(flag('agent', '')), undo = !!flag('undo', false);
      const ref = argv.join(' ').trim(); // after the flags are taken out
      if (!ref) { console.error('Usage: trace-canvas done <task id or title> [--thread T] [--agent A] [--undo]'); process.exit(1); }
      const c = mutate(d => setTaskDone(d, { task: ref, thread: thread || undefined, done: !undo, by: agent || 'human' }));
      console.log(`${undo ? 'Reopened' : 'Ticked'} "${c.title}"`);
      break;
    }
    case 'live': {
      const { liveSessions } = await import('../src/ops.mjs');
      const { readData } = await import('../src/store.mjs');
      const d = readData(), { sessions } = liveSessions(d);
      if (!sessions.length) { console.log('No running sessions.'); break; }
      for (const s of sessions) {
        const where = s.threadId ? `${d.threads[s.threadId].name}${s.bound ? ' (bound)' : ''}` : '-';
        console.log(`${s.status.padEnd(8)} ${s.id}  ${(s.title || s.prompt || s.repo || '').slice(0, 50).padEnd(50)}  ${where}`);
        console.log(`         ${s.activity || ''}${s.parent ? `\n         started by ${s.parent}` : ''}`);
        for (const a of s.agents) console.log(`         ${a.status === 'running' ? '▸' : '✓'} ${a.type}${a.description ? `: ${a.description}` : ''}`);
      }
      break;
    }
    case 'group': {
      // trace-canvas group <thread>... --name G   puts lines in a group; --clear takes them out.
      const { resolveThreadRef } = await import('../src/ops.mjs');
      const name = str(flag('name', '')).trim(), clear = !!flag('clear', false), refs = argv.filter(Boolean);
      if (!refs.length || (!name && !clear)) { console.error('Usage: trace-canvas group <thread>... --name <group>   (or --clear)'); process.exit(1); }
      const done = mutate(d => refs.map(ref => {
        const tid = resolveThreadRef(d, ref), th = tid && d.threads[tid];
        if (!th) throw new Error(`No thread named "${ref}"`);
        if (clear) delete th.group; else th.group = name;
        return th.name;
      }));
      console.log(clear ? `Out of their group: ${done.join(', ')}` : `In "${name}": ${done.join(', ')}`);
      break;
    }
    case 'resume': {
      const { findThreadLoose, threadSessions } = await import('../src/ops.mjs');
      const { readData } = await import('../src/store.mjs');
      const d = readData(), ref = argv.join(' ').trim(), tid = ref && findThreadLoose(d, ref);
      if (!tid) { console.error(ref ? `No thread named "${ref}"` : 'Usage: trace-canvas resume <thread>'); process.exit(1); }
      const ss = threadSessions(d, tid);
      if (!ss.length) { console.log('No sessions on this line yet.'); break; }
      for (const s of ss) {
        console.log(`${s.status.padEnd(8)} ${s.agent.padEnd(11)} ${new Date(s.last).toISOString().slice(0, 16).replace('T', ' ')}  ${s.title.slice(0, 60)}`);
        console.log(`         ${s.command}`);
      }
      break;
    }
    case 'tokens': {
      // trace-canvas tokens [--days 7]: how much of recent Claude Code sessions' tokens went to Trace Canvas.
      const { canvasTokens, projectsRoot } = await import('../src/transcript.mjs');
      const { fmtTokens } = await import('../src/i18n.mjs');
      const days = Number(flag('days', 7)) || 7, since = Date.now() - days * 864e5, root = projectsRoot(), rows = [];
      const ls = dir => { try { return fs.readdirSync(dir); } catch { return []; } };
      for (const dir of ls(root)) for (const f of ls(path.join(root, dir)).filter(f => f.endsWith('.jsonl'))) {
        const p = path.join(root, dir, f);
        if (fs.statSync(p).mtimeMs < since) continue;
        const r = canvasTokens(p);
        if (r.calls >= 5 && (r.notes || r.toolTokens)) rows.push({ ...r, name: `${f.slice(0, 8)} ${dir.replace(/^-Users-[^-]+-/, '').slice(0, 28)}` });
      }
      if (!rows.length) { console.log(`No Claude Code sessions with Trace Canvas in the last ${days} days.`); break; }
      const pct = (a, b) => `${(100 * a / Math.max(1, b)).toFixed(2)}%`, k = n => fmtTokens(Math.round(n));
      console.log(`${'session'.padEnd(38)}${'calls'.padStart(6)}${'notes'.padStart(6)}${'per note'.padStart(9)}${'tools'.padStart(7)}${'total'.padStart(8)}${'Trace Canvas'.padStart(13)}`);
      for (const r of rows.sort((a, b) => b.total - a.total)) console.log(`${r.name.padEnd(38)}${String(r.calls).padStart(6)}${String(r.notes).padStart(6)}${k(r.noteTokens / (r.notes || 1)).padStart(9)}${k(r.toolTokens).padStart(7)}${k(r.total).padStart(8)}${pct(r.reread, r.total).padStart(13)}`);
      const T = rows.reduce((n, r) => n + r.total, 0), R = rows.reduce((n, r) => n + r.reread, 0);
      console.log(`\n${rows.length} session${rows.length === 1 ? '' : 's'} in the last ${days} days: ${k(T)} tokens processed, ${k(R)} of them (${pct(R, T)}) re-reading what Trace Canvas added (hook notes, trace_* calls and results; estimated from their characters).`);
      break;
    }
    case 'retro': {
      // trace-canvas retro <thread>: rank the line's work by rounds and suggest rules (nothing is written yet);
      // trace-canvas retro --apply <record> <n> [--layer project|line|memory]: write suggestion n.
      const { applyRetro, retroRecord, runRetro } = await import('../src/retro.mjs');
      const { findThreadLoose } = await import('../src/ops.mjs');
      const { readData } = await import('../src/store.mjs');
      const { tr } = await import('../src/i18n.mjs');
      const apply = str(flag('apply', '')), layer = str(flag('layer', '')), asJson = !!flag('json', false);
      if (apply) {
        const r = mutate(d => applyRetro(d, { record: apply, n: Number(argv[0]), layer }));
        console.log(`Written to ${r.layer === 'project' ? r.where : r.layer === 'line' ? `the line "${r.where}"` : r.where}: ${r.rule}`);
        break;
      }
      const ref = argv.join(' ').trim(), tid = ref && findThreadLoose(readData(), ref);
      if (!tid) { console.error(ref ? `No thread named "${ref}"` : 'Usage: trace-canvas retro <thread>   (then --apply <record> <n> [--layer project|line|memory])'); process.exit(1); }
      console.error('Reading the line\'s conversations and asking your local claude/codex to group them; this takes a minute or two…');
      const res = await runRetro(readData(), tid), lang = readConfig().lang;
      const c = mutate(d => retroRecord(d, tid, res, lang));
      if (asJson) { console.log(JSON.stringify({ record: c.id, ...res }, null, 2)); break; }
      console.log(`${c.title}\n${res.prompts} messages in ${res.sessions} session${res.sessions === 1 ? '' : 's'}; worst first (rounds ÷ difficulty):\n`);
      res.items.forEach((r, k) => {
        console.log(`${k + 1}. ${r.title}\n   ${tr(lang, 'retroStats', r)}`);
        if (r.rule) console.log(`   stuck: ${r.stuck}\n   made clear by: ${r.clear}\n   rule (${r.layer}): ${r.rule}`);
      });
      if (res.items.some(r => r.rule)) console.log(`\nWrite one: trace-canvas retro --apply ${c.id} <n> [--layer project|line|memory]`);
      break;
    }
    case 'bind': {
      const { bindLiveSession } = await import('../src/ops.mjs');
      const { currentSessionId } = await import('../src/transcript.mjs');
      const unbind = !!flag('unbind', false), session = currentSessionId({ sessionId: str(flag('session', '')) || undefined, projectDir: process.cwd() });
      if (!session) { console.error('No session to bind; pass --session'); process.exit(1); }
      const thread = argv.join(' ').trim();
      if (!unbind && !thread) { console.error('Usage: trace-canvas bind <thread> [--session id]   or   trace-canvas bind --unbind'); process.exit(1); }
      const t = mutate(d => bindLiveSession(d, { sessionId: session, thread: unbind ? null : thread }));
      console.log(t ? `Session ${session} is on "${t.name}"` : `Session ${session} follows its repository/branch line again`);
      break;
    }
    case 'install-hooks':
    case 'uninstall-hooks': {
      const s = scope();
      const file = settingsPath(s);
      if (cmd === 'install-hooks') { install(file, hookCommand(SELF)); console.log(`Hooks added to ${file}`); }
      else console.log(uninstall(file) ? `Hooks removed from ${file}` : `No Trace Canvas hooks in ${file}`);
      break;
    }
    case 'install-mcp': {
      const s = scope();
      const r = installMcp(s, SELF);
      if (r.ok) allowSafeTools(settingsPath(s));
      console.log(r.ok ? `MCP server added: ${r.where}` : `Couldn't add the MCP server (${r.error}).\nRun this yourself:\n  ${r.hint}`);
      break;
    }
    case 'install-skill': {
      const s = scope();
      console.log(`Skill installed at ${installSkill(s, SKILL_DIR)}`);
      if (str(flag('agents', '')).split(',').some(a => a.trim() === 'codex')) {
        console.log(`Codex skill installed at ${installSkill(s, SKILL_DIR, 'codex')}`);
      }
      break;
    }
    case 'setup': {
      const s = scope();
      if (!s.user && !s.project) { console.error('Usage: trace-canvas setup --user   (or --project <dir>)'); process.exit(1); }
      const file = settingsPath(s);
      install(file, hookCommand(SELF));
      console.log(`1. Hooks added to ${file}`);
      const m = installMcp(s, SELF);
      allowSafeTools(file);
      console.log(m.ok ? `2. MCP server added: ${m.where}` : `2. Couldn't add the MCP server. Run this yourself:\n   ${m.hint}`);
      console.log(`   Capturing, logging and reading run without asking; merging and importing still ask (${file}).`);
      console.log(`3. Skill installed at ${installSkill(s, SKILL_DIR)}`);
      if (s.user) { const c = linkCommand(SELF); console.log(c.ok ? `   The trace-canvas command: ${c.where}` : `   To type trace-canvas instead of node ${SELF}, run:\n   ${c.hint}`); }
      // Which computer this is: --machine, else what it was set to before, else the location map's name for it.
      {
        const { machineOwner } = await import('../src/sync.mjs');
        let saved = '';
        try { saved = JSON.parse(fs.readFileSync(path.join(home(), 'config.json'), 'utf8')).machine || ''; } catch {}
        const mapArg = str(flag('map', '')); // flag() takes the option out of argv, so read it once
        if (mapArg) writeConfig({ map: path.resolve(mapArg) });
        const cfg = readConfig(), machine = str(flag('machine', '')) || saved || whoami(cfg.map) || cfg.machine;
        const owner = cfg.map && machineOwner(cfg.map, machine);
        if (owner && !flag('force', false)) { console.error(`   "${machine}" is ${owner}'s name in ${cfg.map}/canvas. Pick another with --machine (or --force).`); process.exit(1); }
        writeConfig({ machine });
        console.log(`4. This computer is "${machine}"${cfg.map ? `; the canvas syncs through ${cfg.map} with trace-canvas sync` : ''}`);
      }
      // --agents claude,codex,gemini also wires the other CLIs (user scope only); missing ones are skipped.
      const others = str(flag('agents', '')).split(',').map(x => x.trim()).filter(x => x === 'codex' || x === 'gemini');
      for (const a of s.user ? others : []) {
        if (!onPath(a)) { console.log(`   ${a}: not found on PATH, skipped${a === 'gemini' ? ' (install a current @google/gemini-cli, then run setup again)' : ''}`); continue; }
        const f = agentFiles(os.homedir())[a], cmd = hookCommand(SELF, a);
        install(f, cmd, a === 'codex' ? codexHooks(cmd) : geminiHooks(cmd));
        const r = installAgentMcp(a, SELF);
        console.log(`   ${a}: hooks in ${f}; MCP ${r.ok ? 'registered' : `not registered, run: ${r.hint}`}`);
        if (a === 'codex') {
          console.log(`   codex: skill installed at ${installSkill(s, SKILL_DIR, 'codex')}; invoke it with $trace-canvas.`);
          const toml = path.join(os.homedir(), '.codex', 'config.toml');
          if (codexWritable(toml, home())) console.log(`   codex: ${home()} added to the sandbox's writable_roots in ${toml}, so its hooks can record`);
          console.log('   codex: start Codex once and trust the new hooks when it asks.');
        }
      }
      console.log('Start a new Claude Code session, then type /trace-canvas to put it on the canvas.');
      break;
    }
    case 'lang': {
      const lang = argv[0];
      if (lang !== 'en' && lang !== 'zh') { console.error('Usage: trace-canvas lang <en|zh>'); process.exit(1); }
      writeConfig({ lang });
      console.log(`Hooks will write records in ${lang === 'en' ? 'English' : 'Chinese'}`);
      break;
    }
    case 'phone': {
      // Opens the canvas to your phone: over Tailscale by default, or at an address you give.
      if (flag('off', false)) { writeConfig({ phone: null }); console.log('Phone access is off. Restart the page (trace-canvas serve) so it stops listening.'); break; }
      const host = str(flag('host', '')), bind = str(flag('bind', '')), port = Number(flag('port', 0)) || null, rotate = !!flag('rotate', false);
      const ts = host ? null : tailscaleSelf();
      if (!host && !ts) { console.error('Tailscale is not running on this computer. Open it (signed in here and on the phone) and run this again,\nor give your own address: trace-canvas phone --host <name or IP> --bind <address to listen on>.'); process.exit(1); }
      if (host && !bind) { console.error('With --host, also pass --bind: the address on this computer to listen on (0.0.0.0 listens on every network).'); process.exit(1); }
      const old = readConfig().phone || {};
      const start = flag('allow-start', false) ? true : flag('deny-start', false) ? false : !!old.start;
      const phone = { host: host || ts.dns, ip: ts ? ts.ip : '', bind: bind || ts.ip, token: !rotate && old.token ? old.token : crypto.randomBytes(18).toString('base64url'), ...(port ? { port } : {}), ...(start ? { start } : {}) };
      writeConfig({ phone });
      const url = `http://${phone.host}:${phone.port || 4777}/?k=${phone.token}`;
      console.log(`${terminalQr(url)}\n\nOn your phone: ${url}`);
      if (host) console.log('This address is plain HTTP. Anyone who can reach it and sees the key can read and change your canvas: put it behind a VPN or a TLS proxy.');
      console.log(`Restart the page (trace-canvas serve) so it also listens on ${phone.bind}. Turn this off with trace-canvas phone --off; --rotate makes a new key.`);
      console.log(start ? '▶ Start is on: the phone can start a Claude Code session on a line in a Terminal window here (--deny-start turns it off).' : '▶ Start is off; --allow-start lets the phone start a Claude Code session on a line here.');
      break;
    }
    case 'where': {
      const q = argv.join(' ').trim();
      if (!q) { console.log(dataFile()); break; }
      const { whereFind } = await import('../src/hook.mjs');
      const rows = whereFind(readConfig(), q, str(flag('machine', '')));
      if (!rows.length) { console.log('Nothing in the location map matches.'); break; }
      for (const r of rows) {
        console.log(`${r.title} [${r.id}]`);
        for (const w of r.where) console.log(`  ${w.host}${w.role ? ` ${w.role}` : ''}: ${w.local || w.path || ''}`);
      }
      break;
    }
    case 'sync': {
      const { runSync } = await import('../src/sync.mjs');
      const r = runSync();
      if (flag('quiet', false)) break;
      if (r.error) { console.error(`Sync failed: ${r.error}`); process.exit(1); }
      if (r.busy) { console.log('Another sync is running.'); break; }
      console.log(`${r.machine}: ${r.imported} change${r.imported === 1 ? '' : 's'} from other machines, ${r.changed} here${r.moved ? `; ${r.moved} lines got stable ids` : ''}. ${r.offline ? 'Offline: pushes next time.' : r.pushed ? 'Pushed.' : r.committed ? 'Committed.' : 'Up to date.'}`);
      break;
    }
    case 'help': case '--help': case '-h': console.log(HELP); break;
    default: console.log(HELP); process.exit(1);
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
