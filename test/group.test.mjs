import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook } from '../src/hook.mjs';
import { forkThread, listThreads } from '../src/ops.mjs';
import { addCommit, createThread, emptyData, mutate, readData } from '../src/store.mjs';

// The page's own arrange(), taken out of app/index.html between its markers.
const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const { arrange, perColFor } = new Function(`${page.slice(page.indexOf('// <arrange>'), page.indexOf('// </arrange>'))}; return { arrange, perColFor };`)();

test('arrange puts each group in its own block, forks right after their line, lines without a group last', () => {
  const L = (id, createdAt, group, parent = null) => ({ id, createdAt, group, parent });
  const lines = [
    L('video', 1, 'Video'), L('promo', 2, 'Video'), L('video-short', 3, 'Video', 'video'),
    L('proposal', 0, 'Proposal'), L('p2', 4, 'Proposal'), L('p3', 5, 'Proposal'), L('p4', 6, 'Proposal'), L('p5', 7, 'Proposal'),
    L('loose', 8, ''), L('x', 9, 'Loop', 'y'), L('y', 10, 'Loop', 'x'),
  ];
  const pos = arrange(lines);
  assert.equal(pos.size, lines.length);
  const col = id => pos.get(id).x, row = id => pos.get(id).y;
  // Blocks by name (Loop, Proposal, Video), then the lines without a group; blocks do not overlap.
  const span = ids => [Math.min(...ids.map(col)), Math.max(...ids.map(col))];
  const [loop, prop, video, rest] = [span(['x', 'y']), span(['proposal', 'p2', 'p3', 'p4', 'p5']), span(['video', 'promo', 'video-short']), span(['loose'])];
  assert.ok(loop[1] < prop[0] && prop[1] < video[0] && video[1] < rest[0]);
  // Inside a block: depth-first along forks, up to 4 a column.
  assert.deepEqual(['video', 'video-short', 'promo'].map(row), [260, 490, 720]);
  assert.equal(col('p5'), col('proposal') + 290);
  assert.deepEqual(arrange(lines), pos);

  // Folded groups take no block: shelved after the last one, a chip's height apart, in name order.
  const f = arrange(lines, { folded: ['Proposal', 'Loop'] });
  assert.equal(f.get('video').x, 0); // Video is the first block now
  const shelfX = Math.max(f.get('loose').x, f.get('video').x) + 290 + 70;
  assert.deepEqual([f.get('x'), f.get('proposal')].map(p => [p.x, p.y]), [[shelfX, 260], [shelfX, 316]]);
  assert.equal(perColFor(lines, 1200, 800, { folded: ['Proposal', 'Loop', 'Video', ''] }), 4);
});

test('a fork joins the group of the line it came from, also a branch line made by the hooks', () => {
  const d = emptyData();
  const th = createThread(d, { name: 'Methods', extra: { group: 'Thesis' } });
  addCommit(d, { thread: th.id, kind: 'task', title: 'Draft', ts: 1 });
  assert.equal(forkThread(d, { from: th.id, name: 'Figures' }).thread.group, 'Thesis');
  assert.deepEqual(listThreads(d).filter(r => r.group).map(r => [r.name, r.group]), [['Methods', 'Thesis'], ['Figures', 'Thesis']]);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-group-'));
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.md'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init');
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  handleHook({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Main work' }, env);
  mutate(dd => { Object.values(dd.threads)[0].group = 'Apps'; }, env);
  git('checkout', '-q', '-b', 'receipt-ocr');
  handleHook({ session_id: 's2', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Read receipts' }, env);
  const branch = Object.values(readData(env).threads).find(t => t.key === 'tripsplit@receipt-ocr');
  assert.equal(branch.group, 'Apps');

  // trace-canvas group puts lines in a group and --clear takes them out.
  const cli = fileURLToPath(new URL('../bin/trace-canvas.mjs', import.meta.url));
  const run = (...a) => execFileSync(process.execPath, [cli, ...a], { encoding: 'utf8', env });
  assert.match(run('group', 'tripsplit', '--name', 'Side projects'), /In "Side projects": tripsplit/);
  assert.equal(Object.values(readData(env).threads).find(t => t.name === 'tripsplit').group, 'Side projects');
  run('group', 'tripsplit', '--clear');
  assert.equal(Object.values(readData(env).threads).find(t => t.name === 'tripsplit').group, undefined);
});

test('Arrange stacks fewer cards a column in a wide window and more in a tall one', () => {
  const lines = Array.from({ length: 24 }, (_, i) => ({ id: `t${i}`, createdAt: i, group: `G${i % 3}` }));
  const wide = perColFor(lines, 1800, 700), tall = perColFor(lines, 500, 1400);
  assert.ok(wide < tall, `${wide} < ${tall}`);
  assert.ok(wide >= 2 && tall <= 12);
});
