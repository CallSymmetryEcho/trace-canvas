import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTranscript, encodeProjectDir, findTranscript } from '../src/transcript.mjs';
import { captureSession, mergeThreads, unmergeThread, mergeDataset, listThreads } from '../src/ops.mjs';
import { emptyData, addCommit, createThread, settleMerged } from '../src/store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX_A = path.join(here, 'fixtures', 'session-a.jsonl');
const FIX_B = path.join(here, 'fixtures', 'session-b.jsonl');
const env = { ...process.env, TRACE_CANVAS_LANG: 'en' };
const titles = (d, tid) => Object.values(d.commits).filter(c => c.thread === tid).sort((a, b) => a.ts - b.ts).map(c => c.title);

test('a transcript becomes turns with files and git moments, skipping subagents and commands', () => {
  const s = parseTranscript(FIX_A);
  assert.equal(s.sessionId, 'sess-a');
  assert.equal(s.title, 'Methods chapter draft');
  assert.equal(s.turns.length, 2);
  assert.deepEqual(s.turns[0].files, ['/work/thesis/chapter3.md']);
  assert.deepEqual(s.turns[0].git[0].commits, [{ sha: 'abc1234', subject: 'Draft methods' }]);
  assert.match(s.turns[0].text, /drafted the methods section/);
  assert.equal(s.turns[1].prompt, 'What does reviewer 2 mean by "operationalize"?');
});

test('capturing a session gives it a line with its key moments, highlights and summary, once', () => {
  const d = emptyData();
  const r = captureSession(d, parseTranscript(FIX_A), {
    summary: 'Drafted the methods section and planned a construct table.',
    highlights: [{ kind: 'decision', title: 'Map each construct to survey items in a table' }, { kind: 'task', title: 'Build the sampling table' }],
  }, env);
  assert.equal(r.thread.name, 'Methods chapter draft');
  assert.deepEqual(titles(d, r.thread.id).slice(0, 4), [
    'Draft the methods section for chapter 3',
    'Commit abc1234: Draft methods',
    'I drafted the methods section in chapter3.md.',
    'They want each construct tied to a measurable variable.',
  ]);
  assert.equal(r.added, 7);
  const again = captureSession(d, parseTranscript(FIX_A), { name: 'Methods chapter', summary: 'Drafted the methods section and planned a construct table.', highlights: [{ kind: 'task', title: 'Build the sampling table' }] }, env);
  assert.equal(again.added, 0);
  assert.equal(Object.keys(d.commits).length, 7);
  assert.equal(d.threads[r.thread.id].name, 'Methods chapter');
});

test('a session the hooks already logged is completed on its own thread, or split out with separate', () => {
  const d = emptyData();
  const repo = createThread(d, { name: 'thesis', key: 'thesis' });
  addCommit(d, { thread: repo.id, kind: 'note', title: 'Earlier work on main', ts: 1 });
  addCommit(d, { thread: repo.id, kind: 'task', title: 'Draft the methods section for chapter 3', ts: Date.parse('2026-10-20T09:00:00Z'), extra: { session: 'sess-a' } });
  const r = captureSession(d, parseTranscript(FIX_A), {}, env);
  assert.equal(r.thread.id, repo.id);
  assert.equal(titles(d, repo.id).filter(t => t.startsWith('Draft the methods')).length, 1);

  const s = captureSession(d, parseTranscript(FIX_A), { separate: true }, env);
  assert.notEqual(s.thread.id, repo.id);
  assert.equal(s.thread.parent, repo.id);
  assert.deepEqual(titles(d, repo.id), ['Earlier work on main']);
  assert.ok(titles(d, s.thread.id).includes('Commit abc1234: Draft methods'));
});

