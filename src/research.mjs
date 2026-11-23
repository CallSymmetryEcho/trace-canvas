// Research question cards: a record with research: { question, version, frozen, runs }.
// Saving freezes the question (its task text and a copy of each input with its SHA-256) as a version; a run starts from
// that frozen package in a workbench, once by default, and again only as an independent control from the same version
// and hash. Each run keeps its own folder, and its state is read back from what the CLI itself wrote there (events,
// exit code, last message): nothing is marked submitted, running or delivered on the canvas's say-so.
// Two workbenches run by themselves: the Codex CLI and Claude Code. Claude Science is driven by hand: the card prepares
// the package and takes the session link and export folder back. OpenScience's own agent is listed as unavailable here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agentEnv, spawnAgent } from './agents.mjs';
import { addCommit, home, uid } from './store.mjs';
import { headline } from './git-events.mjs';

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const which = bin => spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).stdout.trim();
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const MAX_INPUT = 500 << 20;

function codexModel(h = os.homedir()) {
  const t = read(path.join(h, '.codex', 'config.toml')) || '';
  const m = /^model\s*=\s*"([^"]+)"/m.exec(t), e = /^model_reasoning_effort\s*=\s*"([^"]+)"/m.exec(t);
  return m ? m[1] + (e ? ' · ' + e[1] : '') : '';
}

/** What can run here: auto ones start by themselves, manual ones get a package and a way back to the card. */
export function workbenches() {
  const codex = which('codex'), claude = which('claude'), cs = fs.existsSync('/Applications/Claude Science.app');
  return [
    { id: 'codex', auto: true, available: !!codex, reason: codex ? '' : 'nocmd', model: codexModel() },
    { id: 'claude', auto: true, available: !!claude, reason: claude ? '' : 'nocmd', model: '' },
    { id: 'claude-science', auto: false, available: cs, reason: cs ? '' : 'noapp', model: '' },
    { id: 'openscience', auto: false, available: false, reason: 'openscience', model: '' },
  ];
}

// The package's identity: its task text and each input's name and hash, in order.
const manifest = (task, inputs) => sha(JSON.stringify({ task, inputs: inputs.map(i => [i.name, i.sha256]) }));

/** Saves a new question card on a line, its question frozen as version 1. Inputs are copied, so later edits to the
 * originals do not change what a run reads. */
export function createCard(d, { question, thread, inputs = [], agent = 'human' }, env = process.env) {
  const q = String(question || '').trim();
  if (!q) throw new Error('empty');
  const files = inputs.map(p => String(p).trim()).filter(Boolean).map(p => p.replace(/^~(?=\/|$)/, os.homedir()));
  let total = 0;
  for (const f of files) {
    const st = fs.statSync(f, { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw new Error(`notfile:${f}`);
    total += st.size;
  }
  if (total > MAX_INPUT) throw new Error('big');
  const c = addCommit(d, { thread, kind: 'note', title: headline(q, 120), body: q, agent, extra: { research: { question: q, version: 0, runs: [] } } });
  freeze(c, files, env);
  return c;
}

/** Freezes the card's question and inputs as its next version, in ~/.trace-canvas/research/<card>/v<n>/package. */
export function freeze(c, files, env = process.env) {
  const R = c.research, v = R.version + 1, dir = path.join(home(env), 'research', c.id, 'v' + v), pkg = path.join(dir, 'package');
  fs.mkdirSync(path.join(pkg, 'input'), { recursive: true });
  // Two inputs with the same file name (from different folders) get distinct names: the later one is numbered.
  const used = new Set();
  const inputs = files.map((f, k) => {
    let name = path.basename(f);
    if (used.has(name)) name = `${k + 1}-${name}`;
    used.add(name);
    const to = path.join(pkg, 'input', name);
    fs.copyFileSync(f, to);
    return { name, from: f, sha256: sha(fs.readFileSync(to)), size: fs.statSync(to).size };
  });
  const task = `# 研究问题（第 ${v} 版）\n\n${R.question}\n\n## 输入\n\n${inputs.length ? inputs.map(i => `- input/${i.name}（原文件 ${i.from}）· SHA-256 ${i.sha256}`).join('\n') : '- 无附件（只凭问题检索与分析）'}\n`;
  fs.writeFileSync(path.join(pkg, 'task.md'), task);
  R.version = v;
  R.frozen = { version: v, at: Date.now(), dir, task: path.join(pkg, 'task.md'), inputs, sha256: manifest(task, inputs) };
  addLinks(c, [R.frozen.task]);
}

// The package as it is on disk now; a run only starts from a package that still matches its frozen hash.
function packageSha(F) {
  const pkg = path.join(F.dir, 'package'), task = read(path.join(pkg, 'task.md'));
  if (task === null) return null;
  try { return manifest(task, F.inputs.map(i => ({ name: i.name, sha256: sha(fs.readFileSync(path.join(pkg, 'input', i.name))) }))); } catch { return null; }
}

const PROMPT = R => `你在一个科研问题卡的独立运行目录里（当前目录）。任务书是 task.md，输入文件（如有）在 input/。只用这些材料和公开文献，独立回答研究问题，不参考别的运行。
1. 引用文献时注明 DOI、页码或图号，以及读到全文还是只读到摘要。
2. 交付按问题需要：问题里写明了要哪些交付，就照写明的做；没写明时，纯文献或方法问题交一份带出处的中文笔记即可，有数据要分析时再交数据表、图和能从输入重建结果的脚本（注明依赖版本）。交付放在 deliverables/ 下。
3. 最后的回复用中文写：一句判断、适用条件、证据在哪个文件，以及做不到的部分和原因。
不要发布、上传或发送任何东西给别人。研究问题：${R.question}`;

// Each auto workbench: the command run inside the run folder; the shell writes the exit code when it ends.
const COMMANDS = {
  codex: 'codex exec --json --skip-git-repo-check -s workspace-write -C "$PWD" -o last.md "$(cat prompt.md)"',
  claude: 'claude -p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools "WebSearch WebFetch Bash(python3:*) Bash(python:*) Bash(ls:*) Bash(mkdir:*) Bash(unzip:*) Bash(shasum:*) Bash(wc:*) Bash(cat:*) Bash(head:*) Bash(tail:*) Bash(file:*)" -- "$(cat prompt.md)"',
};
export function spawnRun(dir, cmd, env) {
  const ch = spawnAgent('sh', ['-c', `${cmd} < /dev/null > events.jsonl 2> stderr.log; echo $? > exit_code`], { cwd: dir, detached: true, stdio: 'ignore', env });
  ch.unref();
  return ch.pid;
}

/** Starts a run of the card's frozen version. mode 'single' only when the card has no run yet; 'control' is another,
 * independent run of the same version. The same key twice (a retried click) returns the run it already started. */
export function startRun(d, id, { workbench, mode = 'single', key }, env = process.env, run = spawnRun, benches = workbenches()) {
  const c = d.commits[id], R = c && c.research;
  if (!R || !R.frozen) throw new Error('nocard');
  const same = key && R.runs.find(r => r.key === key);
  if (same) return { run: same, again: true };
  if (mode === 'single' && R.runs.length) throw new Error('already');
  const wb = benches.find(b => b.id === workbench);
  if (!wb) throw new Error('nobench');
  if (!wb.available) throw new Error('unavailable:' + wb.reason);
  if (packageSha(R.frozen) !== R.frozen.sha256) throw new Error('changed');
  const rid = uid('r'), dir = path.join(R.frozen.dir, 'runs', rid);
  fs.cpSync(path.join(R.frozen.dir, 'package'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'prompt.md'), PROMPT(R));
  const r = { id: rid, key: key || rid, workbench, mode, version: R.frozen.version, packageSha: R.frozen.sha256, dir, startedAt: Date.now(), requestedModel: wb.model || '' };
  if (wb.auto) Object.assign(r, { status: 'submitted', pid: run(dir, COMMANDS[workbench], { ...agentEnv(env), TRACE_CANVAS_THREAD: c.thread }) }); // the card's line, never the caller's session
  else r.status = 'waiting';
  R.runs.push(r);
  return { run: r };
}

const alive = pid => { try { return !!pid && (process.kill(pid, 0), true); } catch (e) { return e.code === 'EPERM'; } };
// Codex names its model only in its own session file (~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl).
function codexActual(session, at, h = os.homedir()) {
  for (const day of [0, 1]) {
    const t = new Date(at + day * 864e5), dir = path.join(h, '.codex', 'sessions', String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'));
    const f = (fs.readdirSync(dir, { throwIfNoEntry: false }) || []).find(n => n.includes(session));
    if (!f) continue;
    const s = read(path.join(dir, f)) || '', m = /"model":"([^"]+)"/.exec(s), e = /"effort":"([^"]+)"/.exec(s);
    if (m) return m[1] + (e ? ' · ' + e[1] : '');
  }
  return '';
}
// What a run produced: its files, without the package and the logs.
function products(dir, n = 40) {
  const skip = new Set(['prompt.md', 'task.md', 'input', 'events.jsonl', 'stderr.log', 'exit_code']);
  return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) || [])
    .filter(e => e.isFile() && !skip.has(path.relative(dir, path.join(e.parentPath || e.path, e.name)).split(path.sep)[0]))
    .map(e => path.join(e.parentPath || e.path, e.name)).sort().slice(0, n);
}

/** Reads one auto run's state back from its folder. Returns the fields that changed. */
export function readRun(r, h = os.homedir()) {
  const f = n => path.join(r.dir, n);
  const ev = (read(f('events.jsonl')) || '').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const code = read(f('exit_code'));
  let session = '', model = '', final = null, error = false, usage = '', denied = 0;
  if (r.workbench === 'codex') {
    session = (ev.find(e => e.type === 'thread.started') || {}).thread_id || '';
    final = read(f('last.md'));
    const tok = ev.filter(e => e.type === 'turn.completed' && e.usage).reduce((n, e) => n + (e.usage.input_tokens || 0) + (e.usage.output_tokens || 0), 0);
    if (tok) usage = `${tok} tokens`;
    if (session) model = codexActual(session, r.startedAt, h);
  } else {
    const init = ev.find(e => e.type === 'system' && e.subtype === 'init') || {}, res = ev.find(e => e.type === 'result');
    session = init.session_id || ''; model = init.model || '';
    denied = ev.filter(e => e.type === 'system' && e.subtype === 'permission_denied').length;
    if (res) { final = res.result || ''; error = !!res.is_error; if (res.total_cost_usd) usage = `$${res.total_cost_usd.toFixed(2)}（按 API 价计，订阅内）`; }
    if (final !== null && !fs.existsSync(f('result.md'))) fs.writeFileSync(f('result.md'), final);
  }
  const status = code !== null ? (Number(code) === 0 && final && !error ? 'delivered' : 'failed')
    : alive(r.pid) ? (session ? 'running' : 'submitted') : 'stopped';
  const out = { status, ...(session && { session }), ...(model && { model }), ...(usage && { usage }), ...(denied && { denied }) };
  if (final !== null) out.final = String(final).slice(0, 4000);
  if (status === 'failed' || status === 'stopped') out.error = (read(f('stderr.log')) || '').trim().slice(-600);
  if (code !== null && !r.endedAt) out.endedAt = Date.now();
  if (status === 'delivered' || status === 'failed') out.products = products(r.dir);
  return out;
}

/** Brings every unfinished auto run of a card up to date. Returns true when something changed. */
export function refreshCard(d, id, h = os.homedir()) {
  const c = d.commits[id], R = c && c.research;
  if (!R || !R.runs) return false;
  let changed = false;
  for (const r of R.runs) {
    if (!['submitted', 'running', 'stopped'].includes(r.status) || r.manual) continue;
    const next = readRun(r, h);
    if (!Object.entries(next).some(([k, v]) => JSON.stringify(r[k]) !== JSON.stringify(v))) continue;
    Object.assign(r, next); changed = true;
    addLinks(c, [...(next.products || []), ...['last.md', 'result.md'].map(n => path.join(r.dir, n)).filter(p => fs.existsSync(p))]);
  }
  return changed;
}

/** A manual run comes back: the person gives the session link and the folder the workbench exported to. */
export function returnRun(d, id, rid, { session = '', folder = '' }) {
  const c = d.commits[id], r = c && c.research && c.research.runs.find(x => x.id === rid);
  if (!r) throw new Error('norun');
  const dir = String(folder).trim().replace(/^~(?=\/|$)/, os.homedir());
  const st = dir && fs.statSync(dir, { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) throw new Error('nofolder');
  Object.assign(r, { status: 'delivered', manual: true, session: String(session).trim().slice(0, 500), resultDir: dir, endedAt: Date.now(), products: products(dir) });
  addLinks(c, r.products);
  return r;
}

/** The command that reopens a run's own session in a terminal. */
export function resumeCommand(r) {
  if (!r.session || !/^[\w-]+$/.test(r.session)) return '';
  const q = s => `'${s.replace(/'/g, `'\\''`)}'`;
  return r.workbench === 'codex' ? `cd ${q(r.dir)} && codex resume ${r.session}` : r.workbench === 'claude' ? `cd ${q(r.dir)} && claude --resume ${r.session}` : '';
}

function addLinks(c, ps) { c.links = [...new Set([...(c.links || []), ...ps])].slice(0, 120); }
