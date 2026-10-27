import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleHook, sessionThread } from '../src/hook.mjs';
import { activityOf, listLive, readLive, updateLive, STALE_MS } from '../src/live.mjs';
import { bindLiveSession, liveSessions } from '../src/ops.mjs';
import { mutate, readData } from '../src/store.mjs';

function sandbox(sid = 's1') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_DESKTOP_DIR: path.join(root, 'desktop') };
  delete env.TRACE_CANVAS_DISABLE;
  const repo = path.join(root, 'thesis');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.md'), 'x');
  git('add', '.'); git('commit', '-q', '-m', 'init');
  const fire = (ev, extra = {}) => handleHook({ session_id: sid, cwd: repo, transcript_path: path.join(root, `${sid}.jsonl`), hook_event_name: ev, ...extra }, env);
  return { root, env, repo, fire, live: () => readLive(sid, env) };
}

test('a session is idle, working, waiting for you, idle again, then gone', () => {
  const s = sandbox();
  s.fire('SessionStart', { source: 'startup', session_title: 'Methods chapter', model: 'claude-opus-5-5' });
  assert.equal(s.live().status, 'idle');
  assert.equal(s.live().title, 'Methods chapter');
  assert.equal(s.live().repo, 'thesis');
  assert.equal(s.live().key, 'thesis');

  s.fire('UserPromptSubmit', { prompt: 'Draft the methods section\nuse notes.md', prompt_id: 'p1' });
  assert.deepEqual([s.live().status, s.live().activity, s.live().prompt], ['working', 'Draft the methods section', 'Draft the methods section']);

  s.fire('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'chapter3.md') }, tool_use_id: 'u1' });
  assert.equal(s.live().activity, 'Edit chapter3.md');
  s.fire('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.deepEqual([s.live().status, s.live().activity], ['waiting', 'Claude needs your permission to use Bash']);
  s.fire('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.equal(s.live().status, 'waiting');
  s.fire('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'chapter3.md') }, tool_response: {}, tool_use_id: 'u1' });
  assert.equal(s.live().status, 'working');
  s.fire('PreToolUse', { tool_name: 'AskUserQuestion', tool_input: {}, tool_use_id: 'u2' });
  assert.equal(s.live().status, 'waiting');

  s.fire('Stop', { last_assistant_message: '## Done\nI drafted the methods section.', prompt_id: 'p1' });
  assert.deepEqual([s.live().status, s.live().activity], ['idle', 'I drafted the methods section.']);
  s.fire('SessionEnd', { reason: 'prompt_input_exit' });
  assert.equal(s.live(), null);
});

test('MCP tools show their short name in the activity line', () => {
  assert.equal(activityOf('mcp__Claude_Browser__javascript_tool', { action: 'javascript_exec' }), 'javascript_tool');
  assert.equal(activityOf('mcp__trace-canvas__trace_log', { title: 'Done' }), 'trace_log');
  assert.equal(activityOf('mcp__Claude_Browser__navigate', { url: 'http://localhost:4777/' }), 'navigate: http://localhost:4777/');
  assert.equal(activityOf('Read', { file_path: '/x/notes.md' }), 'Read notes.md');
});

test('an event that finishes late never replaces a newer status, and stale sessions drop out', () => {
  const s = sandbox();
  updateLive({ session_id: 's1', hook_event_name: 'Stop', last_assistant_message: 'Done.' }, { env: s.env, now: 2000 });
  updateLive({ session_id: 's1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } }, { env: s.env, now: 1000 });
  assert.equal(s.live().status, 'idle');
  updateLive({ session_id: 's2', hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Allow?' }, { env: s.env, now: 3000 });
  assert.deepEqual(listLive(s.env, 3000).map(x => x.id), ['s2', 's1']);
  assert.deepEqual(listLive(s.env, 2500 + STALE_MS).map(x => x.id), ['s2']);
});

test('a session bound by hand logs to that thread, and unbinding returns it to its repository line', () => {
  const s = sandbox();
  s.fire('SessionStart', { source: 'startup' });
  const t = mutate(d => bindLiveSession(d, { sessionId: 's1', thread: 'Survey analysis' }, s.env), s.env);
  s.fire('UserPromptSubmit', { prompt: 'Fit the regression', prompt_id: 'p1' });
  let d = readData(s.env);
  assert.equal(Object.values(d.commits).find(c => c.title === 'Fit the regression').thread, t.id);
  assert.equal(Object.values(d.commits).find(c => c.title === 'Fit the regression').actor, 'human'); // a prompt you typed
  assert.deepEqual(sessionThread(d, s.live(), s.env), { threadId: t.id, bound: true });

  mutate(d => bindLiveSession(d, { sessionId: 's1', thread: null }, s.env), s.env);
  s.fire('PostToolUse', { tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'git commit -m "Regression"' }, tool_response: { stdout: '[main 1a2b3c4] Regression\n', stderr: '' } });
  d = readData(s.env);
  const repoLine = Object.values(d.threads).find(x => x.key === 'thesis');
  assert.equal(Object.values(d.commits).find(c => c.title.startsWith('Commit 1a2b3c4')).thread, repoLine.id);
  assert.deepEqual(sessionThread(d, s.live(), s.env), { threadId: repoLine.id, bound: false });
});

test('parallel subagents each keep their own status, and the session end clears them', () => {
  const s = sandbox();
  const meta = path.join(s.root, 's1', 'subagents');
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the callers of rel()', spawnDepth: 1 }));
  s.fire('SessionStart', { source: 'startup' });
  s.fire('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' });
  s.fire('SubagentStart', { agent_id: 'a2', agent_type: 'general-purpose' });
  s.fire('SubagentStop', { agent_id: 'a1', agent_type: 'Explore', last_assistant_message: 'rel() has 3 callers, all in hook.mjs.' });
  s.fire('SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }); // late duplicate: stays done
  const [live] = listLive(s.env);
  assert.deepEqual(live.agents.map(a => [a.id, a.type, a.status, a.description, a.last || '']), [
    ['a1', 'Explore', 'done', 'Find the callers of rel()', 'rel() has 3 callers, all in hook.mjs.'],
    ['a2', 'general-purpose', 'running', '', ''],
  ]);
  s.fire('SessionEnd', { reason: 'other' });
  assert.deepEqual(fs.readdirSync(path.join(s.env.TRACE_CANVAS_HOME, 'live')), []);
});

test('a running subagent picks up its description late, and a hand-back report becomes its last words', () => {
  const s = sandbox();
  const dir = path.join(s.root, 's1', 'subagents');
  s.fire('SessionStart', { source: 'startup' });
  s.fire('SubagentStart', { agent_id: 'b1', agent_type: 'Explore' }); // no .meta.json yet, as in Claude Code
  assert.equal(listLive(s.env)[0].agents[0].description, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'agent-b1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Count the source files' }));
  assert.equal(listLive(s.env)[0].agents[0].description, 'Count the source files');

  const lines = [
    '{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at src/ now."}]}}',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"…"}]}}',
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"SubagentHandback","input":{"message":"12 .mjs files. All in src/."}}]}}',
    '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}',
  ];
  fs.writeFileSync(path.join(dir, 'agent-b1.jsonl'), 'cut-off line from the tail\n' + lines.join('\n') + '\n');
  s.fire('SubagentStop', { agent_id: 'b1', agent_type: 'Explore', last_assistant_message: '' });
  const [a] = listLive(s.env)[0].agents;
  assert.deepEqual([a.status, a.description, a.last], ['done', 'Count the source files', '12 .mjs files.']);
});

