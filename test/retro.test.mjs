import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, addCommit, createThread } from '../src/store.mjs';
import { applyRetro, linePrompts, retroRecord, runRetro } from '../src/retro.mjs';
import { encodeProjectDir } from '../src/transcript.mjs';

const jl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const at = m => new Date(Date.UTC(2026, 9, 27, 10, m)).toISOString();

// A line with one Claude Code session and one Codex session, in a temp home.
function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-retro-'));
  const proj = path.join(tmp, 'proj'), claudeDir = path.join(tmp, 'claude'), codexDir = path.join(tmp, 'codex');
  fs.mkdirSync(proj);
  const cdir = path.join(claudeDir, 'projects', encodeProjectDir(proj));
  fs.mkdirSync(cdir, { recursive: true });
  const reply = (id, m, usage) => ({ type: 'assistant', timestamp: at(m), message: { id, role: 'assistant', content: [{ type: 'text', text: 'done' }], usage } });
  fs.writeFileSync(path.join(cdir, 's1.jsonl'), jl([
    { type: 'user', timestamp: at(0), sessionId: 's1', cwd: proj, message: { role: 'user', content: 'Change the commit message format' } },
    reply('m1', 1, { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 }),
    reply('m1', 1, { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 50 }), // same reply, another block: counted once
    { type: 'user', timestamp: at(3), message: { role: 'user', content: '不对，不是这个格式' } },
    reply('m2', 4, { input_tokens: 5, cache_creation_input_tokens: 200, output_tokens: 20 }),
    { type: 'user', timestamp: at(5), message: { role: 'user', content: 'Use type: subject, lower case, no period' } },
    reply('m3', 6, { input_tokens: 5, output_tokens: 10 }),
    { type: 'user', timestamp: at(9 * 60), message: { role: 'user', content: 'Still wrong, the scope goes in brackets' } }, // the next morning
  ]));
  const cx = path.join(codexDir, 'sessions', '2026', '10', '27');
  fs.mkdirSync(cx, { recursive: true });
  const user = (m, text) => ({ timestamp: at(m), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const tokens = (m, n) => ({ timestamp: at(m), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: n } } } });
  fs.writeFileSync(path.join(cx, 'rollout-2026-10-27T10-00-00-c1.jsonl'), jl([
    user(20, 'Add a dark theme'),
    user(20, '# AGENTS.md instructions\n<INSTRUCTIONS>…'), // the app's, after the person's message
    tokens(21, 3000), tokens(22, 4000),
  ]));
  const d = emptyData();
  const th = createThread(d, { name: 'Tooling' });
  d.sessions.s1 = { id: 's1', thread: th.id, agent: 'Claude Code', cwd: proj, last: 1 };
  d.sessions.c1 = { id: 'c1', thread: th.id, agent: 'Codex', cwd: proj, last: 2 };
  const todo = addCommit(d, { thread: th.id, kind: 'task', title: 'Dark theme' });
  const env = { ...process.env, CLAUDE_PROJECTS_DIR: path.join(claudeDir, 'projects'), CODEX_HOME: codexDir, CLAUDE_CONFIG_DIR: claudeDir, PATH: '/usr/bin:/bin' };
  return { d, th, todo, proj, claudeDir, env };
}

test('a line\'s messages come from its Claude Code and Codex sessions, with the tokens each one cost', () => {
  const { d, th, env } = setup();
  const ps = linePrompts(d, th.id, env);
  assert.deepEqual(ps.map(p => [p.i, p.session, p.text.slice(0, 16), p.tokens]), [
    [1, 's1', 'Change the commi', 1060],
    [2, 's1', '不对，不是这个格式', 225],
    [3, 's1', 'Use type: subjec', 15],
    [4, 'c1', 'Add a dark theme', 7000],
    [5, 's1', 'Still wrong, the', 0],
  ]);
});

