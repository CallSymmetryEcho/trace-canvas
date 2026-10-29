import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/trace-canvas.mjs', import.meta.url));

test('--help or -h anywhere prints the help and runs nothing', () => {
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-')), TRACE_CANVAS_DISABLE: '1' };
  for (const args of [['--help'], ['-h'], ['help'], ['dispatch', '--help'], ['sync', '-h']]) {
    const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, timeout: 10000 });
    assert.match(out, /trace-canvas dispatch \[line\|to-do/, args.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(env.TRACE_CANVAS_HOME, 'data.json'))); // nothing ran
});

test('update: says whether there is a newer version, fast-forwards to it, and refreshes a copied skill', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-update-')), remote = path.join(root, 'remote'), local = path.join(root, 'local');
  const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
  fs.mkdirSync(remote);
  for (const d of ['bin', 'src', 'skill', 'app']) fs.cpSync(path.join(here, d), path.join(remote, d), { recursive: true });
  fs.copyFileSync(path.join(here, 'package.json'), path.join(remote, 'package.json'));
  git(remote, 'init', '-q', '-b', 'main'); git(remote, 'add', '.'); git(remote, 'commit', '-q', '-m', 'v1');
  execFileSync('git', ['clone', '-q', remote, local]);
  const home = path.join(root, 'home'), skill = path.join(home, '.claude', 'skills', 'trace-canvas');
  fs.mkdirSync(skill, { recursive: true }); fs.writeFileSync(path.join(skill, 'SKILL.md'), 'old copy');
  const env = { ...process.env, HOME: home, TRACE_CANVAS_HOME: path.join(home, '.trace-canvas') };
  const run = (...a) => execFileSync(process.execPath, [path.join(local, 'bin', 'trace-canvas.mjs'), 'update', ...a], { encoding: 'utf8', env });
  assert.match(run(), /^Up to date/);
  fs.appendFileSync(path.join(remote, 'skill', 'SKILL.md'), '\nA new line.\n'); git(remote, 'commit', '-qam', 'Skill: a new line');
  assert.match(run('--check'), /1 new commit:\n[0-9a-f]+ Skill: a new line\nGet them with: trace-canvas update/);
  assert.match(run(), /Updated [0-9a-f]+ → [0-9a-f]+:\n[0-9a-f]+ Skill: a new line/);
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /A new line\./);
  assert.match(run(), /^Up to date/);
});
