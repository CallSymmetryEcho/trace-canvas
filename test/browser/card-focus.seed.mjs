import { mutate, createThread, addCommit } from '../../src/store.mjs';
// Two lines with a record each.
mutate(d => { for (const name of ['Trip', 'Other']) addCommit(d, { thread: createThread(d, { name }).id, kind: 'note', title: name + ' note' }); });