test('retro ranks work by rounds per difficulty, counts time, tokens and corrections, and writes only what is applied', async () => {
  const { d, th, todo, proj, claudeDir, env } = setup();
  let asked = '';
  const ask = async prompt => {
    asked = prompt;
    return 'Here you go:\n' + JSON.stringify({ items: [
      { title: 'Dark theme', todo: todo.id, messages: [4], difficulty: 4 },
      { title: 'Commit message format', todo: null, messages: [1, 2, 3, 5, 99], difficulty: 1, stuck: 'No example of the format', clear: 'Use type: subject, lower case, no period', rule: 'Ask for an example before changing a format', layer: 'project' },
    ] });
  };
  const res = await runRetro(d, th.id, { ask, lang: 'en', env });
  assert.match(asked, /\[2\] .* s1: 不对，不是这个格式/);
  assert.match(asked, new RegExp(`\\[${todo.id}\\] Dark theme`));
  assert.deepEqual(res.items.map(r => [r.title, r.rounds, r.minutes, r.tokens, r.corrections, r.sessions, r.score]), [
    ['Commit message format', 4, 35, 1300, 2, 1, 4], // 3 + 2 + 30 (a night away counts 30 minutes)
    ['Dark theme', 1, 0, 7000, 0, 1, 0.3],
  ]);
  const c = retroRecord(d, th.id, res, 'en');
  assert.match(c.title, /2 pieces of work; the most back-and-forth was "Commit message format" \(4 rounds\)/);
  assert.equal(Object.values(d.commits).filter(x => x.thread === th.id).length, 2); // the to-do and the note: nothing else yet

  assert.throws(() => applyRetro(d, { record: c.id, n: 2 }, env), /No suggested rule 2/);
  const w = applyRetro(d, { record: c.id, n: 1 }, env);
  assert.equal(w.layer, 'project');
  for (const f of ['CLAUDE.md', 'AGENTS.md']) assert.equal(fs.readFileSync(path.join(proj, f), 'utf8'), '## Rules from retros\n\n- Ask for an example before changing a format\n');
  applyRetro(d, { record: c.id, n: 1 }, env); // the same rule twice stays once
  assert.equal(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8').split('- Ask').length, 2);
  assert.equal(d.commits[c.id].retro.items[0].applied, 'project');

  applyRetro(d, { record: c.id, n: 1, layer: 'line' }, env);
  assert.ok(Object.values(d.commits).some(x => x.kind === 'decision' && x.title === 'Ask for an example before changing a format'));
  applyRetro(d, { record: c.id, n: 1, layer: 'memory' }, env); // no theatrum on this PATH: the agents' user-wide rules
  assert.match(fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'), 'utf8'), /- Ask for an example/);
});

test('a CLAUDE.md that imports AGENTS.md gets the rule once, through AGENTS.md', async () => {
  const { d, th, proj, env } = setup();
  fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(proj, 'AGENTS.md'), '# Project\n\nBuild with make.\n');
  const res = await runRetro(d, th.id, { lang: 'en', env, ask: async () => '{"items":[{"title":"x","messages":[1,2,3,5],"difficulty":2,"rule":"Run make test first","layer":"project"}]}' });
  applyRetro(d, { record: retroRecord(d, th.id, res, 'en').id, n: 1 }, env);
  assert.equal(fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(fs.readFileSync(path.join(proj, 'AGENTS.md'), 'utf8'), '# Project\n\nBuild with make.\n\n## Rules from retros\n\n- Run make test first\n');
});

test('Trace Canvas\'s share of a session: its text is re-read by every later call, until a compaction', async () => {
  const { canvasTokens } = await import('../src/transcript.mjs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-tok-')), 's.jsonl');
  const call = (id, usage, content = []) => ({ type: 'assistant', message: { id, role: 'assistant', content, usage } });
  fs.writeFileSync(file, jl([
    { type: 'attachment', attachment: { type: 'hook_additional_context', content: ['Trace Canvas: ' + 'x'.repeat(21)] } }, // 35 chars: 10 tokens
    call('m1', { input_tokens: 100, output_tokens: 10 }),
    call('m2', { input_tokens: 120, output_tokens: 5 }, [{ type: 'tool_use', id: 't1', name: 'mcp__trace-canvas__trace_tasks', input: { x: 1 } }]), // {"x":1}: 2
    call('m2', { input_tokens: 120, output_tokens: 5 }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'abcdefghijklmn' }] } }, // 4
    call('m3', { cache_read_input_tokens: 200, output_tokens: 5 }),
    { type: 'system', subtype: 'compact_boundary' },
    call('m4', { input_tokens: 50 }),
  ]));
  assert.deepEqual(canvasTokens(file), { calls: 4, total: 490, reread: 10 + 12 + 16, notes: 1, noteTokens: 10, toolTokens: 6 });
});
