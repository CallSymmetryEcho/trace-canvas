import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, createThread, addCommit } from '../src/store.mjs';
import { draftLessons, lessonSource, lessonsFor, parseLessons, rememberLesson } from '../src/lessons.mjs';

test('lessons are drawn from a project\'s decisions and wrap-ups only, and the draft is read as JSON', async () => {
  const d = emptyData();
  const a = createThread(d, { name: 'Video', extra: { group: 'Promo' } }).id, b = createThread(d, { name: 'Other' }).id;
  const dec = addCommit(d, { thread: a, kind: 'decision', title: 'Voice-over: write English words plainly', ts: 1 });
  addCommit(d, { thread: a, kind: 'note', title: 'Wrap-up: Video', body: 'Outputs:\n- v1', ts: 2 });
  addCommit(d, { thread: a, kind: 'agent', title: 'Rendered a take', ts: 3 });
  addCommit(d, { thread: b, kind: 'decision', title: 'Not this project', ts: 4 });
  addCommit(d, { thread: a, kind: 'note', title: 'Retro: 2 pieces', ts: 5, extra: { retro: { items: [{ title: 'x', rule: 'Ask for the final file before posting', applied: 'memory' }, { title: 'y', rule: 'Not applied' }] } } });
  const src = lessonSource(d, 'Promo');
  assert.match(src, /Already kept by retro \(do not repeat these\):\n- Ask for the final file before posting$/);
  assert.doesNotMatch(src, /Not applied|\] note: Retro/);
  assert.match(src, new RegExp(`\\[${dec.id}\\] decision: Voice-over`));
  assert.match(src, /Wrap-up: Video/);
  assert.doesNotMatch(src, /Rendered a take|Not this project/);
  let asked = '';
  const ls = await draftLessons(d, 'Promo', 'en', async p => { asked = p; return `Sure:\n[{"title":"Write English words plainly in TTS scripts","body":"Phonetic marks get read out.","from":["${dec.id}"]},{"body":"no title"}]`; });
  assert.match(asked, /finished project, "Promo"/);
  assert.deepEqual(ls, [{ title: 'Write English words plainly in TTS scripts', body: 'Phonetic marks get read out.', from: [dec.id] }]);
  assert.deepEqual(parseLessons('no json here'), []);
  assert.deepEqual(await draftLessons(d, 'Nothing', 'en', async () => '[]'), []);
});

test('an approved lesson goes to Theatrum as a global lesson tagged with its project; recall keeps lessons only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-lessons-')), bin = path.join(dir, 'theatrum'), log = path.join(dir, 'log');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\ncat >> '${log}'\n`, { mode: 0o755 });
  assert.equal(await rememberLesson({ title: 'Plain words', body: 'Why.', from: ['c1'] }, 'Promo Videos, 2026', { bin }), '');
  const got = fs.readFileSync(log, 'utf8');
  assert.match(got, /^remember\n--type\nlesson\n--scope\nglobal\n--tags\ntrace-canvas,lesson,project-promo-videos-2026\n--source\nuser_requested\n--title\nPlain words\n/);
  assert.match(got, /Plain words\n\nWhy\.\n\nFrom the Trace Canvas project "Promo Videos, 2026", records c1\./);
  assert.match(await rememberLesson({ title: 'x', body: '', from: [] }, 'P', { bin: path.join(dir, 'missing') }), /not installed/);

  const out = ['m1\tpreference\tglobal\t-\tscore=7\tA preference', 'm2\tlesson\tglobal\t-\tscore=6\tPlain words', 'hint: more'].join('\n');
  assert.deepEqual(lessonsFor('video', { run: () => ({ status: 0, stdout: out }) }), [{ id: 'm2', title: 'Plain words' }]);
  assert.deepEqual(lessonsFor('video', { run: () => ({ status: 1, stdout: '' }) }), []);
});
