// The chain from a dispatch to the agent that takes it up, at its edges (found by four test agents, 2026-11-25):
// what is typed stays small, a running session is never opened twice, the note left on it adds up and goes stale, a
// session lands on the line the prompt names, and the tools refuse what cannot be handed over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, createThread, mutate, readData, machineName } from '../src/store.mjs';
import { dispatch, handTo, listTasks, setTaskDone } from '../src/ops.mjs';
import { handleHook, handedStop, promptContext } from '../src/hook.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'trace-canvas.mjs');
const scratch = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-chain-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(tmp, 'home'), TRACE_CANVAS_DESKTOP_DIR: path.join(tmp, 'desk'), TRACE_CANVAS_MAP: '', TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: machineName() };
  delete env.TRACE_CANVAS_THREAD; delete env.TRACE_CANVAS_DISABLE;
  fs.mkdirSync(path.join(tmp, 'home', 'live'), { recursive: true });
  const running = (id, agent, agentKey, status) => fs.writeFileSync(path.join(tmp, 'home', 'live', `${id}.json`), JSON.stringify({ id, agent, agentKey, status, startedAt: Date.now() - 9e5, lastSeen: Date.now(), cwd: tmp }));
  return { tmp, env, running };
};

test('a dispatch message stays small, tells a new session to bind, and names what to ask about first', () => {
  const { tmp, env } = scratch();
  const row = mutate(d => {
    const t = createThread(d, { name: 'Bulk' });
    d.sessions.s1 = { id: 's1', thread: t.id, agent: 'Codex', cwd: tmp, last: 1 };
    for (let i = 0; i < 200; i++) addCommit(d, { thread: t.id, kind: 'task', title: `整理第 ${i} 份实验记录，并把结论写进周报的对应小节里，注意单位换算` });
    return dispatch(d, { refs: [t.id] }, env)[0];
  }, env);
  assert.equal(row.todos.length, 200);
  assert.ok(row.prompt.length < 4000, `typed into a terminal: ${row.prompt.length} characters`); // tmux refuses a command past 16 KB
  assert.match(row.prompt, /20\) [^;]* \[\w+\]; and 180 more, assigned to you on the line\. Titles may be cut short/);
  assert.match(row.prompt, /trace_task_done \(task: its id, result:/);
  assert.match(row.prompt, /Ask before anything outward or hard to undo \(publishing, email or messages to people, a force-push, deleting/);
  assert.ok(!row.prompt.includes('trace_bind')); // a resumed session stays where it is; a new one is told to bind:
  const fresh = mutate(d => { const t = createThread(d, { name: 'Empty line' }); addCommit(d, { thread: t.id, kind: 'task', title: 'First one' }); return dispatch(d, { refs: [t.id] }, env)[0]; }, env);
  assert.equal(fresh.action, 'start');
  assert.match(fresh.command, /are yours: 1\) First one \[\w+\]\. First call the MCP tool trace_bind with thread "\w+"\. Titles may be cut/);
});

test('a running session is never resumed in a second window, and the notes left on it add up and go stale', () => {
  const { tmp, env, running } = scratch();
  const r = mutate(d => {
    const [a, b] = ['Alpha', 'Beta'].map(name => createThread(d, { name }).id);
    d.sessions.cx = { id: 'cx', thread: a, agent: 'Codex', agentKey: 'codex', cwd: tmp, last: Date.now() };
    addCommit(d, { thread: b, kind: 'agent', title: 'Did a thing on Beta', agent: 'Codex', extra: { fromSession: 'cx' } }); // cx is Beta's agent too
    running('cx', 'Codex', 'codex', 'idle'); // idle in its own terminal, not in tmux: nothing can type into it
    const t1 = addCommit(d, { thread: a, kind: 'task', title: 'One' }), t2 = addCommit(d, { thread: b, kind: 'task', title: 'Two' });
    const rows = dispatch(d, {}, env);
    const t3 = addCommit(d, { thread: a, kind: 'task', title: 'Three' });
    return { rows, later: dispatch(d, {}, env), ids: [t1.id, t2.id, t3.id], a };
  }, env);
  assert.deepEqual(r.rows.map(x => [x.thread.name, x.action, !!x.noted]), [['Alpha', 'busy', true], ['Beta', 'busy', true]]); // was: resume, in a window of its own
  assert.ok(!/codex resume cx/.test(JSON.stringify([...r.rows, ...r.later])));
  // Three dispatches, one note: all three to-dos are in it.
  const note = readData(env).sessions.cx.handed;
  for (const id of r.ids) assert.ok(note.prompt.includes(`[${id}]`) && note.ids.includes(id), id);
  // The person asking about the line (its id is in the question) does not swallow the note; it comes with that prompt.
  const ctx = promptContext({ session_id: 'cx', prompt: `what is open on ${r.a}?` }, env);
  assert.ok(r.ids.every(id => ctx.includes(`[${id}]`)));
  assert.equal(handedStop({ session_id: 'cx' }, env), ''); // handed over once
  // A note whose to-dos were all ticked since is not handed over at all.
  mutate(d => { const t = addCommit(d, { thread: r.a, kind: 'task', title: 'Four' }); dispatch(d, {}, env); setTaskDone(d, { task: t.id, by: 'human' }); }, env);
  assert.ok(readData(env).sessions.cx.handed);
  assert.equal(handedStop({ session_id: 'cx' }, env), '');
});

