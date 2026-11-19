// What a commit on the canvas changed, read from git when the page asks. Nothing is stored: a
// record keeps its sha and repository, git keeps the rest. Read-only, no shell, capped output, and
// a plain reason instead of an error when the repository or the commit is not here any more.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

// What a changed file is to a reader: source first, then tests, then docs; binary and generated files (lock files, builds) last.
const TEST = /(^|\/)(tests?|__tests__|spec|fixtures|e2e)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i;
const DOC = /\.(md|markdown|rst|txt|adoc)$|(^|\/)(docs?|site)\/|(^|\/)(LICENSE|CHANGELOG|README)[^/]*$/i;
export const roleOf = (file, binary) => (binary || GENERATED.test(file) ? 'gen' : TEST.test(file) ? 'test' : DOC.test(file) ? 'doc' : 'src');
const RANK = { src: 0, test: 1, doc: 2, gen: 3 };
// numstat lines → files, by role (roleOf), the biggest change first within each.
function filesOf(out) {
  return out.split('\n').filter(l => /^(\d+|-)\t(\d+|-)\t/.test(l)).map(l => {
    const [a, del, ...p] = l.split('\t'), file = p.join('\t'), binary = a === '-';
    return { path: file, add: binary ? 0 : Number(a), del: binary ? 0 : Number(del), binary, generated: GENERATED.test(file), role: roleOf(file, binary) };
  }).sort((x, y) => RANK[x.role] - RANK[y.role] || (y.add + y.del) - (x.add + x.del));
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
  const meta = await git(at, ['show', '-s', '--format=%H%x1f%s%x1f%an%x1f%aI%x1f%B', at.sha]);
  if (!meta) return { sha: at.sha, missing: 'no-commit' };
  const [sha, subject, author, date, full = ''] = meta.out.trim().split('\x1f');
  // The whole message, without the trailers (Co-Authored-By: …) at its end: the page shows it above the files as the summary.
  const message = full.split('\n').filter(l => !/^[A-Za-z][A-Za-z-]+: \S/.test(l) || !/^(co-authored-by|signed-off-by|claude-session|reviewed-by):/i.test(l)).join('\n').trim().slice(0, 4000) || subject;
  const info = { id, repo: at.repo, ...(at.machine ? { machine: at.machine } : {}), sha, short: sha.slice(0, 7), subject, message, author, date };
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

// Where each hunk of a diff sits in the file as it is after the change: its language when the file holds several (a page: css inside
// <style>, js inside <script>), and the function, class, test, CSS rule or heading around its first changed line. Read from indentation:
// from that line upwards, each less-indented line is an enclosing block, and the first that names something is the scope.
// ponytail: no parser, so code that is not indented by nesting gets no scope (the page then shows git's own hunk text).
const JS_SCOPE = [
  [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)/, m => `function ${m[1]}`],
  [/^(?:export\s+)?(?:default\s+)?class\s+([\w$]+)/, m => `class ${m[1]}`],
  [/^(?:test|it|describe)\(\s*(['"`])(.+?)\1/, m => `test: ${m[2]}`],
  // A name given to a function, or to an object or list written over several lines; any other assignment is just a statement.
  [/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=\s*(?:(?:async\s+)?function\b|(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|[[{]\s*$)/, m => m[1]],
  [/^([\w$]+)\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/, m => m[1]],
  [/^(?:static\s+|async\s+|get\s+|set\s+)*([\w$]+)\s*\([^)]*\)\s*\{\s*$/, m => (/^(if|for|while|switch|catch|function|return|with)$/.test(m[1]) ? null : `${m[1]}()`)],
];
const SCOPES = {
  js: JS_SCOPE,
  css: [[/^([^{}/*][^{}]*?)\s*\{/, m => m[1]]],
  py: [[/^(?:async\s+)?def\s+(\w+)/, m => `def ${m[1]}`], [/^class\s+(\w+)/, m => `class ${m[1]}`]],
  json: [[/^"([^"]+)"\s*:\s*[{[]\s*$/, m => m[1]]],
  other: [[/^(?:pub(?:\([a-z]+\))?\s+)?(?:async\s+)?(?:fn|func)\s+(?:\([^)]*\)\s*)?(\w+)/, m => `func ${m[1]}`], [/^(?:[\w:<>,*&\s]+\s+)?(class|struct|interface|enum)\s+(\w+)/, m => `${m[1]} ${m[2]}`]],
};
const LANG = { js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', css: 'css', scss: 'css', less: 'css', py: 'py', json: 'json', md: 'md', markdown: 'md', html: 'html', htm: 'html' };
export function hunkPlaces(diff, text, file) {
  const lines = String(text).split('\n'), ext = LANG[(/\.([a-z0-9]+)$/i.exec(file) || [])[1]?.toLowerCase()] || 'other';
  let region = null;
  if (ext === 'html') {
    region = []; let cur = 'html';
    for (const l of lines) {
      region.push(cur);
      if (cur === 'html') cur = /<style\b[^>]*>(?!.*<\/style>)/i.test(l) ? 'css' : /<script\b[^>]*>(?!.*<\/script>)/i.test(l) ? 'js' : 'html';
      else if (/<\/(style|script)>/i.test(l)) cur = 'html';
    }
  }
  const indent = l => l.length - l.trimStart().length;
  const scopeAt = i => {
    const lang = region ? region[i] : ext;
    if (lang === 'md') { for (let j = i; j >= 0; j--) { const m = /^#{1,6}\s+(.+)/.exec(lines[j]); if (m) return m[1].trim(); } return null; }
    const pats = SCOPES[lang]; if (!pats) return null;
    let ind = lines[i] && lines[i].trim() ? indent(lines[i]) + 1 : Infinity; // + 1: the changed line itself may be the one that names the scope
    for (let j = i, n = 0; j >= 0 && n < 5000; j--, n++) {
      const l = lines[j];
      if (region && region[j] !== lang) break;
      if (!l || !l.trim() || indent(l) >= ind) continue;
      ind = indent(l);
      for (const [re, name] of pats) { const m = re.exec(l.trim()), s = m && name(m); if (s) return s.replace(/\s+/g, ' ').slice(0, 80); }
      if (!ind) break; // top level and unnamed: nothing encloses it
    }
    return null;
  };
  const out = []; let n = 0, open = false;
  for (const l of String(diff).split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { n = Number(h[1]); open = true; continue; }
    if (!open) { if (l[0] === ' ' || l[0] === '+') n++; continue; }
    if (l[0] === ' ') { n++; continue; }
    if (l[0] !== '+' && l[0] !== '-') continue;
    const i = Math.min(Math.max(n - 1, 0), lines.length - 1);
    out.push({ lang: region ? region[i] : '', scope: scopeAt(i) }); open = false;
    if (l[0] === '+') n++;
  }
  return out;
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
  if (!r) return { error: 'git could not show this diff' };
  // The file as it is after the change, to place each hunk in it; a deleted or very large file has no places.
  const whole = await git(info, ['show', `${info.against ? info.to : info.sha}:${file}`], 12 * CAP);
  return { file, diff: r.out, truncated: !!r.truncated, hunks: whole && !whole.truncated ? hunkPlaces(r.out, whole.out, file) : [] };
}

/**
 * What a commit changes, for a person who will not read the code: two sentences for the whole commit and one per changed file on what
 * changed there and why, written by the person's own claude or codex (ask) from the commit message and the diffs. The page asks for it
 * once, on the computer itself, and the answer is kept on the record (server.mjs /api/git/explain), so opening the record costs nothing.
 */
export async function explainCommit(d, id, lang, ask) {
  const info = await commitInfo(d, id);
  if (info.error || info.missing) return { error: info.error || 'This commit is not on this computer' };
  const files = info.files.filter(f => f.role !== 'gen').slice(0, 30), parts = [];
  let room = 120000; // characters of diff in all; ponytail: a commit larger than this is explained from its first files and the message
  for (const f of files) {
    if (room <= 0) break;
    const r = await git(info, ['show', ...PLAIN, '--format=', info.sha, '--', f.path], CAP);
    const text = ((r && r.out) || '').split('\n').map(l => (l.length > 400 ? l.slice(0, 400) + ' …' : l)).join('\n').slice(0, Math.min(12000, room));
    room -= text.length; parts.push(`### ${f.path} (+${f.add} -${f.del})\n${text}`);
  }
  const prompt = [
    'Below is one git commit: its message, then the diff of each changed file.',
    `For a person who will not read the code, write in ${lang === 'zh' ? 'Simplified Chinese (简体中文)' : 'English'}:`,
    '- "summary": at most two sentences on what this commit changes and why;',
    '- "files": for each file path below, one sentence on what changed in that file and why, in plain words, no code, at most 60 characters in Chinese or 30 words in English.',
    'Use only what the message and the diffs show. Where the reason is not shown, say what changed and leave the reason out.',
    'Answer with JSON only, no other text: {"summary": "…", "files": {"<path>": "…"}}',
    '', '## Message', info.message, '', '## Files', ...parts,
  ].join('\n');
  let j;
  try { j = JSON.parse(/\{[\s\S]*\}/.exec(await ask(prompt, { timeout: 240000 }))[0]); } catch (e) { return { error: e instanceof SyntaxError || e instanceof TypeError ? 'The answer could not be read' : e.message }; }
  const str = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const notes = { sha: info.sha, summary: str(j.summary, 400), files: Object.fromEntries(info.files.map(f => [f.path, str(j.files && j.files[f.path], 240)]).filter(x => x[1])) };
  return notes.summary || Object.keys(notes.files).length ? { notes } : { error: 'The answer could not be read' };
}

const home = p => p.replace(/^~(?=\/|$)/, os.homedir());
const linked = (d, p) => Object.values(d.commits || {}).some(c => (c.links || []).some(l => String(l).trim() === p));
/** A local text file a record links (a report: .md, .markdown, .txt; or data and code a research card traces to: .csv, .tsv, .json,
 * .py, .r), as text for the page, or an error code. Only a path some record links is read, so the page cannot read anything else;
 * ~ is the home folder. */
export const TEXT_FILE = /\.(md|markdown|txt|csv|tsv|json|py|r)$/i;
export function readLinkedMd(d, want) {
  const p = String(want || '').trim();
  if (!TEXT_FILE.test(p)) return { error: 'type' };
  if (!linked(d, p)) return { error: 'unlinked' };
  try {
    const file = home(p), st = fs.statSync(file);
    if (st.size > 2 << 20) return { error: 'big' };
    return { text: fs.readFileSync(file, 'utf8') };
  } catch { return { error: 'missing' }; }
}

const IMG = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
/** An image for the reader: one a record links, or (with from) one a linked .md report shows as ![alt](src), a relative src
 * taken from the report's folder. Nothing else is read; 10 MB at most. Returns { type, data } or { error }. */
export function readLinkedImage(d, want, from) {
  const p = String(want || '').trim(), type = IMG[((/\.(\w+)$/.exec(p) || [])[1] || '').toLowerCase()];
  if (!type) return { error: 'type' };
  let file = home(p);
  if (from) {
    const md = readLinkedMd(d, from);
    if (md.error) return md;
    if (![...md.text.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g)].some(m => m[1] === p)) return { error: 'unlinked' };
    let src = p; try { src = decodeURI(p); } catch {}
    file = /^[/~]/.test(src) ? home(src) : path.resolve(path.dirname(home(String(from).trim())), src);
  } else if (!linked(d, p)) return { error: 'unlinked' };
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { error: 'missing' };
    if (st.size > 10 << 20) return { error: 'bigImg' };
    return { type, data: fs.readFileSync(file) };
  } catch { return { error: 'missing' }; }
}
