// Claude Code hook handler. Reads one hook event (JSON on stdin) and turns the
// moments that matter into records:
//   UserPromptSubmit  the session's first instruction becomes a task
//   PostToolUse       file edits are collected; git commit / push / merge and
//                     `gh pr create` are logged as they happen
//   Stop              a turn that changed files becomes an agent record
//   SessionEnd        a summary of the whole session
// Records go to a thread per repository and branch, so parallel sessions on
// different branches land on different lines. The hook never prints to stdout
// and never fails the session.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { home, mutate, readConfig, createThread, addCommit, lastCommit } from './store.mjs';
import { tr } from './i18n.mjs';

const DEFAULT_BRANCHES = new Set(['main', 'master', 'trunk']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const AGENT = 'Claude Code';

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
  const repo = common && path.basename(common) === '.git' ? path.basename(path.dirname(common)) : path.basename(top);
  return { repo, root: top, branch };
}

const stateFile = (sid, env) => path.join(home(env), 'sessions', String(sid).replace(/[^\w.-]/g, '_') + '.json');
function loadState(sid, env) {
  try { return JSON.parse(fs.readFileSync(stateFile(sid, env), 'utf8')); } catch {}
  return { startedAt: Date.now(), threadId: null, prompts: 0, loggedFirstPrompt: false, files: [], turnFiles: [], turnTodos: [], doneTodos: [], commits: [], seen: [] };
}
function saveState(sid, state, env) {
  fs.mkdirSync(path.dirname(stateFile(sid, env)), { recursive: true });
  fs.writeFileSync(stateFile(sid, env), JSON.stringify(state));
}
function dropState(sid, env) { try { fs.unlinkSync(stateFile(sid, env)); } catch {} }

