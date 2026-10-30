import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { focusScript, normalize, terminalScript } from '../src/agents.mjs';
import { handleHook, sessionStartContext, sessionThread } from '../src/hook.mjs';
import { readLive, updateLive } from '../src/live.mjs';
import { codexHooks, codexWritable, install } from '../src/install.mjs';
import { handTo, listTasks } from '../src/ops.mjs';
import { addCommit, createThread, emptyData, mutate, readData } from '../src/store.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-agents-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop'), TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.md'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init');
  return { root, env, repo };
}

test('Codex and Gemini payloads become the shape the hook reads', () => {
  assert.deepEqual(normalize('codex', { hook_event_name: 'PermissionRequest', tool_name: 'shell' }).notification_type, 'permission_prompt');
  assert.equal(normalize('codex', { hook_event_name: 'PermissionRequest' }).hook_event_name, 'Notification');
  assert.equal(normalize('codex', { hook_event_name: 'Interrupt' }).hook_event_name, 'Stop');
  const shell = normalize('codex', { hook_event_name: 'PostToolUse', tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'git commit -m "x"'] }, tool_response: '[main 1a2b3c4] x' });
  assert.deepEqual([shell.tool_name, shell.tool_input.command, shell.tool_response.stdout], ['Bash', 'git commit -m "x"', '[main 1a2b3c4] x']);
  const patch = normalize('codex', { hook_event_name: 'PostToolUse', tool_name: 'apply_patch', tool_input: { command: ['apply_patch', '*** Begin Patch\n*** Update File: src/a.js\n@@\n*** Add File: docs/b.md\n*** End Patch'] } });
  assert.deepEqual([patch.tool_name, patch.tool_input.files], ['Edit', ['src/a.js', 'docs/b.md']]);
  assert.equal(normalize('gemini', { hook_event_name: 'BeforeAgent', prompt: 'Fix the OCR' }).hook_event_name, 'UserPromptSubmit');
  const after = normalize('gemini', { hook_event_name: 'AfterAgent', prompt_response: 'Done. 94% now.' });
  assert.deepEqual([after.hook_event_name, after.last_assistant_message], ['Stop', 'Done. 94% now.']);
  const write = normalize('gemini', { hook_event_name: 'AfterTool', tool_name: 'write_file', tool_input: { file_path: '/x/notes.md', content: 'y' } });
  assert.deepEqual([write.tool_name, write.tool_input.file_path], ['Edit', '/x/notes.md']);
  assert.equal(normalize('gemini', { hook_event_name: 'Notification', notification_type: 'ToolPermission' }).notification_type, 'permission_prompt');
  assert.equal(normalize('claude', { hook_event_name: 'Stop' })._agent, 'claude');
});

test('a Codex session is recorded as Codex, with its own resume command and a "needs you" state', () => {
  const s = sandbox();
  const fire = (ev, extra = {}) => handleHook(normalize('codex', { session_id: 'cx1', cwd: s.repo, transcript_path: path.join(s.root, 'cx1.jsonl'), hook_event_name: ev, ...extra }), s.env);
  fire('SessionStart', { source: 'startup' });
  fire('UserPromptSubmit', { prompt: 'Add a CSV export', turn_id: 't1' });
  fire('PreToolUse', { tool_name: 'shell', tool_use_id: 'u1', tool_input: { command: ['bash', '-lc', 'git commit -am "CSV export"'] } });
  fire('PermissionRequest', { tool_name: 'shell', tool_input: { command: ['bash', '-lc', 'git push'] } });
  let live = readLive('cx1', s.env);
  assert.deepEqual([live.agent, live.agentKey, live.resume, live.status], ['Codex', 'codex', 'codex resume cx1', 'waiting']);
  fire('PostToolUse', { tool_name: 'apply_patch', tool_use_id: 'u2', tool_input: { command: ['apply_patch', '*** Begin Patch\n*** Add File: export.js\n*** End Patch'] } });
  fire('PostToolUse', { tool_name: 'shell', tool_use_id: 'u3', tool_input: { command: ['bash', '-lc', 'git commit -am "CSV export"'] }, tool_response: '[main 9f8e7d6] CSV export\n 1 file changed' });
  fire('Stop', { last_assistant_message: 'Added the CSV export.' });
  const cs = Object.values(readData(s.env).commits).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(cs.map(c => [c.title, c.agent]), [
    ['Add a CSV export', 'Codex'], ['Commit 9f8e7d6: CSV export', 'Codex'], ['Added the CSV export.', 'Codex'],
  ]);
  assert.deepEqual(cs[2].files, ['export.js']);
  assert.deepEqual(cs[0].links, ['codex resume cx1']);
});

