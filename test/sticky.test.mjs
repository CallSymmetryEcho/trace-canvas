import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bindSession, claimFolder, handleHook } from '../src/hook.mjs';
import { bindLiveSession, findThreadLoose, mergeThreads, readThread, threadSessions } from '../src/ops.mjs';
import { addCommit, createThread, emptyData, mutate, readData, regroup } from '../src/store.mjs';

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
  // Seen from the Mac, it resumes over ssh, in the login shell there (ssh alone has no codex on its PATH).
  const d = readData(env), tid = Object.values(d.threads)[0].id;
  const cmd = threadSessions(d, tid, { ...s.env, TRACE_CANVAS_MACHINE: 'mac' })[0].command;
  assert.match(cmd, /^ssh -t bsuperstation '/);
  // What the remote end gets, once this shell has taken the quotes off: the login shell runs the command.
  assert.equal(execFileSync('sh', ['-c', `printf %s ${cmd.slice('ssh -t bsuperstation '.length)}`], { encoding: 'utf8' }), `exec "$SHELL" -lc 'PATH="$HOME/.local/bin:$PATH"; if command -v tmux >/dev/null; then exec tmux new-session -A -s tc-cx9 '\\''codex resume cx9'\\''; else codex resume cx9; fi'`);
});

test('a session resumes from the folder it started in, not one it cd-ed into later, here and from another machine', () => {
  const s = sandbox(), env = { ...s.env, TRACE_CANVAS_MACHINE: 'mac' };
  const drafts = path.join(s.repo, 'emails', 'drafts');
  fs.mkdirSync(drafts, { recursive: true });
  // Claude Code keeps the conversation under the folder it started in, whatever the session cd-s into afterwards.
  const transcript = path.join(s.root, 'projects', s.repo.replace(/[^a-zA-Z0-9]/g, '-'), 's7.jsonl');
  const fire = (ev, cwd, extra = {}) => handleHook({ session_id: 's7', cwd, transcript_path: transcript, hook_event_name: ev, ...extra }, env);
  fire('UserPromptSubmit', drafts, { prompt: 'Draft the email' }); // first seen already inside: found by the transcript
  assert.equal(readData(env).sessions.s7.cwd, s.repo);
  fire('PostToolUse', drafts, { tool_name: 'Edit', tool_use_id: 'u1', tool_input: { file_path: path.join(drafts, 'a.md') } });
  fire('Stop', '/tmp', { last_assistant_message: 'Done' }); // cd-ed somewhere else: still its own folder
  assert.equal(readData(env).sessions.s7.cwd, s.repo);
  // An older record with the folder it cd-ed into is set right by its next event.
  mutate(d => { d.sessions.s7.cwd = drafts; }, env);
  fire('Stop', drafts, { last_assistant_message: 'Sent' });
  const d = readData(env), tid = d.sessions.s7.thread;
  assert.equal(d.sessions.s7.cwd, s.repo);
  // bsuperstation has none of the Mac's transcripts: it goes by the synced folder, resumed over ssh on the Mac.
  const cmd = threadSessions(d, tid, { ...s.env, TRACE_CANVAS_MACHINE: 'bsuperstation' }).find(x => x.id === 's7').command;
  // What the Mac's end runs, with a stand-in tmux that prints what it is given: tmux session tc-<id> (attached to when
  // it is already there, -A), running the resume from the session's folder. Without tmux there, the plain resume.
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-tmux-'));
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  // The login shell's profile is left out: on macOS path_helper puts /opt/homebrew/bin (a real tmux) before the stand-ins.
  fs.writeFileSync(path.join(bin, 'nologin'), '#!/bin/sh\nshift\nexec /bin/sh -c "$1"\n', { mode: 0o755 });
  const there = PATH => execFileSync('/bin/sh', ['-c', `eval ${cmd.slice('ssh -t mac '.length)}`], { encoding: 'utf8', env: { HOME: bin, SHELL: path.join(bin, 'nologin'), PATH } });
  assert.deepEqual(there(bin).trim().split('\n'), ['new-session', '-A', '-s', 'tc-s7', `cd '${s.repo}' && claude --resume s7`]);
  fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\necho "plain $* in $(pwd -P)"\n', { mode: 0o755 }); fs.rmSync(path.join(bin, 'tmux'));
  assert.equal(there(bin).trim(), `plain --resume s7 in ${fs.realpathSync(s.repo)}`);
  // Codex finds a session by its id anywhere: the folder first noted stays.
  handleHook({ session_id: 'c8', cwd: s.repo, transcript_path: path.join(s.root, 'rollout-c8.jsonl'), hook_event_name: 'UserPromptSubmit', prompt: 'Sort the receipts by date', _agent: 'codex' }, env);
  handleHook({ session_id: 'c8', cwd: drafts, transcript_path: path.join(s.root, 'rollout-c8.jsonl'), hook_event_name: 'Stop', last_assistant_message: 'ok', _agent: 'codex' }, env);
  assert.equal(readData(env).sessions.c8.cwd, s.repo);
});