const firstLine = (s, n) => {
  const line = String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
};
// First sentence of an assistant message. Headings and code are skipped, markdown stripped.
export function headline(msg, n = 110) {
  const lines = String(msg || '').replace(/```[\s\S]*?```/g, '\n').split('\n').map(x => x.trim()).filter(Boolean);
  const pick = lines.find(l => !/^#{1,6}\s/.test(l) && l.replace(/[^\p{L}\p{N}]/gu, '').length > 2) || lines[0] || '';
  const plain = pick.replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`>|]/g, '').trim();
  const sentence = plain.split(/(?<=[.!?])\s+|(?<=[。！？])/)[0] || plain;
  return sentence.length > n ? sentence.slice(0, n - 1) + '…' : sentence;
}
function cleanPrompt(p) {
  return String(p || '').replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content>/g, '[pasted]').trim();
}
// Shell commands that change files, and the targets of `>` / `>>` redirects.
const BASH_WRITES = /(?:^|[\s;&|(])(?:tee|sed\s+-i\S*|perl\s+-pi\S*|mv|cp|rm|mkdir|touch|ln|git\s+(?:mv|rm|apply|restore|checkout\s+--))(?=\s)/;
export function redirectTargets(cmd) {
  const out = [];
  // Drop heredoc bodies and quoted strings first, so a `>` inside a message is not read as a redirect.
  const bare = String(cmd)
    .replace(/<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\s|$|\))/g, '<<$2$3')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  for (const m of bare.matchAll(/(?<![0-9&<>=\-])>{1,2}[ \t]*([^\s|;&<>()'"]+)/g)) {
    const f = m[1];
    if (f && !f.startsWith('&') && !f.startsWith('/dev/')) out.push(f);
  }
  return out;
}
const rel = (root, f) => { try { const r = path.relative(root, f); return r && !r.startsWith('..') ? r : f; } catch { return f; } };
const pushUnique = (arr, v) => { if (v && !arr.includes(v)) arr.push(v); };
const resumeLink = sid => `claude --resume ${sid}`;

function threadKey(info, cfg, sid) {
  if (cfg.group === 'session') return `session:${sid}`;
  if (cfg.group === 'repo' || !info.branch || DEFAULT_BRANCHES.has(info.branch)) return info.repo;
  return `${info.repo}@${info.branch}`;
}

function resolveThread(d, info, state, cfg, sid, promptForName) {
  const key = threadKey(info, cfg, sid);
  let t = Object.values(d.threads).find(x => x.key === key);
  if (t) return t;
  if (cfg.group === 'session') {
    const date = new Date().toISOString().slice(5, 10);
    return createThread(d, { name: firstLine(promptForName, 60) || tr(cfg.lang, 'sessionThread', info.repo, date), key });
  }
  if (!key.includes('@')) return createThread(d, { name: info.repo, key, note: info.root });
  // A new branch forks from the thread this session was on, else from the repository's main line.
  const prev = state.threadId && d.threads[state.threadId];
  const parent = prev && prev.key !== key ? prev : Object.values(d.threads).find(x => x.key === info.repo) || createThread(d, { name: info.repo, key: info.repo, note: info.root });
  const forkPoint = lastCommit(d, parent.id);
  t = createThread(d, { name: `${info.repo} · ${info.branch}`, key, parent: parent.id, forkOf: forkPoint ? forkPoint.id : null, note: info.root });
  addCommit(d, { thread: t.id, kind: 'fork', title: tr(cfg.lang, 'branchedFrom', info.branch, parent.name), parents: forkPoint ? [forkPoint.id] : [], agent: AGENT });
  return t;
}

function eventKey(input) {
  const ev = input.hook_event_name;
  if (ev === 'SessionEnd') return 'SessionEnd';
  const id = input.tool_use_id || input.prompt_id;
  return id ? `${ev}:${id}` : null;
}

export function handleHook(input, env = process.env) {
  if (!input || typeof input !== 'object') return { skipped: 'no input' };
  if (env.TRACE_CANVAS_DISABLE === '1') return { skipped: 'disabled' };
  const ev = input.hook_event_name;
  if (!['UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'].includes(ev)) return { skipped: ev };
  const sid = input.session_id || 'unknown';
  const cfg = readConfig(env);
  const cwd = input.cwd || process.cwd();
  // git calls happen outside the lock so parallel sessions don't wait on each other.
  const needsRepo = ev !== 'SessionEnd' && !(ev === 'PostToolUse' && input.tool_name !== 'Bash' && !EDIT_TOOLS.has(input.tool_name) && input.tool_name !== 'TodoWrite');
  const info = needsRepo ? repoInfo(cwd) : null;

  return mutate(d => {
    const state = loadState(sid, env);
    const key = eventKey(input);
    if (key && state.seen.includes(key)) return false;
    if (key) { state.seen.push(key); if (state.seen.length > 300) state.seen = state.seen.slice(-200); }
    let changed = false;
    const thread = prompt => { const t = resolveThread(d, info, state, cfg, sid, prompt); state.threadId = t.id; changed = true; return t; };

    if (ev === 'UserPromptSubmit') {
      const prompt = cleanPrompt(input.prompt);
      state.prompts++;
      if (prompt && !prompt.startsWith('/')) state.lastPrompt = firstLine(prompt, 200);
      const isCommand = prompt.startsWith('/');
      const log = !isCommand && prompt && (cfg.prompts === 'all' || (cfg.prompts === 'first' && !state.loggedFirstPrompt) || (cfg.prompts === 'long' && prompt.length >= 60));
      if (log) {
        const t = thread(prompt);
        addCommit(d, { thread: t.id, kind: 'task', title: firstLine(prompt, 120), body: prompt.slice(0, 3000), agent: AGENT, links: [resumeLink(sid)], extra: { session: sid } });
        state.loggedFirstPrompt = true;
      }
    } else if (ev === 'PostToolUse') {
      const tool = input.tool_name, ti = input.tool_input || {}, out = input.tool_response || {};
      if (EDIT_TOOLS.has(tool)) {
        const f = ti.file_path || ti.notebook_path || out.filePath;
        if (f) { const r = rel(info ? info.root : cwd, f); pushUnique(state.turnFiles, r); pushUnique(state.files, r); }
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
        if (logGit(d, input, info, state, cfg, sid, thread)) { changed = true; state.turnActions = (state.turnActions || 0) + 1; }
      }
    } else if (ev === 'Stop') {
      const msg = String(input.last_assistant_message || '').trim();
      const files = state.turnFiles, todos = state.turnTodos;
      const acted = files.length > 0 || (state.turnActions || 0) > 0;
      const log = cfg.turns === 'all' ? !!(msg || acted) : cfg.turns === 'changes' ? acted : false;
      if (log) {
        const t = thread(state.lastPrompt);
        const body = [msg.slice(0, 1500),
          files.length ? `${tr(cfg.lang, 'filesLabel')}:\n${files.slice(0, 30).map(f => '- ' + f).join('\n')}${files.length > 30 ? `\n- … +${files.length - 30}` : ''}` : '',
          todos.length ? `${tr(cfg.lang, 'todosLabel')}:\n${todos.map(x => '- ' + x).join('\n')}` : ''].filter(Boolean).join('\n\n');
        addCommit(d, { thread: t.id, kind: 'agent', title: headline(msg) || tr(cfg.lang, 'turnChanged', files.length), body, agent: AGENT, links: [resumeLink(sid)], extra: { session: sid, files: files.slice(0, 50) } });
      }
      state.turnFiles = []; state.turnTodos = []; state.turnActions = 0;
    } else if (ev === 'SessionEnd') {
      const tid = state.threadId && d.threads[state.threadId] ? state.threadId : null;
      if (tid && (state.prompts || state.files.length || state.commits.length)) {
        const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
        const body = [
          state.files.length ? `${tr(cfg.lang, 'filesLabel')}:\n${state.files.slice(0, 40).map(f => '- ' + f).join('\n')}` : '',
          state.commits.length ? `${tr(cfg.lang, 'commitsLabel')}:\n${state.commits.map(x => '- ' + x).join('\n')}` : '',
          input.reason ? tr(cfg.lang, 'reason', input.reason) : '',
        ].filter(Boolean).join('\n\n');
        const links = [resumeLink(sid)];
        if (input.transcript_path) links.push(input.transcript_path);
        addCommit(d, { thread: tid, kind: 'note', title: tr(cfg.lang, 'sessionEnd', mins, state.prompts, state.files.length, state.commits.length), body, agent: AGENT, links, extra: { session: sid } });
        changed = true;
      }
      dropState(sid, env);
      return changed ? undefined : false;
    }
    saveState(sid, state, env);
    return changed ? undefined : false;
  }, env);
}

function logGit(d, input, info, state, cfg, sid, thread) {
  const cmd = String((input.tool_input || {}).command || '');
  const res = input.tool_response || {};
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  let changed = false;

  if (/\bgit\b[^\n;&|]*\bcommit\b/.test(cmd) && !/--dry-run/.test(cmd)) {
    const stat = (out.match(/^\s*\d+ files? changed.*$/m) || [''])[0].trim();
    const found = [...out.matchAll(/^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm)].map(m => ({ sha: m[2], subject: m[3] }));
    // Newer Claude Code versions also report the commit as structured data, which survives `| tail` and quiet flags.
    const op = res.gitOperation && res.gitOperation.commit;
    if (!found.length && op && op.sha && (!op.kind || op.kind === 'committed')) {
      const msg = (cmd.match(/\s-m\s+(["'])([\s\S]*?)\1/) || [])[2] || '';
      found.push({ sha: String(op.sha), subject: msg.split('\n')[0].trim() || String(op.branch || '') });
    }
    for (const { sha, subject } of found) {
      const t = thread();
      addCommit(d, { thread: t.id, kind: 'agent', title: tr(cfg.lang, 'commit', sha.slice(0, 7), subject.slice(0, 160)), body: stat, agent: AGENT, extra: { session: sid, gitCommit: sha } });
      state.commits.push(`${sha.slice(0, 7)} ${subject.slice(0, 100)}`);
      changed = true;
    }
  }
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(cmd) && !/Everything up-to-date/.test(out)) {
    const ref = out.match(/^\s*[+*\-!= ]?\s*(?:[0-9a-f]+\.\.\.?[0-9a-f]+|\[new branch\]|\[new tag\])\s+(\S+)\s+->\s+(\S+)/m);
    if (ref) {
      const t = thread();
      addCommit(d, { thread: t.id, kind: 'note', title: tr(cfg.lang, 'pushed', ref[2]), agent: AGENT, extra: { session: sid } });
      changed = true;
    }
  }
  const pr = /\bgh\s+pr\s+create\b/.test(cmd) && out.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/);
  if (pr) {
    const t = thread();
    addCommit(d, { thread: t.id, kind: 'decision', title: tr(cfg.lang, 'prOpened', pr[1]), links: [pr[0]], agent: AGENT, extra: { session: sid } });
    changed = true;
  }
  const mg = cmd.match(/\bgit\s+merge\s+(?:--?[\w-]+(?:[= ][^\s-]\S*)?\s+)*([\w./@-]+)/);
  if (mg && !/CONFLICT|Already up to date|fatal|error:/i.test(out) && info) {
    const branch = mg[1].replace(/^origin\//, '');
    const src = Object.values(d.threads).find(x => x.key === `${info.repo}@${branch}`);
    const t = thread();
    if (src && src.id !== t.id) {
      const srcTip = lastCommit(d, src.id), tip = lastCommit(d, t.id);
      addCommit(d, { thread: t.id, kind: 'merge', title: tr(cfg.lang, 'merged', src.name), parents: [tip && tip.id, srcTip && srcTip.id].filter(Boolean), agent: AGENT, extra: { session: sid, mergeOf: src.id } });
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
