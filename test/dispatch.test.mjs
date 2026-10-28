import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, addCommit, createThread, machineName } from '../src/store.mjs';
import { dispatch } from '../src/ops.mjs';

test('dispatch hands each line\'s new to-dos to the agent working on it, and says how to wake it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dispatch-'));
  // The machine the records here say they are from.
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(tmp, 'home'), TRACE_CANVAS_DESKTOP_DIR: path.join(tmp, 'desk'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: machineName() };
  const now = Date.now(), live = path.join(tmp, 'home', 'live');
  fs.mkdirSync(live, { recursive: true });
  const running = (id, agent, agentKey, status) => fs.writeFileSync(path.join(live, `${id}.json`), JSON.stringify({ id, agent, agentKey, status, startedAt: now - 9e5, lastSeen: now, cwd: tmp }));
  const d = emptyData();
  const [thesis, promo, app, scripts, mine, videos, tools] = ['Thesis', 'Promo', 'App', 'Scripts', 'Mine', 'Videos', 'Tools'].map(name => createThread(d, { name }).id);
  const session = (id, thread, agent, ago) => { d.sessions[id] = { id, thread, agent, cwd: tmp, last: now - ago }; };
  // A to-do the person logged (on the page or the phone), or one an agent logged (from a session, if known).
  const todo = (thread, title, agent = '', fromSession) => addCommit(d, { thread, kind: 'task', title, agent, ts: now - 6e5, extra: fromSession ? { fromSession } : {} });

  // A stopped Claude Code session: what the person logged and what another session logged are new to it.
  session('s1', thesis, 'Claude Code', 7e6);
  todo(thesis, 'Its own to-do', 'Claude Code', 's1'); todo(thesis, 'An older agent to-do', 'Claude Code');
  const fig = todo(thesis, 'Redo figure 3'); todo(thesis, 'Cite the 2024 survey', 'Codex', 'c9');
  // No session yet: a new one.
  const cut = todo(promo, 'Cut a 30 s version');
  // A running Claude Code session gets a message; a working Codex one waits; a stopped Codex one is resumed.
  session('s3', app, 'Claude Code', 0); running('s3', 'Claude Code', 'claude', 'idle');
  todo(app, 'Fix the login bug');
  session('c1', scripts, 'Codex', 7e6);
  todo(scripts, 'Rename the build script');
  session('me', mine, 'Claude Code', 0); running('me', 'Claude Code', 'claude', 'working');
  todo(mine, 'Write the summary');
  // The line's agent is whoever last worked there: a session that sits on another line but logged here since.
  session('old', videos, 'Claude Code', 9e6);
  session('v', tools, 'Claude Code', 0);
  addCommit(d, { thread: videos, kind: 'agent', title: 'Video 21 is scheduled', agent: 'Claude Code', ts: now - 3e5, extra: { fromSession: 'v' } });
  todo(videos, 'Post the vertical cut');

  const rows = dispatch(d, { self: 'me' }, env);
  const by = Object.fromEntries(rows.map(r => [r.thread.name, r]));
  assert.deepEqual(rows.map(r => [r.thread.name, r.action, r.agent, r.session && r.session.id, r.todos.map(c => c.title)]).sort(), [
    ['App', 'message', 'claude', 's3', ['Fix the login bug']],
    ['Mine', 'self', 'claude', 'me', ['Write the summary']],
    ['Promo', 'start', 'claude', undefined, ['Cut a 30 s version']],
    ['Scripts', 'resume', 'codex', 'c1', ['Rename the build script']],
    ['Thesis', 'resume', 'claude', 's1', ['Redo figure 3', 'Cite the 2024 survey']],
    ['Videos', 'resume', 'claude', 'v', ['Post the vertical cut']],
  ]);
  assert.equal(by.Thesis.command, `cd '${tmp}' && claude --resume s1 '${by.Thesis.prompt}'`);
  assert.match(by.Thesis.prompt, new RegExp(`are yours: 1\\) Redo figure 3 \\[${fig.id}\\]; 2\\) Cite`));
  assert.match(by.Scripts.command, /&& codex resume c1 'New to-dos/);
  assert.match(by.Promo.command, new RegExp(`TRACE_CANVAS_THREAD=${promo} claude --remote-control='Promo' `));
  assert.equal(by.App.session.status, 'idle');
  assert.equal(d.commits[cut.id].assignee, 'claude');

  assert.deepEqual(dispatch(d, {}, env), []); // handed out once
  running('c1', 'Codex', 'codex', 'working');
  todo(scripts, 'Add a lint step');
  assert.deepEqual(dispatch(d, { threads: ['Scripts'] }, env).map(r => r.action), ['busy']);
  assert.deepEqual(dispatch(d, { threads: ['Thesis'], all: true }, env)[0].todos.map(c => c.title), ['Its own to-do', 'An older agent to-do']);
  assert.throws(() => dispatch(d, { threads: ['Nope'] }, env), /No line named "Nope"/);
});