test('merge keeps every line; combine folds sessions into one line and re-points links', () => {
  const d = emptyData();
  const a = captureSession(d, parseTranscript(FIX_A), {}, env).thread;
  const b = captureSession(d, parseTranscript(FIX_B), {}, env).thread;
  const other = createThread(d, { name: 'Literature' });
  d.edges.e1 = { id: 'e1', from: a.id, to: other.id, label: 'references' };
  d.edges.e2 = { id: 'e2', from: b.id, to: other.id, label: 'references' };

  const m = mergeThreads(structuredClone(d), { sources: [a.name, b.id], newName: 'Methods chapter', mode: 'merge' }, env);
  assert.equal(m.target.name, 'Methods chapter');
  assert.deepEqual(m.sources, [a.name, b.name]);

  const c = mergeThreads(d, { sources: [a.id, b.name], target: 'Methods chapter', mode: 'combine' }, env);
  assert.equal(d.threads[a.id], undefined);
  assert.equal(d.threads[b.id], undefined);
  const combined = titles(d, c.target.id);
  assert.equal(combined[0], 'Draft the methods section for chapter 3');
  assert.equal(combined.at(-1), 'The sampling table is in tables/sampling.md with 412 respondents.');
  assert.deepEqual(Object.values(d.edges).map(e => [e.from, e.to]), [[c.target.id, other.id]]);
  assert.match(c.target.note, /Combined from Methods chapter draft, Build the sampling table/);

  assert.throws(() => mergeThreads(d, { sources: ['Nope'], target: 'Literature' }, env), /No thread named "Nope"/);
});

test('merging a data set from another computer joins lines by key and skips what is already there', () => {
  const mine = emptyData();
  const t = createThread(mine, { name: 'thesis', key: 'thesis' });
  const shared = addCommit(mine, { thread: t.id, title: 'Shared record' });
  const theirs = { threads: [{ id: 'tX', name: 'thesis', key: 'thesis' }, { id: 'tY', name: 'Grant draft', parent: 'tX' }], commits: [{ ...shared, thread: 'tX' }, { id: 'cN', thread: 'tX', title: 'From the workstation', ts: 5, kind: 'agent' }, { id: 'cG', thread: 'tY', title: 'Budget', ts: 6, kind: 'note' }], edges: [{ id: 'eY', from: 'tY', to: 'tX', label: 'depends on' }] };
  const r = mergeDataset(mine, theirs);
  assert.deepEqual(r, { threads: 1, commits: 2, edges: 1, unified: 1 });
  assert.equal(mine.commits.cN.thread, t.id);
  assert.equal(mine.threads.tY.parent, t.id);
  assert.deepEqual([mine.edges.eY.from, mine.edges.eY.to], ['tY', t.id]);
  assert.equal(listThreads(mine).find(x => x.id === t.id).records, 2);
});

test('an archived line lists its key records: starred first, then the wrap-up and records that link a file', () => {
  const rec = (id, ts, x = {}) => ({ id, thread: 'tA', kind: 'agent', title: id, body: '', ts, parents: [], links: [], ...x });
  const d = { threads: { tA: { id: 'tA', name: 'Talk', status: 'done', archived: 5000 }, tB: { id: 'tB', name: 'Open', status: 'active' } }, edges: {}, commits: {
    turn: rec('turn', 1, { links: ['claude --resume abc'] }), turnFiles: rec('turnFiles', 8, { session: 's1', links: ['/x/changed.md'] }), git: rec('git', 2, { links: ['http://host/commit/1'] }),
    files: rec('files', 3, { links: ['/Users/x/talk/FINAL.md', '~/talk/deck.pptx'] }), star: rec('star', 4, { starred: 9 }),
    wrap: rec('wrap', 6, { kind: 'note', title: '收尾总结：Talk' }), other: { ...rec('other', 7, { links: ['/x/y.md'] }), thread: 'tB' } } };
  const rows = listThreads(d), a = rows.find(x => x.id === 'tA');
  assert.deepEqual(a.key.map(k => k.id), ['star', 'wrap', 'files']);
  assert.deepEqual(a.key[2].links, ['/Users/x/talk/FINAL.md', '~/talk/deck.pptx']);
  assert.equal(a.archived, new Date(5000).toISOString());
  assert.equal('key' in rows.find(x => x.id === 'tB'), false);
});

