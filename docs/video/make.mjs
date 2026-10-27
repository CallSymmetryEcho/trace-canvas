#!/usr/bin/env node
// Builds the tutorial, the promo, the Agents view and the goals video (English and Chinese) in three steps:
//  1. narration: tts.py reads every line with a neural voice (cached, so re-runs only read new lines);
//  2. recording: headless Chrome plays the app scenes against a throwaway data folder (your own
//     ~/.trace-canvas is never touched) and logs every cursor move, click and narration cue;
//  3. animation: Remotion (docs/video/remotion) draws title cards, terminals, cursor, captions and
//     camera from that log, and renders the MP4.
//   node docs/video/make.mjs                # both videos, both languages
//   node docs/video/make.mjs promo zh       # one video, one language
//   node docs/video/make.mjs gifs --render-only   # animate the last recording again
// Writes docs/video/out/trace-canvas-<tutorial|promo|agents>.<lang>.mp4 and .srt (git-ignored), and with
// `gifs` the feature GIFs docs/gif-<agents|merge|timeline>.<lang>.gif that the READMEs show.
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
const W = 1280, H = 720, SCALE = 1.5;
const CHAR = 0.042; // seconds per typed character in the terminal scenes
const REPO = 'github.com/CallSymmetryEcho/trace-canvas';
const MODELS = { kokoro: 'mlx-community/Kokoro-82M-bf16', qwen: 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16' };
const VOICE = { en: process.env.TC_VOICE_EN || 'kokoro:af_heart', zh: process.env.TC_VOICE_ZH || 'qwen:Ryan' };
// Style instruction for Qwen3-TTS voices (Kokoro takes none).
const STYLE = {
  en: 'Clear, crisp and upbeat, at a brisk pace, confident and energetic, like a tech product launch.',
  zh: '语气平稳、克制、中性，情绪平淡，语调起伏小，吐字清晰，语速适中偏快，像新闻主播在播报。',
};
// Lower sampling temperature for Qwen3-TTS (default 0.9) keeps the delivery even from line to line.
const SAMPLING = { temperature: 0.5, top_p: 0.8 };
// Qwen3 still varies from take to take: some Chinese lines came out far higher, flatter or more sing-song than the
// rest, or slow and laboured. New Chinese lines are read four times; tts.py keeps the take closest to the first
// tutorial's lines, which sounded right: median pitch 127 Hz, pitch range 11.4 semitones, 4.5 syllables a second.
// Not part of the cache key, so cached lines stay as they are.
const TAKES = { zh: { takes: 4, target: { hz: 127, range: 11.4, rate: 4.5 } } };
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

// The promo: Trace Canvas as the entry point for agents. `preload` puts the data in place before the first shot.
const PROMO = [
  { page: { card: { big: 'Trace Canvas', small: ['The entry point for your agents', '你的 agent 的入口'] } },
    text: [
      ['Every new agent session starts from zero, and so do you when you come back to a project.', '每开一个新的 agent 会话，都要从头讲一遍项目；你自己隔几天回来，也一样。'],
      ['Trace Canvas gives you and your agents one shared map of all your work.', 'Trace Canvas 给你和你的 agent 一张共享的地图，装下你手上的所有工作。'],
    ] },
  // The demo sessions go in before the page loads, so the live bar shows them from the first shot.
  { page: 'app', preload: h => { h.loadScenario(); h.addSessions(); h.loadAgents(); },
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
      ['And the Agents view shows every running session live: who started whom, and which one is waiting for you.', '「Agent」视图实时显示每个在跑的会话：谁启动了谁，哪个在等你。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#cv-cards [data-tid="sc_ocr"]');
      await p;
      const q = h.speak(1);
      await h.key('Escape');
      await h.click('#tab-agents');
      await h.wait(700);
      for (const id of ['release', 'post', 'ocr']) await h.move(`#ag-inner .ag-session[data-sid="demo-${id}"]`);
      await h.move('#ag-inner .ag-agent.st-running');
      await q;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Open source · MIT · works with Claude Code', '开源 · MIT · 支持 Claude Code'], foot: `${REPO} ⭐` } },
    text: [['Give your agents a map. Trace Canvas is free on GitHub.', '给你的 agent 一张地图。Trace Canvas 在 GitHub 上免费开源。']] },
];
// The hook: a 20-second short for Shorts, Xiaohongshu and X, made for --vertical. `head` is the
// headline above the picture in the vertical frame.
const HOOK_HEAD = ['Too many AI agents to keep track of?', 'AI agent 一多，就乱了？'];
const HOOK = [
  { page: 'app', head: HOOK_HEAD, preload: h => { h.loadScenario(); h.addSessions(); h.loadAgents(); },
    text: [
      ['Five agents running, and you have lost track of who is doing what?', '同时开五个 agent，记不清谁在干什么了？'],
      ['Trace Canvas puts all of it on one map.', 'Trace Canvas 把它们画在同一张地图上。'],
    ],
    run: PROMO[1].run },
  { page: { terminal: 'claude — ~/code/tripsplit' }, head: HOOK_HEAD,
    text: [['A new agent reads the map and catches up in seconds.', '新开的 agent 读一下这张图，几秒就接上进度。']],
    run: PROMO[2].run },
  { page: 'app', head: HOOK_HEAD,
    text: [['And you see at a glance which one is waiting for you.', '哪个 agent 在等你批准，一眼就能看到。']],
    run: async h => {
      const p = h.speak(0);
      await h.click('#tab-agents');
      await h.wait(700);
      await h.move('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(500);
      await h.move('#ag-inner .ag-agent.st-running');
      await p;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Free and open source · Claude Code', '免费开源 · 支持 Claude Code'], foot: `${REPO} ⭐` } },
    text: [['Give your agents a map. Free on GitHub.', '给你的 agent 一张地图。Trace Canvas，免费开源。']] }, // the Chinese voice garbles "GitHub"
];
// The Agents view: who started whom, and who needs you. Data from docs/scenarios/agents.mjs.
const AGENTS = [
  { page: { card: { big: 'Trace Canvas', small: ['Who started whom, and who needs you', '谁启动了谁，谁在等你'] } },
    text: [
      ['Run enough agents at once, and two questions come up: which session started which, and which one is waiting for you?', '同时跑的 agent 一多，就会冒出两个问题：哪个会话是谁启动的？哪个正在等你？'],
      ['The Agents view answers both, live.', '「Agent」视图实时回答这两个问题。'],
    ] },
  { page: 'app', preload: h => { h.loadScenario(); h.loadAgents(); },
    text: [['The live bar at the top counts the running sessions and the ones that need you.', '顶部的实时栏显示有几个会话在跑，有几个在等你。']],
    run: async h => {
      const p = h.speak(0);
      await h.move('#live-bar');
      await h.move('#live-bar .live-chip.st-waiting');
      await p;
    } },
  { page: 'app',
    text: [
      ['The Agents tab draws the running Claude Code sessions as a tree: each session starts the ones to its right.', '「Agent」标签页把正在运行的 Claude Code 会话画成一棵树：每个会话启动它右边的会话。'],
      ['A session that has stopped stays in the chain as a dashed card, so the tree still makes sense.', '已经停下的会话以虚线卡片留在链上，整棵树依然完整。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#tab-agents');
      await h.wait(900);
      for (const id of ['release', 'post', 'video']) await h.move(`#ag-inner .ag-session[data-sid="demo-${id}"]`);
      await p;
      const q = h.speak(1);
      await h.move('#ag-inner .ag-session.st-off');
      await q;
    } },
  { page: 'app',
    text: [['The orange session is waiting for your permission. Its subagents hang off it: green while running, faded when done.', '橙色的会话在等你批准。它的子 agent 挂在旁边：运行中是绿色，完成后变淡。']],
    run: async h => {
      const p = h.speak(0);
      await h.move('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(800);
      await h.move('#ag-inner .ag-agent.st-running');
      await h.move('#ag-inner .ag-agent.st-done');
      await p;
    } },
  { page: 'app',
    text: [['Click a session to see what it is doing, who started it, the sessions and subagents it started, and the command that resumes it.', '点开一个会话，可以看到它在做什么、由谁启动、它启动了哪些会话和子 agent，以及恢复它的命令。']],
    run: async h => {
      const p = h.speak(0);
      await h.click('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(500);
      await h.move('#detail .l-status');
      await h.move('#detail [data-act="goto-live"]');
      await h.js(`document.querySelector('#detail .l-cmd').scrollIntoView({ behavior: 'smooth', block: 'center' })`);
      await h.wait(700);
      await h.move('#detail .l-cmd code');
      await p;
      await h.key('Escape');
    } },
  { page: 'app',
    text: [
      ['It changes as the hooks report. Approve the request, and the session turns green.', '画面随 hooks 上报实时变化：批准请求后，会话变成绿色。'],
      ['When a subagent finishes, it fades and keeps its last message.', '子 agent 完成后变淡，并留下它最后的消息。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.move('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(600);
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set blurry' } });
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set all' } }); // approved: the next step runs
      await p;
      const q = h.speak(1);
      await h.move('#ag-inner .ag-agent.st-running');
      await h.wait(500);
      h.live({ session_id: 'demo-ocr', hook_event_name: 'SubagentStop', agent_id: 'a-bench', agent_type: 'general-purpose',
        last_assistant_message: pick(['All 120 receipts read; the totals are right in 94% of them.', '120 张小票全部读完，94% 的总额正确。'], h.lang) });
      await q;
      await h.wait(600);
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Agents view · open source · MIT', 'Agent 视图 · 开源 · MIT'], foot: `${REPO} ⭐` } },
    text: [['See all your agents at a glance. Trace Canvas is free on GitHub.', '所有 agent 一目了然。Trace Canvas 在 GitHub 上免费开源。']] },
];
// Goals and to-dos: you set the goal and the to-dos, agents tick them off, the list shows how far along it is.
const SHARE = ['Share link so friends can join without an account', '分享链接：朋友不注册也能加入'];
const CURRENCIES = ['Trips with expenses in several currencies', '一次出游支持多种货币'];
const GOALS = [
  { page: { card: { big: 'Trace Canvas', small: ['Goals and to-dos, shared with your agents', '目标和待办，和 agent 共用一份清单'] } },
    text: [
      ['You set the goals. Agents do the work, often while you are away.', '你定目标，agent 干活，常常是在你不在的时候。'],
      ['Goals and to-dos keep both sides on the same list.', '「目标和待办」让双方看同一份清单。'],
    ] },
  { page: 'app', preload: h => { h.loadScenario(); h.loadAgents(); h.goalsDemo(); },
    text: [
      ['Goals in the header opens one list: each line’s goal, its to-dos and how far along it is.', '页头的「目标」按钮打开一份清单：每条线的目标、待办和进度。'],
      ['The first time, a short note explains how the inbox, to-dos and goals differ.', '第一次打开时，有一段说明讲清收件箱、待办和目标的区别。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#goals-btn');
      await h.wait(800);
      await h.move('.gl-group .gl-goal');
      await p;
      const q = h.speak(1);
      await h.move('.gl-tip');
      await q;
      await h.click('#gl-tip-hide');
      await h.wait(400);
    } },
  { page: 'app',
    text: [
      ['Each line shows its goal, a progress bar, and a badge while a session is working on it.', '每条线显示目标和进度条；有会话正在做时，还会显示徽标。'],
      ['Add a to-do for the agent right in the list.', '直接在清单里给 agent 加一条待办。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.move('.gl-group .gl-meter');
      await h.move('.gl-group .live-badge');
      await p;
      const q = h.speak(1);
      await h.click('.gl-add[data-thread="sc_main"]');
      await h.type(pick(['Add a dark mode', '加一个深色模式'], h.lang));
      await h.key('Enter');
      await h.wait(500);
      await q;
      await h.click('#gl-show-done'); // keep ticked to-dos in view, with who ticked them
      await h.js('document.activeElement.blur()'); // the list redraws on outside changes only when nothing in it has focus
    } },
  { page: { terminal: 'claude — ~/code/tripsplit' },
    text: [['Agents read the same list through MCP. When Claude Code finishes a to-do, it ticks it off.', 'agent 通过 MCP 读同一份清单。Claude Code 做完一项，就把它勾掉。']],
    run: async h => {
      const p = h.speak(0);
      await h.cmd(pick(['Work through the open to-dos on tripsplit', '把 tripsplit 上的待办依次做完'], h.lang), '> ');
      await h.wait(500);
      // The tool lines are what the MCP tools return for this list.
      h.out('⏺ trace-canvas - trace_tasks (MCP)(thread: "tripsplit")', 'k');
      h.out(`  ⎿  ${h.tools.tasks('tripsplit')}`);
      await h.wait(900);
      h.out(`⏺ trace-canvas - trace_task_done (MCP)(task: "${pick(SHARE, h.lang)}")`, 'k');
      h.out(`  ⎿  Ticked "${pick(SHARE, h.lang)}".`);
      await p;
    } },
  { page: 'app',
    text: [
      ['Back on the page, the to-do is ticked, marked as done by Claude Code, and the bar moves forward.', '回到页面，那一项已经勾上，标着由 Claude Code 勾选，进度条也往前走。'],
      ['When you come back, one look tells you where everything stands.', '你回来时，看一眼就知道进展到哪了。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.wait(500);
      h.done(SHARE, 'Claude Code');
      await h.wait(1200);
      await h.move('.gl-by');
      await h.move('.gl-group .gl-meter');
      await p;
      const q = h.speak(1);
      h.done(CURRENCIES, 'Codex');
      await h.wait(1200);
      await h.move('.gl-group .gl-prog');
      await q;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Goals and to-dos · open source · MIT', '目标和待办 · 开源 · MIT'], foot: `${REPO} ⭐` } },
    text: [['Set the goal, let the agents work, check the list. Trace Canvas is free on GitHub.', '定好目标，让 agent 去做，回来看清单。Trace Canvas 在 GitHub 上免费开源。']] },
];

// Sessions stay on their line: a resumed session goes on logging on receipt-ocr, the line's panel lists its
// sessions with a resume command each, and `trace-canvas resume` gives other agents the same list.
// The resume runs through the real hook handler (handleHook), as Claude Code would call it.
const RESUMED = '7f3a1c9e-2b4d-4e8a-9c61-0d5e8b2f4a17';
const resumeTurn = h => {
  for (const ev of [{ hook_event_name: 'SessionStart', source: 'resume' },
    { hook_event_name: 'UserPromptSubmit', prompt: pick(['Now compare it with Tesseract on the blurry receipts', '现在拿模糊的小票和 Tesseract 比一比'], h.lang) },
    { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/Users/dev/tripsplit/ocr/compare.py' } },
    { hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/Users/dev/tripsplit/ocr/compare.py' } },
    { hook_event_name: 'Stop', last_assistant_message: pick(['On blurry receipts the vision model reads 94% of totals; Tesseract reads 61%.', '模糊小票上，视觉模型认对 94% 的总额，Tesseract 只有 61%。'], h.lang) },
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set all' } }]) // working again
    handleHook({ session_id: RESUMED, cwd: '/Users/dev/tripsplit', ...ev });
};
// Three sessions on receipt-ocr: the one resumed above (last seen yesterday), a Codex session waiting
// for you, and an older one that has stopped.
function sessionsDemo(lang) {
  const t = Date.now(), H = 3600e3, L = v => pick(v, lang), cwd = '/Users/dev/tripsplit';
  const codex = '019a2c4e-8d1f-7b3a-a5e2-6c9f0e4d1b28';
  mutate(d => {
    const s = (id, agent, resume, title, ago, extra = {}) => { d.sessions[id] = { id, thread: 'sc_ocr', bound: true, agent, resume, cwd, title: L(title), last: t - ago * H, prompted: true, ...extra }; };
    s(RESUMED, 'Claude Code', `claude --resume ${RESUMED}`, ['Try a vision model for receipt totals', '试试用视觉模型读小票总额'], 20);
    s(codex, 'Codex', `codex resume ${codex}`, ['Benchmark the vision model on 120 receipts', '用 120 张小票测视觉模型'], 0.2, { agentKey: 'codex' });
    s('b81e44d0-5c2a-4f19-8e3d-27a9c6f01e55', 'Claude Code', 'claude --resume b81e44d0-5c2a-4f19-8e3d-27a9c6f01e55', ['Deskew receipts before Tesseract', '先做倾斜校正再交给 Tesseract'], 70);
  });
  const opt = { agent: 'Codex', agentKey: 'codex', resume: `codex resume ${codex}` };
  updateLive({ session_id: codex, cwd, hook_event_name: 'SessionStart', session_title: L(['Benchmark the vision model on 120 receipts', '用 120 张小票测视觉模型']) }, { ...opt, now: t - 12 * 60e3 });
  updateLive({ session_id: codex, cwd, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: L(['Codex wants to run python bench.py --receipts 120', 'Codex 想运行 python bench.py --receipts 120']) }, { ...opt, now: t - 60e3 });
}
// What `trace-canvas resume "<line>"` prints for the current map.
const resumeOut = tid => threadSessions(readData(), tid).flatMap(s =>
  [`${s.status.padEnd(8)} ${s.agent.padEnd(11)} ${new Date(s.last).toISOString().slice(0, 16).replace('T', ' ')}  ${s.title.slice(0, 60)}`, `         ${s.command}`]);
const SESSIONS = [
  { page: { terminal: 'zsh — ~/tripsplit' },
    text: [['Resume yesterday’s session, and it goes on right where it was.', '第二天恢复昨天的会话，它会接着记在原来那条线上。']],
    run: async h => {
      const p = h.speak(0);
      await h.cmd(`claude --resume ${RESUMED.slice(0, 8)}…`);
      h.out(pick(['⏺ Resuming “Try a vision model for receipt totals”', '⏺ 正在恢复「试试用视觉模型读小票总额」'], h.lang), 'p');
      await p;
    } },
  { page: 'app', preload: h => { h.loadScenario(); sessionsDemo(h.lang); },
    text: [
      ['Its new work lands on receipt-ocr, not back on the folder’s main line.', '新的进展落在 receipt-ocr 上，不会掉回 tripsplit 主线。'],
      ['Each line lists its sessions: who is working, who needs you, and who has stopped.', '每条线都列出它的会话：谁在干活，谁在等你，谁已经停了。'],
      ['Copy a resume command to pick one up again, instead of starting from scratch.', '复制恢复命令，就能接着那个会话做，不用从头再开一个。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#zoom-fit');
      await h.move('#cv-cards [data-tid="sc_ocr"]');
      resumeTurn(h);
      await h.wait(900);
      await h.move('#cv-cards [data-tid="sc_ocr"] li[data-cid]', 0);
      await p;
      const q = h.speak(1);
      await h.click('#cv-cards [data-tid="sc_ocr"] .card-head'); // the head: lower down, a click opens a station instead
      await h.wait(400);
      await h.js(`document.querySelector('#detail .s-list').scrollIntoView({ behavior: 'smooth', block: 'center' })`); // the list sits below the fold
      await h.wait(700);
      for (const st of ['working', 'waiting', 'off']) await h.move(`#detail .s-list li.st-${st} .s-name`);
      await q;
      const r = h.speak(2);
      await h.js('navigator.clipboard.writeText = () => Promise.resolve()'); // headless Chrome has no clipboard to write to
      await h.click('#detail .s-list li.st-off .btn');
      await r;
      await h.key('Escape');
    } },
  { page: { terminal: 'codex — ~/tripsplit' },
    text: [['Other agents get the same list, so they resume instead of starting anew.', '别的 agent 也能拿到这份列表，直接恢复，不用新开。']],
    run: async h => {
      const p = h.speak(0);
      await h.cmd('trace-canvas resume "tripsplit · receipt-ocr"');
      for (const s of resumeOut('sc_ocr')) { h.out(s); await h.wait(120); }
      await p;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['Sessions stay on their line · open source · MIT', '会话留在它的线上 · 开源 · MIT'], foot: `${REPO} ⭐` } },
    text: [['Sessions stay on their line. Trace Canvas is free on GitHub.', '会话留在它的线上。Trace Canvas 在 GitHub 上免费开源。']] },
];

// Feature GIFs for the READMEs: no narration, a closer camera, each on its own data and view.
// `fresh` reloads the page on `view` after `preload`; `zoom` overrides the camera's 1.15, and `focus` (page px)
// holds the camera still there, which keeps a GIF small: only what changes on the page differs between frames.
const GIFS = [
  { name: 'agents', page: 'app', fresh: true, view: 'agents', zoom: 1.2, focus: { x: 700, y: 330 }, text: [],
    preload: h => { h.loadScenario(); h.loadAgents(); },
    run: async h => {
      await h.move('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(700);
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set blurry' } });
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set all' } }); // approved: the next step runs
      await h.wait(1300);
      await h.move('#ag-inner .ag-agent.st-running');
      h.live({ session_id: 'demo-ocr', hook_event_name: 'SubagentStop', agent_id: 'a-bench', agent_type: 'general-purpose',
        last_assistant_message: pick(['All 120 receipts read; the totals are right in 94% of them.', '120 张小票全部读完，94% 的总额正确。'], h.lang) });
      await h.wait(1300);
      await h.click('#ag-inner .ag-session[data-sid="demo-ocr"]');
      await h.wait(500);
      await h.move('#detail [data-act="goto-live"]');
      await h.wait(1400);
    } },
  // Who did what: your stations are dark, the agents' are in the line's colour; live tips sit on top.
  { name: 'branches', page: 'app', fresh: true, view: 'git', text: [],
    preload: h => { h.loadScenario(); h.loadAgents(); },
    run: async h => {
      await h.camera({ x: 640, y: 360 }, 1, 0);
      await h.wait(900);
      const tip = await h.at('.g-row.g-live.st-waiting');
      await h.camera({ x: 360, y: tip.y + 60 }, 1.6, 900);
      await h.click('.g-row.g-live.st-waiting');
      await h.wait(1300);
      await h.key('Escape');
      await h.wait(300);
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set blurry' } });
      h.live({ session_id: 'demo-ocr', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set all' } });
      await h.wait(1300);
      h.record({ thread: 'sc_ocr', kind: 'decision', title: ['Switch to a vision model', '改用视觉模型'] });
      await h.wait(1300);
      h.record({ thread: 'sc_ocr', kind: 'agent', agent: 'Claude Code', title: ['The vision model reads 94% of receipt totals', '视觉模型认对 94% 的小票总额'] });
      await h.wait(1500);
      await h.camera({ x: 640, y: 400 }, 1.1, 900);
      await h.js(`document.getElementById('git-scroll').scrollBy({ top: 340, behavior: 'smooth' })`);
      await h.wait(1800);
    } },
  // Merging on the canvas, after a close look at one card: dark stations are yours, coloured ones the agents'.
  { name: 'merge', page: 'app', fresh: true, view: 'canvas', text: [],
    preload: h => { h.loadScenario(); h.addSessions(); h.loadAgents(); },
    run: async h => {
      await h.camera({ x: 640, y: 360 }, 1, 0);
      await h.click('#zoom-fit');
      await h.camera('#cv-cards [data-tid="sc_main"]', 1.9, 500);
      await h.move('#cv-cards [data-tid="sc_main"] li[data-cid]', 1);
      await h.wait(900);
      await h.camera({ x: 640, y: 360 }, 1.15, 500);
      await h.click('#cv-cards [data-tid="sc_share"]', { shift: true });
      await h.click('#cv-cards [data-tid="sc_cur"]', { shift: true });
      await h.move('#multi-target');
      await h.js(`(() => { const s = document.getElementById('multi-target'); s.value = 'sc_main'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await h.wait(300);
      await h.click('[data-multi="merge"]');
      await h.wait(600);
      await h.key('Escape');
      await h.click('#zoom-fit');
      await h.camera('#cv-cards [data-tid="sc_main"]', 1.6, 450);
      await h.wait(1000);
    } },
  // Goals and to-dos: agents tick to-dos off on the shared list, the progress bar moves.
  { name: 'goals', page: 'app', fresh: true, view: 'canvas', text: [],
    preload: h => { h.loadScenario(); h.loadAgents(); h.goalsDemo(); },
    run: async h => {
      await h.camera({ x: 640, y: 360 }, 1, 0);
      await h.click('#goals-btn');
      await h.wait(500);
      await h.click('#gl-tip-hide');
      await h.click('#gl-show-done');
      await h.js('document.activeElement.blur()');
      await h.wait(300);
      const g = await h.at('.gl-group:has(.gl-add[data-thread="sc_main"])');
      await h.camera({ x: g.x, y: g.y + 90 }, 1.55, 500);
      await h.wait(700);
      h.done(SHARE, 'Claude Code');
      await h.wait(1600);
      h.done(CURRENCIES, 'Codex');
      await h.wait(1800);
      await h.camera({ x: 640, y: 360 }, 1, 500);
      await h.wait(500);
    } },
  { name: 'timeline', page: 'app', fresh: true, view: 'timeline', zoom: 1.35, text: [],
    preload: h => h.loadScenario('life'),
    run: async h => {
      await h.click('#tl-zoom [data-z="day"]');
      await h.wait(700);
      await h.click('#tl-zoom [data-z="week"]');
      await h.wait(700);
      await h.click('#tl-zoom [data-z="month"]');
      await h.wait(600);
      await h.move('#tl-now');
      await h.wait(500);
      await h.move('.tl-label', 2);
      await h.wait(1500);
    } },
  // A resumed session logs on its line again, and the line's panel lists its sessions, each with a resume command.
  { name: 'sessions', page: 'app', fresh: true, view: 'canvas', text: [],
    preload: h => { h.loadScenario(); sessionsDemo(h.lang); },
    run: async h => {
      await h.camera('#cv-cards [data-tid="sc_ocr"]', 1.7, 0);
      await h.move('#cv-cards [data-tid="sc_ocr"]');
      resumeTurn(h);
      await h.wait(1000);
      await h.move('#cv-cards [data-tid="sc_ocr"] li[data-cid]', 0);
      await h.wait(900);
      await h.click('#cv-cards [data-tid="sc_ocr"] .card-head'); // the head: lower down, a click opens a station instead
      await h.wait(300);
      await h.js(`document.querySelector('#detail .s-list').scrollIntoView({ behavior: 'smooth', block: 'center' })`); // the list sits below the fold
      await h.wait(700);
      await h.camera('#detail .s-list', 1.6, 700);
      for (const st of ['working', 'waiting', 'off']) await h.move(`#detail .s-list li.st-${st} .s-name`, 0, 450);
      await h.js('navigator.clipboard.writeText = () => Promise.resolve()');
      await h.click('#detail .s-list li.st-off .btn');
      await h.wait(1500);
    } },
  // The READMEs' first GIF: the first command after setup, then each past session lands on the canvas as a line.
  { name: 'replay', page: { terminal: 'claude — ~/tripsplit' }, text: [],
    run: async h => {
      await h.cmd(pick(['/trace-canvas put all my sessions on the canvas', '/trace-canvas 把现在所有的会话展示在画布上'], h.lang), '> ');
      await h.wait(300);
      h.out('⏺ trace-canvas - trace_list_sessions (MCP)', 'k');
      h.out(`  ⎿  ${Object.keys(scenarioData('vibe', h.lang).threads).length + 2} sessions in /Users/dev/tripsplit.`); // the scenario's lines plus addSessions()
      await h.wait(500);
      h.out('⏺ trace-canvas - trace_capture_session (MCP)', 'k');
      await h.wait(700);
    } },
  { name: 'replay', page: 'app', fresh: true, view: 'canvas', zoom: 1, focus: { x: 640, y: 360 }, text: [],
    // The page fits the finished map when it loads, then starts from an empty one.
    preload: h => { h.loadScenario(); h.addSessions(); h.maps = allSessionsMaps(); fs.writeFileSync(dataFile(), JSON.stringify(h.maps.at(-1))); },
    ready: async h => { fs.writeFileSync(dataFile(), JSON.stringify(emptyData())); await h.wait(1000); },
    run: async h => {
      for (const m of h.maps) {
        fs.writeFileSync(dataFile(), JSON.stringify(m));
        await h.wait(380);
        const sel = `#cv-cards [data-tid="${Object.keys(m.threads).at(-1)}"]`;
        if (await h.at(sel)) await h.move(sel, 0, 300);
      }
      await h.wait(1800);
    } },
  // See what changed: open a commit station, its files, one file's diff, then the change since an earlier station.
  { name: 'changes', page: 'app', fresh: true, view: 'canvas', text: [],
    preload: h => { h.loadScenario(); changesDemo(h.lang); },
    run: async h => {
      await h.camera('#cv-cards [data-tid="sc_ocr"]', 1.6, 0);
      await h.click(`#cv-cards li[data-cid="${CHG.recs[2]}"]`);
      await h.wait(800);
      await chgTop(h);
      await h.wait(500);
      await h.camera('#detail .gx-head', 1.5, 600);
      await h.move('#detail .gx-file', 0, 350);
      await h.click('#detail .gx-file[title="src/ocr.js"]');
      await h.wait(800);
      await chgShow(h, '.gx-diff', 'center');
      await h.wait(400);
      await h.camera('#detail .gx-diff', 1.5, 500);
      await h.wait(1200);
      await chgTop(h);
      await h.wait(400);
      await h.camera('#detail .gx-head', 1.5, 500);
      await h.move('#detail .gx-against', 0, 350);
      await chgCompare(h);
      await h.wait(900);
      await chgShow(h, '.gx-list', 'end');
      await h.wait(400);
      await h.camera('#detail .gx-list', 1.5, 500); // the list moved with the scroll; follow it
      await h.wait(1500);
    } },
];
// TC_GIFS=branches,merge records only those GIFs.
const VIDEOS = { tutorial: SCENES, promo: PROMO, hook: HOOK, agents: AGENTS, goals: GOALS, gifs: process.env.TC_GIFS ? GIFS.filter(g => process.env.TC_GIFS.split(',').includes(g.name)) : GIFS };

VIDEOS.sessions = SESSIONS;
// See what changed: a made-up tripsplit repository with three real commits in the build's temp folder, so the
// page can ask git for their files and diffs. The records keep only each commit's sha and repository.
const CHG = { recs: [] };
const CHG_FILES = [
  ['Read receipt totals with Tesseract', '2026-10-24T10:00:00Z', {
    'src/ocr.js': "import Tesseract from 'tesseract.js';\nimport { parseTotal } from './receipts.js';\n\n// The total of a receipt, from a photo of it.\nexport async function readTotal(image) {\n  const { data } = await Tesseract.recognize(image, 'eng');\n  return parseTotal(data.text);\n}\n",
    'src/receipts.js': "// The amount on the line that says TOTAL, in cents.\nexport function parseTotal(text) {\n  const line = text.split('\\n').find(l => /total/i.test(l));\n  const m = line && line.match(/(\\d+)[.,](\\d{2})/);\n  return m ? Number(m[1]) * 100 + Number(m[2]) : null;\n}\n",
    'package.json': '{\n  "name": "tripsplit",\n  "type": "module",\n  "dependencies": {\n    "tesseract.js": "^5.1.0"\n  }\n}\n',
    'package-lock.json': JSON.stringify({ name: 'tripsplit', lockfileVersion: 3, packages: { 'node_modules/tesseract.js': { version: '5.1.0', resolved: 'https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.0.tgz' }, 'node_modules/tesseract.js-core': { version: '5.1.0' } } }, null, 2) + '\n',
  }],
  ['Deskew receipts before OCR', '2026-10-25T15:30:00Z', {
    'src/deskew.js': "import sharp from 'sharp';\n\n// Straighten a photographed receipt: find the skew of its text lines and rotate it back.\nexport async function deskew(image) {\n  const img = sharp(image).greyscale();\n  const { width } = await img.metadata();\n  const angle = await skewAngle(img, width);\n  return img.rotate(-angle, { background: '#fff' }).toBuffer();\n}\n\nasync function skewAngle(img, width) {\n  const rows = await img.clone().resize(width >> 2).raw().toBuffer();\n  return estimateAngle(rows, width >> 2); // degrees, positive is clockwise\n}\n",
    'src/ocr.js': "import Tesseract from 'tesseract.js';\nimport { deskew } from './deskew.js';\nimport { parseTotal } from './receipts.js';\n\n// The total of a receipt, from a photo of it, straightened first.\nexport async function readTotal(image) {\n  const { data } = await Tesseract.recognize(await deskew(image), 'eng');\n  return parseTotal(data.text);\n}\n",
  }],
  ['Use a vision model for totals', '2026-10-27T09:10:00Z', {
    'src/ocr.js': "import Tesseract from 'tesseract.js';\nimport { deskew } from './deskew.js';\nimport { parseTotal } from './receipts.js';\nimport { askVision } from './vision.js';\n\n// The total of a receipt, from a photo of it. A vision model reads blurry and\n// crumpled receipts far better than Tesseract; Tesseract stays as the fallback\n// when the model is unsure or the network is down.\nexport async function readTotal(image, { minConfidence = 0.8 } = {}) {\n  try {\n    const r = await askVision(image, 'What is the total on this receipt, in cents?');\n    if (r.confidence >= minConfidence && Number.isInteger(r.cents)) return r.cents;\n  } catch (e) {\n    console.warn('vision model unavailable, falling back to Tesseract:', e.message);\n  }\n  const { data } = await Tesseract.recognize(await deskew(image), 'eng');\n  return parseTotal(data.text);\n}\n\n// Which reader to trust, for the benchmark.\nexport const READERS = ['vision', 'tesseract'];\n",
    'src/vision.js': "// A small client for the vision model: send the photo, get back an amount and a confidence.\nconst ENDPOINT = process.env.VISION_URL || 'http://localhost:8080/v1/read';\n\nexport async function askVision(image, question) {\n  const body = new FormData();\n  body.append('image', new Blob([image]), 'receipt.jpg');\n  body.append('question', question);\n  const res = await fetch(ENDPOINT, { method: 'POST', body, signal: AbortSignal.timeout(8000) });\n  if (!res.ok) throw new Error(`vision model: HTTP ${res.status}`);\n  const { answer, confidence } = await res.json();\n  return { cents: toCents(answer), confidence };\n}\n\nfunction toCents(answer) {\n  const m = String(answer).match(/(\\d+)[.,](\\d{2})/);\n  return m ? Number(m[1]) * 100 + Number(m[2]) : null;\n}\n",
    'test/ocr.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { readTotal } from '../src/ocr.js';\n\ntest('reads the total of a blurry receipt', async () => {\n  assert.strictEqual(await readTotal('test/fixtures/blurry-42-80.jpg'), 4280);\n});\n\ntest('falls back to Tesseract when the model is unsure', async () => {\n  assert.strictEqual(await readTotal('test/fixtures/clear-12-50.jpg', { minConfidence: 1.1 }), 1250);\n});\n",
    'package-lock.json': JSON.stringify({ name: 'tripsplit', lockfileVersion: 3, packages: { 'node_modules/sharp': { version: '0.33.5' }, 'node_modules/tesseract.js': { version: '5.1.0', resolved: 'https://registry.npmjs.org/tesseract.js/-/tesseract.js-5.1.0.tgz' }, 'node_modules/tesseract.js-core': { version: '5.1.0' } } }, null, 2) + '\n',
    'docs/sample-receipt.png': Buffer.from('89504e470d0a1a0a0000000d49484452000000100000001008020000009091683600000012494441547801636060f8cfc0c0c000000d0004011e7a5f8b0000000049454e44ae426082', 'hex'),
  }],
];
// The repository (made once per build; fixed author and dates keep the shas the same in both languages),
// then a commit record for each on receipt-ocr, as the hooks write them: gitCommit and repo.
function changesDemo(lang) {
  fs.mkdirSync(path.join(home, 'tripsplit'), { recursive: true });
  const repo = fs.realpathSync(path.join(home, 'tripsplit')); // as git names it (macOS's /var is /private/var); the panel compares the two
  if (!CHG.shas) {
    run('git', ['-C', repo, 'init', '-q', '-b', 'main']);
    CHG.shas = CHG_FILES.map(([msg, date, files]) => {
      for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), body); }
      const env = { ...process.env, GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
      run('git', ['-C', repo, 'add', '-A'], { env });
      run('git', ['-C', repo, 'commit', '-q', '-m', msg], { env });
      return run('git', ['-C', repo, 'rev-parse', 'HEAD']);
    });
  }
  const t = Date.now(), H = 3600e3;
  mutate(d => { CHG.recs = CHG_FILES.map(([msg], i) => addCommit(d, { thread: 'sc_ocr', kind: 'agent', agent: 'Claude Code', title: tr(lang, 'commit', CHG.shas[i].slice(0, 7), msg), ts: t - (5 - 2 * i) * H, extra: { gitCommit: CHG.shas[i], repo } }).id); });
}
// The Changes section, a diff or the file list sits below the panel's fold; scroll it into view first.
const chgShow = (h, sel, block = 'start') => h.js(`document.querySelector('#detail ${sel}').scrollIntoView({ behavior: 'smooth', block: '${block}' })`);
const chgTop = h => chgShow(h, '.gx-head');
const chgCompare = h => h.js(`(() => { const s = document.querySelector('#detail .gx-against'); s.value = ${JSON.stringify(CHG.recs[0])}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const CHANGES = [
  { page: 'app', zoom: 1.3, preload: h => { h.loadScenario(); changesDemo(h.lang); },
    text: [
      ['Open a commit station, and it shows what changed: the files, most-changed first, with lines added and removed.', '点开一个提交站点，就能看到改了什么：改得最多的文件排在前面，每个都标着增删行数。'],
      ['Click a file to read its diff right there.', '点一个文件，就地展开它的 diff。'],
      ['Compare with an earlier station to see everything that changed in between.', '在「对比」里选一个更早的站点，就能看到两点之间改了什么。'],
    ],
    run: async h => {
      const p = h.speak(0);
      await h.click('#zoom-fit');
      await h.move('#cv-cards [data-tid="sc_ocr"]');
      await h.click(`#cv-cards li[data-cid="${CHG.recs[2]}"]`);
      await h.wait(900);
      await chgTop(h);
      await h.wait(700);
      await h.move('#detail .gx-head');
      for (const i of [0, 1, 2]) await h.move('#detail .gx-file', i, 450);
      await p;
      const q = h.speak(1);
      await h.click('#detail .gx-file[title="src/ocr.js"]');
      await h.wait(900);
      await chgShow(h, '.gx-diff', 'center');
      await h.wait(600);
      await h.move('#detail .gx-diff');
      await q;
      const r = h.speak(2);
      await chgTop(h);
      await h.wait(500);
      await h.move('#detail .gx-against');
      await chgCompare(h);
      await h.wait(1000);
      await chgShow(h, '.gx-list', 'end');
      await h.wait(500);
      await h.move('#detail .gx-head');
      await r;
    } },
  { page: { card: { big: 'Trace Canvas', small: ['See what changed · open source · MIT', '看改了什么 · 开源 · MIT'], foot: `${REPO} ⭐` } },
    text: [['The canvas keeps only the commit and its repository; the diff comes from git when you open it.', '画布只记提交和它所在的仓库，diff 在你打开时直接向 git 要。']] },
];
VIDEOS.changes = CHANGES;
// Feature shorts carry their number from the to-do list (功能短视频 N), so a file and its to-do match: 08-sessions.zh.mp4.
const NUMBER = { sessions: 8, story: 9, tutorial: 10, changes: 11 };
const fileName = video => (NUMBER[video] ? `${String(NUMBER[video]).padStart(2, '0')}-${video}` : `trace-canvas-${video}`);

/* ---------- narration ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
const duration = file => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

function narrate(scenes, lang) {
  if (!scenes.some(s => s.text.length)) return scenes.map(() => []); // nothing to say, no voices needed
  const [engine, voice] = VOICE[lang].split(':');
  if (!MODELS[engine]) throw new Error(`TC_VOICE_${lang.toUpperCase()} must look like kokoro:af_heart or qwen:Serena`);
  if (!fs.existsSync(PY)) throw new Error('No voice environment yet; see "Setup" in docs/video/README.md');
  const v = { model: MODELS[engine], voice, ...(engine === 'qwen' ? { instruct: STYLE[lang], ...SAMPLING } : {}) };
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
    execFileSync(PY, [path.join(here, 'tts.py')], { input: JSON.stringify(todo.map(l => ({ ...v, ...(engine === 'qwen' ? TAKES[lang] : {}), lang, text: l.spoken, out: `${l.abs}.raw.wav` }))), stdio: ['pipe', 'inherit', 'inherit'] });
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
const REAL_ENV = { ...process.env }; // your own data folder, which only `replay` reads
process.env.TRACE_CANVAS_HOME = path.join(home, 'data');
process.env.TRACE_CANVAS_DESKTOP_DIR = path.join(home, 'desktop'); // never the real desktop app's records
fs.mkdirSync(process.env.TRACE_CANVAS_HOME, { recursive: true });
const { startServer } = await import('../../src/server.mjs');
const { mutate, dataFile, emptyData, readData, readConfig, addCommit } = await import('../../src/store.mjs');
const { listThreads, readThread, listTasks, setTaskDone } = await import('../../src/ops.mjs');
const { updateLive } = await import('../../src/live.mjs');
const { writeAgentsDemo } = await import('../scenarios/agents.mjs');
const { handleHook } = await import('../../src/hook.mjs');
const { threadSessions } = await import('../../src/ops.mjs');
const { server } = await startServer({ port: 0 }); // free ports here and for Chrome, so two builds can run at once
const PORT = server.address().port;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${path.join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 50 && !target; i++) {
  // Chrome picks a free debugging port and writes it to its profile, so a stale Chrome or a second build never answers instead.
  try { const port = fs.readFileSync(path.join(home, 'chrome', 'DevToolsActivePort'), 'utf8').split('\n')[0];
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
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
  // Empty live/ but keep the folder: the server watches it, and a new folder would stop its updates.
  const liveDir = path.join(process.env.TRACE_CANVAS_HOME, 'live');
  fs.mkdirSync(liveDir, { recursive: true });
  for (const e of fs.readdirSync(liveDir)) fs.rmSync(path.join(liveDir, e), { recursive: true, force: true });
  fs.rmSync(process.env.TRACE_CANVAS_DESKTOP_DIR, { recursive: true, force: true });
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
    if (scene.zoom) sc.zoom = scene.zoom;
    if (scene.focus) sc.focus = scene.focus;
    if (scene.head) sc.head = pick(scene.head, lang);
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
      async click(sel, { shift = false } = {}) {
        const p = await h.move(sel);
        sc.cursor.push({ t: now(), x: p.x, y: p.y, click: true });
        for (const type of ['mousePressed', 'mouseReleased']) { await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1, modifiers: shift ? 8 : 0 }); await sleep(60); }
        await sleep(300);
      },
      async type(text) { for (const ch of text) { await cdp('Input.insertText', { text: ch }); await sleep(55); } },
      async key(k) {
        const code = { Enter: 13, Escape: 27 }[k];
        await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, ...(k === 'Enter' ? { text: '\r' } : {}) });
        await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code });
      },
      // Camera keyframe for Remotion: look at an element (or {x, y} in page px) at zoom z, gliding there in ms.
      at: (sel, n = 0) => center(sel, n), // where an element is, in page px
      async camera(target, z, ms = 800) {
        const p = typeof target === 'string' ? await center(target, 0) : target;
        if (!p) throw new Error(`not on the page: ${target}`);
        (sc.camera ||= []).push({ t: now(), x: p.x, y: p.y, z, ms });
        await sleep(ms);
      },
      // A record written straight into the data, as `trace-canvas log` would; no agent means you wrote it.
      // A to-do ticked off by an agent, as trace_task_done or `trace-canvas done --agent` would.
      done: (title, by) => mutate(d => setTaskDone(d, { task: pick(title, lang), thread: 'sc_main', by })),
      // Goals demo: a goal for tripsplit and four to-dos, one done; the session's first instruction is not a to-do.
      goalsDemo: () => mutate(d => {
        d.commits.sc_m1.session = 'demo-release';
        d.threads.sc_main.note = pick(['Ship v0.2: friends can split a trip in under a minute', '发布 v0.2：朋友一分钟内就能分好一次出游的账'], lang);
        const t = Date.now(), H = 3600e3;
        for (const [title, hours, by] of [[['Fix rounding: amounts in integer cents', '修复舍入：金额一律用整数分'], 30, 'human'], [SHARE, 5], [CURRENCIES, 4.5],
          [['Settle-up reminders by email', '用邮件提醒结清'], 4]]) {
          const c = addCommit(d, { thread: 'sc_main', kind: 'task', title: pick(title, lang), ts: t - hours * H, extra: { example: true } });
          if (by) Object.assign(c, { done: true, doneBy: by, doneAt: t - 20 * H });
        }
      }),
      record: ({ thread, kind, title, agent = '' }) => mutate(d => addCommit(d, { thread, kind, title: pick(title, lang), agent })),
      async cmd(s, prompt = '$ ') { sc.steps.push({ t: now(), cmd: s, prompt }); await wait(s.length * CHAR * 1000 + 150); },
      out(s, cls = '') { sc.steps.push({ t: now(), out: s, cls }); },
      loadScenario: (name = 'vibe') => fs.writeFileSync(dataFile(), JSON.stringify(scenarioData(name, lang))),
      addSessions: () => addSessions(lang),
      loadAgents: () => writeAgentsDemo({ home: process.env.TRACE_CANVAS_HOME, desktop: process.env.TRACE_CANVAS_DESKTOP_DIR, lang }),
      // A hook event for one of the demo sessions, through the same updateLive() the hooks use.
      live: input => updateLive({ cwd: '/Users/dev/tripsplit', transcript_path: path.join(process.env.TRACE_CANVAS_HOME, 'demo-transcripts', `${input.session_id}.jsonl`), ...input }),
      // The text the MCP tools return for the current map.
      tools: {
        list: () => { const n = listThreads(readData()).length; return `${n} thread${n === 1 ? '' : 's'}.`; },
        tasks: thread => { const rows = listTasks(readData(), { thread }); const open = rows.reduce((n, r) => n + r.total - r.done, 0);
          return `${open} open to-do${open === 1 ? '' : 's'} on ${rows.length} thread${rows.length === 1 ? '' : 's'}.`; },
        read: name => { const t = readThread(readData(), name); return `"${t.name}": ${t.total} record${t.total === 1 ? '' : 's'}.`; },
      },
    };

    if (scene.preload) scene.preload(h);
    if (app) {
      if (!loaded || scene.fresh) {
        // Leave the page first: a navigation that only changes the hash would keep the old view.
        await cdp('Page.navigate', { url: `http://localhost:${PORT}/api/health` });
        await sleep(300);
        await js('localStorage.clear()');
        await cdp('Page.navigate', { url: `http://localhost:${PORT}/#${scene.view || 'canvas'}` });
        await sleep(1500);
        loaded = true;
      }
      if (scene.ready) await scene.ready(h); // on the loaded page, before recording starts
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
  if (video !== 'gifs') writeSrt(video, lang, scenes);
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

// The replay: one session's work as it happened on your own map (read only), on the canvas, then in the
// Branches view. Its lines are the ones holding the session's records, plus the lines they forked from,
// forked into or merged with. Earlier records are there from the start; the rest arrive in time order.
function replayScenes(data, sid) {
  const C = Object.values(data.commits), T = data.threads;
  const own = C.filter(c => c.session === sid && T[c.thread]);
  if (!own.length) throw new Error(`Session ${sid} has no records on the canvas yet; put it there with /trace-canvas first`);
  const mine = new Set(own.map(c => c.thread)), lines = new Set(mine);
  for (const id of mine) {
    for (const k of [T[id].parent, T[id].mergedInto]) if (T[k]) lines.add(k);
    for (const t of Object.values(T)) if (t.parent === id || t.mergedInto === id) lines.add(t.id);
  }
  // A line of the session made shortly before its first record (the fork it was started on) belongs to the story.
  const first = Math.min(...own.map(c => c.ts));
  const start = Math.min(first, ...[...mine].map(id => T[id].createdAt).filter(t => t >= first - 30 * 60e3));
  const recs = C.filter(c => lines.has(c.thread)).sort((a, b) => a.ts - b.ts), later = recs.filter(c => c.ts >= start);
  const edges = Object.values(data.edges || {}).filter(e => lines.has(e.from) && lines.has(e.to));
  // ponytail: merged lines show as merged only at the end; time each one by its merge record if that ever matters.
  const stateAt = ts => {
    const d = { version: 1, threads: {}, commits: {}, edges: {} };
    for (const c of recs) if (c.ts <= ts) d.commits[c.id] = c;
    for (const id of lines) {
      if (T[id].createdAt > ts && !recs.some(c => c.thread === id && c.ts <= ts)) continue;
      d.threads[id] = ts === Infinity || !T[id].mergedInto ? T[id] : { ...T[id], mergedInto: null, status: 'active' };
    }
    for (const e of edges) if (d.threads[e.from] && d.threads[e.to]) d.edges[e.id] = e;
    return d;
  };
  const put = d => fs.writeFileSync(dataFile(), JSON.stringify(d));
  const size = Math.ceil(later.length / 30) || 1, beats = []; // about 30 beats, whatever the session's size
  for (let i = 0; i < later.length; i += size) beats.push(later.slice(i, i + size));
  const count = id => own.filter(c => c.thread === id).length;
  const name = T[[...mine].sort((a, b) => count(b) - count(a))[0]].name;
  // 'Claude' is what the MCP tools write for highlights; next to 'Claude Code' it says nothing new.
  const by = [...new Set(own.map(c => c.agent).filter(Boolean))].filter((a, _, all) => a !== 'Claude' || !all.includes('Claude Code')).join(' · '), day = new Date(first).toISOString().slice(0, 10);
  return [
    { page: { card: { big: name, small: [`${by} · ${day} · ${own.length} records`, `${by} · ${day} · ${own.length} 条记录`] } }, text: [], run: h => h.wait(2600) },
    // The page fits the finished map when it loads; then it steps back to where the session started.
    // A real map is spread out, so the camera stays close to the newest station.
    { page: 'app', text: [], zoom: 1.8, preload: () => put(stateAt(Infinity)),
      ready: async h => { put(stateAt(start - 1)); await h.wait(1200); },
      run: async h => {
        for (const b of beats) {
          const last = b.at(-1);
          put(stateAt(last.ts));
          await h.wait(450);
          // Point at the newest station if its line's card shows it, else at the line.
          const sel = (await h.at(`#cv-cards li[data-cid="${last.id}"]`)) ? `#cv-cards li[data-cid="${last.id}"]` : `#cv-cards [data-tid="${last.thread}"]`;
          if (await h.at(sel)) await h.move(sel, 0, 350);
        }
        put(stateAt(Infinity));
        await h.wait(1500);
      } },
    { page: 'app', text: [],
      run: async h => {
        await h.click('#tab-git');
        await h.wait(900);
        for (let i = 0; i < 6; i++) { await h.js(`document.getElementById('git-scroll').scrollBy({ top: 240, behavior: 'smooth' })`); await h.wait(900); }
      } },
    { page: { card: { big: 'Trace Canvas', small: [`${later.length} records · ${lines.size} lines`, `${later.length} 条记录 · ${lines.size} 条线`], foot: `${REPO} ⭐` } }, text: [], run: h => h.wait(2600) },
  ];
}

// The maps that `/trace-canvas put all my sessions on the canvas` builds, one past session (line) more each:
// the current made-up data, each line on its own and whole, since capturing past sessions draws no forks.
function allSessionsMaps() {
  const d = readData();
  const lines = Object.values(d.threads).map(t => ({ ...t, parent: null, forkOf: null, mergedInto: null, status: t.status === 'merged' ? 'done' : t.status }));
  const recs = Object.values(d.commits).filter(c => d.threads[c.thread] && c.kind !== 'fork');
  const first = id => Math.min(...recs.filter(c => c.thread === id).map(c => c.ts));
  lines.sort((a, b) => first(a.id) - first(b.id));
  return lines.map((_, k) => {
    const on = lines.slice(0, k + 1), ids = new Set(recs.filter(c => on.some(t => t.id === c.thread)).map(c => c.id));
    const commits = Object.fromEntries([...ids].map(id => [id, { ...d.commits[id], parents: (d.commits[id].parents || []).filter(p => ids.has(p) && d.commits[p].thread === d.commits[id].thread) }]));
    return { version: 1, threads: Object.fromEntries(on.map(t => [t.id, t])), commits, edges: {}, sessions: {} };
  });
}

function writeSrt(video, lang, scenes) {
  const ts = s => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
  let at = 0;
  const cues = scenes.flatMap(sc => { const c = sc.lines.map(l => [at + l.t, at + l.t + l.dur, l.text]); at += sc.dur; return c; });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${fileName(video)}.${lang}.srt`), cues.map(([a, b, c], i) => `${i + 1}\n${ts(a)} --> ${ts(b)}\n${c}\n`).join('\n'));
}

// Concurrency 2 was fastest on an M2 Pro: 13 fps against 10 fps at the default 6; more tabs only compete for decoding the recorded clips.
// --vertical renders 1080 x 1920 to out/short-<video>.<lang>.mp4 instead.
function render(video, lang) {
  const mp4 = path.join(OUT, vertical ? `short-${NUMBER[video] ? fileName(video) : video}.${lang}.mp4` : `${fileName(video)}.${lang}.mp4`);
  execFileSync('npx', ['remotion', 'render', 'src/index.jsx', vertical ? 'Vertical' : 'Tutorial', mp4, `--props=${JSON.stringify({ video, lang })}`, `--browser-executable=${CHROME}`, `--concurrency=${process.env.TC_CONCURRENCY || 2}`, '--log=error'], { cwd: REMOTION, stdio: 'inherit' });
  console.log(`${path.relative(process.cwd(), mp4)}  ${duration(mp4).toFixed(1)} s`);
}

// Each GIF scene alone, without captions or sound, then a palette GIF next to the READMEs.
// Scenes that share a name make one GIF together, e.g. a terminal and then the canvas.
function renderGifs(lang) {
  [...new Set(VIDEOS.gifs.map(g => g.name))].forEach(name => {
    const only = VIDEOS.gifs.flatMap((g, i) => (g.name === name ? [i] : []));
    const mp4 = path.join(OUT, `gif-${name}.${lang}.mp4`), gif = path.join(here, '..', `gif-${name}.${lang}.gif`);
    execFileSync('npx', ['remotion', 'render', 'src/index.jsx', 'Tutorial', mp4, `--props=${JSON.stringify({ video: 'gifs', lang, only, bare: true })}`,
      `--browser-executable=${CHROME}`, `--concurrency=${process.env.TC_CONCURRENCY || 2}`, '--muted', '--log=error'], { cwd: REMOTION, stdio: 'inherit' });
    run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-filter_complex',
      'fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', gif]);
    console.log(`${path.relative(process.cwd(), gif)}  ${(fs.statSync(gif).size / 2 ** 20).toFixed(1)} MB, ${duration(gif).toFixed(1)} s`);
  });
}

const args = process.argv.slice(2);
// --render-only: animate the last recordings again, e.g. after changing the Remotion compositions.
const renderOnly = args.includes('--render-only');
const vertical = args.includes('--vertical');
// replay [--session <id>]: the calling session (or that one) from your own map, in your page's language unless en/zh is given.
const replay = args.includes('replay'), lang1 = !args.some(a => a === 'en' || a === 'zh');
let jobs = [];
try {
  if (replay) {
    const { currentSessionId } = await import('../../src/transcript.mjs');
    const i = args.indexOf('--session'), sid = i >= 0 ? args[i + 1] : currentSessionId({ projectDir: process.cwd(), env: REAL_ENV });
    if (!sid) throw new Error('Which session? Pass --session <id>');
    VIDEOS.replay = replayScenes(readData(REAL_ENV), sid);
  }
  const videos = Object.keys(VIDEOS).filter(v => !args.some(a => a in VIDEOS) || args.includes(v));
  const langs = replay && lang1 ? [readConfig(REAL_ENV).lang === 'zh' ? 'zh' : 'en'] : ['en', 'zh'].filter(l => lang1 || args.includes(l));
  jobs = videos.flatMap(v => langs.map(l => [v, l]));
  if (!renderOnly) for (const [v, l] of jobs) await record(v, l);
} finally {
  ws.close();
  chrome.kill();
  await new Promise(r => chrome.once('exit', r));
  server.close();
  // Chrome's helpers may still be writing its profile; a leftover temp folder is no reason to skip the render.
  try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { console.warn(`Left ${home}: ${e.code}`); }
}
for (const [v, l] of jobs) (v === 'gifs' ? renderGifs(l) : render(v, l));
process.exit(0);
