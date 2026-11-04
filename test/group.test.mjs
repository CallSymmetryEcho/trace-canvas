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
  // Inside a block: a tree along forks. A fork sits right of its line on the same row; the next line goes below.
  assert.deepEqual(['video', 'video-short', 'promo'].map(row), [260, 260, 490]);
  assert.equal(col('video-short'), col('video') + 290);
  assert.equal(col('p5'), col('proposal') + 290);
  assert.deepEqual(arrange(lines), pos);

  // Folded groups take no block: shelved after the last one, a chip's height apart, in name order.
  const f = arrange(lines, { folded: ['Proposal', 'Loop'] });
  assert.equal(f.get('video').x, 0); // Video is the first block now
  const shelfX = Math.max(f.get('loose').x, f.get('video').x) + 290 + 70;
  assert.deepEqual([f.get('x'), f.get('proposal')].map(p => [p.x, p.y]), [[shelfX, 260], [shelfX, 316]]);
  assert.equal(perColFor(lines, 1200, 800, { folded: ['Proposal', 'Loop', 'Video', ''] }), 4);
});

test('arranged as a tree, fork links never cross: each line\'s forks keep to rows below it, in order', () => {
  const L = (id, createdAt, parent = null) => ({ id, createdAt, group: 'G', parent });
  // a ── b ── d      a has forks b and c; b has d and e; f is a second root.
  //      └── e
  // └── c
  // f
  const lines = [L('a', 1), L('b', 2, 'a'), L('c', 3, 'a'), L('d', 4, 'b'), L('e', 5, 'b'), L('f', 6)];
  const pos = arrange(lines, { perCol: 8 });
  const at = id => [pos.get(id).x / 290, (pos.get(id).y - 260) / 230];
  assert.deepEqual(['a', 'b', 'd', 'e', 'c', 'f'].map(at), [[0, 0], [1, 0], [2, 0], [2, 1], [1, 2], [0, 3]]);
  // No two fork links cross: links from the same column never interleave their rows.
  const links = lines.filter(l => l.parent).map(l => [at(l.parent), at(l.id)]);
  for (const [p1, c1] of links) for (const [p2, c2] of links) if (p1[0] === p2[0] && p1[1] < p2[1]) assert.ok(c1[1] < c2[1]);
  // Too many rows for a column: the next tree starts a column to the right of the widest one.
  const wrap = arrange(lines, { perCol: 3 });
  assert.equal(wrap.get('f').x, 3 * 290);
  assert.equal(wrap.get('f').y, 260);
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

test('"#" in the capture box suggests lines by name, those starting with the text first', () => {
  const { capMatches } = new Function(`${page.slice(page.indexOf('// <capsuggest>'), page.indexOf('// </capsuggest>'))}; return { capMatches };`)();
  const th = [{ id: 'a', name: '宣传-视频运维' }, { id: 'b', name: 'Trace Canvas 工具' }, { id: 'c', name: 'RL-NW · RL 增强 PID' }];
  assert.deepEqual(capMatches('#', th).map(t => t.id), ['a', 'b', 'c']);
  assert.deepEqual(capMatches('#rl', th).map(t => t.id), ['c']);
  assert.deepEqual(capMatches('#c', th).map(t => t.id), ['b']);
  assert.deepEqual(capMatches('#an', th).map(t => t.id), ['b']);
  assert.deepEqual(capMatches('#tra', th).map(t => t.id), ['b']);
  assert.deepEqual(capMatches('#视频', th).map(t => t.id), ['a']);
  assert.deepEqual(capMatches('#视频 hello', th), []);
  assert.deepEqual(capMatches('note #rl', th), []);
  assert.deepEqual(capMatches('#rl\nmore', th), []);
});
