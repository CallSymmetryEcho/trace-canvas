import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hookCommand, install, installAgentMcp, installMcp, installSkill } from '../src/install.mjs';

const cli = new URL('../bin/trace-canvas.mjs', import.meta.url);
const source = fileURLToPath(new URL('../skill', import.meta.url));

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'user'), bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // The setup test must not register real MCP servers or change this user's settings.
  for (const agent of ['claude', 'codex']) {
    fs.writeFileSync(path.join(bin, agent), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const run = (...args) => execFileSync(process.execPath, ['--input-type=module', '-e', `
    import os from 'node:os';
    os.homedir = () => ${JSON.stringify(userDir)};
    process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(cli))}, ...${JSON.stringify(args)}];
    await import(${JSON.stringify(cli.href)});
  `], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TRACE_CANVAS_HOME: path.join(root, 'data'), TRACE_CANVAS_DISABLE: '1' },
  });
  return { root, userDir, run };
}

function checkSkill(dir) {
  assert.equal(fs.realpathSync(dir), fs.realpathSync(source));
  assert.equal(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8'));
}

test('install-skill adds the user Codex skill as well as the existing Claude skill', t => {
  const { userDir, run } = sandbox(t);
  run('install-skill', '--user', '--agents', 'codex');
  checkSkill(path.join(userDir, '.agents', 'skills', 'trace-canvas'));
  checkSkill(path.join(userDir, '.claude', 'skills', 'trace-canvas'));
  assert.equal(fs.existsSync(path.join(userDir, '.codex', 'hooks.json')), false);
  assert.equal(fs.existsSync(path.join(userDir, '.claude', 'settings.json')), false);
});

test('project skill installation stays in the chosen project and is repeatable', t => {
  const { root, userDir, run } = sandbox(t);
  const project = path.join(root, 'project');
  for (let i = 0; i < 2; i++) run('install-skill', '--project', project, '--agents', 'codex');
  for (const config of ['.agents', '.claude']) {
    const base = path.join(project, config, 'skills');
    checkSkill(path.join(base, 'trace-canvas'));
    assert.deepEqual(fs.readdirSync(base), ['trace-canvas']);
  }
  assert.equal(fs.existsSync(userDir), false);
});

test('setup --user --agents codex installs a usable skill and keeps existing hooks on repeat', t => {
  const { userDir, run } = sandbox(t);
  const hooks = path.join(userDir, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(hooks), { recursive: true });
  const existing = { hooks: [{ type: 'command', command: '/example/existing-hook' }] };
  fs.writeFileSync(hooks, JSON.stringify({ hooks: { SessionStart: [existing] } }));
  run('setup', '--user', '--agents', 'codex');
  checkSkill(path.join(userDir, '.agents', 'skills', 'trace-canvas'));
  checkSkill(path.join(userDir, '.claude', 'skills', 'trace-canvas'));
  const once = fs.readFileSync(hooks, 'utf8');
  assert.deepEqual(JSON.parse(once).hooks.SessionStart[0], existing);
  run('setup', '--user', '--agents', 'codex');
  assert.equal(fs.readFileSync(hooks, 'utf8'), once);
  assert.deepEqual(fs.readdirSync(path.join(userDir, '.agents', 'skills')), ['trace-canvas']);
});

test('replacing a locally edited Codex skill preserves it in a backup', t => {
  const { root } = sandbox(t);
  const base = path.join(root, '.agents', 'skills'), dest = path.join(base, 'trace-canvas');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'SKILL.md'), 'Local edits');
  assert.equal(installSkill({ project: root }, source, 'codex'), dest);
  checkSkill(dest);
  const backup = fs.readdirSync(base).find(name => name.startsWith('trace-canvas.bak-'));
  assert.ok(backup);
  assert.equal(fs.readFileSync(path.join(base, backup, 'SKILL.md'), 'utf8'), 'Local edits');
});

test('hooks and MCP servers start node by its full path, and replace the old bare `node` entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-node-'));
  const cli = '/opt/trace-canvas/bin/trace-canvas.mjs';
  assert.equal(hookCommand(cli), `"${process.execPath}" "${cli}" hook`);
  assert.equal(hookCommand(cli, 'codex'), `"${process.execPath}" "${cli}" hook --agent codex`);
  // A settings file from before: our hook under the bare name, next to someone else's.
  const file = path.join(root, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }, { hooks: [{ type: 'command', command: `node "${cli}" hook`, timeout: 10 }] }] } }));
  install(file, hookCommand(cli));
  const stop = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.Stop.map(g => g.hooks[0].command);
  assert.deepEqual(stop, ['say done', hookCommand(cli)]);
  installMcp({ project: root }, cli);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.mcp.json'), 'utf8')).mcpServers['trace-canvas'].command, process.execPath);
  installAgentMcp('gemini', cli, root);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.gemini', 'settings.json'), 'utf8')).mcpServers['trace-canvas'].command, process.execPath);
});

test('setup --machine and --map are saved as given', t => {
  const { root, run } = sandbox(t);
  const map = path.join(root, 'agent-map');
  fs.mkdirSync(path.join(map, 'canvas'), { recursive: true });
  run('setup', '--user', '--machine', 'lab', '--map', map);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data', 'config.json'), 'utf8'));
  assert.deepEqual([cfg.machine, cfg.map], ['lab', map]);
});