test('a part of a line name finds the line when only one line has it', () => {
  const d = emptyData();
  const ocr = createThread(d, { name: 'tripsplit · receipt-ocr' }).id;
  createThread(d, { name: 'tripsplit · auth' });
  assert.equal(findThreadLoose(d, 'receipt-ocr'), ocr);
  assert.equal(findThreadLoose(d, 'RECEIPT'), ocr);
  assert.throws(() => findThreadLoose(d, 'tripsplit'), /matches several lines: tripsplit · receipt-ocr, tripsplit · auth/);
  assert.equal(findThreadLoose(d, 'nothing like it'), null);
  // Binding finds it too; a name nothing matches still makes a new line.
  assert.equal(bindLiveSession(d, { sessionId: 's1', thread: 'receipt' }).id, ocr);
  assert.equal(bindLiveSession(d, { sessionId: 's2', thread: 'Dark mode' }).name, 'Dark mode');
});

test('a line that claims a folder of the repository gets the sessions working in it; the rest stay on the repository line', () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.repo, 'docs', 'paper'), { recursive: true });
  const thesis = mutate(d => { const t = createThread(d, { name: 'Thesis writing' }); claimFolder(d, t, path.join(s.repo, 'docs')); return t.id; }, s.env);
  assert.deepEqual(readData(s.env).threads[thesis].folders, [{ repo: 'tripsplit', path: 'docs' }]);
  s.fire('w1', 'UserPromptSubmit', { prompt: 'Tighten the abstract', cwd: path.join(s.repo, 'docs', 'paper') }); // deeper still counts
  s.fire('c1', 'UserPromptSubmit', { prompt: 'Fix the build' });
  assert.deepEqual(s.on('Thesis writing'), ['task']);
  assert.deepEqual(s.on('tripsplit'), ['task']);
  assert.throws(() => claimFolder(readData(s.env), { id: 'x' }, s.repo), /not a folder inside a git repository/);
  mutate(d => { claimFolder(d, d.threads[thesis], path.join(s.repo, 'docs'), true); }, s.env); // given back
  assert.equal(readData(s.env).threads[thesis].folders, undefined);
});

test('a hidden session the app runs for itself (Codex suggestions) leaves nothing on the canvas', () => {
  const s = sandbox();
  const wt = path.join(s.repo, '.claude', 'worktrees', 'w1'); fs.mkdirSync(wt, { recursive: true });
  const before = JSON.stringify(readData(s.env));
  s.fire('h1', 'SessionStart', { source: 'startup', cwd: wt });
  s.fire('h1', 'UserPromptSubmit', { prompt: 'This is an app-generated request for a suggested next user message. The user did not write this message.', cwd: wt });
  s.fire('h1', 'Stop', { last_assistant_message: 'Try: run the tests', cwd: wt });
  s.fire('h1', 'SessionEnd', { reason: 'other', cwd: wt });
  assert.equal(JSON.stringify(readData(s.env)), before); // no record, no line, no session entry
  assert.equal(fs.existsSync(path.join(s.env.TRACE_CANVAS_HOME, 'live', 'h1.json')), false);
  s.fire('p1', 'UserPromptSubmit', { prompt: 'A real instruction' }); // the person's own sessions are logged as before
  assert.deepEqual(s.on('tripsplit'), ['task']);
});

