import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handleHook, promptContext } from '../src/hook.mjs';
import { hookConfig } from '../src/install.mjs';
import { addCommit, mutate, readData } from '../src/store.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'trace-canvas.mjs');

test('every instruction reminds the agent to put new goals on its line as to-dos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-prompt-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop'), TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  handleHook({ session_id: 's1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Read receipts with OCR' }, env);
  const tid = Object.values(readData(env).threads)[0].id;
  mutate(d => { addCommit(d, { thread: tid, kind: 'task', title: 'Try a vision model', ts: 1 }); }, env);

  const ctx = promptContext({ session_id: 's1', prompt: 'Later we also want dark mode' }, env);
  assert.match(ctx, new RegExp(`line "tripsplit" \\(thread ${tid}\\)`));
  assert.match(ctx, /trace_log \(kind "task", thread "\w+"\)/);
  assert.match(ctx, /already open: Try a vision model\.$/);
  assert.equal(promptContext({ session_id: 's1', prompt: '/trace-canvas tasks' }, env), '');
  assert.equal(promptContext({ session_id: 'nobody', prompt: 'Hi' }, env), '');

  // The hook prints it under each CLI's own event name, and Claude Code waits for it.
  const run = (args, payload) => JSON.parse(execFileSync(process.execPath, [BIN, 'hook', ...args], { input: JSON.stringify({ session_id: 's1', cwd: repo, ...payload }), env, encoding: 'utf8' })).hookSpecificOutput;
  assert.equal(run([], { hook_event_name: 'UserPromptSubmit', prompt: 'Next idea: export to CSV' }).hookEventName, 'UserPromptSubmit');
  assert.equal(run(['--agent', 'gemini'], { hook_event_name: 'BeforeAgent', prompt: 'And a share link' }).hookEventName, 'BeforeAgent');
  assert.equal(hookConfig('x').UserPromptSubmit[0].hooks[0].async, undefined);
  // The Autopilot gate waits beside the live update, and refuses a tool with Claude Code's own answer.
  assert.deepEqual(hookConfig('x').PreToolUse[0].hooks.map(h => [h.command, !!h.async]), [['x', true], ['x --gate', false]]);
  mutate(d => { d.threads[tid].apStopped = { session: 's1', at: 1 }; }, env);
  const deny = run(['--gate'], { hook_event_name: 'PreToolUse', tool_name: 'Bash' });
  assert.equal(deny.permissionDecision, 'deny'); assert.match(deny.permissionDecisionReason, /turned Autopilot off/);
  assert.equal(execFileSync(process.execPath, [BIN, 'hook', '--gate'], { input: JSON.stringify({ session_id: 's2', tool_name: 'Bash' }), env, encoding: 'utf8' }), '');
});

test('a hand-off prompt Trace Canvas wrote, or a stray keystroke, is not logged as a new to-do', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-handoff-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop'), TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  handleHook({ session_id: 'h1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'You are taking over the Trace Canvas line "tripsplit" (thread t1). First call the MCP tool trace_bind.' }, env);
  handleHook({ session_id: 'h2', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: '读 Trace Canvas 上的线「tripsplit」（thread t1）：用 trace_read_thread 看待办。' }, env);
  for (const typed of [':q', 'login', 'ok', ':wq', 'y']) handleHook({ session_id: 'h4', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: typed }, env); // keystrokes, not asks
  handleHook({ session_id: 'h3', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Split the bill by item' }, env);
  assert.deepEqual(Object.values(readData(env).commits).filter(c => c.kind === 'task').map(c => c.title), ['Split the bill by item']);
});

// Every prompt Trace Canvas writes for an agent comes back as that session's first prompt. Whatever writes one and the
// hook that must know it go by one table (src/prompts.mjs); this feeds each writer's real output back through the hook.
test('a prompt Trace Canvas wrote itself is never logged as a new to-do: either language, pasted, or after the person\'s own words', async () => {
  const fsx = await import('node:fs'), osx = await import('node:os'), px = await import('node:path');
  const { handleHook, autopilotStop } = await import('../src/hook.mjs'), { readData, mutate, createThread, addCommit } = await import('../src/store.mjs');
  const { handTo, dispatch, autopilotPrompt } = await import('../src/ops.mjs'), { HEADS, isHandoff } = await import('../src/prompts.mjs');
  const root = fsx.mkdtempSync(px.join(osx.tmpdir(), 'tc-heads-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: px.join(root, 'home'), TRACE_CANVAS_DESKTOP_DIR: px.join(root, 'desk'), TRACE_CANVAS_MAP: '', TRACE_CANVAS_MACHINE: 'heads', TRACE_CANVAS_PROMPTS: 'all' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  // What the server writes.
  const made = mutate(d => {
    const t = createThread(d, { name: 'Trip' }), c = addCommit(d, { thread: t.id, kind: 'task', title: 'Split the bill' });
    d.sessions.old = { id: 'old', thread: t.id, agent: 'Claude Code', cwd: root, last: 1 };
    const todos = dispatch(d, { refs: [c.id] }, env)[0].prompt;
    return { todos, hand: handTo(d, { ref: c.id, to: 'codex' }, env).command, autopilot: autopilotPrompt(d, t, t.id) };
  }, env);
  const prompts = { ...made, hand: /codex '(.*)'$/.exec(made.hand)[1], nudge: `${HEADS.nudge} "Trip" (thread t1), to clear its to-dos: 1 open, next: x`, evolve: `${HEADS.evolve} "Trip" (thread t1): 0 of 3 rounds done`, reply: `${HEADS.reply}: the figure is ready [c1]` };
  // What the page writes: every handPrompt and agentPromptText it has, both languages.
  const page = fsx.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const fns = [...page.matchAll(/(handPrompt|agentPromptText): (\([^)]*\) => `[^\n]*?`),[ \n]/g)];
  assert.equal(fns.length, 4);
  fns.forEach((m, i) => { prompts[`page ${m[1]} ${i}`] = eval(`(${m[2]})`)('Trip', 't1', 'Split the bill'); });
  let n = 0;
  for (const [k, p] of Object.entries(prompts)) {
    assert.ok(isHandoff(p), k);
    for (const text of [p, `<pasted_content id="1a">\n${p}\n</pasted_content id="1a">`, `接着这个做 <pasted_content id="2b">${p}</pasted_content id="2b">`, `please go on: ${p}`])
      handleHook({ session_id: `s${n++}`, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: text }, env);
  }
  assert.deepEqual(Object.values(readData(env).commits).filter(c => c.kind === 'task').map(c => c.title), ['Split the bill']);
  // The person's own prompt still is one.
  handleHook({ session_id: 'me', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Add a currency switch to the trip page' }, env);
  assert.equal(Object.values(readData(env).commits).filter(c => c.kind === 'task').length, 2);
  assert.equal(typeof autopilotStop, 'function');
});
