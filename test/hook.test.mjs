import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { handleHook, headline, redirectTargets } from '../src/hook.mjs';
import { readData } from '../src/store.mjs';

function sandbox(lang = 'en') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-test-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_LANG: lang };
  delete env.TRACE_CANVAS_DISABLE;
  const repo = path.join(root, 'thesis');
  fs.mkdirSync(repo);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.md'), 'x');
  git('add', '.'); git('commit', '-q', '-m', 'init');
  const base = { session_id: 's1', cwd: repo, transcript_path: path.join(root, 's1.jsonl') };
  const fire = (ev, extra = {}) => handleHook({ ...base, hook_event_name: ev, ...extra }, env);
  const data = () => readData(env);
  const commits = () => Object.values(data().commits).sort((a, b) => a.ts - b.ts);
  return { root, env, repo, git, fire, data, commits };
}

test('a session leaves a task, a turn record, a commit and a summary on the repo thread', () => {
  const s = sandbox();
  s.fire('UserPromptSubmit', { prompt: 'Draft the methods section for chapter 3\nUse the outline in notes.md', prompt_id: 'p1' });
  s.fire('PostToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(s.repo, 'chapter3.md') }, tool_response: {}, tool_use_id: 'u1' });
  s.fire('PostToolUse', { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'Outline', status: 'completed' }, { content: 'Draft', status: 'in_progress' }] }, tool_use_id: 'u2' });
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u3',
    tool_input: { command: 'git add -A && git commit -m "Draft methods"' },
    tool_response: { stdout: '[main 1a2b3c4] Draft methods\n 1 file changed, 40 insertions(+)\n', stderr: '' },
  });
  s.fire('Stop', { last_assistant_message: '## Done\nI drafted the **methods** section. Next: add the sampling table.', prompt_id: 'p1' });
  s.fire('Stop', { last_assistant_message: 'Sure, here is an explanation.', prompt_id: 'p2' });
  s.fire('SessionEnd', { reason: 'prompt_input_exit' });

  const d = s.data();
  const threads = Object.values(d.threads);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].name, 'thesis');
  assert.equal(threads[0].key, 'thesis');
  const cs = s.commits();
  assert.deepEqual(cs.map(c => c.kind), ['task', 'agent', 'agent', 'note']);
  assert.equal(cs[0].title, 'Draft the methods section for chapter 3');
  assert.match(cs[1].title, /^Commit 1a2b3c4: Draft methods/);
  assert.equal(cs[2].title, 'I drafted the methods section.');
  assert.match(cs[2].body, /chapter3\.md/);
  assert.match(cs[2].body, /Completed:\n- Outline/);
  assert.match(cs[3].title, /^Session ended · \d+ min · 1 prompt · 1 file · 1 commit$/);
  assert.ok(cs.every(c => c.thread === threads[0].id && c.agent === 'Claude Code'));
  assert.ok(cs[3].links.includes('claude --resume s1'));
  assert.equal(fs.existsSync(path.join(s.env.TRACE_CANVAS_HOME, 'sessions', 's1.json')), false);
});

test('a new branch forks its own thread, and merging it back marks it merged', () => {
  const s = sandbox();
  s.fire('UserPromptSubmit', { prompt: 'Start the literature review', prompt_id: 'p1' });
  s.git('checkout', '-q', '-b', 'lit-review');
  s.fire('PostToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(s.repo, 'a.md') }, tool_use_id: 'u1' });
  s.fire('Stop', { last_assistant_message: 'Collected twelve papers.', prompt_id: 'p2' });

  let d = s.data();
  const main = Object.values(d.threads).find(t => t.key === 'thesis');
  const branch = Object.values(d.threads).find(t => t.key === 'thesis@lit-review');
  assert.ok(main && branch);
  assert.equal(branch.name, 'thesis · lit-review');
  assert.equal(branch.parent, main.id);
  const fork = Object.values(d.commits).find(c => c.kind === 'fork');
  assert.equal(fork.thread, branch.id);
  assert.equal(branch.forkOf, Object.values(d.commits).find(c => c.kind === 'task').id);

  s.git('checkout', '-q', 'main');
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u9',
    tool_input: { command: 'git merge --no-ff lit-review' },
    tool_response: { stdout: "Merge made by the 'ort' strategy.\n", stderr: '' },
  });
  d = s.data();
  const merge = Object.values(d.commits).find(c => c.kind === 'merge');
  assert.equal(merge.thread, main.id);
  assert.equal(merge.mergeOf, branch.id);
  assert.equal(d.threads[branch.id].status, 'merged');
  assert.equal(d.threads[branch.id].mergedInto, main.id);
});

test('pushes and pull requests are logged with their links', () => {
  const s = sandbox();
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'git push -u origin main' },
    tool_response: { stdout: '', stderr: 'To github.com:me/thesis.git\n * [new branch]      main -> main\n' },
  });
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u2', tool_input: { command: 'gh pr create --fill' },
    tool_response: { stdout: 'https://github.com/me/thesis/pull/7\n', stderr: '' },
  });
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u3', tool_input: { command: 'git push' },
    tool_response: { stdout: '', stderr: 'Everything up-to-date\n' },
  });
  const cs = s.commits();
  assert.deepEqual(cs.map(c => c.title), ['Pushed main', 'Opened pull request #7']);
  assert.deepEqual(cs[1].links, ['https://github.com/me/thesis/pull/7']);
});

