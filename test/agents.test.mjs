import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalize, terminalScript } from '../src/agents.mjs';
import { handleHook, sessionStartContext, sessionThread } from '../src/hook.mjs';
import { readLive } from '../src/live.mjs';
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
