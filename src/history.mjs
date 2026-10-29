// A line's history from before it was on the canvas: its repository's commits (the default branch by first parent, or
// a branch line's own commits) and the Claude Code and Codex sessions that ran in the repository, one record each.
// collect() reads git and the transcripts from a snapshot, outside the data lock; apply() adds what is still new.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCommit, hashId, readConfig } from './store.mjs';
import { firstLine } from './git-events.mjs';
import { gitRoot, repoInfo } from './hook.mjs';
import { tr } from './i18n.mjs';
import { findTranscripts, parseTranscript } from './transcript.mjs';
import { codexPrompts } from './retro.mjs';

export const LIMIT = 500; // commits per line; older ones become one record. ponytail: lift it once the page loads on demand
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const tryGit = (root, args) => { try { return git(root, args).trim(); } catch { return ''; } };

/** The repository a line stands for here: its key or an alias names it as the hooks do (repo, or repo@branch). */
export function lineRepo(d, th) {
  const keys = [th.key, ...(th.aliases || [])].filter(Boolean);
  const dirs = [firstLine(th.note || ''),
    ...Object.values(d.commits).filter(c => c.thread === th.id && c.repo).map(c => c.repo),
    ...Object.values(d.sessions || {}).filter(s => s.thread === th.id).map(s => s.cwd)];
  for (const dir of new Set(dirs)) {
    if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir)) continue;
    const root = gitRoot(dir);
    if (!root) continue;
    const name = repoInfo(root).repo;
    if (keys.includes(name)) return { root, name, branch: null };
    const k = keys.find(k => k.startsWith(`${name}@`));
    if (k) return { root, name, branch: k.slice(name.length + 1) };
  }
  return null;
}

// The local branch if there is one, else the remote's.
const ref = (root, b) => tryGit(root, ['rev-parse', '--verify', '-q', `refs/heads/${b}`]) ? b : tryGit(root, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${b}`]) ? `origin/${b}` : '';
function defaultBranch(root) {
  const head = tryGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, '');
  return [head, 'main', 'master'].filter(Boolean).map(b => ref(root, b)).find(Boolean) || 'HEAD';
}
// https://host/owner/repo or git@host:owner/repo → the commit's page; other remotes (ssh with a port) get none.
function commitPage(root) {
  const url = tryGit(root, ['remote', 'get-url', 'origin']).replace(/\.git$/, '');
  const m = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+\/.+)$/) || url.match(/^[\w.-]+@([\w.-]+):(?!\d+\/)(.+)$/);
  return m ? sha => `https://${m[2] ? `${m[1]}/${m[2]}` : m[1]}/commit/${sha}` : null;
}
const shaOf = c => c.gitCommit || (/^c-git-([0-9a-f]{7,40})$/.exec(c.id) || [])[1];
// ponytail: 7-character prefixes, since the hooks often keep only those; a clash skips one commit
const knownShas = d => new Set(Object.values(d.commits).map(shaOf).filter(Boolean).map(s => s.slice(0, 7)));
// The same commit under another sha (rebased, or the repository split off from another one) keeps its subject and its
// author time: a record with that subject, as the hooks title it or alone, within 10 minutes counts as that commit.
const knownMoments = d => {
  const m = new Map();
  for (const c of Object.values(d.commits)) if (c.kind === 'agent') { const k = c.title.replace(/^(Commit|提交) [0-9a-f]{7,40}[:：] ?/, ''); m.set(k, [...(m.get(k) || []), c.ts]); }
  return m;
};
const seenIn = (shas, moments) => c => shas.has(c.sha.slice(0, 7)) || (moments.get(c.subject.slice(0, 160)) || []).some(ts => Math.abs(ts - c.ts) <= 10 * 60e3);
const knownSessions = d => new Set([...Object.keys(d.sessions || {}), ...Object.values(d.commits).flatMap(c => [c.session, c.fromSession])].filter(Boolean));

// Author time: when the work was done, which a rebase keeps.
const FMT = ['%H', '%at', '%an', '%ae', '%s', '%(trailers:key=Co-authored-by,valueonly,separator=%x1d)'].join('%x1f') + '%x1e';
function commits(root, range, limit) {
  const me = tryGit(root, ['config', 'user.email']).toLowerCase(), page = commitPage(root);
  return tryGit(root, ['log', '--first-parent', `--max-count=${limit}`, `--format=${FMT}`, ...range]).split('\x1e').map(s => s.trim()).filter(Boolean).map(s => {
    const [sha, ct, an, ae, subject, co = ''] = s.split('\x1f');
    // Who: an agent named in Co-authored-by, else you (your own address) or the author by name.
    const agent = /claude/i.test(co) ? 'Claude Code' : /codex|openai/i.test(co) ? 'Codex' : /gemini/i.test(co) ? 'Gemini CLI' : ae.toLowerCase() === me ? '' : an;
    return { sha, ts: Number(ct) * 1000, subject, agent, human: !/claude|codex|openai|gemini/i.test(co), link: page && page(sha) };
  }).reverse();
}

