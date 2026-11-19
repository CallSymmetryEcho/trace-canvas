import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { explainCommit, hunkPlaces, commitDiff, commitInfo } from '../src/git-view.mjs';
import { GIT_COMMIT, commandDir } from '../src/git-events.mjs';
import { gitRoot, handleHook } from '../src/hook.mjs';
import { createThread, emptyData, mutate, readData } from '../src/store.mjs';

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function repo(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: { ...process.env, ...ENV } }).trim();
  git('init', '-q', '-b', 'main');
  const commit = (files, msg) => { for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), body); git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD'); };
  return { dir: fs.realpathSync(dir), git, commit };
}

test('a commit record shows its files and diffs, compares with another, and says why when it cannot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gitview-'));
  const r = repo(root, 'tripsplit');
  const one = r.commit({ 'split.js': 'a\nb\nc\n', 'package-lock.json': '{}\n', 'logo.png': Buffer.from([0, 1, 2, 0, 255]) }, 'Split the bill');
  const two = r.commit({ 'split.js': 'a\nB\nc\nd\n' }, 'Round to cents');
  const three = r.commit({ 'notes.md': 'x\n' }, 'Notes');
  const big = r.commit({ 'big.txt': 'x'.repeat(120) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(3000) }, 'A big file');
  const d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: r.dir });
  const rec = (id, extra) => { d.commits[id] = { id, thread: th.id, kind: 'agent', title: id, ts: Object.keys(d.commits).length, ...extra }; };
  rec('r1', { gitCommit: one, repo: r.dir });
  rec('r2', { gitCommit: two }); // no repository recorded: found through the line's folder
  rec('r3', { gitCommit: big, repo: r.dir });
  rec('gone', { gitCommit: 'deadbee', repo: r.dir });
  rec('elsewhere', { gitCommit: 'abcdef1', repo: path.join(root, 'not-here'), machine: 'studio' });
  // Made on another machine, in a folder that is not here: found in this machine's clone that another record names.
  const away = createThread(d, { name: 'away' });
  d.commits.abroad = { id: 'abroad', thread: away.id, kind: 'agent', title: 'abroad', ts: 9, gitCommit: three, repo: '/home/studio/tripsplit', machine: 'studio' };

  const i1 = await commitInfo(d, 'r1');
  assert.equal(i1.subject, 'Split the bill');
  assert.deepEqual(i1.files.map(f => [f.path, f.add, f.binary, f.generated]), [['split.js', 3, false, false], ['package-lock.json', 1, false, true], ['logo.png', 0, true, false]]);
  assert.match((await commitDiff(d, 'r1', 'split.js')).diff, /^\+b$/m);
  // Source first, then tests, then docs, whatever their size; lock files and binaries last.
  const mixed = r.commit({ 'README.md': 'x\n'.repeat(50), 'split.test.js': 't\n'.repeat(20), 'tip.js': 'one\n', 'yarn.lock': 'l\n'.repeat(900) }, 'Tips');
  rec('r4', { gitCommit: mixed, repo: r.dir });
  assert.deepEqual((await commitInfo(d, 'r4')).files.map(f => [f.path, f.role]), [['tip.js', 'src'], ['split.test.js', 'test'], ['README.md', 'doc'], ['yarn.lock', 'gen']]);
  assert.match((await commitDiff(d, 'r1', '../../etc/passwd')).error, /not part of this change/);

  const i2 = await commitInfo(d, 'r2', 'r1');
  assert.equal(i2.repo, r.dir);
  assert.deepEqual([i2.from, i2.to, i2.files.map(f => f.path)], [one, two, ['split.js']]);
  assert.match((await commitDiff(d, 'r2', 'split.js', 'r1')).diff, /^-b\n\+B$/m);

  assert.equal((await commitDiff(d, 'r3', 'big.txt')).truncated, true);
  assert.equal((await commitInfo(d, 'gone')).missing, 'no-commit');
  assert.deepEqual([(await commitInfo(d, 'elsewhere')).missing, (await commitInfo(d, 'elsewhere')).machine], ['no-repo', 'studio']);
  assert.equal((await commitInfo(d, 'abroad')).repo, r.dir);
  assert.equal((await commitInfo(d, 'nope')).error, 'No such record');
});

