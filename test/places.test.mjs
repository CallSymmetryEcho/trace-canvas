// A project that moved or has a backup: its places are records on a line; a file opens from where the project is now,
// backup-fix lists what is missing and restores from a backup only after a yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, createThread, mutate, readData } from '../src/store.mjs';
import { addPlace, checkFiles, placesOf, restoreFiles, unbackedProjects } from '../src/places.mjs';
import { readLinkedMd } from '../src/git-view.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'trace-canvas.mjs');
function sandbox() {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-places-')));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(top, 'tc'), TRACE_CANVAS_MACHINE: 'here' };
  const proj = path.join(top, 'proj'), nas = path.join(top, 'nas', 'proj'), bak = path.join(top, 'cloud', 'proj');
  for (const dir of [env.TRACE_CANVAS_HOME, path.join(proj, 'out'), path.join(nas, 'out'), path.join(bak, 'out')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(env.TRACE_CANVAS_HOME, 'config.json'), '{}');
  let tid, rec;
  mutate(d => {
    const t = createThread(d, { name: 'Paper' }); t.note = proj; tid = t.id;
    d.sessions.s1 = { id: 's1', thread: t.id, cwd: proj, machine: 'here' };
    rec = addCommit(d, { thread: t.id, kind: 'agent', title: 'Report written', links: [path.join(proj, 'out', 'report.md')], extra: { session: 's1', machine: 'here', files: ['out/fig.md'], root: proj } }).id;
  }, env);
  return { top, env, proj, nas, bak, tid, rec, cli: (...a) => execFileSync('node', [CLI, 'backup-fix', ...a], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
}

test('a project that moved: the place is a record on its line, its files open from the new folder, and nothing counts as missing', () => {
  const s = sandbox(), file = path.join(s.proj, 'out', 'report.md');
  fs.writeFileSync(path.join(s.nas, 'out', 'report.md'), '# At the NAS'); fs.writeFileSync(path.join(s.nas, 'out', 'fig.md'), '# Fig');
  fs.rmSync(s.proj, { recursive: true }); // the project is gone from where the records say
  assert.equal(readLinkedMd(readData(s.env), file, s.rec, s.env).error, 'missing');
  assert.equal(checkFiles(readData(s.env), null, s.env).missing, 2);

  const out = s.cli('Paper', '--moved', s.nas);
  const d = readData(s.env), pl = placesOf(d);
  assert.deepEqual(pl.map(p => [p.root, p.machine, p.role, p.path, p.on, p.thread]), [[s.proj, 'here', 'moved', s.nas, 'here', s.tid]]);
  assert.equal(d.commits[pl[0].rec].kind, 'decision');
  assert.equal(d.threads[s.tid].note, s.nas, 'the line keeps the new folder: new sessions start there');
  assert.match(out, /2 files? checked, 0 not on this machine/);
  const r = readLinkedMd(d, file, s.rec, s.env);
  assert.deepEqual([r.text, r.via], ['# At the NAS', { role: 'moved', path: s.nas }]);
  assert.equal(readLinkedMd(d, 'out/fig.md', s.rec, s.env).text, '# Fig', 'a changed file listed from the old root as well');
  // Another machine's places are not this one's: the same record there is still missing.
  assert.equal(readLinkedMd(d, file, s.rec, { ...s.env, TRACE_CANVAS_MACHINE: 'elsewhere' }).error !== undefined, true);
});

test('a lost file with a backup: listed, not restored without a yes, restored with one, never overwritten', () => {
  const s = sandbox(), file = path.join(s.proj, 'out', 'report.md'), kept = path.join(s.proj, 'out', 'fig.md');
  fs.writeFileSync(kept, '# Mine'); fs.writeFileSync(path.join(s.bak, 'out', 'report.md'), '# From the backup'); fs.writeFileSync(path.join(s.bak, 'out', 'fig.md'), '# Older');
  assert.deepEqual(unbackedProjects(readData(s.env), s.env).map(p => p.root), [s.proj]);
  s.cli('--project', s.proj, '--backup', s.bak);
  assert.deepEqual(unbackedProjects(readData(s.env), s.env), []);
  const listed = s.cli('Paper');
  assert.match(listed, /2 files? checked, 1 not on this machine/); assert.ok(listed.includes(path.join(s.bak, 'out', 'report.md')));
  // The reader opens the backup's copy meanwhile, and says where from.
  assert.equal(readLinkedMd(readData(s.env), file, s.rec, s.env).via.role, 'backup');
  // No terminal (an agent): it lists and stops.
  assert.match(s.cli('Paper', '--restore'), /Nothing was restored/); assert.equal(fs.existsSync(file), false);
  const done = s.cli('Paper', '--restore', '--yes');
  assert.match(done, /Restored 1/);
  assert.equal(fs.readFileSync(file, 'utf8'), '# From the backup'); assert.equal(fs.readFileSync(kept, 'utf8'), '# Mine', 'a file that is there is left alone');
  assert.ok(fs.existsSync(path.join(s.bak, 'out', 'report.md')), 'the backup keeps its copy');
  const d = readData(s.env);
  assert.ok(Object.values(d.commits).some(c => c.thread === s.tid && /Restored 1 file/.test(c.title) && c.links.includes(file)), 'the result is on the line');
  // restoreFiles itself never overwrites.
  fs.writeFileSync(file, '# Changed since');
  assert.deepEqual(restoreFiles([{ file, copy: { file: path.join(s.bak, 'out', 'report.md'), role: 'backup' } }]).skipped, [file]);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Changed since');
});

test('a backup folder that is not there is not the same as a file that is lost', () => {
  const s = sandbox();
  fs.rmSync(path.join(s.proj, 'out', 'report.md'), { force: true });
  mutate(d => addPlace(d, { thread: s.tid, root: s.proj, machine: 'here', role: 'backup', dir: path.join(s.top, 'not-mounted'), on: 'here' }), s.env);
  const r = checkFiles(readData(s.env), [s.tid], s.env);
  assert.deepEqual([r.missing, r.items.every(i => i.copy === null)], [2, true]);
  assert.throws(() => addPlace({ commits: {}, threads: {} }, { root: 'relative', role: 'backup', dir: '/x' }), /full path/);
});
