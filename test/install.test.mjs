import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hookCommand, install, installAgentMcp, installMcp, installSkill, linkCommand } from '../src/install.mjs';

const cli = new URL('../bin/trace-canvas.mjs', import.meta.url);
const source = fileURLToPath(new URL('../skill', import.meta.url));

function sandbox(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userDir = path.join(root, 'user'), bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  // The setup test must not register real MCP servers or change this user's settings.
  // setup writes the trace-canvas command next to the first user-owned node on the PATH: a stand-in node here keeps it
  // in the sandbox, or every test run rewrites the real one to run this checkout.
  for (const agent of ['claude', 'codex', 'node']) {
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

test('setup makes trace-canvas a command in the user\'s own bin folder on the PATH, else says how', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cmd-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cli = path.join(home, 'clone', 'bin', 'trace-canvas.mjs'), local = path.join(home, '.local', 'bin');
  fs.mkdirSync(path.dirname(cli), { recursive: true }); fs.writeFileSync(cli, '#!/usr/bin/env node\n');
  const node = '/opt/node22/bin/node'; // the node that ran setup, not whichever a shell finds first
  assert.match(linkCommand(cli, { PATH: '/usr/bin:/bin' }, home, node).hint, /alias trace-canvas='\\"\/opt\/node22\/bin\/node\\" \\".*clone\/bin\/trace-canvas\.mjs/);
  fs.mkdirSync(local, { recursive: true });
  const env = { PATH: `/usr/bin${path.delimiter}${local}` }, dest = path.join(local, 'trace-canvas');
  assert.deepEqual(linkCommand(cli, env, home, node), { ok: true, where: dest });
  assert.match(fs.readFileSync(dest, 'utf8'), new RegExp(`exec "${node}" "${cli}" "\\$@"`));
  assert.ok(fs.statSync(dest).mode & 0o100); // runnable
  assert.ok(linkCommand(cli, env, home, node).ok); // again: our script is replaced
  fs.unlinkSync(path.join(local, 'trace-canvas')); fs.writeFileSync(path.join(local, 'trace-canvas'), 'someone else\'s');
  assert.ok(linkCommand(cli, env, home).hint); // a file that is not our link stays
  // No ~/.local/bin or ~/bin on the PATH: the folder of the user's own node, as npm -g would use.
  const nodeDir = path.join(home, 'brew', 'bin');
  fs.mkdirSync(nodeDir, { recursive: true }); fs.writeFileSync(path.join(nodeDir, 'node'), '');
  assert.deepEqual(linkCommand(cli, { PATH: `/usr/bin${path.delimiter}${nodeDir}` }, path.join(home, 'nohome'), node), { ok: true, where: path.join(nodeDir, 'trace-canvas') });
});

test('a new terminal tab or window: iTerm2 tabs or Terminal windows on macOS; on Linux the terminal found on the PATH, on the display, the window kept open', async () => {
  const { terminalCommand } = await import('../src/agents.mjs');
  const { macTerminal } = await import('../src/agents.mjs');
  const mac = (extra, has) => macTerminal({ HOME: '/h', TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mac-')), ...extra }, has);
  assert.equal(mac({}, () => false), 'terminal');
  assert.equal(mac({}, p => p === '/Applications/iTerm.app'), 'iterm'); // iTerm2 installed: tabs
  assert.equal(mac({ TRACE_CANVAS_TERMINAL: 'terminal' }, () => true), 'terminal'); // chosen
  assert.match(terminalCommand('ls', { TRACE_CANVAS_TERMINAL: 'iterm' }, 'darwin')[1][1], /create tab with default profile/);
  assert.match(terminalCommand('ls', { TRACE_CANVAS_TERMINAL: 'terminal' }, 'darwin')[1][1], /do script "ls"/);
  // A command past the tty's 1024-byte line limit is typed as a short line that sources a self-deleting script.
  const { typeable } = await import('../src/agents.mjs');
  const long = `claude 'x${'y'.repeat(1300)}'`, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-type-')), short = typeable(long, dir);
  assert.match(short, /^\. '.*trace-canvas-[\w-]+\.sh'$/);
  const file = short.slice(3, -1);
  assert.equal(fs.readFileSync(file, 'utf8'), `rm -f '${file}'\n${long}\n`);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(typeable('ls', dir), 'ls');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-term-'));
  for (const t of ['konsole', 'gnome-terminal']) { fs.writeFileSync(path.join(bin, t), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, t), 0o755); }
  const env = { PATH: bin, DISPLAY: ':0', SHELL: '/bin/bash' };
  assert.deepEqual(terminalCommand('claude --resume s1', env, 'linux'), [path.join(bin, 'konsole'), ['--new-tab', '-e', '/bin/bash', '-lc', "claude --resume s1; exec '/bin/bash' -l"], env]);
  assert.deepEqual(terminalCommand('ls', { ...env, TERMINAL: 'gnome-terminal' }, 'linux')[1].slice(0, 3), ['--tab', '--', '/bin/bash']);
  // x-terminal-emulator → gnome-terminal.wrapper: a tab in gnome-terminal, not the wrapper's new window.
  fs.writeFileSync(path.join(bin, 'gnome-terminal.wrapper'), '#!/bin/sh\n'); fs.chmodSync(path.join(bin, 'gnome-terminal.wrapper'), 0o755);
  fs.symlinkSync(path.join(bin, 'gnome-terminal.wrapper'), path.join(bin, 'x-terminal-emulator'));
  assert.deepEqual(terminalCommand('ls', env, 'linux').slice(0, 2), [path.join(bin, 'gnome-terminal'), ['--tab', '--', '/bin/bash', '-lc', "ls; exec '/bin/bash' -l"]]);
  // Opened from inside an agent: the new one must not inherit who the caller is (it would be the caller's child).
  const caller = { ...env, CLAUDECODE: '1', CLAUDE_PID: '9', CLAUDE_CODE_SESSION_ID: 'caller', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_CODE_MESSAGING_SOCKET: '/s', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CONFIG_DIR: '/cfg', CLAUDE_CODE_USE_BEDROCK: '1' };
  const given = terminalCommand('ls', caller, 'linux')[2];
  assert.deepEqual(Object.keys(given).filter(k => /^CLAUDE/.test(k)).sort(), ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CONFIG_DIR']);
  // GNOME Terminal: the tab goes into the window of the agent that runs there, not a new window each time.
  const gt = { ...env, TERMINAL: 'gnome-terminal', GNOME_TERMINAL_SCREEN: '/org/gnome/Terminal/screen/mine' };
  assert.equal(terminalCommand('ls', gt, 'linux', '/org/gnome/Terminal/screen/agents')[2].GNOME_TERMINAL_SCREEN, '/org/gnome/Terminal/screen/agents');
  assert.equal(terminalCommand('ls', gt, 'linux', '')[2].GNOME_TERMINAL_SCREEN, '/org/gnome/Terminal/screen/mine'); // none runs: the caller's
  assert.equal(terminalCommand('ls', { PATH: '/nowhere', DISPLAY: ':0' }, 'linux'), null); // no terminal
  assert.equal(terminalCommand('ls', env, 'win32'), null);
});

test('the user\'s own bin folders join a bare PATH (a server started over ssh), at the end and once', async () => {
  const { withUserBins } = await import('../src/install.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bins-'));
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const bare = '/usr/bin:/bin';
  assert.equal(withUserBins(bare, home).split(':').slice(0, 3).join(':'), `/usr/bin:/bin:${path.join(home, '.local', 'bin')}`);
  assert.equal(withUserBins(withUserBins(bare, home), home), withUserBins(bare, home)); // once
  assert.ok(!withUserBins(bare, home).includes(path.join(home, '.bun', 'bin'))); // only folders that exist
});

test('opening a terminal reports why it did not open, instead of saying an agent started', { skip: process.platform !== 'darwin' }, async () => {
  const { openTerminal } = await import('../src/agents.mjs');
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-osa-')), osa = path.join(bin, 'osascript');
  const env = code => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, OSA: code });
  // A stand-in for osascript: fails the way a denied Automation permission does, or succeeds.
  fs.writeFileSync(osa, '#!/bin/sh\n[ "$OSA" = ok ] && exit 0\necho "execution error: Not authorized to send Apple events to Terminal. (-1743)" >&2; exit 1\n', { mode: 0o755 });
  assert.match(await openTerminal('claude hi', env('denied')), /Automation/);
  assert.equal(await openTerminal('claude hi', env('ok')), null);
});