test('a commit made in another folder or a worktree records the repository it landed in', () => {
  assert.equal(commandDir(`cd "/a b" && cd sub && git add -A && git commit -m x`, '/w'), '/a b/sub');
  assert.equal(commandDir('git -C ../other commit -m x', '/w/here'), '/w/other');
  assert.equal(commandDir('cd ~/proj; git commit -am x', '/w'), path.join(os.homedir(), 'proj'));
  assert.equal(commandDir('cd $SOMEWHERE && git commit -m x', '/w'), '/w');
  // Only a real `git … commit` counts as a commit command.
  for (const c of ['git commit -m x', 'cd a && git commit -am x', 'git -c user.name=p -c user.email=p@x commit -m y', 'git -C "/a b" commit', 'x=$(git --no-pager commit -q)']) assert.ok(GIT_COMMIT.test(c), c);
  for (const c of ['git log --grep commit', "await git(repo, ['cat-file', '-e', `${sha}^{commit}`])", "import { commitInfo } from './src/git-view.mjs'", 'echo "git commit"']) assert.ok(!GIT_COMMIT.test(c), c);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gitrepo-'));
  const home = repo(root, 'graduation'), other = repo(root, 'trace-canvas');
  home.commit({ 'a.md': 'x' }, 'init'); other.commit({ 'b.md': 'y' }, 'init');
  const wt = path.join(root, 'wt');
  other.git('worktree', 'add', '-q', '-b', 'feature', wt);
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'tc'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const commitIn = (cmd, sha, n) => handleHook({ session_id: 's1', cwd: home.dir, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: `u${n}`, tool_input: { command: cmd }, tool_response: { stdout: `[main ${sha}] Work` } }, env);
  commitIn(`cd ${other.dir} && git commit -m Work`, '1a2b3c4', 1);
  commitIn(`git -C ${wt} commit -m Work`, '5d6e7f8', 2);
  const repos = Object.values(readData(env).commits).sort((a, b) => a.ts - b.ts).map(c => c.repo);
  assert.deepEqual(repos, [other.dir, other.dir]); // the worktree points back to its main repository
  // A folder reached through a link records the repository's real path.
  const link = path.join(root, 'link-to-other'); fs.symlinkSync(other.dir, link);
  assert.equal(gitRoot(link), other.dir);
});

