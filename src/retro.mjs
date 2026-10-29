// Retro: how many rounds each piece of work on a line took with its agents, and what to keep from the
// ones that took many. Reads this machine's Claude Code and Codex transcripts; the grouping and the
// suggestions come from the person's own claude (or codex) command line. A suggested rule is written
// only when the person approves it: to the project's CLAUDE.md / AGENTS.md, to the line, or to long-term memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { addCommit, readConfig, threadIdOf } from './store.mjs';
import { lineDir, sessionList } from './ops.mjs';
import { findTranscript, parseTranscript } from './transcript.mjs';
import { onPath } from './install.mjs';
import { remotePrompts } from './remote.mjs';
import { tr } from './i18n.mjs';

const MAX_PROMPTS = 400;
// Text an app put in the person's place: Codex's AGENTS.md and environment blocks, skill bodies, suggestion requests.
const NOISE = /^\s*(#\s*AGENTS\.md|<|This is an app-generated request)/;
// Messages that correct the agent ("不对", "still wrong", "redo").
const CORRECTION = /不对|不是这|错了|还是(不|没|有问题|一样)|重新|再来|没改|没有改|不要这|wrong|not what|still (not|wrong|broken)|again|redo|revert/i;
export const LAYERS = ['project', 'line', 'memory'];

function codexFile(id, env) {
  const root = env.CODEX_HOME || path.join(os.homedir(), '.codex'), want = `-${id}.jsonl`;
  const walk = dir => {
    let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    for (const e of ents) {
      const p = path.join(dir, e.name);
      const hit = e.isDirectory() ? walk(p) : e.name.endsWith(want) ? p : null;
      if (hit) return hit;
    }
    return null;
  };
  return walk(path.join(root, 'sessions')) || walk(path.join(root, 'archived_sessions'));
}

export function codexPrompts(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    const p = j.payload || {};
    // Each model call reports its tokens; they count for the message before them.
    if (j.type === 'event_msg' && p.type === 'token_count') { if (out.length && p.info && p.info.last_token_usage) out[out.length - 1].tokens += p.info.last_token_usage.total_tokens || 0; continue; }
    if (j.type !== 'response_item' || p.type !== 'message' || p.role !== 'user') continue;
    const text = (p.content || []).filter(b => b && b.type === 'input_text').map(b => b.text).join('\n').replace(/^\[\$[\w-]+\]\([^)]*\)\s*/, '').trim();
    if (text && !NOISE.test(text)) out.push({ ts: Date.parse(j.timestamp), text, tokens: 0 });
  }
  return out;
}

// What the person typed in these sessions, read from this machine's transcripts (an agent not known: either kind).
export function sessionPrompts(sessions, env = process.env) {
  const out = [];
  for (const s of sessions) {
    const kind = /codex/i.test(s.agent || '') ? 'codex' : s.agent ? 'claude' : '';
    const claude = kind !== 'codex' && findTranscript({ sessionId: s.id }, env), codex = !claude && kind !== 'claude' && codexFile(s.id, env);
    const ps = claude ? parseTranscript(claude).turns.map(t => ({ ts: t.ts, text: t.prompt, tokens: t.tokens })) : codex ? codexPrompts(codex) : [];
    for (const p of ps) if (p.text && !NOISE.test(p.text)) out.push({ ...p, session: s.id });
  }
  return out;
}

// The line's conversations: its own sessions; when it has none, the sessions that logged on it from their own line.
export function retroSessions(d, tid) {
  const all = sessionList(d), own = all.filter(s => s.thread === tid);
  if (own.length) return own;
  const from = new Set(Object.values(d.commits).filter(c => c.fromSession && threadIdOf(d, c) === tid).map(c => c.fromSession));
  return all.filter(s => from.has(s.id));
}

/**
 * What the person typed in the line's conversations, oldest first, numbered. A session that ran on another machine is
 * read there (fetchAway, over ssh by default) and analysed here with the rest. unread: the machines that could not be.
 */
export function lineConversations(d, tid, env = process.env, { fetchAway = remotePrompts } = {}) {
  const me = readConfig(env).machine, sessions = retroSessions(d, tid), by = new Map(), unread = [];
  for (const s of sessions) { const m = s.machine && s.machine !== me ? s.machine : ''; by.set(m, [...(by.get(m) || []), s]); }
  const out = [];
  for (const [m, ss] of by) {
    const r = m ? fetchAway(m, ss.map(s => s.id)) : { prompts: sessionPrompts(ss, env) };
    if (r.error) unread.push({ machine: m, sessions: ss.length, error: r.error });
    else if (!r.prompts.length) unread.push({ machine: m, sessions: ss.length, error: 'their transcripts are not there any more' });
    else out.push(...r.prompts);
  }
  const prompts = out.sort((a, b) => a.ts - b.ts).slice(-MAX_PROMPTS).map((p, i) => ({ ...p, i: i + 1 }));
  return { prompts, sessions: sessions.length, unread };
}
export const linePrompts = (d, tid, env, opts) => lineConversations(d, tid, env, opts).prompts;

