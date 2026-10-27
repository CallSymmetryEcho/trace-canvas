import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitDiff, commitInfo } from '../src/git-view.mjs';
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
  const big = r.commit({ 'big.txt': 'x'.repeat(120) + '\n'.repeat(1) + ('y'.repeat(99) + '\n').repeat(3000) }, 'A big file');
  const d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: r.dir });
  const rec = (id, extra) => { d.commits[id] = { id, thread: th.id, kind: 'agent', title: id, ts: Object.keys(d.commits).length, ...extra }; };
  rec('r1', { gitCommit: one, repo: r.dir });
  rec('r2', { gitCommit: two }); // no repository recorded: found through the line's folder
  rec('r3', { gitCommit: big, repo: r.dir });
  rec('gone', { gitCommit: 'deadbee', repo: r.dir });
  rec('elsewhere', { gitCommit: 'abcdef1', repo: path.join(root, 'not-here') });

  const i1 = await commitInfo(d, 'r1');
  assert.equal(i1.subject, 'Split the bill');
  assert.deepEqual(i1.files.map(f => [f.path, f.add, f.binary, f.generated]), [['split.js', 3, false, false], ['package-lock.json', 1, false, true], ['logo.png', 0, true, false]]);
  assert.match((await commitDiff(d, 'r1', 'split.js')).diff, /^\+b$/m);
  assert.match((await commitDiff(d, 'r1', '../../etc/passwd')).error, /not part of this change/);

  const i2 = await commitInfo(d, 'r2', 'r1');
  assert.equal(i2.repo, r.dir);
  assert.deepEqual([i2.from, i2.to, i2.files.map(f => f.path)], [one, two, ['split.js']]);
  assert.match((await commitDiff(d, 'r2', 'split.js', 'r1')).diff, /^-b\n\+B$/m);

  assert.equal((await commitDiff(d, 'r3', 'big.txt')).truncated, true);
  assert.equal((await commitInfo(d, 'gone')).missing, 'no-commit');
  assert.equal((await commitInfo(d, 'elsewhere')).missing, 'no-repo');
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
