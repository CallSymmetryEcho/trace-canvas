// Claude Code hook handler. Reads one hook event (JSON on stdin) and turns the
// moments that matter into records:
//   SessionStart, PreToolUse, Notification, SubagentStart/Stop  only update the live status (live.mjs)
//   UserPromptSubmit  the session's first instruction becomes a task
//   PostToolUse       file edits are collected; git commit / push / merge and
//                     `gh pr create` are logged as they happen
//   Stop              a turn that changed files becomes an agent record
//   SessionEnd        a summary of the whole session
// Records go to a thread per repository and branch, so parallel sessions on
// different branches land on different lines, unless the session was put on a line
// by hand. Which line a session is on lives in the data's session table, so it
// survives the session process ending and being resumed. The hook never prints to
// stdout and never fails the session.
import { lessonsFor } from './lessons.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { dataFile, home, mutate, readConfig, readData, createThread, addCommit, lastCommit, goalOf, hashId, threadById, threadByKey, isTodo, REVIEW_GATE, AUTOPILOT_ASK, AUTOPILOT_WORKER, AUTOPILOT_END, EVOLVE_ROUND } from './store.mjs';
import { gitEvents, redirectTargets, BASH_WRITES, EDIT_TOOLS, GIT_COMMIT, commandDir, commitMessage, headline, firstLine, cleanPrompt } from './git-events.mjs';
import { tr } from './i18n.mjs';
const threadIdOfLocal = (d, c) => (c && c.thread && d.threads[c.thread] ? c.thread : 'inbox');
import { dropLive, readLive, terminalOf, updateLive, listLive as listLiveLocal } from './live.mjs';
import { agentOf } from './agents.mjs';

export { headline, redirectTargets };

const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk']);
export const AGENT = 'Claude Code';

function git(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

export function repoInfo(cwd) {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top) return { repo: path.basename(cwd) || 'workspace', root: cwd, branch: null };
  let branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') branch = null;
  // In a worktree, name the thread after the main repository, not the worktree folder.
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const folder = common && path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(top);
  return { repo: remoteName(cwd) || folder, folder, root: top, branch };
}

// The repository's name from its remote (gitea, then origin, then the first one), so the same
// repository is the same line on every machine, whatever its folder is called there.
function remoteName(cwd) {
  const urls = new Map(git(cwd, ['config', '--get-regexp', '^remote\\..*\\.url$']).split('\n').map(l => l.match(/^remote\.(.+)\.url (.+)$/)).filter(Boolean).map(m => [m[1], m[2]]));
  const url = urls.get('gitea') || urls.get('origin') || urls.values().next().value;
  const m = url && url.replace(/\/+$/, '').match(/([^/:]+?)(?:\.git)?$/);
  return m ? m[1] : '';
}

// The main repository a folder belongs to (a worktree points back to it), so a commit made in a
// worktree stays readable after the worktree is gone.
export function gitRoot(dir) {
  const common = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common) return null;
  const root = path.basename(common) === '.git' ? path.dirname(common) : git(dir, ['rev-parse', '--show-toplevel']);
  return root ? real(root) : null; // the real path, so records of one repository compare equal
}

const stateFile = (sid, env) => path.join(home(env), 'sessions', String(sid).replace(/[^\w.-]/g, '_') + '.json');
function loadState(sid, env) {
  try { return JSON.parse(fs.readFileSync(stateFile(sid, env), 'utf8')); } catch {}
  return { startedAt: Date.now(), prompts: 0, files: [], turnFiles: [], turnTodos: [], turnActions: 0, doneTodos: [], commits: [], seen: [] };
}
function saveState(sid, state, env) {
  fs.mkdirSync(path.dirname(stateFile(sid, env)), { recursive: true });
  fs.writeFileSync(stateFile(sid, env), JSON.stringify(state));
}
function dropState(sid, env) { try { fs.unlinkSync(stateFile(sid, env)); } catch {} }

// git reports the real path, while cwd and tool paths may go through a link (on macOS /var and
// /tmp point into /private), so compare real paths. f itself may not exist yet; its folder does.
const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
export const rel = (root, f) => { try { const r = path.relative(real(root), path.join(real(path.dirname(f)), path.basename(f))); return r && !r.startsWith('..') ? r : f; } catch { return f; } };
const pushUnique = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
export const resumeLink = sid => `claude --resume ${sid}`;

function threadKey(info, cfg, sid) {
  if (cfg.group === 'session') return `session:${sid}`;
  if (cfg.group === 'repo' || !info.branch || DEFAULT_BRANCHES.has(info.branch)) return info.repo;
  return `${info.repo}@${info.branch}`;
}

/**
 * The line that claims the folder cwd is in (trace-canvas folder): one repository, several lines, by subfolder. The
 * folders are kept as the repository's name and a path inside it, so they hold on every machine; the deepest wins.
 */