test('a real Codex 0.164 session replays into the right records (test/fixtures/codex/session.jsonl)', () => {
  const s = sandbox();
  const lines = fs.readFileSync(new URL('./fixtures/codex/session.jsonl', import.meta.url), 'utf8').trim().split('\n');
  let waiting;
  for (const l of lines) {
    const p = normalize('codex', JSON.parse(l.replaceAll('/work/codex-probe', s.repo)));
    handleHook(p, s.env);
    if (p.notification_type === 'permission_prompt') waiting = readLive(p.session_id, s.env).status;
  }
  const cs = Object.values(readData(s.env).commits).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(cs.map(c => c.kind), ['task', 'agent', 'agent', 'note']);
  assert.equal(cs[1].title, 'Commit eac5d74: Second line'); // the failed first try (index.lock) left nothing
  assert.deepEqual(cs[2].files, ['notes.md']); // from apply_patch
  assert.ok(cs.every(c => c.agent === 'Codex') && cs[0].links[0].startsWith('codex resume '));
  assert.equal(waiting, 'waiting');
  assert.equal(readLive(JSON.parse(lines[0]).session_id, s.env), null); // SessionEnd clears it
});

test('setup puts the data folder on the Codex sandbox writable list, once, wherever the table is', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-toml-')), f = path.join(dir, 'config.toml');
  fs.writeFileSync(f, 'model = "x"\n\n[projects."/a"]\ntrust_level = "trusted"\n');
  assert.equal(codexWritable(f, '/h/.trace-canvas'), true);
  assert.equal(codexWritable(f, '/h/.trace-canvas'), false);
  assert.ok(fs.readFileSync(f, 'utf8').endsWith('trust_level = "trusted"\n\n[sandbox_workspace_write]\nwritable_roots = ["/h/.trace-canvas"]\n'));
  fs.writeFileSync(f, '[sandbox_workspace_write]\nnetwork_access = true\n[x]\nwritable_roots = ["no"]\n');
  codexWritable(f, '/h');
  assert.equal(fs.readFileSync(f, 'utf8'), '[sandbox_workspace_write]\nwritable_roots = ["/h"]\nnetwork_access = true\n[x]\nwritable_roots = ["no"]\n');
  fs.writeFileSync(f, '[sandbox_workspace_write]\nwritable_roots = ["/data"]\n');
  codexWritable(f, '/h');
  assert.equal(fs.readFileSync(f, 'utf8'), '[sandbox_workspace_write]\nwritable_roots = ["/h", "/data"]\n');
  assert.ok(fs.existsSync(f + '.bak'));
});

test('Codex hooks go after everyone else\'s, in seconds, and installing twice changes nothing', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-codex-')), 'hooks.json');
  const theirs = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: '/usr/local/bin/vibe-island hook', timeout: 5 }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'theatrum-session-context', timeout: 5 }] }] } };
  fs.writeFileSync(file, JSON.stringify(theirs));
  const cmd = 'node "/x/trace-canvas.mjs" hook --agent codex';
  install(file, cmd, codexHooks(cmd));
  const once = fs.readFileSync(file, 'utf8');
  install(file, cmd, codexHooks(cmd));
  assert.equal(fs.readFileSync(file, 'utf8'), once);
  const h = JSON.parse(once).hooks;
  assert.equal(h.PreToolUse[0].hooks[0].command, '/usr/local/bin/vibe-island hook'); // theirs keep their place
  assert.equal(h.PreToolUse[1].hooks[0].command, cmd);
  assert.equal(h.SessionStart[1].hooks[0].timeout, 10);
  assert.ok(h.PermissionRequest && !h.Notification && !JSON.stringify(h).includes('"async"'));
});

test('to-dos are assigned to an agent and handed over with a command that starts it on the line', () => {
  const d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: os.tmpdir() });
  addCommit(d, { thread: th.id, kind: 'task', title: 'Add a CSV export', ts: 1 });
  addCommit(d, { thread: th.id, kind: 'task', title: 'Dark mode', ts: 2, extra: { assignee: 'gemini' } });
  const r = handTo(d, { ref: 'CSV export', to: 'codex' }, { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-hand-')) });
  assert.equal(r.todo.assignee, 'codex');
  assert.ok(r.command.startsWith(`cd '${os.tmpdir()}' && TRACE_CANVAS_THREAD=${th.id} codex '`));
  assert.ok(r.command.includes('trace_bind') && r.command.includes('Start with: Add a CSV export'));
  assert.deepEqual(listTasks(d, { assignee: 'codex' })[0].tasks.map(t => t.title), ['Add a CSV export']);
  assert.deepEqual(listTasks(d, { assignee: 'gemini' })[0].tasks.map(t => t.assignee), ['gemini']);
  assert.throws(() => handTo(d, { ref: 'Dark mode', to: 'copilot' }), /Hand to whom/);
});

