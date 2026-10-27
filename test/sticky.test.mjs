import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bindSession, handleHook } from '../src/hook.mjs';
import { bindLiveSession, mergeThreads, readThread } from '../src/ops.mjs';
import { addCommit, createThread, mutate, readData } from '../src/store.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sticky-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop'), TRACE_CANVAS_MAP: '' };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  const repo = path.join(root, 'tripsplit');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo, 'a.md'), 'x'); git('add', '.'); git('commit', '-q', '-m', 'init');
  let n = 0;
  const fire = (sid, ev, extra = {}) => handleHook({ session_id: sid, cwd: repo, transcript_path: path.join(root, `${sid}.jsonl`), hook_event_name: ev, ...extra }, env);
  const edit = sid => { fire(sid, 'PostToolUse', { tool_name: 'Edit', tool_use_id: `u${++n}`, tool_input: { file_path: path.join(repo, 'a.md') } }); fire(sid, 'Stop', { last_assistant_message: `Turn ${n}` }); };
  const on = name => Object.values(readData(env).commits).filter(c => readData(env).threads[c.thread]?.name === name).sort((a, b) => a.ts - b.ts).map(c => c.kind);
  return { root, env, repo, fire, edit, on };
}

test('a bound session stays on its line after it ends and is resumed, and logs no second first prompt', () => {
  const s = sandbox();
  const promo = mutate(d => createThread(d, { name: 'promo' }).id, s.env);
  s.fire('s1', 'UserPromptSubmit', { prompt: 'Tidy the promo video' });
  mutate(d => bindSession(d, 's1', promo, s.env), s.env);
  s.edit('s1');
  s.fire('s1', 'SessionEnd', { reason: 'other' }); // the desktop app ends the process…
  s.fire('s1', 'SessionStart', { source: 'resume' }); // …and resumes it under the same id
  s.fire('s1', 'UserPromptSubmit', { prompt: 'Now the second video' });
  s.edit('s1');
  assert.deepEqual(s.on('tripsplit'), ['task']);
  assert.deepEqual(s.on('promo'), ['agent', 'note', 'agent']);
  const e = readData(s.env).sessions.s1;
  assert.deepEqual([e.thread, e.bound, e.prompted, e.title, e.resume, e.cwd], [promo, true, true, 'Tidy the promo video', 'claude --resume s1', s.repo]);
});

test('a session from before the session table is adopted from its records', () => {
  const s = sandbox();
  mutate(d => {
    const th = createThread(d, { name: 'promo' });
    addCommit(d, { thread: th.id, kind: 'task', title: 'Old first prompt', ts: 1, extra: { session: 'old' } });
  }, s.env);
  s.fire('old', 'UserPromptSubmit', { prompt: 'Resumed after the update' });
  s.edit('old');
  assert.deepEqual(s.on('promo'), ['task', 'agent']); // a line without a key got its records by hand
  assert.equal(Object.values(readData(s.env).threads).some(t => t.key === 'tripsplit'), false);
});

test('combining hands the folder key and old ids to the kept line', () => {
  const s = sandbox();
  s.fire('a', 'UserPromptSubmit', { prompt: 'Work in the folder' }); // creates the folder line
  const folder = Object.values(readData(s.env).threads).find(t => t.key === 'tripsplit').id;
  mutate(d => { createThread(d, { name: 'promo' }); bindSession(d, 'b', folder, s.env); }, s.env);
  mutate(d => mergeThreads(d, { sources: ['tripsplit'], target: 'promo', mode: 'combine' }, s.env), s.env);
  const promo = Object.values(readData(s.env).threads).find(t => t.name === 'promo');
  assert.equal(promo.key, 'tripsplit');
  assert.ok(promo.aliases.includes(folder));
  s.fire('c', 'UserPromptSubmit', { prompt: 'A new session in the same folder' }); // unbound: follows the key
  s.edit('b'); // bound to the folded line: follows the alias
  assert.deepEqual(s.on('promo'), ['task', 'task', 'agent']);
  assert.equal(Object.keys(readData(s.env).threads).length, 1);
});

test('a line lists its sessions, newest first, with the command that resumes each from its folder', () => {
  const s = sandbox();
  s.fire('s1', 'UserPromptSubmit', { prompt: 'First session' });
  s.fire('s2', 'UserPromptSubmit', { prompt: 'Second session', _agent: 'codex' });
  const r = readThread(readData(s.env), 'tripsplit', {}, s.env);
  assert.deepEqual(r.sessions.map(x => [x.id, x.agent, x.title, x.status]), [['s2', 'Codex', 'Second session', 'working'], ['s1', 'Claude Code', 'First session', 'working']]);
  assert.equal(r.sessions[0].resume, `cd '${s.repo}' && codex resume s2`);
});

test('a session bound through the tools says which agent and machine it is, before any hook has run', () => {
  const s = sandbox();
  const env = { ...s.env, TRACE_CANVAS_MACHINE: 'bsuperstation' };
  mutate(d => { createThread(d, { name: 'Cross-machine test' }); bindLiveSession(d, { sessionId: 'cx9', thread: 'Cross-machine test', agent: 'codex' }, env); }, env);
  const e = readData(env).sessions.cx9;
  assert.deepEqual([e.agent, e.agentKey, e.resume, e.machine, e.bound], ['Codex', 'codex', 'codex resume cx9', 'bsuperstation', true]);
});
