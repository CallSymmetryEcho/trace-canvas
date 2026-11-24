import { mutate, createThread, addCommit } from '../../src/store.mjs';
// A line "Trip" with a dozen open to-dos and one an agent ticked, waiting for review.
mutate(d => {
  const t = createThread(d, { name: 'Trip' });
  for (let i = 0; i < 12; i++) addCommit(d, { thread: t.id, kind: 'task', title: 'To-do ' + i });
  addCommit(d, { thread: t.id, kind: 'task', title: 'Add up the total', extra: { done: true, doneBy: 'Claude Code', doneAt: Date.now(), toReview: true, result: 'Added it up.' } });
});