export function folderLine(d, info, cwd) {
  const sub = info && info.root && cwd ? path.relative(info.root, real(cwd)) : '';
  if (!sub || sub.startsWith('..') || path.isAbsolute(sub)) return null;
  let best = null, depth = -1;
  for (const t of Object.values(d.threads)) {
    if (t.status === 'merged') continue;
    for (const f of t.folders || []) if (f.repo === info.repo && (sub === f.path || sub.startsWith(`${f.path}/`)) && f.path.length > depth) { best = t; depth = f.path.length; }
  }
  return best;
}
/** A line claims a folder of a repository (remove: gives it back). Returns { repo, path }. Call inside mutate(). */
export function claimFolder(d, th, dir, remove = false) {
  const info = repoInfo(path.resolve(dir)), sub = info.branch !== undefined && gitRoot(dir) ? path.relative(info.root, real(path.resolve(dir))) : '';
  if (!sub || sub.startsWith('..')) throw new Error(`${dir} is not a folder inside a git repository (the repository's own folder is its line already)`);
  const f = { repo: info.repo, path: sub.split(path.sep).join('/') }, same = x => x.repo === f.repo && x.path === f.path;
  th.folders = [...(th.folders || []).filter(x => !same(x)), ...(remove ? [] : [f])];
  if (!th.folders.length) delete th.folders;
  return f;
}

// Finds or creates the thread for a repository/branch. Exported for transcript capture.
export function resolveThread(d, info, { cfg, sid, prevThreadId = null, promptForName = '', agent = AGENT, cwd = '' }) {
  const claimed = folderLine(d, info, cwd);
  if (claimed) return claimed;
  const key = threadKey(info, cfg, sid);
  let t = threadByKey(d, key);
  if (t) return t;
  // Lines from before keys came from the remote are named after the folder: take such a line over.
  const old = info.folder && info.folder !== info.repo ? threadKey({ ...info, repo: info.folder }, cfg, sid) : null;
  t = old && threadByKey(d, old);
  if (t) { t.aliases = [...new Set([...(t.aliases || []), t.key, old].filter(k => k && k !== key))]; t.key = key; return t; }
  if (cfg.group === 'session') {
    const date = new Date().toISOString().slice(5, 10);
    return createThread(d, { id: hashId('t', key), name: firstLine(promptForName, 60) || tr(cfg.lang, 'sessionThread', info.repo, date), key });
  }
  // A repository's line takes in its history from before (src/history.mjs); `history: false` leaves it out.
  if (!key.includes('@')) return createThread(d, { id: hashId('t', key), name: info.repo, key, note: info.root, extra: { history: true } });
  // A new branch forks from the thread this session was on, else from the repository's main line.
  const prev = prevThreadId && d.threads[prevThreadId];
  const parent = prev && prev.key !== key ? prev : threadByKey(d, info.repo) || createThread(d, { id: hashId('t', info.repo), name: info.repo, key: info.repo, note: info.root, extra: { history: true } });
  const forkPoint = lastCommit(d, parent.id);
  t = createThread(d, { id: hashId('t', key), name: `${info.repo} · ${info.branch}`, key, parent: parent.id, forkOf: forkPoint ? forkPoint.id : null, note: info.root, extra: { history: true, ...(parent.group ? { group: parent.group } : {}) } });
  addCommit(d, { thread: t.id, kind: 'fork', title: tr(cfg.lang, 'branchedFrom', info.branch, parent.name), parents: forkPoint ? [forkPoint.id] : [], agent });
  return t;
}

function eventKey(input) {
  const ev = input.hook_event_name;
  if (ev === 'SessionEnd') return 'SessionEnd';
  const id = input.tool_use_id || input.prompt_id;
  return id ? `${ev}:${id}` : null;
}

