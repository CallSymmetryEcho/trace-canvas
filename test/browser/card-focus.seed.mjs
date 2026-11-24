import { mutate, createThread, addCommit } from '../../src/store.mjs';
// Two lines with a record each.
mutate(d => { for (const name of ['Trip', 'Other']) addCommit(d, { thread: createThread(d, { name }).id, kind: 'note', title: name + ' note' }); });
// A line forked now that carries a to-do older than its fork (moved onto it): Branches must not draw its fork as a
// straight line down to that old record (2026-11-24).
mutate(d => {
  const trip = Object.values(d.threads).find(t => t.name === 'Trip'), at = addCommit(d, { thread: trip.id, kind: 'decision', title: 'Split the hotels off', ts: Date.now() - 1000 });
  const f = createThread(d, { name: 'Hotels', extra: { parent: trip.id, forkOf: at.id } });
  addCommit(d, { thread: f.id, kind: 'task', title: 'An old to-do moved here', ts: Date.now() - 9e7 });
  addCommit(d, { thread: trip.id, kind: 'note', title: 'An older note', ts: Date.now() - 8e7 });
});