test('the desktop app records give each session the one that started it, and keep idle ancestors in the chain', () => {
  const s = sandbox();
  const dir = path.join(s.env.TRACE_CANVAS_DESKTOP_DIR, 'org', 'acct');
  fs.mkdirSync(dir, { recursive: true });
  const rec = (local, cli, title, parent) => fs.writeFileSync(path.join(dir, `local_${local}.json`), JSON.stringify({ sessionId: `local_${local}`, cliSessionId: cli, title, ...(parent ? { spawnedFrom: { sessionId: `local_${parent}` } } : {}) }));
  rec('A', 'cli-a', 'Plan the release', null);
  rec('B', 'cli-b', 'Fix the mirror', 'A');
  rec('C', 'cli-c', 'Render the videos', 'B');
  for (const [cli, ev] of [['cli-b', 'Stop'], ['cli-c', 'PreToolUse']]) updateLive({ session_id: cli, hook_event_name: ev, tool_name: 'Bash', tool_input: { command: 'npx remotion render' } }, { env: s.env });
  const { sessions, others } = liveSessions(readData(s.env), s.env);
  const by = Object.fromEntries(sessions.map(x => [x.id, x]));
  assert.deepEqual([by['cli-c'].parent, by['cli-c'].title, by['cli-b'].parent], ['cli-b', 'Render the videos', 'cli-a']);
  assert.deepEqual(others.map(o => [o.id, o.title, o.status]), [['cli-a', 'Plan the release', 'off']]);
  // The page opens a session's chat in the desktop app with claude://claude.ai/epitaxy/<desktopId>.
  assert.deepEqual([by['cli-c'].desktopId, others[0].desktopId], ['local_C', 'local_A']);
});

test('server lists running sessions with their thread and binds only with its header', async () => {
  process.env.TRACE_CANVAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-srv-'));
  process.env.TRACE_CANVAS_DESKTOP_DIR = path.join(process.env.TRACE_CANVAS_HOME, 'no-desktop');
  updateLive({ session_id: 'abc', hook_event_name: 'PreToolUse', cwd: '/x', tool_name: 'Read', tool_input: { file_path: '/x/notes.md' } }, { env: process.env, info: { repo: 'x', branch: 'main', root: '/x' }, key: 'x' });
  const { startServer } = await import('../src/server.mjs');
  const { server, url } = await startServer({ port: 0 });
  try {
    let live = (await (await fetch(url + 'api/live')).json()).sessions;
    assert.deepEqual([live[0].id, live[0].status, live[0].activity, live[0].threadId], ['abc', 'working', 'Read notes.md', null]);
    const denied = await fetch(url + 'api/bind', { method: 'POST', body: JSON.stringify({ session: 'abc', thread: 'Notes' }) });
    assert.equal(denied.status, 403);
    const ok = await (await fetch(url + 'api/bind', { method: 'POST', headers: { 'X-Trace-Canvas': '1' }, body: JSON.stringify({ session: 'abc', thread: 'Notes' }) })).json();
    live = (await (await fetch(url + 'api/live')).json()).sessions;
    assert.deepEqual([live[0].threadId, live[0].bound], [ok.thread.id, true]);
  } finally {
    server.close();
    fs.unwatchFile(path.join(process.env.TRACE_CANVAS_HOME, 'data.json'));
  }
});