function rpc(child) {
  let buf = ''; const waiting = new Map();
  child.stdout.on('data', c => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\n')) !== -1) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); }
  });
  let id = 0;
  return (method, params) => new Promise(res => { id++; waiting.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
}

test('the MCP server speaks JSON-RPC over stdio and captures the current session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mcp-'));
  const project = path.join(root, 'thesis');
  const projects = path.join(root, 'projects');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(projects, encodeProjectDir(project)), { recursive: true });
  fs.copyFileSync(FIX_A, path.join(projects, encodeProjectDir(project), 'sess-a.jsonl'));
  assert.equal(findTranscript({ projectDir: project }, { CLAUDE_PROJECTS_DIR: projects }), path.join(projects, encodeProjectDir(project), 'sess-a.jsonl'));

  const child = spawn(process.execPath, [path.join(here, '..', 'bin', 'trace-canvas.mjs'), 'mcp'], {
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'sess-a', TRACE_CANVAS_HOME: path.join(root, 'home'), CLAUDE_PROJECTS_DIR: projects, CLAUDE_PROJECT_DIR: project, TRACE_CANVAS_PORT: '4999', TRACE_CANVAS_LANG: 'en' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const call = rpc(child);
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'trace-canvas');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await call('tools/list', {});
    assert.deepEqual(list.result.tools.map(t => t.name), ['trace_capture_session', 'trace_list_sessions', 'trace_list_threads', 'trace_read_thread', 'trace_merge', 'trace_log', 'trace_quest', 'trace_import_data', 'trace_fork', 'trace_detach', 'trace_tasks', 'trace_task_done', 'trace_live', 'trace_bind', 'trace_open', 'trace_precedents', 'trace_where']);

    const cap = await call('tools/call', { name: 'trace_capture_session', arguments: { summary: 'Drafted methods.', highlights: [{ kind: 'task', title: 'Build the sampling table' }] } });
    assert.equal(cap.result.isError, undefined);
    assert.equal(cap.result.structuredContent.thread.name, 'Methods chapter draft');
    assert.equal(cap.result.structuredContent.added, 6);
    assert.match(cap.result.content[0].text, /^Added 6 records to "Methods chapter draft"/);

    // A Quest: opened on a line, its steps filed into it (off the line's chain), closed with its conclusion.
    const opened = await call('tools/call', { name: 'trace_quest', arguments: { question: 'Which sampling frame fits the methods chapter?', thread: 'Methods chapter draft' } });
    const qid = opened.result.structuredContent.id;
    const step = await call('tools/call', { name: 'trace_log', arguments: { title: 'Compared three frames', kind: 'decision', quest: qid, thread: 'Somewhere else' } });
    await call('tools/call', { name: 'trace_log', arguments: { title: 'Next note on the line', thread: 'Methods chapter draft', kind: 'note' } });
    const nope = await call('tools/call', { name: 'trace_log', arguments: { title: 'x', quest: 'cnope' } });
    assert.equal(nope.result.isError, true);
    const closed = await call('tools/call', { name: 'trace_quest', arguments: { quest: qid, conclusion: 'The stratified frame.' } });
    assert.match(closed.result.content[0].text, /^Closed the Quest/);
    const dq = JSON.parse(fs.readFileSync(path.join(root, 'home', 'data.json'), 'utf8'));
    const s1 = dq.commits[step.result.structuredContent.id], q = dq.commits[qid], next = Object.values(dq.commits).find(c => c.title === 'Next note on the line');
    assert.equal(s1.quest, qid);
    assert.equal(s1.thread, q.thread); // a step lands on its Quest's line, whatever thread it names
    assert.deepEqual(s1.parents, []);
    assert.deepEqual(next.parents, [qid]); // the line's next record hangs from the Quest, not from its step
    assert.equal(q.research.conclusion, 'The stratified frame.');

    const sessions = await call('tools/call', { name: 'trace_list_sessions', arguments: {} });
    assert.equal(sessions.result.structuredContent.sessions[0].onCanvas, 'Methods chapter draft');

    await call('tools/call', { name: 'trace_log', arguments: { title: 'Ask the advisor about the sampling frame', thread: 'Advisor meeting', kind: 'task' } });
    const again = await call('tools/call', { name: 'trace_log', arguments: { title: '  ask the advisor about  the sampling frame', thread: 'Advisor meeting', kind: 'task' } });
    assert.match(again.result.content[0].text, /^Already an open to-do on "Advisor meeting"/);
    // on: dispatched at once, not only stored; a machine that cannot be reached says so, and the to-do stays.
    const away = await call('tools/call', { name: 'trace_log', arguments: { title: 'Read the slides on the laptop', thread: 'Advisor meeting', kind: 'task', on: 'tc-test.invalid' } });
    const [row] = away.result.structuredContent.dispatched;
    assert.equal(row.action, 'start');
    assert.equal(row.on, 'tc-test.invalid');
    assert.ok(row.failed, 'an unreachable machine is reported');
    assert.match(away.result.content[0].text, /^Logged to "Advisor meeting"\. Not started on tc-test\.invalid: /);
    // Without a thread, the session's own line; all: true for every line.
    const mine = await call('tools/call', { name: 'trace_tasks', arguments: {} });
    assert.deepEqual(mine.result.structuredContent.threads.map(r => r.name), ['Methods chapter draft']);
    assert.deepEqual(mine.result.structuredContent.threads[0].tasks.map(t => Object.keys(t)), [['id', 'title']]); // an open to-do: no empty fields
    const every = await call('tools/call', { name: 'trace_tasks', arguments: { all: true } });
    assert.deepEqual(every.result.structuredContent.threads.map(r => r.name), ['Methods chapter draft', 'Advisor meeting']);
    // A to-do keeps the session that logged it (and stays a to-do), so its conversation can be found again.
    const { from } = (await call('tools/call', { name: 'trace_read_thread', arguments: { thread: 'Advisor meeting' } })).result.structuredContent.records.at(-1);
    assert.equal(from.session, 'sess-a');
    assert.match(from.resume, /claude --resume sess-a$/);
    const merged = await call('tools/call', { name: 'trace_merge', arguments: { sources: ['Advisor meeting'], target: 'Methods chapter draft', mode: 'merge' } });
    assert.match(merged.result.content[0].text, /^Merged "Advisor meeting" into "Methods chapter draft"/);
    const bad = await call('tools/call', { name: 'trace_merge', arguments: { sources: ['Nope'] } });
    assert.equal(bad.result.isError, true);

    const read = await call('tools/call', { name: 'trace_read_thread', arguments: { thread: 'Methods chapter draft' } });
    assert.equal(read.result.structuredContent.records.at(-1).kind, 'merge');
    const unknown = await call('nope/method', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    child.stdin.end();
  }
});