function claudeSessions(root, known, env) {
  const out = [];
  for (const f of findTranscripts(root, env)) {
    if (known.has(f.sessionId)) continue; // before parsing: a long transcript takes a while
    const s = parseTranscript(f.path);
    if (!s.turns.length || known.has(s.sessionId)) continue;
    const files = new Set(s.turns.flatMap(t => t.files)).size, commits = s.turns.flatMap(t => t.git.flatMap(g => g.commits.map(c => c.sha.slice(0, 7))));
    if (s.turns.length === 1 && !files && !commits.length) continue; // one prompt that changed nothing: a probe or a quick question
    out.push({ id: s.sessionId, agentKey: 'claude', agent: 'Claude Code', start: s.startedAt, end: s.endedAt, title: s.title || s.turns[0].prompt,
      prompts: s.turns.length, files, commits });
  }
  return out;
}
function codexSessions(root, known, env) {
  const base = env.CODEX_HOME || path.join(os.homedir(), '.codex'), out = [];
  const walk = dir => { let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch {} return es.flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : /^rollout-.*\.jsonl$/.test(e.name) ? [path.join(dir, e.name)] : []); };
  for (const file of [...walk(path.join(base, 'sessions')), ...walk(path.join(base, 'archived_sessions'))]) {
    const id = (file.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/) || [])[1];
    if (!id || known.has(id)) continue;
    let head = '';
    try { const fd = fs.openSync(file, 'r'), buf = Buffer.alloc(16384); head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8'); fs.closeSync(fd); } catch { continue; }
    const m = head.match(/"cwd":"((?:[^"\\]|\\.)*)"/), cwd = m && JSON.parse(`"${m[1]}"`);
    if (!cwd || (cwd !== root && !cwd.startsWith(`${root}/`))) continue;
    if (/"thread_source":"(?!user")/.test(head)) continue; // Codex's own reviewers (guardian_review) and helpers, not the person's sessions
    const ps = codexPrompts(file); // what the person typed; a session with none (an app's own request) is left out
    if (ps.length) out.push({ id, agentKey: 'codex', agent: 'Codex', start: ps[0].ts, end: fs.statSync(file).mtimeMs, title: ps[0].text, prompts: ps.length, files: 0, commits: [] });
  }
  return out;
}

/** What the line would get, read from a snapshot of the data: { root, branch, commits, older, sessions } or null. */
export function collect(d, th, env = process.env, limit = LIMIT) {
  const r = lineRepo(d, th);
  if (!r) return null;
  const main = defaultBranch(r.root), branch = r.branch && ref(r.root, r.branch);
  if (r.branch && !branch) return null;
  const range = branch ? [branch, `^${main}`] : [main];
  const seen = seenIn(knownShas(d), knownMoments(d)), all = commits(r.root, range, limit), total = Number(tryGit(r.root, ['rev-list', '--first-parent', '--count', ...range])) || all.length;
  let older = null;
  if (total > all.length) older = { n: total - all.length, ts: Number(tryGit(r.root, ['log', '--first-parent', '--max-parents=0', '--format=%at', ...range]).split('\n')[0]) * 1000 || all[0].ts - 1 };
  const known = knownSessions(d);
  const sessions = r.branch ? [] : [...claudeSessions(r.root, known, env), ...codexSessions(r.root, known, env)].sort((a, b) => a.start - b.start);
  return { root: r.root, name: r.name, branch: branch || main, commits: all.filter(c => !seen(c)), older, sessions };
}

/** Adds what is still new (checked again: the hooks may have logged a commit meanwhile). Call inside mutate(). */
export function apply(d, th, plan, env = process.env) {
  const cfg = readConfig(env), status = th.status, seen = seenIn(knownShas(d), knownMoments(d)), known = knownSessions(d), day = ts => new Date(ts).toISOString().slice(0, 10);
  let commitsAdded = 0, sessionsAdded = 0, prev = null;
  const older = plan.older && hashId('c', `${plan.name}:older:${th.id}`);
  if (older && !d.commits[older]) prev = addCommit(d, { thread: th.id, kind: 'note', title: tr(cfg.lang, 'olderCommits', plan.older.n, day(plan.older.ts)), ts: plan.older.ts, parents: [], extra: { id: older, imported: 'git' } });
  for (const c of plan.commits) {
    const id = hashId('c', `${plan.name}:${c.sha}`);
    if (d.commits[id] || seen(c)) continue;
    prev = addCommit(d, { thread: th.id, kind: 'agent', title: tr(cfg.lang, 'commit', c.sha.slice(0, 7), c.subject.slice(0, 160)), agent: c.agent, ts: c.ts, links: c.link ? [c.link] : [], parents: prev ? [prev.id] : [],
      extra: { id, gitCommit: c.sha, repo: plan.root, imported: 'git', ...(c.human ? { actor: 'human' } : {}) } });
    commitsAdded++;
  }
  for (const s of plan.sessions) {
    if (known.has(s.id)) continue;
    const resume = s.agentKey === 'codex' ? `codex resume ${s.id}` : `claude --resume ${s.id}`;
    addCommit(d, { thread: th.id, kind: 'note', title: firstLine(s.title, 100), body: tr(cfg.lang, 'pastSession', s), agent: s.agent, ts: s.start, links: [resume], parents: [], extra: { id: hashId('c', `session:${s.id}`), session: s.id, imported: 'session' } });
    // It joins the line's sessions, so it can be resumed from there.
    d.sessions[s.id] = { id: s.id, thread: th.id, agent: s.agent, agentKey: s.agentKey, resume, cwd: plan.root, machine: cfg.machine, title: firstLine(s.title, 120), last: s.end || s.start };
    sessionsAdded++;
  }
  th.status = status; // old records do not wake a parked line
  th.history = true;
  return { commits: commitsAdded, sessions: sessionsAdded, older: !!(older && plan.older) };
}

/** The lines that stand for a repository here and have not been switched off, each with what it would get. */
export function historyLines(d, env = process.env) {
  return Object.values(d.threads).filter(th => th.history !== false && th.status !== 'merged').map(th => ({ th, plan: collect(d, th, env) })).filter(x => x.plan);
}
