import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, addCommit, createThread } from '../src/store.mjs';
import { listTasks, setTaskDone } from '../src/ops.mjs';

function data() {
  const d = emptyData();
  const a = createThread(d, { name: 'Thesis chapter 3' });
  a.note = 'Send the revised chapter to the advisor by Friday';
  const b = createThread(d, { name: 'thesis-repo', key: 'thesis' });
  b.note = '/Users/dev/Application Support/thesis'; // what hooks used to store: a path, not a goal
  const c = createThread(d, { name: 'Old exam' });
  c.status = 'done';
  addCommit(d, { thread: a.id, kind: 'task', title: 'Rewrite 3.2', ts: 1 });
  addCommit(d, { thread: a.id, kind: 'task', title: 'Add the control experiment', ts: 2 });
  addCommit(d, { thread: a.id, kind: 'agent', title: 'Draft of 3.1', ts: 3 });
  addCommit(d, { thread: b.id, kind: 'task', title: 'Rewrite the tracking script', ts: 4 });
  addCommit(d, { thread: c.id, kind: 'task', title: 'Book the room', ts: 5, extra: { done: true } });
  addCommit(d, { thread: a.id, kind: 'task', title: 'Draft the methods section', ts: 6, extra: { session: 's1', actor: 'human' } }); // a session's first prompt
  addCommit(d, { thread: a.id, kind: 'task', title: 'Check the figure numbering', ts: 7, extra: { session: 's1', highlight: true } }); // a next step Claude wrote
  return { d, a, b };
}

test('goals and to-dos per line: open first, paths are not goals, finished lines drop out', () => {
  const { d, a } = data();
  const rows = listTasks(d);
  assert.deepEqual(rows.map(r => [r.name, r.goal, `${r.done}/${r.total}`, r.tasks.map(t => t.title)]), [
    ['Thesis chapter 3', 'Send the revised chapter to the advisor by Friday', '0/3', ['Rewrite 3.2', 'Add the control experiment', 'Check the figure numbering']],
    ['thesis-repo', '', '0/1', ['Rewrite the tracking script']],
  ]);
  assert.equal(listTasks(d, { thread: 'Old exam', includeDone: true })[0].tasks[0].done, true);
  assert.throws(() => listTasks(d, { thread: 'nope' }), /No thread/);
  assert.equal(listTasks(d, { thread: a.id }).length, 1);
});

test('a to-do is ticked by title or id, records who ticked it, and can be reopened', () => {
  const { d, a } = data();
  const c = setTaskDone(d, { task: 'control experiment', by: 'Claude Code' });
  assert.deepEqual([c.title, c.done, c.doneBy, typeof c.doneAt], ['Add the control experiment', true, 'Claude Code', 'number']);
  assert.deepEqual(listTasks(d, { thread: a.id })[0].tasks.map(t => t.title), ['Rewrite 3.2', 'Check the figure numbering']);
  assert.throws(() => setTaskDone(d, { task: 'rewrite' }), /2 tasks match/); // one on each line
  assert.equal(setTaskDone(d, { task: 'rewrite', thread: 'thesis-repo' }).title, 'Rewrite the tracking script');
  const back = setTaskDone(d, { task: c.id, done: false });
  assert.deepEqual([back.done, back.doneBy, back.doneAt], [false, undefined, undefined]);
});
