import { mutate, createThread, addCommit } from '../../src/store.mjs';
// Two lines on Autopilot (one self-iterating) and one that is not.
mutate(d => {
  const now = Date.now();
  for (const [name, ap] of [['Run', {}], ['Evolve', { evolve: { rounds: 3 } }], ['Quiet', null]]) {
    const t = createThread(d, { name }); if (ap) t.autopilot = { session: 's-' + name, on: now + 1e12, at: now, ...ap };
    addCommit(d, { thread: t.id, kind: 'task', title: name + ' to-do' });
  }
});