test('trace_fork start: the new line gets its own agent through the canvas launcher, not a terminal the agent picks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fork-'));
  const bin = path.join(root, 'bin'), said = path.join(root, 'osascript.txt'), project = path.join(root, 'paper');
  fs.mkdirSync(bin); fs.mkdirSync(project);
  fs.writeFileSync(path.join(bin, 'osascript'), `#!/bin/sh\nprintf '%s' "$2" > '${said}'\n`, { mode: 0o755 }); // records the script, opens nothing
  const child = spawn(process.execPath, [path.join(here, '..', 'bin', 'trace-canvas.mjs'), 'mcp'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TRACE_CANVAS_TERMINAL: 'iterm', TRACE_CANVAS_PLATFORM: 'darwin', TRACE_CANVAS_HOME: path.join(root, 'home'), CLAUDE_PROJECT_DIR: project, CLAUDE_PROJECTS_DIR: path.join(root, 'projects'), TRACE_CANVAS_LANG: 'en' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const call = rpc(child);
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    await call('tools/call', { name: 'trace_log', arguments: { title: 'Device results', thread: 'Sensor paper', kind: 'note' } });
    const r = await call('tools/call', { name: 'trace_fork', arguments: { from: 'Sensor paper', name: 'Learn: Si contacts', start: 'claude', prompt: 'Write the reading list.' } });
    const { thread, started } = r.result.structuredContent;
    assert.equal(started.failed, undefined);
    assert.match(r.result.content[0].text, /Claude Code started on it in a new terminal tab\./);
    assert.equal(started.command, `cd '${path.resolve(project)}' && TRACE_CANVAS_THREAD=${thread.id} claude 'Write the reading list.'`);
    assert.match(fs.readFileSync(said, 'utf8'), /tell application "iTerm"[\s\S]*create tab[\s\S]*TRACE_CANVAS_THREAD=/);
  } finally {
    child.stdin.end();
  }
});

