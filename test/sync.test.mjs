import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleHook, repoInfo } from '../src/hook.mjs';
import { machineOwner, runSync, syncDocs } from '../src/sync.mjs';
import { addCommit, canonicalize, createThread, emptyData, hashId, mutate, readData, threadById } from '../src/store.mjs';

const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A bare "Gitea" repository and two machines, each with its own clone of the map and its own data folder.
function twoMachines() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sync-'));
  const bare = path.join(root, 'agent-map.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  const seed = path.join(root, 'seed');
  execFileSync('git', ['clone', '-q', bare, seed], { stdio: 'ignore' });
  fs.mkdirSync(path.join(seed, 'canvas')); fs.writeFileSync(path.join(seed, 'canvas', 'README.md'), 'canvas\n');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'); git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'); git(seed, 'push', '-q', 'origin', 'main');
  const machine = name => {
    const map = path.join(root, `map-${name}`);
    execFileSync('git', ['clone', '-q', bare, map], { stdio: 'ignore' });
    git(map, 'config', 'user.name', name); git(map, 'config', 'user.email', `${name}@t`);
    const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, `home-${name}`), TRACE_CANVAS_MAP: map, TRACE_CANVAS_MACHINE: name, TRACE_CANVAS_LANG: 'en' };
    return { name, map, env, data: () => readData(env), sync: () => runSync(env) };
  };
  return { root, bare, a: machine('mac'), b: machine('bsuperstation') };
}

test('two machines share one canvas: new, changed and deleted records travel, prompts go as titles only', () => {
  const { a, b } = twoMachines();
  const ids = mutate(d => {
    const th = createThread(d, { name: 'receipt-ocr' });
    const task = addCommit(d, { thread: th.id, kind: 'task', title: 'Try a vision model', ts: 1 });
    const prompt = addCommit(d, { thread: th.id, kind: 'task', title: 'Read receipts', body: 'Use the box at 8.8.8.8 with token: abc123', ts: 2, extra: { session: 's1', actor: 'human' } });
    const note = addCommit(d, { thread: th.id, kind: 'note', title: 'Server', body: 'runs on 8.8.4.4, LAN 192.168.1.20', ts: 3 });
    return { th: th.id, task: task.id, prompt: prompt.id, note: note.id };
  }, a.env);
  const r1 = a.sync();
  assert.deepEqual([r1.error, r1.committed, r1.pushed, r1.offline], [null, true, true, false]);
  const r2 = b.sync();
  assert.equal(r2.imported, 4);
  const bd = b.data();
  assert.equal(bd.threads[ids.th].name, 'receipt-ocr');
  assert.equal(bd.commits[ids.prompt].body, ''); // only the title travelled
  assert.equal(bd.commits[ids.note].body, 'runs on [redacted], LAN 192.168.1.20');
  assert.equal(bd.commits[ids.task].machine, 'mac');

  // bsuperstation ticks the to-do; the Mac sees it and keeps its own copy of the prompt.
  mutate(d => { d.commits[ids.task].done = true; }, b.env);
  b.sync(); a.sync();
  assert.equal(a.data().commits[ids.task].done, true);
  assert.equal(a.data().commits[ids.prompt].body, 'Use the box at 8.8.8.8 with token: abc123');
  // Taking the other machine's change does not restamp it: both files carry the same time.
  const line = (m, id) => fs.readFileSync(path.join(m.map, 'canvas', `${m.name}.jsonl`), 'utf8').split('\n').find(l => l.includes(`"id":"${id}"`));
  git(a.map, 'pull', '-q'); git(b.map, 'pull', '-q');
  assert.equal(JSON.parse(line(a, ids.task)).t, JSON.parse(line(b, ids.task)).t);

  // A deletion travels as a tombstone.
  mutate(d => { delete d.commits[ids.note]; }, a.env);
  a.sync(); b.sync();
  assert.equal(b.data().commits[ids.note], undefined);

  // Nothing changed: the same bytes, no new commit.
  const before = fs.readFileSync(path.join(a.map, 'canvas', 'mac.jsonl'), 'utf8');
  const again = a.sync();
  assert.equal(again.committed, false);
  assert.equal(fs.readFileSync(path.join(a.map, 'canvas', 'mac.jsonl'), 'utf8'), before);
  // A name another computer already writes under is refused by setup; this computer's own is fine.
  fs.writeFileSync(path.join(a.map, 'canvas', 'lab.jsonl'), '{"host":"lab-pc-7","id":"lab","k":"machine"}\n');
  assert.deepEqual([machineOwner(a.map, 'lab'), machineOwner(a.map, 'mac'), machineOwner(a.map, 'new')], ['lab-pc-7', null, null]);
});

