import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, addCommit, createThread } from '../src/store.mjs';
import { REVIEW_GATE, autopilotPrompt, listTasks, setTaskDone } from '../src/ops.mjs';

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

test('an agent\'s tick waits for review with its result; the person\'s does not; a returned to-do comes first with its reason', () => {
  const d = emptyData();
  const th = createThread(d, { name: 'goals' });
  const a = addCommit(d, { thread: th.id, kind: 'task', title: 'Fold old goals', ts: 1 });
  const b = addCommit(d, { thread: th.id, kind: 'task', title: 'Write the README', ts: 2 });
  const c = addCommit(d, { thread: th.id, kind: 'task', title: 'Add a review state', ts: 3 });
  setTaskDone(d, { task: a.id, by: 'Claude Code', result: 'Commit abc123: folds lines quiet for a day' });
  setTaskDone(d, { task: b.id, by: 'human' });
  assert.equal(d.commits[a.id].toReview, true);
  assert.equal(d.commits[a.id].result, 'Commit abc123: folds lines quiet for a day');
  assert.equal(d.commits[b.id].toReview, undefined);
  let row = listTasks(d, { thread: th.id, includeDone: true })[0];
  assert.equal(row.toReview, 1);
  assert.equal(row.tasks.find(x => x.id === a.id).toReview, true);
  // Returned by the person (the page sets this): open again, first, with the reason.
  Object.assign(d.commits[a.id], { done: false, doneBy: null, doneAt: null, toReview: null, returned: { at: 5, note: 'also fold merged lines', by: 'Claude Code' } });
  row = listTasks(d, { thread: th.id })[0];
  assert.deepEqual(row.tasks.map(x => x.id), [a.id, c.id]);
  assert.equal(row.tasks[0].returned, 'also fold merged lines');
  assert.equal(row.toReview, undefined);
});

test('Autopilot is told to stop when ten wait for review, to give a result, and to do a returned to-do first', () => {
  const d = emptyData(), th = createThread(d, { name: 'x' });
  const p = autopilotPrompt(d, th, th.id);
  assert.equal(REVIEW_GATE, 10);
  assert.match(p, /toReview: 10 or more, stop too/);
  assert.match(p, /give trace_task_done a result/);
  assert.match(p, /returned: was sent back by the person/);
});