export function retroPrompt(prompts, todos, lang = 'en') {
  const day = ts => new Date(ts).toISOString().slice(5, 16).replace('T', ' ');
  return `You review how a person worked with AI coding agents on one line of work, to find what took more back-and-forth than it should have.

The person's messages to the agents, oldest first, as [number] date session: text:
${prompts.map(p => `[${p.i}] ${day(p.ts)} ${p.session.slice(0, 6)}: ${p.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}

The line's to-dos, as [id] title:
${todos.map(c => `[${c.id}] ${c.title.slice(0, 120)}`).join('\n') || '(none)'}

Group the messages into pieces of work; a piece that matches a to-do takes its id. Leave out messages that are only "continue", "ok" or a greeting.
For each piece give: "title" (short), "todo" (id or null), "messages" (their numbers), "difficulty" 1-5 (1 = trivial, like fixing wording; 5 = a large feature).
For each piece with 4 or more messages also give: "stuck" (what was missing or unclear, which cost the extra rounds), "clear" (the person's sentence that finally made it clear, quoted exactly), "rule" (one instruction to agents that would have made it work in one round next time), "layer": "project" when the rule is about this project, "line" when it matters only for this line's work, "memory" when it is the person's habit for every project.
Write title, stuck and rule in ${lang === 'zh' ? 'Chinese' : 'English'}. Reply with JSON only: {"items":[...]}`;
}

// Rounds, time, corrections and sessions per piece, worst first by rounds per unit of difficulty.
export function rankRetro(prompts, items) {
  const by = new Map(prompts.map(p => [p.i, p]));
  return (items || []).map(it => {
    const ps = [...new Set((it.messages || []).map(Number))].map(n => by.get(n)).filter(Boolean).sort((a, b) => a.ts - b.ts);
    // Time spent: the gaps between messages, each capped at 30 minutes, so a night away does not count.
    let ms = 0;
    for (let k = 1; k < ps.length; k++) ms += Math.min(ps[k].ts - ps[k - 1].ts, 30 * 60e3);
    const difficulty = Math.min(5, Math.max(1, Math.round(Number(it.difficulty) || 3)));
    const str = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 600) : '');
    return {
      title: str(it.title) || '?', todo: str(it.todo) || null, rounds: ps.length, minutes: Math.round(ms / 60e3),
      corrections: ps.filter(p => CORRECTION.test(p.text)).length, sessions: new Set(ps.map(p => p.session)).size,
      tokens: ps.reduce((n, p) => n + (p.tokens || 0), 0),
      difficulty, score: Math.round(ps.length / difficulty * 10) / 10,
      stuck: str(it.stuck), clear: str(it.clear), rule: str(it.rule), layer: LAYERS.includes(it.layer) ? it.layer : 'project',
    };
  }).filter(r => r.rounds).sort((a, b) => b.score - a.score || b.rounds - a.rounds);
}

// The person's own claude command line, or codex when claude is not installed.
export function askAgent(prompt, { timeout = 600000, env = process.env } = {}) {
  if (!onPath('claude', env) && !onPath('codex', env)) return Promise.reject(new Error(`Neither claude nor codex is on the PATH of the canvas server here (${env.PATH || 'empty'})`));
  const codex = !onPath('claude', env) && onPath('codex', env);
  const outFile = codex ? path.join(os.tmpdir(), `trace-canvas-ask-${process.pid}-${Date.now()}.txt`) : null;
  const [cmd, args] = codex ? ['codex', ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', outFile]] : ['claude', ['-p', '--output-format', 'text']];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: os.tmpdir(), env: { ...env, TRACE_CANVAS_DISABLE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('timeout')); }, timeout);
    child.stdout.on('data', c => { out += c; });
    child.stderr.on('data', c => { err += c; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().slice(-500) || `${cmd} exited with ${code}`));
      if (!codex) return resolve(out);
      try { resolve(fs.readFileSync(outFile, 'utf8')); fs.rmSync(outFile, { force: true }); } catch (e) { reject(e); }
    });
    child.stdin.end(prompt);
  });
}

export async function runRetro(d, tid, { ask = askAgent, lang = readConfig().lang, env = process.env, fetchAway } = {}) {
  const { prompts, sessions, unread } = lineConversations(d, tid, env, fetchAway ? { fetchAway } : {});
  if (!sessions) throw new Error('This line has no conversations to read: no session ran on it, and none logged anything on it from another line');
  if (!prompts.length) throw new Error(`None of this line's ${sessions} session${sessions === 1 ? '' : 's'} could be read: ${unread.map(u => `${u.sessions} on ${u.machine || 'this machine'}: ${u.error}`).join('; ')}`);
  const todos = Object.values(d.commits).filter(c => c.kind === 'task' && threadIdOf(d, c) === tid);
  const reply = String(await ask(retroPrompt(prompts, todos, lang)));
  let items;
  try { items = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)).items; }
  catch { throw new Error(`The analysis did not come back as JSON: ${reply.slice(0, 200)}`); }
  return { items: rankRetro(prompts, items), prompts: prompts.length, sessions: new Set(prompts.map(p => p.session)).size, unread };
}