test('the page reads a commit and a diff through the server', async () => {
  process.env.TRACE_CANVAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gitsrv-'));
  const r = repo(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gitsrv-repo-')), 'app');
  const sha = r.commit({ 'x.js': 'one\n' }, 'First');
  mutate(d => { d.commits.c1 = { id: 'c1', thread: 'inbox', kind: 'agent', title: 'First', ts: 1, gitCommit: sha, repo: r.dir }; });
  const { startServer } = await import('../src/server.mjs');
  const { server, url } = await startServer({ port: 0 });
  try {
    const info = await (await fetch(url + 'api/git/commit?record=c1')).json();
    assert.deepEqual(info.files.map(f => f.path), ['x.js']);
    const diff = await (await fetch(url + 'api/git/diff?record=c1&file=x.js')).json();
    assert.match(diff.diff, /^\+one$/m);
  } finally {
    server.close();
    fs.unwatchFile(path.join(process.env.TRACE_CANVAS_HOME, 'data.json'));
  }
});

test('a commit with no clone here is read on the machine it was made on, over ssh, unless that is off', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gitaway-')));
  const r = repo(root, 'studio-only'), sha = r.commit({ 'a.txt': 'one\n' }, 'Made on the studio');
  // A stand-in ssh: drops the options and the machine, then runs the command here with /away/ taken out of its paths.
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nwhile [ "$1" = "-o" ]; do shift 2; done\nshift\nexec sh -c "$(printf %s "$1" | sed s#/away/#/#)"\n', { mode: 0o755 });
  const keep = { PATH: process.env.PATH, HOME_: process.env.TRACE_CANVAS_HOME, M: process.env.TRACE_CANVAS_MACHINE };
  Object.assign(process.env, { PATH: `${bin}:${keep.PATH}`, TRACE_CANVAS_HOME: path.join(root, 'tc'), TRACE_CANVAS_MACHINE: 'mac' });
  try {
    const d = emptyData(), th = createThread(d, { name: 'studio' });
    d.commits.s1 = { id: 's1', thread: th.id, kind: 'agent', title: 's1', ts: 1, gitCommit: sha, repo: path.join(root, 'away', 'studio-only'), machine: 'studio' };
    fs.mkdirSync(path.join(root, 'tc'));
    fs.writeFileSync(path.join(root, 'tc', 'config.json'), JSON.stringify({ awayGit: false }));
    assert.deepEqual([(await commitInfo(d, 's1')).missing, (await commitInfo(d, 's1')).machine], ['no-repo', 'studio']);
    fs.writeFileSync(path.join(root, 'tc', 'config.json'), '{}');
    const i = await commitInfo(d, 's1');
    assert.deepEqual([i.machine, i.subject, i.files.map(f => f.path)], ['studio', 'Made on the studio', ['a.txt']]);
    assert.match((await commitDiff(d, 's1', 'a.txt')).diff, /^\+one$/m);
  } finally {
    process.env.PATH = keep.PATH;
    for (const [k, v] of [['TRACE_CANVAS_HOME', keep.HOME_], ['TRACE_CANVAS_MACHINE', keep.M]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('each hunk of a diff is placed in its file: the language of that part of a page, and the function, rule, test or heading around it', () => {
  const page = ['<!doctype html>', '<style>', '.card { color: red; }', '@media (max-width: 760px) {', '  .card,', '  .sheet {', '    color: blue;', '  }', '}', '</style>', '<div id="app"></div>', '<script>',
    'const S = {};', 'function draw(c) {', '  if (c.open) {', '    paint(c);', '  }', '}', 'class Pane {', '  render(x) {', '    return x;', '  }', '}', 'boot();', '</script>'].join('\n');
  const at = (n, file = 'app/index.html', text = page) => hunkPlaces(`@@ -${n},1 +${n},1 @@\n-old\n+new`, text, file)[0];
  assert.deepEqual(at(3), { lang: 'css', scope: '.card' });              // a one-line rule names itself
  assert.deepEqual(at(7), { lang: 'css', scope: '.sheet' });             // a selector spread over lines is named by its last line
  assert.deepEqual(at(11), { lang: 'html', scope: null });
  assert.deepEqual(at(16), { lang: 'js', scope: 'function draw' });      // through the if, to the function
  assert.deepEqual(at(21), { lang: 'js', scope: 'render()' });
  assert.deepEqual(at(24), { lang: 'js', scope: null });                 // a top-level statement has no scope
  const fn = "const TOOLS = [\n  {\n    name: 'x',\n  },\n];\nfunction call(a) {\n  const c = mutate(d => {\n    d.x = 1;\n  });\n}\nconst pick = (a) => {\n  return a;\n};\n";
  assert.deepEqual([3, 8, 12].map(n => at(n, 'src/mcp.mjs', fn).scope), ['TOOLS', 'function call', 'pick']); // a plain assignment on the way up is not a scope
  assert.equal(at(2, 'a.py', 'class A:\n    def run(self):\n        x = 1\n        return x\n').scope, 'def run');
  assert.equal(at(4, 'README.md', '# Title\n\n## Install\ntext\n').scope, 'Install');
  assert.equal(at(3, 't.test.mjs', "test('adds up', () => {\n  const a = 1;\n  assert.equal(a, 1);\n});\n").scope, 'test: adds up');
  // Two hunks: each takes the first changed line after its own context lines.
  const two = hunkPlaces('@@ -13,3 +13,3 @@\n const S = {};\n function draw(c) {\n-  x\n+  y\n@@ -20,2 +20,3 @@\n   render(x) {\n+    log(x);\n     return x;', page, 'app/index.html');
  assert.deepEqual(two.map(h => h.scope), ['function draw', 'render()']);
});

test('a commit is explained once from its message and diffs: two sentences for it, one per file, only for files it changed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-explain-'));
  const r = repo(root, 'tripsplit');
  const sha = r.commit({ 'split.js': 'a\nb\n', 'notes.md': 'why\n', 'yarn.lock': 'l\n' }, 'Split the bill evenly\n\nSo nobody does the sum by hand.\n\nCo-Authored-By: X <x@y.z>');
  const d = emptyData();
  const th = createThread(d, { name: 'tripsplit', note: r.dir });
  d.commits.r1 = { id: 'r1', thread: th.id, kind: 'agent', title: 'r1', ts: 1, gitCommit: sha, repo: r.dir };
  assert.equal((await commitInfo(d, 'r1')).message, 'Split the bill evenly\n\nSo nobody does the sum by hand.'); // trailers are not part of the summary
  let asked = '';
  const ok = await explainCommit(d, 'r1', 'zh', async p => { asked = p; return 'Here:\n{"summary": "平分账单。", "files": {"split.js": "新增平分  的计算。", "other.js": "x", "notes.md": ""}}'; });
  assert.match(asked, /简体中文[\s\S]*## Message\nSplit the bill evenly[\s\S]*### split\.js \(\+2 -0\)[\s\S]*\+a\n\+b/);
  assert.doesNotMatch(asked, /yarn\.lock/); // a lock file is not read
  assert.deepEqual(ok.notes, { sha, summary: '平分账单。', files: { 'split.js': '新增平分 的计算。' } });
  assert.equal((await explainCommit(d, 'r1', 'en', async () => 'no json')).error, 'The answer could not be read');
  assert.equal((await explainCommit(d, 'r1', 'en', async () => { throw new Error('timeout'); })).error, 'timeout');
  assert.equal((await explainCommit(d, 'nope', 'en', async () => '{}')).error, 'No such record');
});