test('when both machines change the same record, the later change wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-lww-'));
  const base = emptyData();
  createThread(base, { id: 't1', name: 'Methods' });
  const a = structuredClone(base), b = structuredClone(base);
  fs.writeFileSync(path.join(dir, 'mac.jsonl'), syncDocs(a, { dir, machine: 'mac', now: 100 }).text);
  fs.writeFileSync(path.join(dir, 'lab.jsonl'), syncDocs(b, { dir, machine: 'lab', now: 100 }).text);
  a.threads.t1.name = 'Methods (Mac)'; b.threads.t1.name = 'Methods (lab)';
  fs.writeFileSync(path.join(dir, 'mac.jsonl'), syncDocs(a, { dir, machine: 'mac', now: 200 }).text);
  fs.writeFileSync(path.join(dir, 'lab.jsonl'), syncDocs(b, { dir, machine: 'lab', now: 300 }).text);
  syncDocs(a, { dir, machine: 'mac', now: 400 });
  assert.equal(a.threads.t1.name, 'Methods (lab)');
});

test('a sync that cannot reach the server says offline and keeps the commit for next time', () => {
  const { a } = twoMachines();
  git(a.map, 'remote', 'set-url', 'origin', path.join(os.tmpdir(), 'no-such-repo.git'));
  mutate(d => { createThread(d, { name: 'Offline line' }); }, a.env);
  const r = a.sync();
  assert.deepEqual([r.offline, r.committed, r.pushed, r.error], [true, true, false, null]);
});

test('lines with a key get the same id on every machine; the old id stays as an alias', () => {
  const d = emptyData();
  createThread(d, { id: 'tOld', name: 'tripsplit', key: 'tripsplit' });
  createThread(d, { id: 'tFork', name: 'tripsplit · auth', parent: 'tOld' });
  addCommit(d, { thread: 'tOld', kind: 'task', title: 'x', ts: 1 });
  d.edges.e1 = { id: 'e1', from: 'tOld', to: 'tFork', label: 'feeds' };
  d.sessions.s1 = { id: 's1', thread: 'tOld', bound: true };
  const want = hashId('t', 'tripsplit');
  assert.equal(canonicalize(d), 1);
  assert.equal(canonicalize(d), 0);
  assert.deepEqual([d.threads[want].aliases, d.threads.tFork.parent, Object.values(d.commits)[0].thread, d.edges.e1.from, d.sessions.s1.thread], [['tOld'], want, want, want, want]);
  assert.equal(threadById(d, 'tOld').id, want);
  // Records and tools that still name the old id land on the line.
  assert.equal(addCommit(d, { thread: 'tOld', title: 'y' }).thread, want);
});

test('a repository is named after its remote, and its folder-named line from before is taken over', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-remote-'));
  const repo = path.join(root, 'roboticarm');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', 'gitea-lab:bl27855/alchemarm.git');
  assert.equal(repoInfo(repo).repo, 'alchemarm');
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const old = mutate(d => createThread(d, { name: 'roboticarm', key: 'roboticarm', note: repo }).id, env);
  handleHook({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Calibrate the gripper' }, env);
  const d = readData(env);
  assert.equal(Object.keys(d.threads).length, 1);
  assert.deepEqual([d.threads[old].key, d.threads[old].aliases], ['alchemarm', ['roboticarm']]);
  assert.equal(Object.values(d.commits)[0].thread, old);
});