test('a link logged as a path relative to the session folder is kept as the full path; URLs, commands and missing files stay as written', async () => {
  const { fullLinks } = await import('../src/mcp.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-links-'));
  fs.mkdirSync(path.join(dir, 'notes')); fs.writeFileSync(path.join(dir, 'notes', 'reading_list.md'), '# x');
  assert.deepEqual(fullLinks(['notes/reading_list.md', 'https://x.com/a', 'claude --resume abc', 'gone.md', '/abs/x.md'], dir),
    [path.join(dir, 'notes', 'reading_list.md'), 'https://x.com/a', 'claude --resume abc', 'gone.md', '/abs/x.md']);
});

// warden 2026-11-23 (groups-merge): the four merges that went wrong on the page, as rules of mergeThreads.
test('a merge is refused when it would make a circle, or goes into the inbox or a merged line', () => {
  const d = emptyData();
  const [a, b, n, m] = ['A', 'B', 'N', 'M'].map(name => createThread(d, { name }));
  mergeThreads(d, { sources: [a.id, b.id], target: n.id }, env);
  const before = structuredClone(d);
  assert.throws(() => mergeThreads(d, { sources: [n.id], target: a.id }, env), /circle/);
  assert.throws(() => mergeThreads(d, { sources: [m.id], target: a.id }, env), /merge into that line instead/);
  assert.throws(() => mergeThreads(d, { sources: [m.id], target: 'inbox' }, env), /inbox/i);
  assert.deepEqual(d, before, 'a refused merge changes nothing');
});

test('a line already merged into the target is not merged a second time', () => {
  const d = emptyData();
  const [a, b, n] = ['A', 'B', 'N'].map(name => createThread(d, { name }));
  mergeThreads(d, { sources: [a.id], target: n.id }, env);
  const before = structuredClone(d), records = () => Object.values(d.commits).filter(c => c.mergeOf === a.id).length;
  assert.throws(() => mergeThreads(d, { sources: [a.id], target: n.id }, env), /already merged into "N"/);
  assert.deepEqual(d, before);
  const r = mergeThreads(d, { sources: [a.id, b.id], target: n.id }, env);
  assert.deepEqual([r.sources, r.already], [['B'], ['A']]);
  assert.equal(records(), 1);
});

test('lines of one group merged into a new line: the new line is in that group, and so are they', () => {
  const d = emptyData();
  const [a, b, c] = ['A', 'B', 'C'].map(name => createThread(d, { name, extra: { group: 'G1' } }));
  c.group = 'G2';
  const n = mergeThreads(d, { sources: [a.id, b.id], newName: 'N' }, env).target;
  settleMerged(d);
  assert.deepEqual([n.group, a.group, b.group], ['G1', 'G1', 'G1']);
  const mixed = mergeThreads(d, { sources: [n.id, c.id], newName: 'Mixed' }, env).target;
  assert.equal(mixed.group, undefined, 'lines of two groups: the new line is in none');
});