const LOG_EVENTS = ['UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];
// Codex Desktop asks itself for a suggested next message in a hidden session of its own, in whatever folder is open
// (a worktree on a branch made a line of its own). None of it is the person's work, so it stays off the canvas.
const APP_PROMPT = /^\s*This is an app-generated request/;
const LIVE_EVENTS = [...LOG_EVENTS, 'SessionStart', 'PreToolUse', 'Notification', 'SubagentStart', 'SubagentStop'];

// The openings of the prompts Trace Canvas itself writes to hand a line over (src/ops.mjs, app/index.html).
// Keystrokes typed into the session rather than asked of it (":q", "login", "ok"): never a to-do.
export const notTask = prompt => { const p = String(prompt || '').trim(); return p.length < 3 || (!/\s/.test(p) && (/^:/.test(p) || /^(login|logout|exit|quit|clear|yes|no|ok|okay)$/i.test(p))); };
export const HANDOFF = /^(Autopilot \(beta\) on the Trace Canvas line|You are taking over the Trace Canvas line|New to-dos on the Trace Canvas line|Read the Trace Canvas line|读 Trace Canvas 上的线)/;

export function handleHook(input, env = process.env) {
  if (!input || typeof input !== 'object') return { skipped: 'no input' };
  if (env.TRACE_CANVAS_DISABLE === '1') return { skipped: 'disabled' };
  const ev = input.hook_event_name;
  if (!LIVE_EVENTS.includes(ev)) return { skipped: ev };
  const sid = input.session_id || 'unknown';
  if (ev === 'UserPromptSubmit' && APP_PROMPT.test(String(input.prompt || ''))) {
    saveState(sid, { ...loadState(sid, env), ignored: true }, env);
    try { dropLive(sid, env); } catch {}
    return { skipped: 'app-generated' };
  }
  if (loadState(sid, env).ignored) { if (ev === 'SessionEnd') dropState(sid, env); else try { dropLive(sid, env); } catch {} return { skipped: 'app-generated' }; }
  const cfg = readConfig(env);
  const cwd = input.cwd || process.cwd();
  const ag = agentOf(input._agent); // normalize() sets it for Codex and Gemini; plain input is Claude Code
  // git calls happen outside the lock so parallel sessions don't wait on each other.
  // PreToolUse and Notification fire on every tool call, so they reuse what the live file already knows.
  const relevantTool = ev !== 'PostToolUse' || input.tool_name === 'Bash' || EDIT_TOOLS.has(input.tool_name) || input.tool_name === 'TodoWrite';
  const quick = ['PreToolUse', 'Notification', 'SubagentStart', 'SubagentStop'].includes(ev);
  const known = ev !== 'SessionEnd' && readLive(sid, env);
  const info = ev !== 'SessionEnd' && relevantTool && !(quick && known) ? repoInfo(cwd) : null;
  // The session's terminal tab and agent process, looked up until the process is found (Go to the terminal; live while it runs).
  // A new process for the same session (the Agent SDK starts one each turn): its pid, so replies to it still find it.
  const terminal = ev === 'SessionEnd' ? null : !(known && 'pid' in known) ? terminalOf(env)
    : +env.CLAUDE_PID && known.pid !== +env.CLAUDE_PID ? { pid: +env.CLAUDE_PID } : null;
  // The repository a commit landed in, which is often not cwd's (`cd other && git commit`).
  const bashCmd = ev === 'PostToolUse' && input.tool_name === 'Bash' ? String((input.tool_input || {}).command || '') : '';
  const commitRepo = GIT_COMMIT.test(bashCmd) ? gitRoot(commandDir(bashCmd, cwd)) : null;
  // `git commit -q` (or output cut by `| tail`) prints no sha: then the commit is HEAD, if it was made just now.
  const head = commitRepo ? git(commitRepo, ['log', '-1', '--format=%H%x09%ct%x09%s']).split('\t') : [];
  const headNow = head.length === 3 && Date.now() - Number(head[1]) * 1000 < 120e3 ? { sha: head[0], subject: head[2] } : null;
  try { updateLive(input, { info, key: info ? threadKey(info, cfg, sid) : null, env, agent: ag.name, agentKey: input._agent || 'claude', resume: ag.resume(sid), machine: cfg.machine, terminal }); } catch {}
  if (!LOG_EVENTS.includes(ev)) return { live: ev };

  let due = null;
  const r = mutate(d => {
    const state = loadState(sid, env);
    const key = eventKey(input);
    if (key && state.seen.includes(key)) return false;
    if (key) { state.seen.push(key); if (state.seen.length > 300) state.seen = state.seen.slice(-200); }
    let changed = false;
    // The session's entry outlives this process: the desktop app ends sessions and resumes them
    // under the same id, and a resumed session stays on its line and does not log a first prompt again.
    const s = d.sessions[sid] || adoptSession(d, sid, state);
    const touch = () => { d.sessions[sid] = Object.assign(s, { id: sid, agent: ag.name, agentKey: input._agent || 'claude', resume: ag.resume(sid), cwd, machine: cfg.machine, last: Date.now() }); changed = true; };
    const thread = prompt => {
      const t = (s.bound && threadById(d, s.thread)) || resolveThread(d, info, { cfg, sid, prevThreadId: s.thread, promptForName: prompt || state.lastPrompt, agent: ag.name, cwd });
      s.thread = t.id; touch(); return t;
    };

    if (ev === 'UserPromptSubmit') {
      const prompt = cleanPrompt(input.prompt);
      state.prompts++;
      if (prompt && !prompt.startsWith('/')) state.lastPrompt = firstLine(prompt, 200);
      const isCommand = prompt.startsWith('/');
      // A hand-off prompt written by dispatch, hand or the page restates to-dos that are already on the line: not a new one.
      const handoff = HANDOFF.test(prompt);
      if (handoff) s.prompted = true;
      // An Autopilot round counts as running only once its prompt reaches a session: the switch lights here, not on the click.
      // Looked for in the raw prompt: pasted in with a word or two of the person's own, the paste is shortened in `prompt`.
      // Handed on in other words by another agent ("autopilot is on for twitq…, go on with its to-dos"): a message that
      // says autopilot and carries the id of a line waiting to be taken up. The id, not the name: a person asking a
      // session to turn Autopilot on names the line, and that session is not the one doing it.
      // Or left for this session as a reply (trace_log to:) when nothing could type it in: taken up at its next turn, where the
      // reply reaches it (promptContext, after this). Only an undelivered one, so an old round is not taken up again.
      const left = Object.values(d.commits).filter(c => c.to && !c.deliveredAt && sid.startsWith(c.to)).map(c => `${c.title}\n${c.body || ''}`);
      const raw = [String(input.prompt || ''), ...left].join('\n'), ap = /^Autopilot \(beta\) on the Trace Canvas line .*?\(thread ([\w-]+)\)/m.exec(raw);
      const apTh = ap ? d.threads[ap[1]] : /autopilot/i.test(raw) ? Object.values(d.threads).find(t => t.autopilot && !t.autopilot.session && raw.includes(t.id)) : null;
      // A round another session already holds stays with it (a prompt pasted twice): two agents on one line, one of them ungated.
      if (apTh && apTh.autopilot && (!apTh.autopilot.session || apTh.autopilot.session === sid)) { apTh.autopilot = { ...apTh.autopilot, session: sid, on: Date.now() }; changed = true; }
      // The person's message to an Autopilot agent (an answer, most often) starts a new stretch for autopilotStop. Kept in the
      // session's own state, not on the line: a write there would sync over the person turning it off on another machine.
      if (Object.values(d.threads).some(t => t.autopilot && t.autopilot.session === sid)) { state.apTurn = Date.now(); state.apNudged = 0; }
      // The person speaking to a session Autopilot was turned off in lets it work again (autopilotGate).
      for (const t of Object.values(d.threads)) if (t.apStopped && t.apStopped.session === sid) { delete t.apStopped; changed = true; }
      const log = !isCommand && prompt && !handoff && !notTask(prompt) && (cfg.prompts === 'all' || (cfg.prompts === 'first' && !s.prompted) || (cfg.prompts === 'long' && prompt.length >= 60));
      if (log) {
        const t = thread(prompt);
        addCommit(d, { thread: t.id, kind: 'task', title: firstLine(prompt, 120), body: prompt.slice(0, 3000), agent: ag.name, links: [ag.resume(sid)], extra: { session: sid, actor: 'human' } });
        s.prompted = true;
        if (!s.title) s.title = firstLine(prompt, 120);
      }
      // The line's history from before catches up in the background (the CLI starts it), at most every 10 minutes.
      const th = s.thread && threadById(d, s.thread);
      if (th && th.history && historyDue(th.id, env)) due = th.id;
    } else if (ev === 'PostToolUse') {
      const tool = input.tool_name, ti = input.tool_input || {}, out = input.tool_response || {};
      if (EDIT_TOOLS.has(tool)) {
        // Codex's apply_patch can touch several files at once (normalize puts them in `files`).
        for (const f of ti.files || [ti.file_path || ti.notebook_path || out.filePath].filter(Boolean)) {
          const r = rel(info ? info.root : cwd, path.resolve(cwd, f)); pushUnique(state.turnFiles, r); pushUnique(state.files, r);
        }
      } else if (tool === 'TodoWrite' && Array.isArray(ti.todos)) {
        for (const td of ti.todos) {
          const name = td && (td.content || td.subject);
          if (td && td.status === 'completed' && name && !state.doneTodos.includes(name)) { state.doneTodos.push(name); state.turnTodos.push(name); }
        }
      } else if (tool === 'Bash') {
        const cmd = String(ti.command || '');
        const root = info ? info.root : cwd;
        const targets = redirectTargets(cmd).map(f => rel(root, path.resolve(cwd, f)));
        for (const f of targets) { pushUnique(state.turnFiles, f); pushUnique(state.files, f); }
        if (targets.length || BASH_WRITES.test(cmd)) state.turnActions = (state.turnActions || 0) + 1;
        const g = { ...gitEvents(cmd, out.stdout, out.stderr, out.gitOperation), repo: commitRepo };
        // Only when the commit did not fail, HEAD carries the message the command gave, and it is not on the canvas yet.
        const msg = commitMessage(cmd), failed = /\b(fatal|error):|nothing to commit|no changes added/i.test(`${out.stdout || ''}\n${out.stderr || ''}`);
        if (!g.commits.length && headNow && !failed && !/--dry-run/.test(cmd) && (!msg || msg === headNow.subject) && !Object.values(d.commits).some(c => c.gitCommit === headNow.sha)) g.commits.push(headNow);
        if (logGitEvents(d, g, { info, cfg, sid, thread, state, agent: ag.name })) state.turnActions = (state.turnActions || 0) + 1;
      }
    } else if (ev === 'Stop') {
      const msg = String(input.last_assistant_message || '').trim();
      const files = state.turnFiles, todos = state.turnTodos;
      const acted = files.length > 0 || (state.turnActions || 0) > 0;
      const log = cfg.turns === 'all' ? !!(msg || acted) : cfg.turns === 'changes' ? acted : false;
      if (log) {
        const t = thread(state.lastPrompt);
        addCommit(d, { thread: t.id, kind: 'agent', title: headline(msg) || tr(cfg.lang, 'turnChanged', files.length), body: turnBody(cfg.lang, msg, files, todos), agent: ag.name, links: [ag.resume(sid)], extra: { session: sid, files: files.slice(0, 50) } });
      }
      state.turnFiles = []; state.turnTodos = []; state.turnActions = 0;
    } else if (ev === 'SessionEnd') {
      const th = threadById(d, s.thread), tid = th ? th.id : null;
      if (d.sessions[sid]) { s.last = Date.now(); changed = true; }
      if (tid && (state.prompts || state.files.length || state.commits.length)) {
        const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
        const links = [ag.resume(sid)];
        if (input.transcript_path) links.push(input.transcript_path);
        addCommit(d, { thread: tid, kind: 'note', title: tr(cfg.lang, 'sessionEnd', mins, state.prompts, state.files.length, state.commits.length), body: sessionBody(cfg.lang, state.files, state.commits, input.reason), agent: ag.name, links, extra: { session: sid } });
        changed = true;
      }
      dropState(sid, env);
      return changed ? undefined : false;
    }
    saveState(sid, state, env);
    return changed ? undefined : false;
  }, env);
  return due ? { history: due } : r;
}

/**
 * Whether a line's history should catch up now, and if so notes the time. Kept on this machine, not on the line:
 * each machine reads its own repositories and sessions, and a synced stamp would rewrite the line every few minutes.
 */
export function historyDue(tid, env = process.env, every = 10 * 60e3) {
  const f = path.join(home(env), 'history-at.json');
  let at = {};
  try { at = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  if (Date.now() - (at[tid] || 0) < every) return false;
  at[tid] = Date.now();
  try { fs.writeFileSync(f, JSON.stringify(at)); } catch {}
  return true;
}

// Sessions from before the session table: the old state file's binding, else the line of the
// session's newest record (a line without a key only gets a session's records by hand).
function adoptSession(d, sid, state) {
  if (state.threadId && d.threads[state.threadId]) return { thread: state.threadId, bound: !!state.bound, prompted: !!state.loggedFirstPrompt };
  let last = null;
  for (const c of Object.values(d.commits)) if (c.session === sid && (!last || c.ts > last.ts)) last = c;
  const t = last && threadById(d, last.thread);
  return { thread: t ? t.id : null, bound: !!t && !t.key, prompted: !!last };
}

// Puts a session on a line by hand (null undoes it); from then on its records go there, also after
// the session is resumed. Call it inside mutate().
export function bindSession(d, sid, tid, env = process.env) {
  const s = d.sessions[sid] || (d.sessions[sid] = { id: sid, ...adoptSession(d, sid, loadState(sid, env)) });
  s.thread = tid || null;
  s.bound = !!tid;
}

// The line a session is on: bound by hand, else where the hooks last put it, else its repo/branch line.
export function sessionThread(d, s, env = process.env) {
  const e = (d.sessions || {})[s.id] || adoptSession(d, s.id, loadState(s.id, env));
  const t = threadById(d, e.thread);
  if (t) return { threadId: t.id, bound: !!e.bound };
  const k = threadByKey(d, s.key);
  return { threadId: k ? k.id : null, bound: false };
}

// Where things are on this machine, from the location map: the entries whose local path holds cwd
// (or sits inside it). Empty when no map is set up or where.py is too old to answer in JSON.
// The first python3 that runs: one on PATH can be broken (linuxbrew's, built for a newer glibc)
// while the system's works.
export function python3(args, opts) {
  let err;
  for (const exe of ['python3', '/usr/bin/python3']) { try { return execFileSync(exe, args, opts); } catch (e) { err = e; } }
  throw err;
}
function whereRows(cfg) {
  const py = cfg.map && path.join(cfg.map, 'tools', 'where.py');
  if (!py || !fs.existsSync(py)) return [];
  try { return JSON.parse(python3([py, '--json'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return []; }
}
// Location-map entries matching every word of query (in their id, title, notes, tags or paths),
// with only the places on `machine` when one is given.
export function whereFind(cfg, query, machine = '') {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  return whereRows(cfg).filter(r => words.every(w => JSON.stringify(r).toLowerCase().includes(w)))
    .map(r => ({ id: r.id, title: r.title, notes: r.notes || '', where: (r.where || []).filter(w => !machine || w.host === machine) }))
    .filter(r => !machine || r.where.length);
}
function whereHere(cfg, cwd) {
  try {
    const rows = whereRows(cfg);
    const here = path.resolve(cwd);
    // Entries that contain cwd come first, the most specific (longest path) first, then things inside cwd.
    const score = r => Math.max(0, ...(r.where || []).filter(w => w.local).map(w => (here === w.local || here.startsWith(w.local + path.sep) ? 1e6 + w.local.length : w.local.startsWith(here + path.sep) ? 1 : 0)));
    return rows.map(r => [score(r), r]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, r]) => r);
  } catch { return []; }
}

/**
 * What a new session should know first: its line and goal, the open to-dos for this agent, who else
 * works on the line, and where things are on this machine. TRACE_CANVAS_THREAD (set by `hand`) binds
 * the session to that line. Returns '' when there is nothing useful to say.
 */
export function sessionStartContext(input, env = process.env) {
  const sid = input.session_id, cwd = input.cwd || process.cwd(), key = input._agent || 'claude', ag = agentOf(key);
  const cfg = readConfig(env);
  const d = readData(env);
  const handed = env.TRACE_CANVAS_THREAD && threadById(d, env.TRACE_CANVAS_THREAD);
  let tid = handed ? handed.id : null;
  if (tid && sid) mutate(dd => bindSession(dd, sid, tid, env), env);
  if (!tid && sid && !(d.sessions[sid] && d.sessions[sid].bound)) { const t = folderLine(d, repoInfo(cwd), cwd); if (t) tid = t.id; }
  if (!tid && sid) tid = sessionThread(d, { id: sid, key: threadKey(repoInfo(cwd), cfg, sid) }, env).threadId;
  const out = [];
  if (tid) {
    const th = d.threads[tid];
    const todos = Object.values(d.commits).filter(c => threadIdOfLocal(d, c) === tid && c.kind === 'task' && !c.done && !(c.session && !c.highlight)).sort((a, b) => a.ts - b.ts);
    const mine = todos.filter(c => c.assignee === key), free = todos.filter(c => !c.assignee);
    out.push(`Trace Canvas: this session works on the line "${th.name}" (thread ${tid}).`);
    const goal = goalOf(th);
    if (goal) out.push(`Goal: ${goal}`);
    // Level 1: a line still young is handed the lessons of finished projects that fit it (Theatrum, src/lessons.mjs).
    if (Object.values(d.commits).filter(c => threadIdOfLocal(d, c) === tid).length < 30 && env.TRACE_CANVAS_LESSONS !== '0') {
      const ls = lessonsFor([th.name, th.group, goal].filter(Boolean).join(' '));
      if (ls.length) out.push('Lessons from finished projects that may fit this line (Theatrum; memory_recall reads them in full):', ...ls.map(l => `- ${l.title} [${l.id}]`));
    }
    // A to-do the person sent back comes first, with their reason.
    if (mine.length) out.push(`Open to-dos for you (${ag.name}):`, ...mine.sort((a, b) => !!b.returned - !!a.returned).slice(0, 10).map(c => `- ${c.title} [${c.id}]${c.returned ? ` (sent back by the person: ${c.returned.note || 'no reason given'}; do this first)` : ''}`));
    if (free.length) out.push(`${free.length} open to-do${free.length === 1 ? ' is' : 's are'} not assigned to anyone yet.`);
    const others = listLiveLocal(env).filter(s => s.id !== sid && sessionThread(d, s, env).threadId === tid);
    if (others.length) out.push(`Also working on this line now: ${others.map(s => `${s.agent || 'Claude Code'} (${s.status}${s.activity ? `: ${s.activity}` : ''})`).join('; ')}.`);
  }
  const places = whereHere(cfg, cwd).slice(0, 3);
  if (places.length) {
    out.push('Where things are on this machine (from the location map):');
    for (const r of places) out.push(`- ${r.title}: ${(r.where || []).filter(w => w.local).slice(0, 4).map(w => `${w.role ? w.role + ' ' : ''}${w.local}`).join('; ')}${r.notes ? ` — ${String(r.notes).split('\n')[0]}` : ''}`);
  }
  if (!out.length) return '';
  out.push('Use the MCP tool trace_tasks with mine: true to read your to-dos, trace_task_done when one is finished, trace_log with kind "task" for new goals and next steps the person gives, and trace_log for decisions and results.');
  return out.join('\n');
}

/**
 * Said to the agent with every instruction: the line it works on, and to add the new goals, ideas
 * and next steps the person just gave as to-dos there, so the list keeps up without being asked.
 * The open to-dos are listed so the agent skips what is already on it.
 */
/**
 * Autopilot goes on without the person prompting it: when its agent stops while it could go on (no summary since the
 * person's last message, to-dos still open on its line), the Stop hook hands it the next one ({decision: block}).
 * Pushed once already and no to-do done since: it may stop, so it never loops. '' lets it stop.
 */
export function autopilotStop(input, env = process.env) {
  const sid = input.session_id;
  if (!sid) return '';
  // Reads only: its counters live in the session's state, so the running machine never writes the line (see the UserPromptSubmit part).
  const d = readData(env), th = Object.values(d.threads).find(t => t.autopilot && t.autopilot.session === sid);
  if (!th) return '';
  const st = loadState(sid, env), ap = th.autopilot, since = Math.max(ap.on || 0, st.apTurn || 0);
  const cs = Object.values(d.commits).filter(c => threadIdOfLocal(d, c) === th.id);
  // Stopped to ask, or held at the review gate (its prompt says to write the summary there).
  if (cs.some(c => c.ts > since && AUTOPILOT_END.test(c.title || ''))) return '';
  if (cs.filter(c => isTodo(c) && c.done && c.toReview).length >= REVIEW_GATE) return '';
  let reason = '';
  {
    // The to-dos trace_tasks lists (not a session's first instruction), less those it asked about since the person last spoke
    // (an answer frees the to-do) or gave a worker this round.
    const said = (re, from) => cs.filter(c => c.ts > from && re.test(c.title || '')).map(c => `${c.title} ${c.body || ''}`);
    const asks = said(AUTOPILOT_ASK, since), handed = said(AUTOPILOT_WORKER, ap.on || 0), named = (list, c) => list.some(a => a.includes(c.id));
    const open = cs.filter(c => isTodo(c) && !c.done).sort((a, b) => a.ts - b.ts), todo = open.filter(c => !named(asks, c) && !named(handed, c));
    // Self-iteration: with rounds and time left, a cleared line is not the end; a logged round counts as progress.
    const ev = ap.evolve, done = cs.filter(c => c.kind === 'decision' && c.ts > (ap.on || 0) && EVOLVE_ROUND.test(c.title || '')).sort((a, b) => a.ts - b.ts), rounds = done.length;
    const stuck = rounds >= 2 && done.slice(-2).every(c => /revert|撤回|没保留/i.test(c.title)); // two rounds in a row kept nothing
    const evolving = !!ev && rounds < ev.rounds && Date.now() < ev.until && !stuck;
    const progress = cs.filter(c => isTodo(c) && c.done).length + open.length - todo.length + rounds; // ticked, asked about, handed out, rounds
    if ((!open.length && !evolving) || (st.apNudged && progress <= st.apDoneAtNudge)) return '';
    if (!todo.length && open.some(c => named(handed, c) && !named(asks, c))) return ''; // waiting for its workers: their results wake it
    saveState(sid, { ...st, apNudged: (st.apNudged || 0) + 1, apDoneAtNudge: progress }, env);
    const head = `Autopilot is on for the line "${th.name}" (thread ${th.id}), to clear its to-dos: ${open.length} open`;
    reason = !todo.length && evolving
      ? `Autopilot self-iteration is on for the line "${th.name}" (thread ${th.id}): ${rounds} of ${ev.rounds} rounds done, its to-dos are ${open.length ? 'all waiting on the person' : 'cleared'}. Measure by "${firstLine(ev.metric, 200)}", log "Evolve round ${rounds + 1}: kept|reverted · <before → after>" for the round just done if not yet logged, then set the next 1-3 "Evolve: …" to-dos that should move the measure and do them. Stop with the "Autopilot summary" only when two rounds in a row kept nothing or the next step needs the person.`
      : todo.length
      ? `${head}, next: ${firstLine(todo[0].title, 120)} [${todo[0].id}]. Go on by the decision profile, with this line's to-dos only. One you cannot decide: log "Question: <the question> [<its id>]" and go on with the next; write the "Autopilot summary" only when the rest all wait on the person or on another running session.`
      : `${head}, each with a question asked. Log the "Autopilot summary" with the count (cleared N · M wait on you · K with others) and the questions together, then stop.`;
  }
  return reason;
}

/**
 * Autopilot turned off is a stop, not a request: the session that ran it is refused every tool but Trace Canvas's own
 * (PreToolUse, synchronous) until the person speaks to it or a new round starts. The reason tells it to log where it
 * stopped and end its turn. Runs on every tool call, so the data is only parsed when it can matter. '' lets it run.
 */
export function autopilotGate(input, env = process.env) {
  const sid = input.session_id, tool = String(input.tool_name || '');
  if (!sid || tool.startsWith('mcp__trace-canvas__')) return '';
  let raw;
  try { raw = fs.readFileSync(dataFile(env), 'utf8'); } catch { return ''; }
  if (!raw.includes('"apStopped"') || !raw.includes(sid)) return '';
  const th = Object.values(JSON.parse(raw).threads || {}).find(t => t.apStopped && t.apStopped.session === sid && !(t.autopilot && t.autopilot.session === sid));
  return th ? `The person turned Autopilot off on the Trace Canvas line "${th.name}" (thread ${th.id}). Stop here: do not go on with this to-do or start another. Log one record with trace_log on that line saying where you stopped and what is left half done, then end your turn and wait for the person.` : '';
}

// Replies other sessions logged for this one (trace_log to): handed over once, at its next turn. A session whose
// process changes every turn (the Agent SDK) has a new messaging name each time, so a SendMessage reply misses it.
export function takeReplies(sid, env = process.env, now = Date.now()) {
  const mine = c => c.to && !c.deliveredAt && sid.startsWith(c.to);
  if (!Object.values(readData(env).commits).some(mine)) return '';
  const got = mutate(d => Object.values(d.commits).filter(mine).sort((a, b) => a.ts - b.ts).map(c => { c.deliveredAt = now; return c; }), env);
  return got.length ? `Replies other sessions left for you on Trace Canvas: ${got.map(c => `[${c.id}] ${firstLine(c.title, 160)}${c.body ? ` — ${String(c.body).replace(/\s+/g, ' ').slice(0, 600)}` : ''}`).join(' | ')}` : '';
}

export function promptContext(input, env = process.env) {
  if (!input.session_id || cleanPrompt(input.prompt).startsWith('/')) return '';
  const replies = takeReplies(input.session_id, env);
  return [replies, lineContext(input, env)].filter(Boolean).join('\n');
}
function lineContext(input, env) {
  const d = readData(env), { threadId } = sessionThread(d, { id: input.session_id }, env);
  const th = threadId && d.threads[threadId];
  // The person answering an Autopilot agent that stopped to ask: the switch is still on, so it goes on after this.
  const ap = Object.values(d.threads).find(t => t.autopilot && t.autopilot.session === input.session_id);
  const apNote = ap ? ` Autopilot is still on for the line "${ap.name}" (thread ${ap.id}): if this message answers what you stopped to ask, log the answer as a decision, then go on clearing its open to-dos by the decision profile (one you cannot decide: log "Question: … [its id]" and go on) until the line is clear or only questions are left.` : '';
  if (!th) return apNote.trim();
  const open = Object.values(d.commits).filter(c => threadIdOfLocal(d, c) === th.id && c.kind === 'task' && !c.done && !(c.session && !c.highlight)).sort((a, b) => a.ts - b.ts);
  return `Trace Canvas: you work on the line "${th.name}" (thread ${th.id}). If this message gives a new goal, idea or next step worth tracking, add each one now as a to-do with trace_log (kind "task", thread "${th.id}"), one short title per item; not the request in this message, which you are doing now, nor anything you will finish in this same turn${open.length ? `, and what is already open: ${open.slice(-8).map(c => firstLine(c.title, 60)).join('; ')}` : ''}.${apNote}`;
}

export function turnBody(lang, msg, files, todos = []) {
  return [String(msg || '').slice(0, 1500),
    files.length ? `${tr(lang, 'filesLabel')}:\n${files.slice(0, 30).map(f => '- ' + f).join('\n')}${files.length > 30 ? `\n- … +${files.length - 30}` : ''}` : '',
    todos.length ? `${tr(lang, 'todosLabel')}:\n${todos.map(x => '- ' + x).join('\n')}` : ''].filter(Boolean).join('\n\n');
}
export function sessionBody(lang, files, commits, reason) {
  return [
    files.length ? `${tr(lang, 'filesLabel')}:\n${files.slice(0, 40).map(f => '- ' + f).join('\n')}` : '',
    commits.length ? `${tr(lang, 'commitsLabel')}:\n${commits.map(x => '- ' + x).join('\n')}` : '',
    reason ? tr(lang, 'reason', reason) : '',
  ].filter(Boolean).join('\n\n');
}

// Writes the records for one command's git events. Returns true if anything was logged.
export function logGitEvents(d, g, { info, cfg, sid, thread, state, ts, agent = AGENT }) {
  let changed = false;
  const at = ts ? { ts } : {};
  for (const { sha, subject } of g.commits) {
    const t = thread();
    addCommit(d, { thread: t.id, kind: 'agent', title: tr(cfg.lang, 'commit', sha.slice(0, 7), subject.slice(0, 160)), agent, ...at, extra: { session: sid, gitCommit: sha, ...(g.repo ? { repo: g.repo } : {}) } });
    if (state) state.commits.push(`${sha.slice(0, 7)} ${subject.slice(0, 100)}`);
    changed = true;
  }
  if (g.push) {
    const t = thread();
    addCommit(d, { thread: t.id, kind: 'note', title: tr(cfg.lang, 'pushed', g.push), agent, ...at, extra: { session: sid } });
    changed = true;
  }
  if (g.pr) {
    const t = thread();
    addCommit(d, { thread: t.id, kind: 'decision', title: tr(cfg.lang, 'prOpened', g.pr.number), links: [g.pr.url], agent, ...at, extra: { session: sid } });
    changed = true;
  }
  if (g.merge && info) {
    const src = Object.values(d.threads).find(x => x.key === `${info.repo}@${g.merge}`);
    const t = thread();
    if (src && src.id !== t.id) {
      const srcTip = lastCommit(d, src.id), tip = lastCommit(d, t.id);
      addCommit(d, { thread: t.id, kind: 'merge', title: tr(cfg.lang, 'merged', src.name), parents: [tip && tip.id, srcTip && srcTip.id].filter(Boolean), agent, ...at, extra: { session: sid, mergeOf: src.id } });
      src.status = 'merged'; src.mergedInto = t.id;
      changed = true;
    }
  }
  return changed;
}

export async function readStdin() {
  if (process.stdin.isTTY) return '';
  let s = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) s += chunk;
  return s;
}
