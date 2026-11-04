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
});

test('a hand-off prompt Trace Canvas wrote is not logged as a new to-do', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-handoff-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop'), TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  handleHook({ session_id: 'h1', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'You are taking over the Trace Canvas line "tripsplit" (thread t1). First call the MCP tool trace_bind.' }, env);
  handleHook({ session_id: 'h2', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: '读 Trace Canvas 上的线「tripsplit」（thread t1）：用 trace_read_thread 看待办。' }, env);
  handleHook({ session_id: 'h3', cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'Split the bill by item' }, env);
  assert.deepEqual(Object.values(readData(env).commits).filter(c => c.kind === 'task').map(c => c.title), ['Split the bill by item']);
});
