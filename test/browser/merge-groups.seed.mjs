import { mutate, createThread, addCommit } from '../../src/store.mjs';
mutate(d => {
  const mk = (name, group, x, y, extra = {}) => { const t = createThread(d, { name, extra: { ...(group ? { group } : {}), ...extra } }); t.x = x; t.y = y; addCommit(d, { thread: t.id, kind: 'task', title: `${name} open to-do` }); return t; };
  const a = mk('A', 'G1', 0, 0), b = mk('B', 'G1', 300, 0); mk('C', 'G1', 600, 0);
  const f = mk('F', 'G1', 0, 250); f.parent = a.id;
  mk('D', 'G2', 300, 250); mk('E', '', 600, 250); mk('H', '', 900, 0); mk('I', 'G2', 900, 250);
});