test('quiet turns, repeated events and disabled runs write nothing', () => {
  const s = sandbox();
  s.fire('Stop', { last_assistant_message: 'Just answering a question.', prompt_id: 'p1' });
  assert.equal(fs.existsSync(path.join(s.env.TRACE_CANVAS_HOME, 'data.json')), false);

  const commit = { tool_name: 'Bash', tool_use_id: 'same', tool_input: { command: 'git commit -m x' }, tool_response: { stdout: '[main abcdef1] x\n' } };
  s.fire('PostToolUse', commit);
  s.fire('PostToolUse', commit);
  assert.equal(s.commits().length, 1);

  const r = handleHook({ hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: s.repo, prompt: 'hello there' }, { ...s.env, TRACE_CANVAS_DISABLE: '1' });
  assert.deepEqual(r, { skipped: 'disabled' });
  assert.equal(s.commits().length, 1);
});

test('only the first prompt is logged by default, and slash commands and task notifications never are', () => {
  const s = sandbox();
  s.fire('UserPromptSubmit', { prompt: '/clear', prompt_id: 'p0' });
  s.fire('UserPromptSubmit', { prompt: '<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n</task-notification>', prompt_id: 'pn' });
  s.fire('UserPromptSubmit', { prompt: '<cross-session-message from="local_ab12" name="Fix the mirror">\nPlease check the release.\n</cross-session-message>', prompt_id: 'px' });
  s.fire('UserPromptSubmit', { prompt: '<side-sessions-event>None of the sessions you started is working now.</side-sessions-event>', prompt_id: 'py' });
  s.fire('UserPromptSubmit', { prompt: 'Compare the two survey datasets', prompt_id: 'p1' });
  s.fire('UserPromptSubmit', { prompt: 'yes, go ahead', prompt_id: 'p2' });
  assert.deepEqual(s.commits().map(c => c.title), ['Compare the two survey datasets']);
});

test('records follow the configured language', () => {
  const s = sandbox('zh');
  s.fire('PostToolUse', { tool_name: 'Bash', tool_use_id: 'u1', tool_input: { command: 'git commit -m 初稿' }, tool_response: { stdout: '[main 1234567] 初稿\n' } });
  assert.equal(s.commits()[0].title, '提交 1234567：初稿');
});

test('files written from Bash count as changes, and structured commit data is used when stdout is cut', () => {
  const s = sandbox();
  s.fire('UserPromptSubmit', { prompt: 'Write the timeline and commit it', prompt_id: 'p1' });
  // Shaped like a real Claude Code 2.1.309 payload: the commit line was piped through `tail -0`.
  s.fire('PostToolUse', {
    tool_name: 'Bash', tool_use_id: 'u1',
    tool_input: { command: "printf 'Phase 1\\n' > timeline.md && git add timeline.md && git commit -m 'Add timeline\n\nCo-Authored-By: x' 2>&1 | tail -0" },
    tool_response: { stdout: '', stderr: '', interrupted: false, gitOperation: { commit: { sha: '17636a1', kind: 'committed', branch: 'main' } } },
  });
  s.fire('Stop', { last_assistant_message: 'I wrote timeline.md and committed it.', prompt_id: 'p1' });
  s.fire('SessionEnd', { reason: 'other' });
  assert.deepEqual(s.commits().map(c => c.title), [
    'Write the timeline and commit it',
    'Commit 17636a1: Add timeline',
    'I wrote timeline.md and committed it.',
    'Session ended · 1 min · 1 prompt · 1 file · 1 commit',
  ]);
  assert.deepEqual(s.commits()[2].files, ['timeline.md']);
});

test('redirectTargets ignores stream merges, /dev/null and arrows inside arguments', () => {
  assert.deepEqual(redirectTargets('echo hi > notes/a.md 2>&1'), ['notes/a.md']);
  assert.deepEqual(redirectTargets('cat <<EOF >> log.txt\nx\nEOF'), ['log.txt']);
  assert.deepEqual(redirectTargets('npm test > /dev/null 2>&1; git log --format="%h -> %s"'), []);
  assert.deepEqual(redirectTargets("git commit -m 'Add timeline\n\nCo-Authored-By: A <a@b.com>\nClaude-Session: https://x'"), []);
  assert.deepEqual(redirectTargets('git commit -m "$(cat <<\'EOF\'\nFix <parser>\nEOF\n)"'), []);
  assert.deepEqual(redirectTargets('cat <<EOF > out.md\nhello > not-a-file\nEOF'), ['out.md']);
});

test('headline keeps the first real sentence and drops headings and markdown', () => {
  assert.equal(headline('# Summary\n\nI **fixed** the [parser](x). Then I ran tests.'), 'I fixed the parser.');
  assert.equal(headline('## Changes\n- Added the `--port` flag to serve'), 'Added the --port flag to serve');
  assert.equal(headline('I created `notes.txt` in the project directory. It holds one word.'), 'I created notes.txt in the project directory.');
  assert.equal(headline('```js\ncode\n```\nAll 12 tests pass. Nothing else changed.'), 'All 12 tests pass.');
  assert.equal(headline('已完成方法部分的初稿。下一步补表格。'), '已完成方法部分的初稿。');
});
