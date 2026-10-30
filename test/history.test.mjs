import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, collect, historyLines, linkRepo } from '../src/history.mjs';
import { handleHook, historyDue } from '../src/hook.mjs';
import { addCommit, createThread, emptyData, readData } from '../src/store.mjs';
import { encodeProjectDir } from '../src/transcript.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function sandbox() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-history-')));
  const repo = path.join(root, 'tripsplit'), projects = path.join(root, 'projects'), codex = path.join(root, 'codex');
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: 'laptop', TRACE_CANVAS_MAP: '', CLAUDE_PROJECTS_DIR: projects, CODEX_HOME: codex, IFLOW_PROJECTS_DIR: path.join(root, 'iflow') };
  delete env.TRACE_CANVAS_DISABLE; delete env.TRACE_CANVAS_THREAD;
  fs.mkdirSync(repo);
  let t = Date.parse('2026-01-05T10:00:00Z') / 1000;
  const git = (args, author = 'me@x') => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: author === 'me@x' ? 'Me' : 'Ana', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_NAME: 'Me', GIT_COMMITTER_EMAIL: 'me@x', GIT_AUTHOR_DATE: `${t} +0000`, GIT_COMMITTER_DATE: `${t} +0000` } }).trim();
  const commit = (msg, author) => { t += 3600; fs.writeFileSync(path.join(repo, 'a.md'), msg); git(['add', '.']); git(['commit', '-q', '-m', msg], author); return git(['rev-parse', 'HEAD']); };
  git(['init', '-q', '-b', 'main']); git(['config', 'user.email', 'me@x']);
  const shas = [commit('Start'), commit('Add the receipt parser\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>'), commit('Fix totals', 'ana@y'), commit('Tidy')];
  git(['checkout', '-q', '-b', 'ocr']); const ocr = commit('Try OCR'); git(['checkout', '-q', 'main']);
  // A Claude Code transcript and a Codex rollout from this folder, and a Codex one from elsewhere.
  fs.mkdirSync(path.join(projects, encodeProjectDir(repo)), { recursive: true });
  fs.copyFileSync(path.join(here, 'fixtures', 'session-a.jsonl'), path.join(projects, encodeProjectDir(repo), 'sess-a.jsonl'));
  const rollout = (id, cwd, text, meta = {}) => {
    const dir = path.join(codex, 'sessions', '2026', '01', '06'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-2026-01-06T10-00-00-${id}.jsonl`), [
      { timestamp: '2026-01-06T10:00:00Z', type: 'session_meta', payload: { id, cwd, ...meta } },
      { timestamp: '2026-01-06T10:00:05Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } },
    ].map(j => JSON.stringify(j)).join('\n') + '\n');
    const at = new Date('2026-01-06T10:20:00Z'); fs.utimesSync(path.join(dir, `rollout-2026-01-06T10-00-00-${id}.jsonl`), at, at); // its last write: when the session ended
  };
  rollout('11111111-2222-3333-4444-555555555555', repo, 'Speed up the parser');
  rollout('66666666-7777-8888-9999-000000000000', path.join(root, 'elsewhere'), 'Not this project');
  rollout('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', repo, 'You are judging one planned action', { thread_source: 'guardian_review' }); // Codex's reviewer
  return { root, repo, env, shas, ocr };
}

test('a repository line takes in its first-parent commits and past sessions once, next to what the hooks logged', () => {
  const s = sandbox(), d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: s.repo });
  const ocrLine = createThread(d, { name: 'tripsplit · ocr', key: 'tripsplit@ocr', note: s.repo });
  createThread(d, { name: 'Notes', key: 'notes' }); // no repository: left alone
  // The hooks logged one of the commits already, by its short sha.
  addCommit(d, { thread: th.id, kind: 'agent', title: 'Commit: Fix totals', ts: Date.now(), extra: { session: 'live', gitCommit: s.shas[2].slice(0, 7) } });

  assert.deepEqual(historyLines(d, s.env).map(x => x.th.name), ['tripsplit', 'tripsplit · ocr']);
  const plan = collect(d, th, s.env);
  assert.deepEqual([plan.root, plan.branch, plan.older], [s.repo, 'main', null]);
  assert.deepEqual(plan.commits.map(c => c.subject), ['Start', 'Add the receipt parser', 'Tidy']);
  assert.deepEqual(plan.sessions.map(x => [x.agent, x.title]), [['Codex', 'Speed up the parser'], ['Claude Code', 'Methods chapter draft']]);

  const r = apply(d, th, plan, s.env);
  assert.deepEqual(r, { commits: 3, sessions: 2, older: false });
  const recs = Object.values(d.commits).filter(c => c.thread === th.id && c.imported).sort((a, b) => a.ts - b.ts);
  const commitsIn = recs.filter(c => c.imported === 'git');
  // Who: you for your own commits, the agent named in Co-authored-by.
  assert.deepEqual(commitsIn.map(c => [c.title.replace(/[0-9a-f]{7}/, 'x'), c.agent, c.actor || '']), [['Commit x: Start', '', 'human'], ['Commit x: Add the receipt parser', 'Claude Code', ''], ['Commit x: Tidy', '', 'human']]);
  assert.deepEqual(commitsIn.map(c => c.parents.length), [0, 1, 1]);
  assert.equal(commitsIn[1].parents[0], commitsIn[0].id);
  assert.equal(commitsIn[0].gitCommit, s.shas[0]);
  // A past session is one record and joins the line's sessions, resumable from the repository.
  const codexRec = recs.find(c => c.session === '11111111-2222-3333-4444-555555555555');
  assert.match(codexRec.body, /^Codex session · 2026-01-06 \d\d:\d\d–\d\d:\d\d · 1 prompt$/);
  assert.deepEqual([d.sessions[codexRec.session].thread, d.sessions[codexRec.session].resume, d.sessions[codexRec.session].cwd], [th.id, 'codex resume 11111111-2222-3333-4444-555555555555', s.repo]);
  assert.equal(d.threads[th.id].history, true);

  // Once: the same ids on every machine, nothing twice.
  assert.deepEqual(apply(d, th, collect(d, th, s.env), s.env), { commits: 0, sessions: 0, older: false });
  // A branch line takes only its own commits; the ones it shares with main are the main line's.
  assert.deepEqual(collect(d, ocrLine, s.env).commits.map(c => c.sha), [s.ocr]);
  assert.deepEqual(collect(d, ocrLine, s.env).sessions, []);
});

test('past the limit the oldest commits become one record where the line starts', () => {
  const s = sandbox(), d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: s.repo });
  const plan = collect(d, th, s.env, 2);
  assert.deepEqual(plan.commits.map(c => c.subject), ['Fix totals', 'Tidy']);
  assert.equal(plan.older.n, 2);
  apply(d, th, plan, s.env);
  const first = Object.values(d.commits).filter(c => c.thread === th.id).sort((a, b) => a.ts - b.ts)[0];
  assert.deepEqual([first.kind, first.title, first.ts], ['note', '2 earlier commits, from 2026-01-05', Date.parse('2026-01-05T11:00:00Z')]);
});

test('a new repository line asks for its history on the first prompt, then not again for a while', () => {
  const s = sandbox();
  const fire = (sid, ev, extra = {}) => handleHook({ session_id: sid, cwd: s.repo, transcript_path: path.join(s.root, `${sid}.jsonl`), hook_event_name: ev, ...extra }, s.env);
  const r = fire('s1', 'UserPromptSubmit', { prompt: 'Work on the parser' });
  const th = Object.values(readData(s.env).threads).find(t => t.key === 'tripsplit');
  assert.equal(th.history, true);
  assert.deepEqual(r, { history: th.id });
  assert.equal((fire('s1', 'UserPromptSubmit', { prompt: 'And the tests' }) || {}).history, undefined);
  assert.equal(historyDue(th.id, s.env), false);
  assert.equal(historyDue(th.id, s.env, 0), true);
});

test('a commit the hooks logged before it was rebased is not taken in again under its new sha', () => {
  const s = sandbox(), d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: s.repo });
  addCommit(d, { thread: th.id, kind: 'agent', title: 'Commit 0000000: Tidy', ts: Date.parse('2026-01-05T14:00:03Z'), extra: { session: 'live', gitCommit: '0000000' } });
  assert.deepEqual(collect(d, th, s.env).commits.map(c => c.subject), ['Start', 'Add the receipt parser', 'Fix totals']);
});

// A Claude Code transcript with two instructions, in the folder Claude Code would keep it in for cwd.
function transcript(projects, cwd, id) {
  const dir = path.join(projects, encodeProjectDir(cwd)); fs.mkdirSync(dir, { recursive: true });
  const line = (n, text) => ({ sessionId: id, cwd, type: 'user', uuid: `u${n}`, timestamp: `2026-01-07T10:0${n}:00.000Z`, promptSource: 'user', message: { role: 'user', content: text } });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), [line(1, `Work in ${path.basename(cwd)}`), line(2, 'And the tests')].map(j => JSON.stringify(j)).join('\n') + '\n');
}

test('a line made by hand is put on a repository and takes in its history; another line with that repository says so', () => {
  const s = sandbox(), d = emptyData();
  const th = createThread(d, { name: 'Receipts app', key: 'area:receipts' });
  assert.equal(collect(d, th, s.env), null);
  assert.deepEqual(linkRepo(d, th, s.repo), { root: s.repo, name: 'tripsplit' });
  assert.deepEqual([th.key, th.aliases, th.repoDir, th.history], ['tripsplit', ['area:receipts'], s.repo, true]);
  assert.deepEqual(collect(d, th, s.env).commits.map(c => c.subject), ['Start', 'Add the receipt parser', 'Fix totals', 'Tidy']);
  const other = createThread(d, { name: 'Another card' });
  assert.throws(() => linkRepo(d, other, s.repo), /"Receipts app" already stands for tripsplit/);
});

test('sessions in the repository\'s worktrees count, a sibling folder\'s do not; a folder without git brings only its own sessions', () => {
  const s = sandbox(), d = emptyData(), projects = s.env.CLAUDE_PROJECTS_DIR;
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: s.repo });
  transcript(projects, path.join(s.repo, '.claude', 'worktrees', 'ocr'), 'wt-1');
  const sibling = `${s.repo}-phone`; fs.mkdirSync(sibling); transcript(projects, sibling, 'sib-1');
  const inner = path.join(s.repo, 'vendor', 'lib'); fs.mkdirSync(inner, { recursive: true }); execFileSync('git', ['-C', inner, 'init', '-q']); transcript(projects, inner, 'in-1'); // a repository of its own
  assert.deepEqual(collect(d, th, s.env).sessions.map(x => x.id).sort(), ['11111111-2222-3333-4444-555555555555', 'sess-a', 'wt-1']);
  // A folder without git, keyed by its name as the hooks key it: its own sessions, not its subfolders'.
  const notes = path.join(s.root, 'notes'); fs.mkdirSync(path.join(notes, 'deep'), { recursive: true });
  transcript(projects, notes, 'n-1'); transcript(projects, path.join(notes, 'deep'), 'n-2');
  const folder = createThread(d, { name: 'notes', key: 'notes', note: notes });
  const plan = collect(d, folder, s.env);
  assert.deepEqual([plan.commits, plan.older, plan.sessions.map(x => x.id)], [[], null, ['n-1']]);
});

test('past iFlow CLI sessions in the repository come in too, found by the cwd inside their transcripts', () => {
  const s = sandbox(), d = emptyData();
  const th = createThread(d, { name: 'tripsplit', key: 'tripsplit', note: s.repo });
  const dir = path.join(s.env.IFLOW_PROJECTS_DIR, '-tripsplit'); fs.mkdirSync(dir, { recursive: true }); // iFlow names its folders its own way
  const line = (n, text) => ({ uuid: `u${n}`, sessionId: 'session-if9', cwd: s.repo, type: 'user', timestamp: `2026-01-08T10:0${n}:00.000Z`, message: { role: 'user', content: text } });
  fs.writeFileSync(path.join(dir, 'session-if9.jsonl'), [line(1, 'Port the parser to iFlow'), line(2, 'Add tests')].map(j => JSON.stringify(j)).join('\n') + '\n');
  const got = collect(d, th, s.env).sessions.find(x => x.id === 'session-if9');
  assert.deepEqual([got.agent, got.agentKey, got.title, got.prompts], ['iFlow CLI', 'iflow', 'Port the parser to iFlow', 2]);
  apply(d, th, collect(d, th, s.env), s.env);
  assert.equal(d.sessions['session-if9'].resume, 'iflow -r session-if9');
});