test('after a merge that keeps the source line, its sessions and open to-dos go on on the line it went into', async () => {
  const { promptContext } = await import('../src/hook.mjs');
  const s = sandbox();
  s.fire('a', 'UserPromptSubmit', { prompt: 'Work in the folder' }); // unbound: on the folder line by its key
  const folder = Object.values(readData(s.env).threads).find(t => t.key === 'tripsplit').id;
  const [promo, big] = mutate(d => {
    bindSession(d, 'b', folder, s.env); bindSession(d, 'c', folder, s.env);
    addCommit(d, { thread: folder, kind: 'task', title: 'open one' });
    addCommit(d, { thread: folder, kind: 'task', title: 'finished one', extra: { done: true } });
    return [createThread(d, { name: 'promo' }).id, createThread(d, { name: 'big' }).id];
  }, s.env);
  mutate(d => mergeThreads(d, { sources: [folder], target: 'promo', mode: 'merge' }, s.env), s.env);
  mutate(d => mergeThreads(d, { sources: [promo], target: 'big', mode: 'merge' }, s.env), s.env); // a chain: folder > promo > big
  let d = readData(s.env);
  const of = title => Object.values(d.commits).find(c => c.title === title);
  assert.equal(d.sessions.b.thread, big);
  assert.equal(d.sessions.b.mergedFrom, folder);
  assert.equal(of('open one').thread, big);
  assert.equal(of('finished one').thread, folder); // history stays
  assert.match(promptContext({ session_id: 'b', prompt: 'go on', cwd: s.repo }, s.env), /was merged into "big" \(thread \w+\)[^]*you work on the line "big"/);
  assert.doesNotMatch(promptContext({ session_id: 'b', prompt: 'go on', cwd: s.repo }, s.env), /was merged into/); // told once
  const before = Object.values(d.commits).filter(c => c.thread === folder).length;
  s.edit('b'); // bound to the merged line
  s.fire('a', 'UserPromptSubmit', { prompt: 'More work in the same folder' }); // found by the merged line's key
  mutate(dd => { addCommit(dd, { thread: folder, kind: 'note', title: 'logged by id on the old line' }); }, s.env);
  d = readData(s.env);
  assert.equal(Object.values(d.commits).filter(c => c.thread === folder).length, before);
  assert.equal(of('logged by id on the old line').thread, big);
  assert.equal(d.sessions.a.thread, big);
  // Written straight onto the merged line after the merge (an older copy on another machine): it follows too.
  const late = mutate(dd => { const c = addCommit(dd, { thread: big, kind: 'note', title: 'left on the old line' }); c.thread = folder; c.ts = Date.now() + 1000; return c.id; }, s.env);
  assert.equal(readData(s.env).commits[late].thread, big);
  mutate(dd => { delete dd.commits[late]; }, s.env);
  // Undoing the merges takes them back, one step at a time; what was moved by hand since stays where it was put.
  mutate(dd => { dd.threads[promo].status = 'active'; dd.threads[promo].mergedInto = null; }, s.env);
  d = readData(s.env);
  assert.equal(d.sessions.b.thread, promo); // folder is still merged into promo
  assert.equal(of('open one').thread, promo);
  mutate(dd => { addCommit(dd, { thread: promo, kind: 'task', title: 'stays' }); bindSession(dd, 'c', big, s.env); }, s.env); // c: bound by hand to where the merge had put it
  mutate(dd => { dd.threads[folder].status = 'done'; dd.threads[folder].mergedInto = null; }, s.env);
  d = readData(s.env);
  assert.equal(d.sessions.b.thread, folder);
  assert.equal(d.sessions.b.mergedFrom, undefined);
  assert.equal(d.sessions.c.thread, big);
  assert.equal(of('open one').thread, folder);
  assert.equal(of('open one').movedFrom, undefined);
  assert.equal(of('stays').thread, promo);
  assert.match(promptContext({ session_id: 'b', prompt: 'go on', cwd: s.repo }, s.env), /merge of your line was undone[^]*you work on the line "tripsplit"/);
});

test('a line that changes group takes its forks and the lines merged into it along', () => {
  const env = { TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-group-')) };
  const ids = mutate(d => {
    const mk = (name, extra) => createThread(d, { name, extra }).id;
    const main = mk('main', { group: 'trip' }), other = mk('other', { group: 'trip' });
    const fork = mk('fork', { group: 'trip', parent: main }), nested = mk('nested', { group: 'trip', parent: fork });
    const placed = mk('placed', { group: 'elsewhere', parent: main });
    const old = mk('old', { status: 'merged', mergedInto: main }), oldFork = mk('oldFork', { group: 'trip', parent: old });
    const chained = mk('chained', { status: 'merged', mergedInto: old, group: 'stale' });
    return { main, other, fork, nested, placed, old, oldFork, chained };
  }, env);
  const groups = () => Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, readData(env).threads[id].group || '']));
  // Merged lines are in the group of the line they lead to, even before anything moves.
  assert.deepEqual(groups(), { main: 'trip', other: 'trip', fork: 'trip', nested: 'trip', placed: 'elsewhere', old: 'trip', oldFork: 'trip', chained: 'trip' });
  mutate(d => { d.threads[ids.main].group = 'work'; regroup(d, ids.main, 'trip', 'work'); }, env);
  assert.deepEqual(groups(), { main: 'work', other: 'trip', fork: 'work', nested: 'work', placed: 'elsewhere', old: 'work', oldFork: 'work', chained: 'work' });
  mutate(d => { delete d.threads[ids.main].group; regroup(d, ids.main, 'work', ''); }, env);
  assert.deepEqual(groups(), { main: '', other: 'trip', fork: '', nested: '', placed: 'elsewhere', old: '', oldFork: '', chained: '' });
  const d = readData(env);
  assert.equal(d.threads[ids.old].mergedInto, ids.main);
  assert.equal(d.threads[ids.nested].parent, ids.fork);
});
