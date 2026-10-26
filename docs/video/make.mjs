#!/usr/bin/env node
// Records the tutorial videos (English and Chinese) with headless Chrome, macOS `say` and
// ffmpeg, against a throwaway data folder (your own ~/.trace-canvas is never touched).
//   node docs/video/make.mjs          # both languages
//   node docs/video/make.mjs zh       # one language
// Writes docs/video/out/trace-canvas-tutorial.<lang>.mp4 and .srt (git-ignored).
// Voices: TC_VOICE_EN / TC_VOICE_ZH (default Samantha / Tingting). A Premium or Enhanced
// voice, added in System Settings > Accessibility > Spoken Content, sounds more natural.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarioData } from '../scenarios/scenarios.mjs';
import { tr } from '../../src/i18n.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4791, DEBUG = 9341, W = 1280, H = 720, SCALE = 1.5;
const VOICE = { en: process.env.TC_VOICE_EN || 'Samantha', zh: process.env.TC_VOICE_ZH || 'Tingting' };
const RATE = { en: ['-r', '168'], zh: [] };
const REPO = 'github.com/CallSymmetryEcho/trace-canvas';
const pick = (v, lang) => (Array.isArray(v) ? v[lang === 'zh' ? 1 : 0] : v);

/* ---------- pages that are not the app: title cards and terminals ---------- */
const card = (big, small, foot = '') => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#f4f2ec;color:#141414;text-align:center;font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
.line{margin:0 auto 34px;width:520px;height:10px;border-radius:5px;background:linear-gradient(90deg,#E4002B 0 25%,#0072CE 25% 50%,#00A651 50% 75%,#F29F05 75%)}
h1{font-size:76px;margin:0 0 18px;letter-spacing:-1px}p{font-size:28px;margin:0;color:#444}.f{margin-top:36px;font:24px "SF Mono",Menlo,monospace;color:#0b57d0}
</style><div><div class="line"></div><h1>${big}</h1><p>${small}</p>${foot && `<div class="f">${foot}</div>`}</div>`;

const term = title => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#e9e7e1;font-family:-apple-system,"PingFang SC",sans-serif}
.win{width:1080px;height:470px;margin-bottom:90px;border-radius:12px;background:#16181d;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;display:flex;flex-direction:column}
.bar{height:36px;background:#2a2d34;display:flex;align-items:center;gap:8px;padding:0 14px;color:#aab;font-size:13px}
.bar i{width:12px;height:12px;border-radius:50%}.bar span{flex:1;text-align:center;margin-right:60px}
pre{margin:0;padding:20px 24px;color:#e6e6e6;font:19px/1.55 "SF Mono",Menlo,"PingFang SC",monospace;white-space:pre-wrap}
.p{color:#7ee787}.o{color:#b9c0cc}.k{color:#d2a8ff}.c{display:inline-block;width:10px;height:21px;background:#e6e6e6;vertical-align:-4px;animation:b 1s steps(1) infinite}
@keyframes b{50%{opacity:0}}
</style><div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${title}</span></div><pre id="t"></pre></div>
<script>
const t = document.getElementById('t'), esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let html = '';
const draw = () => { t.innerHTML = html + '<span class="c"></span>'; };
window.__t = {
  async cmd(s, prompt) { html += '<span class="p">' + esc(prompt) + '</span>'; for (const ch of s) { html += esc(ch); draw(); await new Promise(r => setTimeout(r, 42)); } html += '\\n'; draw(); },
  out(s, cls) { html += '<span class="' + (cls || 'o') + '">' + esc(s) + '</span>\\n'; draw(); },
};
draw();
</script>`;

// Injected into every page: captions, a visible cursor and a click ripple (headless Chrome draws no cursor).
function overlay(bottom, x, y) {
  if (window.__ov) return;
  const st = document.createElement('style');
  st.textContent = `#__cap{position:fixed;left:50%;bottom:${bottom}px;transform:translateX(-50%);max-width:1060px;width:max-content;padding:9px 20px;border-radius:12px;background:rgba(18,18,20,.86);color:#fff;font:500 24px/1.45 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;text-align:center;z-index:2147483646;pointer-events:none}
#__cap:empty{display:none}
#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transition-property:transform;transition-timing-function:cubic-bezier(.4,0,.2,1)}
.__rip{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid rgba(37,99,235,.9);z-index:2147483645;pointer-events:none;animation:__rip .5s ease-out forwards}
@keyframes __rip{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}`;
  document.head.appendChild(st);
  const cap = document.createElement('div'); cap.id = '__cap';
  const cur = document.createElement('div'); cur.id = '__cur';
  cur.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 10.5-6.6 1.3 3.9 7.4-2.8 1.5-3.9-7.5L4 20z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.body.append(cap, cur);
  window.__ov = {
    cap: s => { cap.textContent = s; },
    move: (nx, ny, ms) => { x = nx; y = ny; cur.style.transitionDuration = ms + 'ms'; cur.style.transform = `translate(${nx - 4}px, ${ny - 2}px)`; },
    ripple: () => { const r = document.createElement('div'); r.className = '__rip'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); },
  };
  window.__ov.move(x, y, 0);
}

/* ---------- the script ---------- */
// Narration lines are [en, zh]; either side can be [caption, what the voice says].
const SCENES = [
  { page: lang => card('Trace Canvas', pick(['A transit map of your parallel AI work', '把并行的 AI 工作画成一张地铁线路图'], lang)),
    text: [
      ['When you run several AI agents at once, the work scatters across sessions, branches and chat windows.', '同时开好几个 AI agent 干活时，工作会散落在不同的会话、分支和聊天窗口里。'],
      ['Trace Canvas puts all of it on one map.', 'Trace Canvas 把它们画到同一张图上。'],
    ] },
  { page: () => term('zsh — ~/code'),
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
  { page: 'app', empty: true,
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
  { page: 'app',
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
  { page: () => term('zsh — ~/code/trace-canvas'),
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
  { page: () => term('claude — ~/code/tripsplit'),
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
  { page: lang => card('Trace Canvas', pick(['Free and open source · MIT · Node.js 18+', '免费开源 · MIT 许可 · Node.js 18+'], lang), `${REPO} ⭐`),
    text: [
      ['Trace Canvas is free and open source, under the MIT license.', 'Trace Canvas 免费开源，使用 MIT 许可。'],
      ['Find it on GitHub, and give it a star if it helps your work.', '地址在屏幕上，如果对你有帮助，欢迎在 GitHub 上点个 Star。'],
    ] },
];

/* ---------- recording machinery ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const duration = file => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-video-'));
process.env.TRACE_CANVAS_HOME = path.join(home, 'data');
fs.mkdirSync(process.env.TRACE_CANVAS_HOME, { recursive: true });
const { startServer } = await import('../../src/server.mjs');
const { mutate, dataFile, emptyData } = await import('../../src/store.mjs');
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
let seq = 0, rec = null;
const waiting = new Map();
const cdp = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => {
  const m = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(`page: ${m.result.exceptionDetails.exception?.description || expr}`);
  return m.result?.result?.value;
};
// Video time runs only while recording, so page loads between scenes are cut out.
const vnow = () => (Date.now() - rec.t0 - rec.paused) / 1000;
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); return; }
  if (m.method !== 'Page.screencastFrame') return;
  cdp('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  if (!rec || rec.pauseAt) return;
  const file = path.join(rec.dir, `f${String(rec.frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(m.params.data, 'base64'));
  rec.frames.push([file, vnow()]);
});
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });

async function record(lang) {
  console.log(`[${lang}] voice ${VOICE[lang]}`);
  const tmp = fs.mkdtempSync(path.join(home, `rec-${lang}-`));
  // Narration first, so every scene knows how long each line takes.
  const lines = SCENES.map((s, si) => s.text.map((pair, li) => {
    const v = pick(pair, lang), caption = pick(v, 'en'), spoken = Array.isArray(v) ? v[1] : v;
    const file = path.join(tmp, `s${si}-${li}.aiff`);
    run('say', ['-v', VOICE[lang], ...RATE[lang], '-o', file, spoken]);
    return { caption, file, dur: duration(file) };
  }));
  fs.writeFileSync(dataFile(), JSON.stringify(emptyData()));
  fs.writeFileSync(path.join(process.env.TRACE_CANVAS_HOME, 'config.json'), JSON.stringify({ lang }));
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/api/health` });
  await sleep(300);
  await js('localStorage.clear()');

  rec = { dir: tmp, frames: [], clips: [], cues: [], t0: Date.now(), paused: 0, pauseAt: Date.now() };
  let cur = { x: W / 2, y: H / 2 }, onApp = false;
  const center = async (sel, n = 0) => js(`(() => { const all = document.querySelectorAll(${JSON.stringify(sel)}); const e = all[${n} < 0 ? all.length + ${n} : ${n}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 22)) }; })()`);
  const h = {
    lang,
    wait: sleep,
    js,
    speak: null,
    async move(sel, n = 0, ms = 650) {
      const p = await center(sel, n);
      if (!p) throw new Error(`not on the page: ${sel}`);
      cur = p;
      await js(`__ov.move(${p.x}, ${p.y}, ${ms})`);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      await sleep(ms + 80);
      return p;
    },
    async click(sel) {
      const p = await h.move(sel);
      await js('__ov.ripple()');
      for (const type of ['mousePressed', 'mouseReleased']) { await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(60); }
      await sleep(300);
    },
    async type(text) { for (const ch of text) { await cdp('Input.insertText', { text: ch }); await sleep(55); } },
    async key(k) {
      const code = { Enter: 13, Escape: 27 }[k];
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(k === 'Enter' ? { text: '\r' } : {}) });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
    },
    cmd: (s, prompt = '$ ') => js(`__t.cmd(${JSON.stringify(s)}, ${JSON.stringify(prompt)})`),
    out: (s, cls) => js(`__t.out(${JSON.stringify(s)}, ${JSON.stringify(cls || '')})`),
    loadScenario: () => fs.writeFileSync(dataFile(), JSON.stringify(scenarioData('vibe', lang))),
    addSessions: () => addSessions(lang),
  };

  for (const [si, scene] of SCENES.entries()) {
    const needsNav = scene.page !== 'app' || !onApp;
    if (needsNav) {
      if (!rec.pauseAt) { rec.pauseAt = Date.now(); await cdp('Page.stopScreencast'); }
      const url = scene.page === 'app' ? `http://localhost:${PORT}/#canvas` : `data:text/html;charset=utf-8,${encodeURIComponent(scene.page(lang))}`;
      await cdp('Page.navigate', { url });
      await sleep(scene.page === 'app' ? 1500 : 500);
      onApp = scene.page === 'app';
      // On the app the caption sits above the zoom toolbar and the capture bar.
      await js(`(${overlay})(${onApp ? 156 : 40}, ${cur.x}, ${cur.y})`);
      await sleep(200);
      rec.paused += Date.now() - rec.pauseAt; rec.pauseAt = null;
      await cdp('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: W * SCALE, maxHeight: H * SCALE });
    }
    h.speak = async li => {
      const { caption, file, dur } = lines[si][li];
      const start = vnow();
      rec.clips.push([file, start]);
      rec.cues.push([start, start + dur, caption]);
      await js(`__ov.cap(${JSON.stringify(caption)})`);
      await sleep(dur * 1000 + 250);
    };
    await sleep(250);
    if (scene.run) await scene.run(h);
    else for (const li of lines[si].keys()) await h.speak(li);
    await sleep(500);
    await js(`__ov.cap('')`);
    console.log(`[${lang}] scene ${si + 1}/${SCENES.length} done at ${vnow().toFixed(1)} s`);
  }
  await sleep(600);
  const end = vnow();
  await cdp('Page.stopScreencast');
  return assemble(lang, end, tmp);
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

function assemble(lang, end, tmp) {
  fs.mkdirSync(OUT, { recursive: true });
  const { frames, clips, cues } = rec;
  // The first frame starts at 0 so the picture stays in step with the narration.
  const list = frames.map(([f, t], i) => `file '${f}'\nduration ${((frames[i + 1]?.[1] ?? end) - (i ? t : 0)).toFixed(4)}`);
  fs.writeFileSync(path.join(tmp, 'frames.txt'), `${list.join('\n')}\nfile '${frames.at(-1)[0]}'\n`);
  const mp4 = path.join(OUT, `trace-canvas-tutorial.${lang}.mp4`);
  const delays = clips.map(([, t], i) => `[${i + 1}:a]adelay=${Math.round(t * 1000)}:all=1[a${i}]`).join(';');
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'frames.txt'), ...clips.flatMap(([f]) => ['-i', f]),
    '-filter_complex', `[0:v]scale=1920:1080,fps=30,format=yuv420p[v];${delays};${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0,apad[a]`,
    '-map', '[v]', '-map', '[a]', '-t', end.toFixed(2), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4]);
  const ts = s => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
  fs.writeFileSync(path.join(OUT, `trace-canvas-tutorial.${lang}.srt`), cues.map(([a, b, c], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${c}\n`).join('\n'));
  console.log(`${path.relative(process.cwd(), mp4)}  ${end.toFixed(1)} s, ${frames.length} frames`);
}

try {
  for (const lang of process.argv[2] ? [process.argv[2]] : ['en', 'zh']) await record(lang);
} finally {
  ws.close();
  chrome.kill();
  await new Promise(r => chrome.once('exit', r));
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
}
process.exit(0);
