import { mutate, createThread, addCommit } from '../../src/store.mjs';
// Twelve lines laid out wide, as Arrange leaves them on a desktop: four columns by three rows.
mutate(d => { for (let i = 0; i < 12; i++) { const t = createThread(d, { name: 'Line ' + (i + 1) }); t.x = (i % 4) * 360; t.y = 260 + Math.floor(i / 4) * 300; addCommit(d, { thread: t.id, kind: 'note', title: 'A record' }); } });
