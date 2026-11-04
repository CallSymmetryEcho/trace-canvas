// What a commit on the canvas changed, read from git when the page asks. Nothing is stored: a
// record keeps its sha and repository, git keeps the rest. Read-only, no shell, capped output, and
// a plain reason instead of an error when the repository or the commit is not here any more.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { q } from './agents.mjs';
import { ARGS, otherMachines } from './remote.mjs';
import { readConfig } from './store.mjs';

const SHA = /^[0-9a-f]{7,40}$/;
const CAP = 200 * 1024; // one diff
const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|[^/]+\.lock|[^/]+\.min\.(js|css)|[^/]+\.map)$|(^|\/)(dist|build)\//;
// No colour, no external diff or textconv programs from the repository's config, paths as they are.
const PLAIN = ['--no-color', '--no-ext-diff', '--no-textconv', '--no-renames'];

// at: { repo } here, or { repo, machine } on another machine over ssh (the same git command, quoted for its shell).
function git(at, args, maxBuffer = 4 * CAP) {
  const cmd = ['git', '-C', at.repo, '-c', 'core.quotepath=off', ...args];
  const [bin, argv, timeout] = at.machine ? ['ssh', [...ARGS, at.machine, cmd.map(q).join(' ')], 15000] : [cmd[0], cmd.slice(1), 5000];
  return new Promise(resolve => execFile(bin, argv, { timeout, maxBuffer, encoding: 'utf8' }, (e, out) => {
    if (!e) return resolve({ out });
    resolve(e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? { out, truncated: true } : null);
  }));
}

// Commits logged by the hooks carry gitCommit; tools/git_to_canvas.mjs-style records carry it in their id.
const shaOf = c => (c && (c.gitCommit || ((c.id || '').match(/^c-git-([0-9a-f]{7,40})$/) || [])[1])) || null;
const firstLine = s => String(s || '').split('\n')[0].trim();

// Where to look: the record's own repository, its session's folder, its line's folder, then every
// folder the canvas knows, which finds commits logged before records kept their repository, and every
// repository another record names: a commit made on another machine is found in this one's clone.
function candidates(d, c) {
  const s = (d.sessions || {})[c.session], th = d.threads[c.thread];
  const lines = Object.values(d.threads).map(t => firstLine(t.note)), sessions = Object.values(d.sessions || {}).map(x => x.cwd);
  const repos = Object.values(d.commits).map(x => x.repo);
  return [...new Set([c.repo, s && s.cwd, th && firstLine(th.note), ...lines, ...sessions, ...repos].filter(p => p && path.isAbsolute(p)))];
}

const found = new Map(); // sha → { repo, machine? }; ponytail: first-in-first-out at 200, enough for one person's canvas
const remember = (sha, at) => { found.set(sha, at); if (found.size > 200) found.delete(found.keys().next().value); return { sha, ...at }; };
async function locate(d, c) {
  const sha = shaOf(c);
  if (!sha || !SHA.test(sha)) return { missing: 'no-commit' };
  if (found.has(sha)) return { sha, ...found.get(sha) };
  const here = candidates(d, c).filter(p => fs.existsSync(p));
  for (let repo of here) {
    if (await git({ repo }, ['cat-file', '-e', `${sha}^{commit}`])) {
      const top = await git({ repo }, ['rev-parse', '--show-toplevel']);
      repo = (top && top.out.trim()) || repo; // a session's subfolder names its repository's root
      return remember(sha, { repo });
    }
  }
  // No clone here: read it on the machine it was made on, when that is allowed and it is one we know.
  const away = c.machine && c.repo && readConfig().awayGit && otherMachines(d).includes(c.machine) && { repo: c.repo, machine: c.machine };
  if (away && await git(away, ['cat-file', '-e', `${sha}^{commit}`])) return remember(sha, away);
  // Not here: say which computer it was made on, so the person knows where to look.
  const missing = !here.length || (c.repo && !fs.existsSync(c.repo)) ? 'no-repo' : 'no-commit';
  return { sha, missing, ...(missing === 'no-repo' && c.machine ? { machine: c.machine } : {}) };
}

// numstat lines → files, the biggest change first; binary and generated files go last.
function filesOf(out) {
  return out.split('\n').filter(l => /^(\d+|-)\t(\d+|-)\t/.test(l)).map(l => {
    const [a, del, ...p] = l.split('\t'), file = p.join('\t'), binary = a === '-';
    return { path: file, add: binary ? 0 : Number(a), del: binary ? 0 : Number(del), binary, generated: GENERATED.test(file) };
  }).sort((x, y) => (x.binary || x.generated) - (y.binary || y.generated) || (y.add + y.del) - (x.add + x.del));
}

/**
 * One record's commit: its metadata and changed files. With `against` (another record), the files
 * that differ between the two commits, from the earlier to the later.
 */
export async function commitInfo(d, id, against = null) {
  const c = d.commits[id];
  if (!c) return { error: 'No such record' };
  const at = await locate(d, c);
  if (at.missing) return at;
  const meta = await git(at, ['show', '-s', '--format=%H%x1f%s%x1f%an%x1f%aI', at.sha]);
  if (!meta) return { sha: at.sha, missing: 'no-commit' };
  const [sha, subject, author, date] = meta.out.trim().split('\x1f');
  const info = { id, repo: at.repo, ...(at.machine ? { machine: at.machine } : {}), sha, short: sha.slice(0, 7), subject, author, date };
  if (!against) {
    const ns = await git(at, ['show', ...PLAIN, '--numstat', '--format=', sha]);
    return { ...info, files: ns ? filesOf(ns.out) : [] };
  }
  const o = d.commits[against], other = shaOf(o);
  if (!o || !other || !SHA.test(other) || !(await git(at, ['cat-file', '-e', `${other}^{commit}`]))) return { ...info, against: { id: against, missing: 'no-commit' }, files: [] };
  const [from, to] = o.ts < c.ts ? [other, sha] : [sha, other];
  const ns = await git(at, ['diff', ...PLAIN, '--numstat', from, to]);
  return { ...info, against: { id: against, sha: other, short: other.slice(0, 7) }, from, to, files: ns ? filesOf(ns.out) : [] };
}

/** The diff of one file of a record's commit, or between two records' commits. */
export async function commitDiff(d, id, file, against = null) {
  const info = await commitInfo(d, id, against);
  if (info.missing || info.error || (info.against && info.against.missing)) return info;
  // Only a file git itself listed for this change, which also rules out paths like ../../x.
  if (!info.files.some(f => f.path === file)) return { error: 'That file is not part of this change' };
  const r = info.against
    ? await git(info, ['diff', ...PLAIN, info.from, info.to, '--', file], CAP)
    : await git(info, ['show', ...PLAIN, '--format=', info.sha, '--', file], CAP);
  return r ? { file, diff: r.out, truncated: !!r.truncated } : { error: 'git could not show this diff' };
}