// The result goes on the line as a note that keeps the ranking; nothing else is written yet.
export function retroRecord(d, tid, res, lang = readConfig().lang) {
  const top = res.items[0];
  const body = res.items.map((r, k) => `${k + 1}. ${r.title} · ${tr(lang, 'retroStats', r)}${r.rule ? `\n   → ${r.rule}` : ''}`).join('\n');
  return addCommit(d, {
    thread: tid, kind: 'note', agent: 'Trace Canvas',
    title: top ? tr(lang, 'retroTitle', res.items.length, top.title, top.rounds) : tr(lang, 'retroNone'),
    body, extra: { retro: { at: Date.now(), prompts: res.prompts, sessions: res.sessions, items: res.items } },
  });
}

const RULES_HEAD = '## Rules from retros';
function appendRule(file, rule) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (cur.includes(rule)) return;
  const head = cur.includes(RULES_HEAD) ? '' : `${cur && !cur.endsWith('\n\n') ? (cur.endsWith('\n') ? '\n' : '\n\n') : ''}${RULES_HEAD}\n\n`;
  fs.appendFileSync(file, `${head}- ${rule}\n`);
}

// Writes item n of a retro note to the layer the person chose; returns where it went.
export function applyRetro(d, { record, n, layer }, env = process.env) {
  const c = d.commits[record], it = c && c.retro && c.retro.items[Number(n) - 1];
  if (!it || !it.rule) throw new Error(`No suggested rule ${n} in that retro`);
  layer = LAYERS.includes(layer) ? layer : it.layer;
  const tid = threadIdOf(d, c);
  let where;
  if (layer === 'line') {
    addCommit(d, { thread: tid, kind: 'decision', title: it.rule, body: [it.stuck, it.clear && `「${it.clear}」`].filter(Boolean).join('\n'), agent: 'Trace Canvas' });
    where = d.threads[tid] ? d.threads[tid].name : tid;
  } else if (layer === 'project') {
    // The line's folder: its path, or the folder most of its sessions ran in.
    const dirs = sessionList(d, tid).map(s => s.cwd).filter(Boolean);
    const dir = lineDir(d.threads[tid]) || dirs.sort((a, b) => dirs.filter(x => x === b).length - dirs.filter(x => x === a).length)[0];
    if (!dir || !fs.existsSync(dir)) throw new Error('This line has no project folder on this machine');
    const claude = path.join(dir, 'CLAUDE.md'), agents = path.join(dir, 'AGENTS.md');
    const imports = fs.existsSync(claude) && /^@AGENTS\.md\s*$/m.test(fs.readFileSync(claude, 'utf8'));
    const files = fs.existsSync(claude) || fs.existsSync(agents) ? [agents, claude].filter(f => fs.existsSync(f) && !(imports && f === claude)) : [claude, agents];
    for (const f of files) appendRule(f, it.rule);
    where = files.join(', ');
  } else {
    // Long-term memory: the Theatrum vault when it is installed, otherwise the agents' own user-wide rules.
    const title = it.title.slice(0, 60);
    if (onPath('theatrum', env)) {
      const r = spawnSync('theatrum', ['remember', '--type', 'lesson', '--scope', 'global', '--source', 'user_requested', '--tags', 'retro', '--title', title, it.rule], { encoding: 'utf8', timeout: 30000, env });
      if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'theatrum failed').trim().slice(-300));
      where = 'Theatrum';
    } else {
      const f = path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'CLAUDE.md');
      appendRule(f, it.rule);
      where = f;
    }
  }
  it.applied = layer;
  return { layer, where, rule: it.rule };
}
