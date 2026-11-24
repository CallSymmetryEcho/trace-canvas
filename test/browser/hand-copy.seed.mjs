import { mutate, createThread, addCommit } from '../../src/store.mjs';
// A line "Trip" with one open to-do handed to Claude Code.
mutate(d => { const t = createThread(d, { name: 'Trip' }); addCommit(d, { thread: t.id, kind: 'task', title: 'Book the train', extra: { assignee: 'claude' } }); });
