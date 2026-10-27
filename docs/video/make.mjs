#!/usr/bin/env node
// Builds the tutorial and the promo video (English and Chinese) in three steps:
//  1. narration: tts.py reads every line with a neural voice (cached, so re-runs only read new lines);
//  2. recording: headless Chrome plays the app scenes against a throwaway data folder (your own
//     ~/.trace-canvas is never touched) and logs every cursor move, click and narration cue;
//  3. animation: Remotion (docs/video/remotion) draws title cards, terminals, cursor, captions and
//     camera from that log, and renders the MP4.
//   node docs/video/make.mjs                # both videos, both languages
//   node docs/video/make.mjs promo zh       # one video, one language
// Writes docs/video/out/trace-canvas-<tutorial|promo>.<lang>.mp4 and .srt (git-ignored).
// Voices: TC_VOICE_EN / TC_VOICE_ZH as "kokoro:<voice>" or "qwen:<speaker>"; see README.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarioData } from '../scenarios/scenarios.mjs';
import { tr } from '../../src/i18n.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');
const REMOTION = path.join(here, 'remotion');
const PUB = path.join(REMOTION, 'public');
const PY = path.join(here, '.venv', 'bin', 'python');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4791, DEBUG = 9341, W = 1280, H = 720, SCALE = 1.5;
const CHAR = 0.042; // seconds per typed character in the terminal scenes
const REPO = 'github.com/CallSymmetryEcho/trace-canvas';
const MODELS = { kokoro: 'mlx-community/Kokoro-82M-bf16', qwen: 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16' };
const VOICE = { en: process.env.TC_VOICE_EN || 'kokoro:af_heart', zh: process.env.TC_VOICE_ZH || 'qwen:Ryan' };
// Style instruction for Qwen3-TTS voices (Kokoro takes none).
const STYLE = {
  en: 'Clear, crisp and upbeat, at a brisk pace, confident and energetic, like a tech product launch.',
  zh: '吐字清晰，干净利落，语速稍快，语气自信有精神，像科技产品发布会的讲解。',
};
const pick = (v, lang) => (Array.isArray(v) ? v[lang === 'zh' ? 1 : 0] : v);

/* ---------- the script ---------- */
// page: 'app' (recorded), { card } or { terminal } (drawn by Remotion).
// Narration lines are [en, zh]; either side can be [caption, what the voice says].
const SCENES = [
  { page: { card: { big: 'Trace Canvas', small: ['A transit map of your parallel AI work', '把并行的 AI 工作画成一张地铁线路图'] } },
    text: [
      ['When you run several AI agents at once, the work scatters across sessions, branches and chat windows.', '同时开好几个 AI agent 干活时，工作会散落在不同的会话、分支和聊天窗口里。'],
      ['Trace Canvas puts all of it on one map.', 'Trace Canvas 把它们画到同一张图上。'],
    ] },
  { page: { terminal: 'zsh — ~/code' },
    text: [
      ['It needs only Node.js, with nothing else to install.', '只需要 Node.js，不用安装别的依赖。'],
      ['Clone the repository and start it with one command.', '克隆仓库，一条命令就能启动。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.cmd(`git clone https://${REPO}.git`);
      h.out("Cloning into 'trace-canvas'...");
      await h.cmd('cd trace-canvas');
      await p;
      const q = h.speak(1);
      await h.cmd('node bin/trace-canvas.mjs');
      for (const s of ['Trace Canvas is running at http://localhost:4777/', 'Data: ~/.trace-canvas/data.json', 'AI tidy-up: on (uses your local `claude` CLI)', 'Press Ctrl+C to stop.']) { h.out(s); await h.wait(250); }
      await q;
    } },
  { page: 'app',
    text: [
      ['The page runs on your own computer, and your data stays in one local file.', '页面在你自己的电脑上运行，数据保存在本机的一个文件里。'],
      ['As your agents work, their records arrive on the page.', 'agent 一边工作，记录一边出现在页面上。'],
    ],
    run: async h => {
      await h.speak(0);
      const p = h.speak(1);
      h.loadScenario();
      await h.wait(1800);
      await h.click('#zoom-fit');
      await p;
    } },
  { page: 'app',
    text: [
      ['Each thread is one piece of work, drawn as a line, like a git branch.', '每条线程是一件在推进的事，画成一条线路，相当于 git 分支。'],
      ['Each record is a station: an idea, a task, agent output, a decision or a note.', '每条记录是线路上的一个站点：想法、任务、agent 产出、决策或笔记。'],
      ['Click a station to read it. Agent records keep the command that resumes their session.', '点开站点可以看详情，agent 的记录里还留着恢复那次会话的命令。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.move('#cv-cards [data-tid="sc_main"]');
      await p;
      const q = h.speak(1);
      await h.move('#cv-cards [data-tid="sc_auth"] li[data-cid]', 0);
      await h.move('#cv-cards [data-tid="sc_auth"] li[data-cid]', 3);
      await q;
      const r = h.speak(2);
      await h.click('#cv-cards [data-tid="sc_auth"] li[data-cid="sc_a5"]');
      await r;
      await h.wait(600);
      await h.key('Escape');
    } },
  { page: 'app',
    text: [
      ['Fork a thread from any record, and merge it back when it is done.', '可以从任意记录分叉出新线程，做完再合并回来。'],
      ['Labeled links say how threads relate.', '线程之间的连线写明它们的关系。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.move('#cv-cards [data-tid="sc_fix"]');
      await h.move('#cv-cards [data-tid="sc_main"]');
      await p;
      const q = h.speak(1);
      await h.move('#cv-edges .e-label', -1);
      await q;
    } },
  { page: 'app',
    text: [['The Branches view is a git graph: every record in time order, one lane per thread.', '「分支」视图是一张 git 图：所有记录按时间排列，每条线程一条泳道。']],
    run: async h => {
      const p = h.speak(0);
      await h.click('#tab-git');
      await h.wait(900);
      await h.js(`document.getElementById('git-scroll').scrollBy({ top: 260, behavior: 'smooth' })`);
      await p;
    } },
  { page: 'app',
    text: [['The Timeline shows when each thread was active, by day, week or month.', '「时间线」视图显示每条线程在哪段时间活跃，可以按天、周、月查看。']],
    run: async h => {
      const p = h.speak(0);
      await h.click('#tab-timeline');
      await h.wait(700);
      await h.click('#tl-zoom [data-z="day"]');
      await h.wait(500);
      await h.click('#tl-zoom [data-z="month"]');
      await p;
    } },
  { page: 'app', captionAt: 'top', // the typing happens at the bottom of the page
    text: [
      ['To add something by hand, type it and press Enter.', '想手动记一笔，输入后按回车就行。'],
      ['Start with a hash and a thread name to file it on that line.', ['以 # 号加线程名开头，就会记到那条线上。', '以井号加线程名开头，就会记到那条线上。']],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#tab-canvas');
      await h.wait(400);
      await h.click('#zoom-fit');
      await h.click('#cap-text');
      await p;
      const q = h.speak(1);
      await h.type(pick(['#tripsplit Ask two friends to try the arrows on their phones', '#tripsplit 请两位朋友在手机上试试箭头视图'], h.lang));
      await h.wait(300);
      await h.key('Enter');
      await q;
      await h.wait(800);
    } },
  { page: { terminal: 'zsh — ~/code/trace-canvas' },
    text: [
      ['One command connects Claude Code: hooks, an MCP server and the trace-canvas skill.', '一条命令接入 Claude Code：hooks、MCP 服务和 trace-canvas skill。'],
      ['The hooks then log the key moments of every session by themselves: the first instruction, commits, pull requests and a summary.', '之后 hooks 会自动记下每个会话的关键节点：第一条指令、提交、PR 和会话总结。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.cmd('node bin/trace-canvas.mjs setup --user');
      for (const s of ['1. Hooks added to ~/.claude/settings.json', '2. MCP server added: user scope (claude mcp add)', '3. Skill installed at ~/.claude/skills/trace-canvas', 'Start a new Claude Code session, then type /trace-canvas to put it on the canvas.']) { h.out(s); await h.wait(350); }
      await p;
      await h.speak(1);
    } },
  { page: { terminal: 'claude — ~/code/tripsplit' },
    text: [[['Type /trace-canvas in a session, and Claude writes its highlights and a summary onto the map.', 'Type slash trace canvas in a session, and Claude writes its highlights and a summary onto the map.'],
      ['在会话里输入 /trace-canvas，Claude 会把这次会话的要点和总结写到图上。', '在会话里输入斜杠 trace canvas，Claude 会把这次会话的要点和总结写到图上。']]],
    run: async h => {
      const p = h.speak(0);
      await h.cmd('/trace-canvas', '> ');
      await h.wait(700);
      h.out('⏺ trace-canvas - trace_capture_session (MCP)', 'k');
      await h.wait(500);
      h.out('  ⎿  Added 5 records to "tripsplit · share-link". The page is open at http://localhost:4777/.');
      await h.wait(600);
      h.out(pick(['⏺ This session is on the canvas: the task, two results, the commit and a summary.', '⏺ 这次会话已放进画布：任务、两条结果、一次提交和会话总结。'], h.lang), 'p');
      await p;
    } },
  { page: 'app',
    text: [['The session appears as its own line, next to the work another agent logged at the same time.', '这个会话成为图上的一条新线路，旁边是另一个 agent 同时记下的工作。']],
    run: async h => {
      const p = h.speak(0);
      await h.wait(500);
      h.addSessions();
      await h.wait(1500);
      await h.click('#zoom-fit');
      await h.move('#cv-cards [data-tid="sc_share"]');
      await h.move('#cv-cards [data-tid="sc_cur"]');
      await p;
    } },
  { page: 'app',
    text: [
      ['Pick several threads to merge them back, like branches in git, or to combine them into one line.', '选中几条线程，可以像 git 分支一样合并回来，也可以并成一条线。'],
      ['Merged threads stay on the map, joined to the line they went into.', '合并后的线程仍留在图上，连到它们汇入的那条线。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#select-btn');
      await h.click('#cv-cards [data-tid="sc_share"]');
      await h.click('#cv-cards [data-tid="sc_cur"]');
      await h.move('#multi-target');
      await h.js(`(() => { const s = document.getElementById('multi-target'); s.value = 'sc_main'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await h.move('[data-multi="combine"]');
      await h.click('[data-multi="merge"]');
      await p;
      const q = h.speak(1);
      await h.wait(400);
      await h.key('Escape'); // the merge opens the target thread's panel
      await h.click('#zoom-fit');
      await h.move('#cv-cards [data-tid="sc_main"]');
      await q;
    } },
  { page: 'app',
    text: [['The page works in English and Chinese.', '页面支持中文和英文。']],
    run: async h => {
      const p = h.speak(0);
      await h.click('#lang-btn');
      await h.wait(1300);
      await h.click('#lang-btn');
      await p;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Free and open source · MIT · Node.js 18+', '免费开源 · MIT 许可 · Node.js 18+'], foot: `${REPO} ⭐` } },
    text: [
      ['Trace Canvas is free and open source, under the MIT license.', 'Trace Canvas 免费开源，使用 MIT 许可。'],
      ['Find it on GitHub, and give it a star if it helps your work.', '地址在屏幕上，如果对你有帮助，欢迎在 GitHub 上点个 Star。'],
    ] },
];

// The promo: Trace Canvas as the entry point for agents. `preload` puts the full map in place before the first shot.
const PROMO = [
  { page: { card: { big: 'Trace Canvas', small: ['The entry point for your agents', '你的 agent 的入口'] } },
    text: [
      ['Every new agent session starts from zero, and so do you when you come back to a project.', '每开一个新的 agent 会话，都要从头讲一遍项目；你自己隔几天回来，也一样。'],
      ['Trace Canvas gives you and your agents one shared map of all your work.', 'Trace Canvas 给你和你的 agent 一张共享的地图，装下你手上的所有工作。'],
    ] },
  { page: 'app', preload: true,
    text: [
      ['Every project, branch, decision and agent session sits on one transit map.', '每个项目、分支、决策和 agent 会话，都在同一张线路图上。'],
      ['While Claude Code works, its hooks, skill and MCP tools keep the map up to date.', 'Claude Code 工作时，hooks、skill 和 MCP 工具会自动更新这张图。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#zoom-fit');
      for (const id of ['sc_main', 'sc_auth', 'sc_share']) await h.move(`#cv-cards [data-tid="${id}"]`);
      await p;
      const q = h.speak(1);
      await h.move('#cv-cards [data-tid="sc_cur"]');
      await h.move('#cv-cards [data-tid="sc_ocr"]');
      await q;
    } },
  { page: { terminal: 'claude — ~/code/tripsplit' },
    text: [['A new agent reads the map through MCP and catches up in seconds, without rereading old chats.', '新的 agent 通过 MCP 读这张图，几秒钟就能跟上进度，不用再翻旧聊天记录。']],
    run: async h => {
      const p = h.speak(0);
      await h.cmd(pick(['Where did we leave the receipt OCR work?', '小票识别那部分做到哪了？'], h.lang), '> ');
      await h.wait(500);
      // The tool lines are what the MCP tools return for this map.
      h.out('⏺ trace-canvas - trace_list_threads (MCP)', 'k');
      h.out(`  ⎿  ${h.tools.list()}`);
      await h.wait(600);
      h.out('⏺ trace-canvas - trace_read_thread (MCP)(thread: "tripsplit · receipt-ocr")', 'k');
      h.out(`  ⎿  ${h.tools.read('tripsplit · receipt-ocr')}`);
      await h.wait(700);
      h.out(pick(['⏺ It is parked. Even after deskewing, Tesseract reads only 74% of receipt totals; the open task is to try a vision model instead. It is planned for v0.2.',
        '⏺ 这条线已暂停。先做倾斜校正后，Tesseract 也只认对 74% 的小票总额；待办是改用视觉模型试试，计划放进 v0.2。'], h.lang), 'p');
      await p;
      await h.wait(1200);
    } },
  { page: 'app',
    text: [
      ['Every answer points back to records on the map, so you can check it.', '每个回答都能对应到图上的记录，随时可以核对。'],
      ['Agents on other computers can send their records too, so nothing is lost between machines.', '其他电脑上的 agent 也能把记录导进来，换了机器也不会丢。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#cv-cards [data-tid="sc_ocr"]');
      await p;
      const q = h.speak(1);
      await h.key('Escape');
      await h.click('#tab-git');
      await h.wait(900);
      await h.js(`document.getElementById('git-scroll').scrollBy({ top: 200, behavior: 'smooth' })`);
      await q;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Open source · MIT · works with Claude Code', '开源 · MIT · 支持 Claude Code'], foot: `${REPO} ⭐` } },
    text: [['Give your agents a map. Trace Canvas is free on GitHub.', '给你的 agent 一张地图。Trace Canvas 在 GitHub 上免费开源。']] },
];
const VIDEOS = { tutorial: SCENES, promo: PROMO };

/* ---------- narration ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
const duration = file => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

function narrate(scenes, lang) {
  const [engine, voice] = VOICE[lang].split(':');
  if (!MODELS[engine]) throw new Error(`TC_VOICE_${lang.toUpperCase()} must look like kokoro:af_heart or qwen:Serena`);
  if (!fs.existsSync(PY)) throw new Error('No voice environment yet; see "Setup" in docs/video/README.md');
  const v = { model: MODELS[engine], voice, ...(engine === 'qwen' ? { instruct: STYLE[lang] } : {}) };
  const dir = path.join(PUB, 'audio', lang);
  fs.mkdirSync(dir, { recursive: true });
  const lines = scenes.map(s => s.text.map(pair => {
    const x = pick(pair, lang), spoken = Array.isArray(x) ? x[1] : x;
    const id = crypto.createHash('sha1').update(JSON.stringify([v, spoken])).digest('hex').slice(0, 12);
    return { caption: pick(x, 'en'), spoken, file: `audio/${lang}/${id}.wav`, abs: path.join(dir, `${id}.wav`) };
  }));
  const todo = lines.flat().filter(l => !fs.existsSync(l.abs));
  console.log(`[${lang}] voice ${VOICE[lang]}: ${todo.length} of ${lines.flat().length} lines to read`);
  if (todo.length) {
    execFileSync(PY, [path.join(here, 'tts.py')], { input: JSON.stringify(todo.map(l => ({ ...v, lang, text: l.spoken, out: `${l.abs}.raw.wav` }))), stdio: ['pipe', 'inherit', 'inherit'] });
    // Even loudness across lines and voices.
    for (const l of todo) {
      run('ffmpeg', ['-v', 'error', '-y', '-i', `${l.abs}.raw.wav`, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', l.abs]);
      fs.rmSync(`${l.abs}.raw.wav`);
    }
  }
  for (const l of lines.flat()) l.dur = duration(l.abs);
  return lines;
}

/* ---------- recording ---------- */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-video-'));
process.env.TRACE_CANVAS_HOME = path.join(home, 'data');
fs.mkdirSync(process.env.TRACE_CANVAS_HOME, { recursive: true });
const { startServer } = await import('../../src/server.mjs');
const { mutate, dataFile, emptyData, readData } = await import('../../src/store.mjs');
const { listThreads, readThread } = await import('../../src/ops.mjs');
const { server } = await startServer({ port: PORT });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0, cast = null; // cast: { dir, t0, frames } while an app scene records
const waiting = new Map();
const cdp = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => {
  const m = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(`page: ${m.result.exceptionDetails.exception?.description || expr}`);
  return m.result?.result?.value;
};
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method !== 'Page.screencastFrame') return;
  cdp('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  if (!cast) return;
  const file = path.join(cast.dir, `f${String(cast.frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
  cast.frames.push([file, (Date.now() - cast.t0) / 1000]);
});
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });
// Light theme whatever the Mac's appearance, to match the title cards and the screenshots.
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

// Screencast frames arrive only when the page changes; each one is held until the next.
function encodeClip(frames, dur, file) {
  const list = frames.map(([f, t], i) => `file '${f}'\nduration ${((frames[i + 1]?.[1] ?? dur) - (i ? t : 0)).toFixed(4)}`);
  fs.writeFileSync(`${file}.txt`, `${list.join('\n')}\nfile '${frames.at(-1)[0]}'\n`);
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', `${file}.txt`, '-vf', 'scale=1920:1080,fps=30,format=yuv420p', '-t', dur.toFixed(2), '-c:v', 'libx264', '-crf', '18', '-an', file]);
  fs.rmSync(`${file}.txt`);
}

async function record(video, lang) {
  const SCENES = VIDEOS[video], base = `${video}/${lang}`;
  const lines = narrate(SCENES, lang);
  fs.rmSync(path.join(PUB, base), { recursive: true, force: true });
  fs.mkdirSync(path.join(PUB, base, 'clips'), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(emptyData()));
  fs.writeFileSync(path.join(process.env.TRACE_CANVAS_HOME, 'config.json'), JSON.stringify({ lang }));
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/api/health` });
  await sleep(300);
  await js('localStorage.clear()');

  const scenes = [];
  let cur = { x: W / 2, y: H / 2 }, loaded = false;
  for (const [si, scene] of SCENES.entries()) {
    const app = scene.page === 'app';
    // App scenes run in real time; cards and terminals only advance a virtual clock.
    let t0 = Date.now(), vt = 0;
    const now = () => (app ? (Date.now() - t0) / 1000 : vt);
    const waitUntil = async T => { if (app) await sleep(Math.max(0, T - now()) * 1000); else vt = Math.max(vt, T); };
    const wait = ms => waitUntil(now() + ms / 1000);
    const sc = app ? { kind: 'app', clip: `${base}/clips/s${String(si + 1).padStart(2, '0')}.mp4`, start: { ...cur }, cursor: [] }
      : scene.page.card ? { kind: 'card', big: scene.page.card.big, small: pick(scene.page.card.small, lang), foot: scene.page.card.foot || '' }
      : { kind: 'terminal', title: scene.page.terminal, steps: [] };
    sc.lines = [];
    if (scene.captionAt) sc.captionAt = scene.captionAt;
    const center = (sel, n) => js(`(() => { const all = document.querySelectorAll(${JSON.stringify(sel)}); const e = all[${n} < 0 ? all.length + ${n} : ${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 22)) }; })()`);
    const h = {
      lang, js, wait,
      // Resolves when the line has been spoken; awaiting it later still waits from when it started.
      speak(li) {
        const l = lines[si][li], t = now();
        sc.lines.push({ t, dur: l.dur, text: l.caption, audio: l.file });
        return { then: (res, rej) => waitUntil(t + l.dur + 0.25).then(res, rej) };
      },
      async move(sel, n = 0, ms = 650) {
        const p = await center(sel, n);
        if (!p) throw new Error(`not on the page: ${sel}`);
        cur = p;
        sc.cursor.push({ t: now(), x: p.x, y: p.y, ms });
        await sleep(ms + 80);
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
        return p;
      },
      async click(sel) {
        const p = await h.move(sel);
        sc.cursor.push({ t: now(), x: p.x, y: p.y, click: true });
        for (const type of ['mousePressed', 'mouseReleased']) { await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(60); }
        await sleep(300);
      },
      async type(text) { for (const ch of text) { await cdp('Input.insertText', { text: ch }); await sleep(55); } },
      async key(k) {
        const code = { Enter: 13, Escape: 27 }[k];
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(k === 'Enter' ? { text: '\r' } : {}) });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
      },
      async cmd(s, prompt = '$ ') { sc.steps.push({ t: now(), cmd: s, prompt }); await wait(s.length * CHAR * 1000 + 150); },
      out(s, cls = '') { sc.steps.push({ t: now(), out: s, cls }); },
      loadScenario: () => fs.writeFileSync(dataFile(), JSON.stringify(scenarioData('vibe', lang))),
      addSessions: () => addSessions(lang),
      // The text the MCP tools return for the current map.
      tools: {
        list: () => { const n = listThreads(readData()).length; return `${n} thread${n === 1 ? '' : 's'}.`; },
        read: name => { const t = readThread(readData(), name); return `"${t.name}": ${t.total} record${t.total === 1 ? '' : 's'}.`; },
      },
    };

    if (scene.preload) { h.loadScenario(); h.addSessions(); }
    if (app) {
      if (!loaded) { await cdp('Page.navigate', { url: `http://localhost:${PORT}/#canvas` }); await sleep(1500); loaded = true; }
      cast = { dir: fs.mkdtempSync(path.join(home, 'frames-')), frames: [] };
      t0 = cast.t0 = Date.now();
      await cdp('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * SCALE, maxHeight: H * SCALE });
    }
    await wait(300);
    if (scene.run) await scene.run(h);
    else for (const li of lines[si].keys()) await h.speak(li);
    await wait(600);
    sc.dur = Number(now().toFixed(3));
    if (app) {
      await cdp('Page.stopScreencast');
      encodeClip(cast.frames, sc.dur, path.join(PUB, sc.clip));
      fs.rmSync(cast.dir, { recursive: true, force: true });
      cast = null;
    }
    scenes.push(sc);
    console.log(`[${video} ${lang}] scene ${si + 1}/${SCENES.length}: ${sc.kind}, ${sc.dur.toFixed(1)} s`);
  }
  fs.writeFileSync(path.join(PUB, base, 'manifest.json'), JSON.stringify({ lang, charSec: CHAR, scenes }, null, 1));
  writeSrt(video, lang, scenes);
}

// The two new sessions that the /trace-canvas scene puts on the canvas.
function addSessions(lang) {
  const t = Date.now(), ago = m => t - m * 60e3, L = v => pick(v, lang);
  mutate(d => {
    const th = (id, name, color, x, y, mins) => { d.threads[id] = { id, name, color, status: 'active', x, y, note: '', parent: 'sc_main', forkOf: 'sc_m10', mergedInto: null, key: name.replace(' · ', '@'), createdAt: ago(mins), example: true }; };
    const rc = (id, thread, kind, mins, title, agent, parent) => { d.commits[id] = { id, thread, kind, title, body: '', links: [], agent, ts: ago(mins), parents: [parent], done: false, example: true }; };
    th('sc_share', 'tripsplit · share-link', '#00A0B0', 1200, -250, 50);
    rc('sc_s0', 'sc_share', 'fork', 50, tr(lang, 'branchedFrom', 'share-link', 'tripsplit'), 'Claude Code', 'sc_m10');
    rc('sc_s1', 'sc_share', 'task', 49, L(['Add a share link so friends can join a trip without an account', '加一个分享链接，朋友不注册也能加入行程']), 'Claude Code', 'sc_s0');
    rc('sc_s2', 'sc_share', 'agent', 20, L(['Signed share links that expire after 7 days, and a join page for guests', '带签名的分享链接，7 天后失效；访客有单独的加入页']), 'Claude Code', 'sc_s1');
    rc('sc_s3', 'sc_share', 'agent', 12, tr(lang, 'commit', 'c4d19e2', 'Share links for trips'), 'Claude Code', 'sc_s2');
    rc('sc_s4', 'sc_share', 'note', 2, tr(lang, 'sessionEnd', 48, 6, 9, 1), 'Claude Code', 'sc_s3');
    th('sc_cur', 'tripsplit · currencies', '#E5007E', 1200, 250, 45);
    rc('sc_c0', 'sc_cur', 'fork', 45, tr(lang, 'branchedFrom', 'currencies', 'tripsplit'), 'Codex', 'sc_m10');
    rc('sc_c1', 'sc_cur', 'agent', 30, L(['Each expense keeps its currency; balances convert at the day’s rate', '每笔账单保留原币种，结余按当天汇率换算']), 'Codex', 'sc_c0');
    rc('sc_c2', 'sc_cur', 'agent', 18, tr(lang, 'commit', '7a2b9f1', 'Multi-currency trips'), 'Codex', 'sc_c1');
  });
}

function writeSrt(video, lang, scenes) {
  const ts = s => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
  let at = 0;
  const cues = scenes.flatMap(sc => { const c = sc.lines.map(l => [at + l.t, at + l.t + l.dur, l.text]); at += sc.dur; return c; });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `trace-canvas-${video}.${lang}.srt`), cues.map(([a, b, c], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${c}\n`).join('\n'));
}

// Concurrency 2 was fastest on an M2 Pro: 13 fps against 10 fps at the default 6; more tabs only compete for decoding the recorded clips.
function render(video, lang) {
  const mp4 = path.join(OUT, `trace-canvas-${video}.${lang}.mp4`);
  execFileSync('npx', ['remotion', 'render', 'src/index.jsx', 'Tutorial', mp4, `--props=${JSON.stringify({ video, lang })}`, `--browser-executable=${CHROME}`, `--concurrency=${process.env.TC_CONCURRENCY || 2}`, '--log=error'], { cwd: REMOTION, stdio: 'inherit' });
  console.log(`${path.relative(process.cwd(), mp4)}  ${duration(mp4).toFixed(1)} s`);
}

const args = process.argv.slice(2);
const videos = Object.keys(VIDEOS).filter(v => !args.some(a => a in VIDEOS) || args.includes(v));
const langs = ['en', 'zh'].filter(l => !args.some(a => a === 'en' || a === 'zh') || args.includes(l));
const jobs = videos.flatMap(v => langs.map(l => [v, l]));
try {
  for (const [v, l] of jobs) await record(v, l);
} finally {
  ws.close();
  chrome.kill();
  await new Promise(r => chrome.once('exit', r));
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
}
for (const [v, l] of jobs) render(v, l);
process.exit(0);