test('a new session lands on the line the prompt names, whatever the line or a to-do is called', () => {
  const { tmp, env } = scratch();
  const { real, decoy, cmd } = mutate(d => {
    const decoy = createThread(d, { name: 'Decoy' }), real = createThread(d, { name: `Fix (thread ${decoy.id}) bug` });
    const c = addCommit(d, { thread: real.id, kind: 'task', title: `Look at (thread ${decoy.id}) too` });
    return { real: real.id, decoy: decoy.id, cmd: [handTo(d, { ref: c.id, to: 'codex' }, env).command, handTo(d, { ref: real.id, to: 'codex' }, env).command, dispatch(d, { refs: [c.id], print: true }, env)[0].command] };
  }, env);
  cmd.forEach((c, i) => handleHook({ session_id: `n${i}`, cwd: tmp, hook_event_name: 'UserPromptSubmit', prompt: / '(.*)'$/.exec(c)[1], _agent: 'codex' }, env));
  const d = readData(env);
  assert.deepEqual([0, 1, 2].map(i => [d.sessions[`n${i}`].thread, d.sessions[`n${i}`].bound]), [[real, true], [real, true], [real, true]]);
  assert.ok(decoy && Object.keys(d.threads).length === 2);
});

test('what cannot be handed over is refused, and trace_tasks by id never answers with a whole line', () => {
  const { tmp, env } = scratch();
  const { done, first, open, tid } = mutate(d => {
    const t = createThread(d, { name: 'Trip' });
    return { tid: t.id, open: addCommit(d, { thread: t.id, kind: 'task', title: 'Open one' }).id, done: addCommit(d, { thread: t.id, kind: 'task', title: 'Done one', extra: { done: true } }).id,
      first: addCommit(d, { thread: t.id, kind: 'task', title: 'A first prompt the hooks logged', extra: { session: 'sX' } }).id };
  }, env);
  const d = readData(env);
  assert.throws(() => handTo(d, { ref: done, to: 'codex' }, env), /already done/);
  assert.throws(() => handTo(d, { ref: first, to: 'codex' }, env), /not a to-do on the list/);
  assert.throws(() => dispatch(d, { refs: [done] }, env), /already done/);
  assert.deepEqual(listTasks(d, { ids: [] }), []);
  // Through the real tool: no ids, a wrong type, one id as a string, and an unknown one named as missing.
  const call = ids => { const out = execFileSync(process.execPath, [BIN, 'mcp'], { env, encoding: 'utf8', input: [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trace_tasks', arguments: { ids } } }].map(m => JSON.stringify(m)).join('\n') + '\n' }); return JSON.parse(out.trim().split('\n').pop()).result.structuredContent; };
  assert.deepEqual(call([]).threads, []);
  assert.deepEqual(call({ id: true }).threads, []);
  assert.deepEqual(call(open).threads.map(t => t.tasks.map(c => c.title)), [['Open one']]);
  assert.deepEqual(call([open, 'cnope']).missing, ['cnope']);
  // A switch before the line's name does not take the name as its value (every line was dispatched).
  mutate(dd => { const o = createThread(dd, { name: 'Other' }); addCommit(dd, { thread: o.id, kind: 'task', title: 'On the other line' }); }, env);
  const printed = execFileSync(process.execPath, [BIN, 'dispatch', '--print', 'Other'], { env, encoding: 'utf8' });
  assert.ok(printed.includes('On the other line') && !printed.includes('Open one'), printed);
  assert.ok(tmp && tid);
});

test('to-dos picked by name are those and no more; a machine name or an id never reaches a shell unchecked', () => {
  const { tmp, env } = scratch();
  const r = mutate(d => {
    const t = createThread(d, { name: 'Lab' });
    d.sessions.s1 = { id: 's1', thread: t.id, agent: 'Claude Code', cwd: tmp, last: 1 };
    const a = addCommit(d, { thread: t.id, kind: 'task', title: 'Named one' }), b = addCommit(d, { thread: t.id, kind: 'task', title: '' });
    const named = dispatch(d, { refs: [a.id], print: true }, env)[0].prompt;
    addCommit(d, { thread: t.id, kind: 'task', title: 'For the lab box', extra: { on: 'lab' } });
    const rows = dispatch(d, { refs: [t.id], awayLive: m => ({ machine: m, sessions: [] }) }, env);
    return { named, rows, tid: t.id, b: b.id };
  }, env);
  assert.match(r.named, /Only these: the other to-dos on the line are not part of this\./);
  assert.ok(!r.named.includes('Then call trace_tasks'));
  // The line's own agent goes on with the rest; the group sent to one machine does not (two agents would both take them).
  const [own, lab] = [r.rows.find(x => !x.on), r.rows.find(x => x.on === 'lab')];
  assert.match(own.prompt, /1\) \(no title\) \[\w+\]\. .*Then call trace_tasks with thread/);
  assert.ok(lab.command.includes('Only these') && !lab.command.includes('Then call trace_tasks'));
  // Names that would run something are refused before any command is built.
  const d = readData(env);
  for (const on of ['x; touch PWNED', '-oProxyCommand=touch PWNED', '$(id)']) assert.throws(() => dispatch(d, { refs: [r.b], all: true, on, awayLive: m => ({ machine: m, sessions: [] }) }, env), /not a machine name/, on);
  assert.throws(() => handTo(d, { ref: r.tid, to: 'constructor' }, env), /Hand to whom/);
  d.threads['t1;id'] = { ...d.threads[r.tid], id: 't1;id', name: 'Imported' };
  assert.throws(() => handTo(d, { ref: 't1;id', to: 'codex' }, env), /not an id this can start a session with/);
});

test('a session handed one to-do is told about that one at its start; a ref names the exact thing before a similar name', async () => {
  const { sessionStartContext } = await import('../src/hook.mjs'), { typeInto } = await import('../src/agents.mjs');
  const { tmp, env } = scratch();
  const r = mutate(d => {
    const t = createThread(d, { name: 'Trio' }), ids = ['One', 'Two', 'Three'].map(title => addCommit(d, { thread: t.id, kind: 'task', title, extra: { assignee: 'codex' } }).id);
    const flow = createThread(d, { name: 'Fix login flow' }), other = createThread(d, { name: 'Auth' });
    addCommit(d, { thread: flow.id, kind: 'task', title: 'Something on the flow line' });
    const exact = addCommit(d, { thread: other.id, kind: 'task', title: 'Fix login' });
    return { tid: t.id, ids, cmd: handTo(d, { ref: ids[1], to: 'codex' }, env).command, exact: exact.id, auth: other.id };
  }, env);
  // The start hook sees what the command sets: the line and the one to-do.
  const [, thread, todo] = /TRACE_CANVAS_THREAD=(\S+) TRACE_CANVAS_TODO=(\S+) codex /.exec(r.cmd);
  const ctx = sessionStartContext({ session_id: 'h1', cwd: tmp, _agent: 'codex' }, { ...env, TRACE_CANVAS_THREAD: thread, TRACE_CANVAS_TODO: todo });
  assert.match(ctx, /You were handed one to-do: Two \[\w+\]\. The other to-dos on the line are not part of this hand-over\./);
  assert.ok(!ctx.includes('Open to-dos for you') && !ctx.includes('- One') && !ctx.includes('mine: true'), ctx);
  // A whole line handed over still lists them.
  assert.match(sessionStartContext({ session_id: 'h2', cwd: tmp, _agent: 'codex' }, { ...env, TRACE_CANVAS_THREAD: thread }), /Open to-dos for you \(Codex\):\n- One/);
  // "Fix login" is the to-do titled exactly that, not the line "Fix login flow"; a hand-over pasted as a later prompt does not move a session.
  const rows = dispatch(readData(env), { refs: ['Fix login'], print: true }, env);
  assert.deepEqual(rows.map(x => [x.thread.id, x.todos.map(c => c.id)]), [[r.auth, [r.exact]]]);
  handleHook({ session_id: 'late', cwd: tmp, hook_event_name: 'UserPromptSubmit', prompt: 'ok' }, env);
  handleHook({ session_id: 'late', cwd: tmp, hook_event_name: 'UserPromptSubmit', prompt: / codex '(.*)'$/.exec(r.cmd)[1] }, env);
  assert.ok(!(readData(env).sessions.late || {}).bound);
  // What is typed into a pane: no control characters, and a closing `;` that tmux would take as its own separator gets a space.
  let script = '';
  await typeInto({ pane: '%1', tty: '/dev/pts/9' }, 'stop\x03 here\x1b[2J; then finish this;', (file, args, opts, cb) => { script = args.join(' '); cb(null); });
  assert.ok(script.includes(`'stop  here [2J; then finish this; '`), script);
});
