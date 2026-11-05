import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleHook, promptContext } from '../src/hook.mjs';
import { replyTo } from '../src/mcp.mjs';
import { updateLive } from '../src/live.mjs';
import { addCommit, mutate, readData } from '../src/store.mjs';

test('a reply logged for a session reaches it at its next turn, once, though its process changed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-reply-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), CLAUDE_CONFIG_DIR: path.join(root, 'claude'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const sid = '8f3de6b8-578f-4fe9-b976-536f05b5a841';
  // Its process each turn: 101 sent the message and is gone, 102 runs now. The hooks noted both.
  updateLive({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: 'fix it' }, { env, terminal: { pid: 101 } });
  updateLive({ hook_event_name: 'UserPromptSubmit', session_id: sid, prompt: 'and?' }, { env, terminal: { pid: 102 } });
  // Through the hook itself: the same session in a third process.
  handleHook({ session_id: sid, cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'next' }, { ...env, CLAUDE_PID: '103' });
  assert.equal(replyTo('103', readData(env), env), sid);
  assert.equal(replyTo('/run/user/1000/cc-socks/101.sock', readData(env), env), sid);
  assert.equal(replyTo('102', readData(env), env), sid);
  assert.throws(() => replyTo('/run/user/1000/cc-socks/999.sock', readData(env), env), /No session known for process 999/);
  assert.throws(() => replyTo('hello there', readData(env), env), /not "hello there"/);
  const note = mutate(d => addCommit(d, { thread: 'inbox', kind: 'note', title: 'cause', extra: { fromSession: sid } }), env);
  assert.equal(replyTo(note.id, readData(env), env), sid);

  mutate(d => { addCommit(d, { thread: 'inbox', kind: 'agent', title: 'Fixed in abc123', body: 'tests pass', extra: { to: sid } }); }, env);
  const ctx = promptContext({ session_id: sid, prompt: 'any news?' }, env);
  assert.match(ctx, /Replies other sessions left for you on Trace Canvas: \[\w+\] Fixed in abc123 — tests pass/);
  assert.doesNotMatch(promptContext({ session_id: sid, prompt: 'again' }, env), /Replies/); // once
  assert.doesNotMatch(promptContext({ session_id: 'someone-else-1234', prompt: 'hi' }, env), /Replies/);
});
