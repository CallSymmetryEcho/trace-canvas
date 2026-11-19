import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, createThread } from '../src/store.mjs';
import { createCard, startRun, readRun, refreshCard, returnRun, resumeCommand } from '../src/research.mjs';

const BENCHES = [
  { id: 'codex', auto: true, available: true, model: 'gpt-x · high' },
  { id: 'claude', auto: true, available: true, model: '' },
  { id: 'claude-science', auto: false, available: true },
  { id: 'openscience', auto: false, available: false, reason: 'openscience' },
];
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rs-')), env = { TRACE_CANVAS_HOME: path.join(tmp, 'home') };
  const input = path.join(tmp, 'blind-input.zip');
  fs.writeFileSync(input, 'frames');
  const d = emptyData(), th = createThread(d, { name: 'research' });
  const c = createCard(d, { question: 'Does the bright region pass the midpoint?', thread: th.id, inputs: [input] }, env);
  const started = [];
  const fake = (dir, cmd, e) => { started.push({ dir, cmd, thread: e.TRACE_CANVAS_THREAD }); return 999999; };
  return { tmp, env, d, th, c, input, started, fake };
}

test('saving freezes the question and a copy of each input with its hash; a run starts once, from that package', () => {
  const { env, d, th, c, input, started, fake } = setup();
  const F = c.research.frozen;
  assert.equal(c.title, 'Does the bright region pass the midpoint?');
  assert.equal(F.version, 1);
  assert.match(fs.readFileSync(F.task, 'utf8'), /Does the bright region pass the midpoint\?[\s\S]*input\/blind-input\.zip（原文件 [^）]+）· SHA-256 [0-9a-f]{64}/);
  fs.writeFileSync(input, 'changed later'); // the original changing later does not touch the frozen copy
  const a = startRun(d, c.id, { workbench: 'codex', key: 'k1' }, env, fake, BENCHES).run;
  assert.deepEqual([a.status, a.mode, a.packageSha, a.requestedModel, started.length, started[0].thread], ['submitted', 'single', F.sha256, 'gpt-x · high', 1, th.id]);
  assert.match(started[0].cmd, /^codex exec --json/);
  assert.equal(fs.readFileSync(path.join(a.dir, 'input', 'blind-input.zip'), 'utf8'), 'frames');
  assert.match(fs.readFileSync(path.join(a.dir, 'prompt.md'), 'utf8'), /不要发布[\s\S]*Does the bright region/);
  // A retried click (same key) does not start it again; a second single run is refused.
  assert.equal(startRun(d, c.id, { workbench: 'codex', key: 'k1' }, env, fake, BENCHES).again, true);
  assert.equal(started.length, 1);
  assert.throws(() => startRun(d, c.id, { workbench: 'claude', key: 'k2' }, env, fake, BENCHES), /already/);
  // An independent control: same version and hash, its own folder.
  const b = startRun(d, c.id, { workbench: 'claude', mode: 'control', key: 'k3' }, env, fake, BENCHES).run;
  assert.deepEqual([b.mode, b.packageSha, b.version, b.dir !== a.dir], ['control', a.packageSha, 1, true]);
  assert.match(started[1].cmd, /^claude -p --output-format stream-json/);
  assert.throws(() => startRun(d, c.id, { workbench: 'openscience', mode: 'control', key: 'k4' }, env, fake, BENCHES), /unavailable:openscience/);
  // A package changed on disk does not run.
  fs.writeFileSync(path.join(F.dir, 'package', 'input', 'blind-input.zip'), 'tampered');
  assert.throws(() => startRun(d, c.id, { workbench: 'codex', mode: 'control', key: 'k5' }, env, fake, BENCHES), /changed/);
  assert.throws(() => createCard(d, { question: ' ', thread: th.id }, env), /empty/);
  // Same file name from two folders: both kept, the second numbered, each with its own origin in the task.
  const other = path.join(path.dirname(input), 'b'); fs.mkdirSync(other); fs.writeFileSync(path.join(other, 'blind-input.zip'), 'other');
  const two = createCard(d, { question: 'q2', thread: th.id, inputs: [input, path.join(other, 'blind-input.zip')] }, env);
  assert.deepEqual(two.research.frozen.inputs.map(i => i.name), ['blind-input.zip', '2-blind-input.zip']);
  assert.match(fs.readFileSync(two.research.frozen.task, 'utf8'), /2-blind-input\.zip（原文件 .*\/b\/blind-input\.zip）/);
  assert.throws(() => createCard(d, { question: 'q', thread: th.id, inputs: ['/nope/x.zip'] }, env), /notfile/);
});

