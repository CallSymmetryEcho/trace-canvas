import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, addCommit, createThread } from '../src/store.mjs';
import { forkThread, detachThread, goalOf, bindLiveSession, listThreads } from '../src/ops.mjs';
import { sessionThread } from '../src/hook.mjs';
import { currentSessionId, encodeProjectDir } from '../src/transcript.mjs';

test('fork from a thread tip, a record or the inbox, drawn like a fork on the page', () => {
  const d = emptyData();
  const promo = createThread(d, { name: 'promote-视频制作' });
  addCommit(d, { thread: promo.id, kind: 'task', title: 'Cut the promo to 50 s', ts: 1 });
  const tip = addCommit(d, { thread: promo.id, kind: 'agent', title: 'Rendered v3', ts: 2 });
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fork-')), TRACE_CANVAS_LANG: 'en' };

  const a = forkThread(d, { from: 'promote-视频制作', name: 'Promo · subtitles' }, env);
  assert.deepEqual([a.thread.name, a.thread.parent, a.thread.forkOf, a.record.kind, a.record.parents, a.record.ts > tip.ts],
    ['Promo · subtitles', promo.id, tip.id, 'fork', [tip.id], true]);
  assert.equal(a.record.title, 'Forked from promote-视频制作: Rendered v3');

  const first = Object.values(d.commits).find(c => c.title === 'Cut the promo to 50 s');
  const b = forkThread(d, { from: first.id }, env);
  assert.deepEqual([b.thread.name, b.thread.forkOf], ['promote-视频制作 · branch', first.id]);

  const idea = addCommit(d, { thread: 'inbox', kind: 'idea', title: 'A teaser for Bilibili', ts: 3 });
  assert.equal(forkThread(d, { from: idea.id }, env).thread.parent, 'inbox');
  assert.throws(() => forkThread(d, { from: 'nope' }, env), /No record or thread/);

  bindLiveSession(d, { sessionId: 's-promo', thread: a.thread.id }, env);
  assert.deepEqual(sessionThread(d, { id: 's-promo' }, env), { threadId: a.thread.id, bound: true });
});

test('the calling session: explicit id, then CLAUDE_CODE_SESSION_ID, never a guess between two active sessions', () => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-proj-'));
  const project = '/Users/dev/tripsplit';
  const dir = path.join(projects, encodeProjectDir(project));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mine.jsonl'), '{}\n');
  const env = { CLAUDE_PROJECTS_DIR: projects };
  assert.equal(currentSessionId({ projectDir: project, env }), 'mine'); // one session: no doubt
  fs.writeFileSync(path.join(dir, 'other.jsonl'), '{}\n'); // a second session in the same folder, written last
  assert.throws(() => currentSessionId({ projectDir: project, env }), /pass session_id/);
  assert.equal(currentSessionId({ projectDir: project, env: { ...env, CLAUDE_CODE_SESSION_ID: 'mine' } }), 'mine');
  assert.equal(currentSessionId({ sessionId: 'explicit', projectDir: project, env: { ...env, CLAUDE_CODE_SESSION_ID: 'mine' } }), 'explicit');
});

test('the goal has its own field; old notes keep only the lines that are not system notes', () => {
  assert.equal(goalOf({ goal: 'Ship v0.2', note: '/Users/dev/tripsplit' }), 'Ship v0.2');
  assert.equal(goalOf({ note: '/Users/dev/tripsplit' }), '');
  assert.equal(goalOf({ note: '/Users/lianbin/Library/Application Support/Claude/side-session-notes/x' }), '');
  assert.equal(goalOf({ note: '由 trace-canvas 合并而来' }), '');
  assert.equal(goalOf({ note: 'Cut the promo under a minute\nCombined from A, B' }), 'Cut the promo under a minute');
  assert.equal(goalOf({ goal: '', note: 'old text' }), ''); // cleared on purpose
});

test('detach makes a forked line a line of its own, optionally taking the request that started it', () => {
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-detach-')), TRACE_CANVAS_LANG: 'en' };
  const d = emptyData(), main = createThread(d, { name: 'Canvas test' }).id;
  addCommit(d, { thread: main, kind: 'agent', title: 'Before', ts: 1000 });
  const ask = addCommit(d, { thread: main, kind: 'task', title: 'Look into photonic tweezers', ts: 2000 });
  const after = addCommit(d, { thread: main, kind: 'agent', title: 'After', ts: 3000 });
  const { thread, record } = forkThread(d, { from: ask.id, name: 'Tweezers' }, env);
  const r1 = addCommit(d, { thread: thread.id, kind: 'agent', title: 'Read three papers', ts: Date.now() + 1 });
  assert.deepEqual(r1.parents, [record.id]);
  assert.throws(() => detachThread(d, { thread: main }), /not a fork/);

  detachThread(d, { thread: 'Tweezers', take: ask.id });
  const t = listThreads(d).find(x => x.id === thread.id);
  assert.equal(t.forkedFrom, undefined);
  assert.equal(d.commits[record.id], undefined); // the fork record is gone
  assert.equal(d.commits[ask.id].thread, thread.id); // the request moved over and starts the line
  assert.deepEqual(d.commits[ask.id].parents, []);
  assert.deepEqual(r1.parents, [ask.id]);
  assert.deepEqual(d.commits[after.id].parents.map(p => d.commits[p].title), ['Before']); // the old line closes the gap
  for (const c of Object.values(d.commits)) for (const p of c.parents || []) assert.equal(d.commits[p].thread === thread.id, c.thread === thread.id, c.title);
  assert.throws(() => detachThread(d, { thread: 'Tweezers' }), /line of its own already/);
});
