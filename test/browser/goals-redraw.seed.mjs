import { mutate, createThread, addCommit } from '../../src/store.mjs';
// A line "Trip" with a dozen open to-dos and one an agent ticked, waiting for review.
mutate(d => {
  const t = createThread(d, { name: 'Trip' });
  for (let i = 0; i < 12; i++) addCommit(d, { thread: t.id, kind: 'task', title: 'To-do ' + i });
  // Two finished ones: yesterday's shows with Show done, the one from 20 days ago is behind "finished over 15 days ago".
  for (const days of [1, 20]) addCommit(d, { thread: t.id, kind: 'task', title: 'Done ' + days, extra: { done: true, doneBy: 'human', doneAt: Date.now() - days * 864e5 } });
  addCommit(d, { thread: t.id, kind: 'task', title: 'Add up the total', extra: { done: true, doneBy: 'Claude Code', doneAt: Date.now(), toReview: true, result: 'Added it up.' } });
});