test('undoing a merge puts everything back: status, group, the link, the merge record, to-dos and sessions', () => {
  const d = emptyData();
  const src = createThread(d, { name: 'D', extra: { group: 'G2' } }), into = createThread(d, { name: 'E' });
  src.status = 'parked';
  addCommit(d, { thread: into.id, kind: 'note', title: 'on E' });
  const todo = addCommit(d, { thread: src.id, kind: 'task', title: 'open on D' });
  d.sessions = { s1: { id: 's1', thread: src.id } };
  settleMerged(d);
  const before = structuredClone(d);

  mergeThreads(d, { sources: [src.id], target: into.id }, env);
  settleMerged(d);
  const later = addCommit(d, { thread: into.id, kind: 'note', title: 'after the merge' });
  assert.deepEqual([src.status, src.mergedInto, src.group, todo.thread, d.sessions.s1.thread], ['merged', into.id, undefined, into.id, into.id]);

  unmergeThread(d, src.id);
  settleMerged(d);
  assert.ok(!Object.values(d.commits).some(c => c.kind === 'merge'), 'no merge record is left on the target');
  assert.ok(d.commits[later.parents[0]] && d.commits[later.parents[0]].title === 'on E', 'what was logged after it hangs on the record before it');
  delete d.commits[later.id]; delete d.sessions.s1.mergedNote;
  assert.deepEqual(d, before);

  // A line the merge itself made goes with the undo of its last source.
  const n = mergeThreads(d, { sources: [src.id, into.id], newName: 'N' }, env).target;
  settleMerged(d);
  assert.equal(todo.thread, n.id, 'the open to-do went along');
  unmergeThread(d, src.id);
  assert.ok(d.threads[n.id], 'one line is still merged into it');
  unmergeThread(d, into.id);
  settleMerged(d);
  assert.equal(d.threads[n.id], undefined);
  assert.equal(todo.thread, src.id, 'and is back on its line');
  assert.throws(() => unmergeThread(d, into.id), /not a merged line/);

  // But not when the person wrote a goal (or a note) on it: the line stays, with their words.
  for (const field of ['goal', 'note']) {
    const g = mergeThreads(d, { sources: [src.id, into.id], newName: 'G ' + field }, env).target;
    g[field] = 'Ship the map';
    unmergeThread(d, src.id); unmergeThread(d, into.id); settleMerged(d);
    assert.equal(d.threads[g.id] && d.threads[g.id][field], 'Ship the map', field + ' kept');
    delete d.threads[g.id];
  }
});

// 2026-11-24: the canvas offered `claude --resume <id>` for a session whose conversation file was gone from the Mac
// ("No conversation found"). The project's folder was there; the session's file was not.
test('a session whose conversation file is gone gets a new session in its folder, and dispatch passes it over', async () => {
  const { threadSessions, conversationGone, lineAgent, agentContext } = await import('../src/ops.mjs');
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gone-'))), cwd = path.join(top, 'proj');
  const env2 = { ...process.env, TRACE_CANVAS_HOME: path.join(top, 'tc'), TRACE_CANVAS_MACHINE: 'here', CLAUDE_PROJECTS_DIR: path.join(top, 'projects') };
  const proj = path.join(env2.CLAUDE_PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(cwd); fs.writeFileSync(path.join(proj, 'kept.jsonl'), '{}\n');
  const d = { threads: {}, commits: {}, edges: {}, sessions: {} }, t = createThread(d, { name: 'Paper' });
  for (const [id, ts] of [['kept', 1000], ['lost', 2000]]) {
    d.sessions[id] = { id, thread: t.id, agent: 'Claude Code', cwd, machine: 'here', resume: `claude --resume ${id}`, last: ts };
    addCommit(d, { thread: t.id, kind: 'agent', title: id + ' worked', ts, extra: { session: id, machine: 'here' } });
  }
  const by = Object.fromEntries(threadSessions(d, t.id, env2).map(s => [s.id, s]));
  assert.deepEqual([!!by.kept.gone, by.kept.command], [false, `cd '${cwd}' && claude --resume kept`]);
  assert.deepEqual([by.lost.gone, by.lost.command], [true, `cd '${cwd}' && TRACE_CANVAS_THREAD=${t.id} claude`]);
  assert.equal(lineAgent(d, t.id, {}, agentContext(d, env2, () => [])), 'kept', 'the latest session is gone: the one before it');
  // Not judged: another machine's session, and a project folder that is not there at all.
  assert.equal(conversationGone({ ...d.sessions.lost, machine: 'mac' }, env2), false);
  assert.equal(conversationGone({ ...d.sessions.lost, cwd: path.join(top, 'elsewhere') }, env2), false);
});

test('a failed resume from another folder does not move the session there', async () => {
  const { sessionDir } = await import('../src/hook.mjs');
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dir-'))), enc = p => p.replace(/[^a-zA-Z0-9]/g, '-');
  const proj = path.join(top, 'proj'), file = path.join(top, 'projects', enc(top), 's1.jsonl');
  assert.equal(sessionDir(top, proj, file), proj, 'the file it names is not there: it stays');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}\n');
  assert.equal(sessionDir(top, proj, file), top, 'a conversation that is there is followed');
});