test('a run\'s state comes from what its CLI wrote: session, actual model, result and products, or why it failed', () => {
  const { env, d, c, tmp, fake } = setup();
  const a = startRun(d, c.id, { workbench: 'codex', key: 'a' }, env, fake, BENCHES).run;
  assert.equal(readRun(a, tmp).status, 'stopped'); // no exit code and its process is gone
  const sid = '01a1-test-session';
  fs.writeFileSync(path.join(a.dir, 'events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: sid }) + '\n' + JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } }) + '\n');
  const t = new Date(a.startedAt), day = path.join(tmp, '.codex', 'sessions', String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, `rollout-x-${sid}.jsonl`), '{"model":"gpt-6.2-astra","effort":"high"}');
  fs.mkdirSync(path.join(a.dir, 'deliverables'));
  fs.writeFileSync(path.join(a.dir, 'deliverables', 'per_frame.csv'), 'x');
  fs.writeFileSync(path.join(a.dir, 'last.md'), 'S82 passes the midpoint.');
  fs.writeFileSync(path.join(a.dir, 'exit_code'), '0\n');
  assert.equal(refreshCard(d, c.id, tmp), true);
  assert.deepEqual([a.status, a.session, a.model, a.usage, a.final], ['delivered', sid, 'gpt-6.2-astra · high', '120 tokens', 'S82 passes the midpoint.']);
  assert.deepEqual(a.products.map(p => path.relative(a.dir, p)), ['deliverables/per_frame.csv', 'last.md']);
  assert.ok(c.links.includes(path.join(a.dir, 'deliverables', 'per_frame.csv')));
  assert.equal(refreshCard(d, c.id, tmp), false); // delivered: nothing more to read
  assert.equal(resumeCommand(a), `cd '${a.dir}' && codex resume ${sid}`);
  // Claude Code: session and model from its init event; a failed result keeps stderr.
  const b = startRun(d, c.id, { workbench: 'claude', mode: 'control', key: 'b' }, env, fake, BENCHES).run;
  fs.writeFileSync(path.join(b.dir, 'events.jsonl'), [{ type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-opus-5-5' }, { type: 'system', subtype: 'permission_denied' }, { type: 'result', is_error: true, result: 'Usage limit' }].map(e => JSON.stringify(e)).join('\n'));
  fs.writeFileSync(path.join(b.dir, 'stderr.log'), 'limit reached');
  fs.writeFileSync(path.join(b.dir, 'exit_code'), '1');
  const r = readRun(b, tmp);
  assert.deepEqual([r.status, r.session, r.model, r.error, r.denied], ['failed', 's-1', 'claude-opus-5-5', 'limit reached', 1]);
  assert.equal(fs.readFileSync(path.join(b.dir, 'result.md'), 'utf8'), 'Usage limit');
});

test('a manual workbench gets the package and waits; the person brings the session and export folder back', () => {
  const { env, d, c, tmp, started, fake } = setup();
  const m = startRun(d, c.id, { workbench: 'claude-science', key: 'm' }, env, fake, BENCHES).run;
  assert.deepEqual([m.status, m.pid, started.length], ['waiting', undefined, 0]);
  assert.ok(fs.existsSync(path.join(m.dir, 'task.md')));
  assert.throws(() => returnRun(d, c.id, m.id, { folder: path.join(tmp, 'nope') }), /nofolder/);
  const out = path.join(tmp, 'export');
  fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'fig2.png'), 'png');
  const r = returnRun(d, c.id, m.id, { session: 'http://localhost:51593/projects/p/frames/f', folder: out });
  assert.deepEqual([r.status, r.manual, r.products], ['delivered', true, [path.join(out, 'fig2.png')]]);
  assert.equal(resumeCommand(r), '');
});