test('▶ Start names the Remote Control session after the line, keeps the command on one line, and sees a session already there', () => {
  const d = emptyData(), env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-start-')) };
  const th = createThread(d, { name: "Bin's\nline", key: 'bins-line', note: os.tmpdir() });
  addCommit(d, { thread: th.id, kind: 'task', title: 'First\nthen second', ts: 1 });
  const r = handTo(d, { ref: th.id, to: 'claude', remote: true }, env);
  assert.ok(r.command.startsWith(`cd '${os.tmpdir()}' && TRACE_CANVAS_THREAD=${th.id} claude --remote-control='Bin'\\''s line' 'You are taking over`));
  assert.ok(!r.command.includes('\n') && r.command.includes('trace_read_thread'));
  assert.deepEqual(r.live, []);
  updateLive({ hook_event_name: 'UserPromptSubmit', session_id: 's-running', cwd: os.tmpdir() }, { env });
  d.sessions = { 's-running': { thread: th.id, bound: true } };
  assert.deepEqual(handTo(d, { ref: th.id, to: 'claude', remote: true }, env).live.map(s => s.id), ['s-running']);
  assert.ok(!handTo(d, { ref: th.id, to: 'codex', remote: true }, env).command.includes('--remote-control')); // Claude Code only
});

test('a new session is told its line, goal, its own to-dos and where things are on this machine', () => {
  const s = sandbox();
  const tid = mutate(d => {
    const th = createThread(d, { name: 'tripsplit · receipt-ocr' }); th.goal = 'Totals right on 95% of blurry receipts';
    addCommit(d, { thread: th.id, kind: 'task', title: 'Try a vision model', ts: 1, extra: { assignee: 'codex' } });
    addCommit(d, { thread: th.id, kind: 'task', title: 'Write the benchmark notes', ts: 2 });
    return th.id;
  }, s.env);
  // A tiny stand-in for the location map's where.py --json.
  const map = path.join(s.root, 'map'); fs.mkdirSync(path.join(map, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(map, 'tools', 'where.py'), `import json\nprint(json.dumps([{"id":"repo-tripsplit","title":"tripsplit","notes":"Heavy runs on bsuperstation","where":[{"host":"mac","role":"clone","path":"x","local":${JSON.stringify(s.repo)}}]}]))\n`);
  const env = { ...s.env, TRACE_CANVAS_THREAD: tid, TRACE_CANVAS_MAP: map };
  const ctx = sessionStartContext(normalize('codex', { session_id: 'cx2', cwd: s.repo, hook_event_name: 'SessionStart' }), env);
  assert.match(ctx, /line "tripsplit · receipt-ocr"/);
  assert.match(ctx, /Goal: Totals right on 95% of blurry receipts/);
  assert.match(ctx, /Open to-dos for you \(Codex\):\n- Try a vision model/);
  assert.match(ctx, /1 open to-do is not assigned/);
  assert.match(ctx, new RegExp(`tripsplit: clone ${s.repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — Heavy runs on bsuperstation`));
  assert.deepEqual(sessionThread(readData(s.env), { id: 'cx2' }, s.env), { threadId: tid, bound: true });
});

test('Open in Terminal runs the hand-off command in a new Terminal window, quoted for AppleScript', () => {
  const s = terminalScript(`cd '/x y' && TRACE_CANVAS_THREAD=t1 codex 'Say "hi" \\ then work'`);
  assert.equal(s, `tell application "Terminal"\n  do script "cd '/x y' && TRACE_CANVAS_THREAD=t1 codex 'Say \\"hi\\" \\\\ then work'"\n  activate\nend tell`);
});

test('Go to the terminal finds the Terminal or iTerm2 tab by its tty, and nothing else', () => {
  assert.match(focusScript({ tty: '/dev/ttys012', term: 'Apple_Terminal' }), /tell application "Terminal"[\s\S]*tty of t is "\/dev\/ttys012"[\s\S]*return "ok"/);
  assert.match(focusScript({ tty: '/dev/ttys004', term: 'iTerm.app' }), /tell application "iTerm2"[\s\S]*sessions of t/);
  assert.equal(focusScript({ tty: '/dev/ttys004', term: 'vscode' }), null);
  assert.equal(focusScript({ tty: '', term: 'Apple_Terminal' }), null);
  assert.equal(focusScript({ tty: '/dev/ttys1" & do shell script "x', term: 'Apple_Terminal' }), null);
  assert.equal(focusScript(), null);
});

test('an iFlow CLI session, its payloads as iFlow 0.4 builds them, is recorded as iFlow with the reply read from its transcript', () => {
  const s = sandbox(), transcript = path.join(s.root, 'session-if1.jsonl');
  // iFlow's own tool names and inputs (run_shell_command, write_file), the alias it adds, and a string tool response.
  const fire = (ev, extra = {}) => handleHook(normalize('iflow', { session_id: 'session-if1', transcript_path: transcript, cwd: s.repo, hook_event_name: ev, ...extra }), s.env);
  fire('SessionStart', { source: 'startup' });
  fire('UserPromptSubmit', { prompt: 'Add a notes file' });
  fire('PostToolUse', { tool_name: 'write_file', tool_name_alias: 'WriteFile', tool_input: { file_path: path.join(s.repo, 'notes.txt'), content: 'hello' }, tool_response: 'ok', tool_desc: '', tool_schema: {} });
  fire('PostToolUse', { tool_name: 'run_shell_command', tool_name_alias: 'Shell', tool_input: { command: 'git add notes.txt && git commit -m "Add notes"' }, tool_response: '[main 1a2b3c4] Add notes\n 1 file changed', tool_desc: '', tool_schema: {} });
  // Its Stop carries no reply (and always stop_hook_active: true): the reply comes from the transcript.
  fs.writeFileSync(transcript, [
    { type: 'user', sessionId: 'session-if1', message: { role: 'user', content: 'Add a notes file' } },
    { type: 'assistant', sessionId: 'session-if1', message: { role: 'assistant', content: [{ type: 'text', text: 'Added notes.txt and committed it.' }] } },
  ].map(j => JSON.stringify(j)).join('\n') + '\n');
  fire('Stop', { stop_hook_active: true });
  const live = readLive('session-if1', s.env);
  assert.deepEqual([live.agent, live.agentKey, live.resume], ['iFlow CLI', 'iflow', 'iflow -r session-if1']);
  const cs = Object.values(readData(s.env).commits).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(cs.map(c => [c.title, c.agent]), [['Add a notes file', 'iFlow CLI'], ['Commit 1a2b3c4: Add notes', 'iFlow CLI'], ['Added notes.txt and committed it.', 'iFlow CLI']]);
  assert.deepEqual(cs[2].files, ['notes.txt']);
});

test('iFlow hooks go in its settings.json in Claude\'s shape, seconds, no matcher on SubagentStop; its MCP server too', async () => {
  const { iflowHooks, installAgentMcp, install, agentFiles } = await import('../src/install.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-iflow-')), file = agentFiles(home).iflow;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ modelName: 'Qwen3-Coder', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other-tool' }] }] } }));
  install(file, 'node cli.mjs hook --agent iflow', iflowHooks('node cli.mjs hook --agent iflow'));
  installAgentMcp('iflow', '/x/cli.mjs', home);
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.modelName, 'Qwen3-Coder'); // the person's own settings stay
  assert.deepEqual(Object.keys(s.hooks).sort(), ['Notification', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit']);
  assert.equal(s.hooks.Stop[0].hooks[0].command, 'other-tool'); // theirs first, ours after
  assert.equal(s.hooks.Stop[1].hooks[0].timeout, 10);
  assert.equal(s.hooks.SubagentStop[0].matcher, undefined);
  assert.deepEqual(s.mcpServers['trace-canvas'].env, { TRACE_CANVAS_AGENT: 'iflow' });
});

test('Claude Code on another model\'s API is named after it', async () => {
  const { modelProvider } = await import('../src/agents.mjs');
  assert.equal(modelProvider({ ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' }), 'DeepSeek');
  assert.equal(modelProvider({ ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/anthropic' }), 'Kimi');
  assert.equal(modelProvider({ ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic' }), 'Qwen');
  assert.equal(modelProvider({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }), '');
  assert.equal(modelProvider({}), '');
  const s = sandbox(), env = { ...s.env, ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' };
  handleHook({ session_id: 'ds1', cwd: s.repo, hook_event_name: 'UserPromptSubmit', prompt: 'Speed up the parser' }, env);
  assert.deepEqual(Object.values(readData(env).commits).map(c => c.agent), ['Claude Code · DeepSeek']);
});

test('the experimental CLIs: Claude-shaped hooks for Qwen Code, Qoder and TRAE', async () => {
  const { AGENT_SETUP, agentFiles, installAgentMcp } = await import('../src/install.mjs');
  const { AGENTS } = await import('../src/agents.mjs');
  const trae = AGENT_SETUP.trae.hooks('cmd');
  assert.deepEqual(Object.keys(trae), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop']);
  assert.deepEqual(trae.PreToolUse, [{ matcher: '*', hooks: [{ type: 'command', command: 'cmd' }] }]);
  assert.deepEqual(trae.Stop, [{ hooks: [{ type: 'command', command: 'cmd' }] }]); // no timeout: units differ between CLIs
  assert.equal(Object.keys(AGENT_SETUP.qwen.hooks('cmd')).length, 7);
  for (const k of ['qwen', 'qoder', 'trae', 'kimi', 'dsh', 'minimax']) assert.equal(AGENTS[k].experimental, true);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cn-'));
  assert.equal(agentFiles(home).trae, path.join(home, '.trae', 'hooks.json'));
  fs.mkdirSync(path.join(home, '.trae-cn'));
  assert.equal(agentFiles(home).trae, path.join(home, '.trae-cn', 'hooks.json')); // the Chinese edition's folder when it is there
  assert.equal(installAgentMcp('qwen', '/x/cli.mjs', home).ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(agentFiles(home).qwen, 'utf8')).mcpServers['trace-canvas'].env, { TRACE_CANVAS_AGENT: 'qwen' });
  assert.match(installAgentMcp('qoder', '/x/cli.mjs', home).hint, /^qodercli mcp add trace-canvas -- /);
});

test('a Kimi Code session, its payloads as Kimi Code builds them, is recorded as Kimi Code', () => {
  const s = sandbox();
  // snake_case fields, the prompt as content parts, Edit's path, the result as tool_output; Interrupt ends a turn.
  const fire = (ev, extra = {}) => handleHook(normalize('kimi', { hook_event_name: ev, session_id: 'kimi-s1', session_title: 'Notes', client_type: 'kimi_code_cli', cwd: s.repo, ...extra }), s.env);
  fire('SessionStart', { source: 'startup', model: 'kimi-k2', profile: 'default' });
  fire('UserPromptSubmit', { prompt: [{ type: 'text', text: 'Add a notes file' }] });
  assert.equal(normalize('kimi', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { path: '/p/a.js', old_string: 'a', new_string: 'b' } }).tool_input.file_path, '/p/a.js');
  fire('PermissionRequest', { tool_name: 'Bash' });
  assert.equal(readLive('kimi-s1', s.env).status, 'waiting');
  fire('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'git add notes.txt && git commit -m "Add notes"' }, tool_output: '[main 1a2b3c4] Add notes\n 1 file changed' });
  assert.equal(normalize('kimi', { hook_event_name: 'Interrupt', reason: 'user' }).hook_event_name, 'Stop');
  const live = readLive('kimi-s1', s.env);
  assert.deepEqual([live.agent, live.agentKey, live.resume], ['Kimi Code', 'kimi', 'kimi --session kimi-s1']);
  const cs = Object.values(readData(s.env).commits).sort((a, b) => a.ts - b.ts);
  assert.deepEqual(cs.map(c => [c.title, c.agent]), [['Add a notes file', 'Kimi Code'], ['Commit 1a2b3c4: Add notes', 'Kimi Code']]);
});

test('Kimi Code\'s hooks are [[hooks]] tables in its config.toml, replaced on a second setup; its MCP server goes in mcp.json', async () => {
  const { installKimi, installAgentMcp } = await import('../src/install.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-kimi-')), file = path.join(home, '.kimi-code', 'config.toml');
  const mine = 'default_model = "kimi-k2"\n\n[[hooks]]\nevent = "Notification"\nmatcher = "task\\\\.completed"\ncommand = "terminal-notifier -message done"\n\n[mcp]\nstartup_timeout_ms = 30000\n';
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, mine);
  const cmd = '"/usr/bin/node" "/x/bin/trace-canvas.mjs" hook --agent kimi';
  installKimi(file, cmd); installKimi(file, cmd);
  const toml = fs.readFileSync(file, 'utf8'), tables = toml.split(/^(?=\[)/m);
  assert.ok(toml.startsWith(mine.trimEnd())); // the person's settings and hooks are kept, in place
  const ours = tables.filter(t => t.includes('--agent kimi'));
  assert.deepEqual(ours.map(t => t.match(/event = "(\w+)"/)[1]), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'Interrupt', 'SubagentStart', 'SubagentStop', 'SessionEnd']);
  assert.equal(ours[0], `[[hooks]]\nevent = "SessionStart"\ncommand = '${cmd}'\ntimeout = 10\n\n`);
  for (const t of ours) assert.deepEqual(t.trim().split('\n').slice(1).map(l => l.split(' = ')[0]), ['event', 'command', 'timeout']); // only keys it allows
  installAgentMcp('kimi', '/x/bin/trace-canvas.mjs', home);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.kimi-code', 'mcp.json'), 'utf8')).mcpServers['trace-canvas'].env, { TRACE_CANVAS_AGENT: 'kimi' });
});

test('DeepSeek Harness gets a Claude Code hooks file for its bridge plugin and a patch that mounts it and the MCP client', async () => {
  const { installDsh } = await import('../src/install.mjs');
  const s = sandbox(), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dsh-'));
  const patch = installDsh(dir, '/x/bin/trace-canvas.mjs'), yml = fs.readFileSync(patch, 'utf8');
  const hooks = JSON.parse(fs.readFileSync(path.join(dir, 'dsh-hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop']);
  assert.match(hooks.Stop[0].hooks[0].command, /trace-canvas\.mjs" hook --agent dsh$/);
  assert.match(yml, /name: '@deepseek-ai\/dsh-hooks-claude-code'\n {6}config:\n {8}configPath: ".*dsh-hooks\.json"/);
  assert.match(yml, /name: '@deepseek-ai\/dsh-mcp-client'[\s\S]*serverName: trace-canvas[\s\S]*args: \["\/x\/bin\/trace-canvas\.mjs", mcp\][\s\S]*TRACE_CANVAS_AGENT: dsh/);
  // Its bridge's payloads: Claude's fields, the prompt as text, transcript_path always '', a string tool_response.
  const fire = (ev, extra = {}) => handleHook(normalize('dsh', { session_id: 'dsh-s1', transcript_path: '', cwd: s.repo, hook_event_name: ev, ...extra }), s.env);
  fire('SessionStart', { source: 'startup' });
  fire('UserPromptSubmit', { prompt: 'Speed up the parser' });
  fire('PostToolUse', { tool_name: 'bash', tool_input: { command: 'git commit -am "Faster parser"' }, tool_use_id: 'c1', tool_response: '[main 9f8e7d6] Faster parser' });
  fire('Stop', { stop_hook_active: false });
  const live = readLive('dsh-s1', s.env);
  assert.deepEqual([live.agent, live.agentKey, live.resume], ['DeepSeek Harness', 'dsh', 'dsh web']);
  assert.deepEqual(Object.values(readData(s.env).commits).sort((a, b) => a.ts - b.ts).map(c => c.title), ['Speed up the parser', 'Commit 9f8e7d6: Faster parser']);
});

test('MiniMax Code gets a local plugin in Claude Code\'s plugin format: hooks, and the MCP server in its manifest', async () => {
  const { installMinimax } = await import('../src/install.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mm-'));
  const root = installMinimax(home, '/x/bin/trace-canvas.mjs', {});
  assert.equal(root, path.join(home, '.minimax', 'plugins', 'trace-canvas'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'trace-canvas'); // the folder's name
  assert.deepEqual(manifest.mcpServers['trace-canvas'].args, ['/x/bin/trace-canvas.mjs', 'mcp']);
  const hooks = JSON.parse(fs.readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd']);
  assert.match(hooks.PreToolUse[0].hooks[0].command, /--agent minimax$/);
  assert.equal(installMinimax(home, '/x/bin/trace-canvas.mjs', { MINIMAX_DATA_DIR: path.join(home, 'mm') }), path.join(home, 'mm', 'plugins', 'trace-canvas'));
  fs.mkdirSync(path.join(home, 'old', '.mavis'), { recursive: true }); // only the legacy folder there
  assert.equal(installMinimax(path.join(home, 'old'), '/x/bin/trace-canvas.mjs', {}), path.join(home, 'old', '.mavis', 'plugins', 'trace-canvas'));
  assert.equal(normalize('minimax', { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }).notification_type, 'permission_prompt');
});
