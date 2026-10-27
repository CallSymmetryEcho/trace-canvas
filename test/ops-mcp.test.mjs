import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTranscript, encodeProjectDir, findTranscript } from '../src/transcript.mjs';
import { captureSession, mergeThreads, mergeDataset, listThreads } from '../src/ops.mjs';
import { emptyData, addCommit, createThread } from '../src/store.mjs';

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
    env: { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), CLAUDE_PROJECTS_DIR: projects, CLAUDE_PROJECT_DIR: project, TRACE_CANVAS_PORT: '4999', TRACE_CANVAS_LANG: 'en' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const call = rpc(child);
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'trace-canvas');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await call('tools/list', {});
    assert.deepEqual(list.result.tools.map(t => t.name), ['trace_capture_session', 'trace_list_sessions', 'trace_list_threads', 'trace_read_thread', 'trace_merge', 'trace_log', 'trace_import_data', 'trace_tasks', 'trace_task_done', 'trace_live', 'trace_bind', 'trace_open']);

    const cap = await call('tools/call', { name: 'trace_capture_session', arguments: { summary: 'Drafted methods.', highlights: [{ kind: 'task', title: 'Build the sampling table' }] } });
    assert.equal(cap.result.isError, undefined);
    assert.equal(cap.result.structuredContent.thread.name, 'Methods chapter draft');
    assert.equal(cap.result.structuredContent.added, 6);
    assert.match(cap.result.content[0].text, /^Added 6 records to "Methods chapter draft"/);

    const sessions = await call('tools/call', { name: 'trace_list_sessions', arguments: {} });
    assert.equal(sessions.result.structuredContent.sessions[0].onCanvas, 'Methods chapter draft');

    await call('tools/call', { name: 'trace_log', arguments: { title: 'Ask the advisor about the sampling frame', thread: 'Advisor meeting', kind: 'task' } });
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
