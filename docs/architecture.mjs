// Generates docs/architecture.svg and docs/architecture.zh-CN.svg from one layout.
//   node docs/architecture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'PingFang SC', 'Microsoft YaHei', monospace";
const C = {
  trig: ['#F1F3F6', '#8A94A6'], entry: ['#E8F1FC', '#4A7FC1'], logic: ['#EAF6EE', '#4E9A6A'],
  store: ['#FBF1E3', '#B9853A'], view: ['#F3EEFA', '#8661B5'],
};
const INK = '#1F2933', SUB = '#52606D', FAINT = '#7B8794', LOOP = '#E8590C';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(lang) {
  const P = v => (Array.isArray(v) ? v[lang === 'zh' ? 1 : 0] : v);
  let s = '', bg = '';
  // `backticks` become monospace tspans
  const rich = str => P(str).split('`').map((seg, i) => (i % 2 ? `<tspan font-family="${MONO}" font-size="0.95em">${esc(seg)}</tspan>` : esc(seg))).join('');
  const text = (x, y, str, { size = 11.5, weight = 400, fill = SUB, anchor = 'start', mono = false } = {}) => {
    s += `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${mono ? ` font-family="${MONO}"` : ''}>${rich(str)}</text>\n`;
  };
  const rect = (x, y, w, h, [fill, stroke], { rx = 10, dash = false, sw = 1.5 } = {}) => {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ' stroke-dasharray="4 3"' : ''}/>\n`;
  };
  const box = (x, y, w, h, col, title, lines, { sub = null, lh = 17 } = {}) => {
    rect(x, y, w, h, col);
    text(x + 14, y + 24, title, { size: 14, weight: 700, fill: INK });
    let yy = y + 24;
    if (sub) { yy += 17; text(x + 14, yy, sub, { size: 11, fill: col[1], mono: true }); }
    yy += 6;
    for (const l of lines) { yy += lh; text(x + 14, yy, l); }
  };
  const band = (y, h, label, x2 = 1380) => {
    // bands go in the background layer so arrows crossing them stay visible
    bg += `<rect x="20" y="${y}" width="${x2 - 20}" height="${h}" rx="14" fill="#FAFBFC" stroke="#E3E6EB" stroke-width="1"/>\n`;
    text(36, y + 26, label, { size: 12.5, weight: 700, fill: INK });
  };
  const arrow = (x1, y1, x2, y2, { color = SUB, w = 1.6 } = {}) => {
    s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" marker-end="url(#${color === LOOP ? 'ao' : 'a'})"/>\n`;
  };
  const badge = (x, y, n) => {
    s += `<circle cx="${x}" cy="${y}" r="9" fill="${LOOP}"/>\n`;
    text(x, y + 4, String(n), { size: 11, weight: 700, fill: '#FFFFFF', anchor: 'middle' });
  };
  const small = (x, y, str, o = {}) => text(x, y, str, { size: 10.5, fill: FAINT, ...o });

  // ---------- title ----------
  text(36, 40, ['Trace Canvas — architecture', 'Trace Canvas 架构'], { size: 22, weight: 700, fill: INK });
  text(36, 62, ['Who calls whom, from a Claude Code session to the page. Orange: the live-update loop — ① fs.watchFile (400 ms) ② SSE `change` ③ GET /api/data → re-render.',
    '从 Claude Code 会话到网页，谁调用谁。橙色为实时更新回路：① fs.watchFile（400 ms）② SSE `change` ③ GET /api/data → 重画。'], { size: 12.5 });

  // ---------- 1 who acts ----------
  band(76, 136, ['Who acts', '谁来触发']);
  box(150, 92, 195, 108, C.trig, 'Claude Code', [['hook events:', '钩子事件：'], '`UserPromptSubmit`', '`PostToolUse` · `Stop`', '`SessionEnd`']);
  box(365, 92, 195, 108, C.trig, ['Claude (the model)', 'Claude（模型）'], [['calls the trace_* tools', '自行调用 trace_* 工具，'], ['on its own, or when', '或在你输入'], ['you run /trace-canvas', '/trace-canvas 时调用']]);
  box(580, 92, 195, 108, C.trig, ['Other agents', '其他 agent 与脚本'], [['Codex · scripts · cron', 'Codex · 脚本 · cron'], ['ChatGPT: JSON lines', 'ChatGPT：JSON lines'], '→ `log` / `import`']);
  box(795, 92, 195, 108, C.trig, ['Another computer', '另一台电脑'], [["a workstation's", '工作站的'], ['data.json or an export', 'data.json 或导出文件'], ['→ `import` merges it', '→ 用 `import` 合并']]);
  box(1070, 92, 290, 108, C.trig, ['You', '你'], [['terminal: the CLI', '终端：命令行'], ['browser: the page', '浏览器：网页'], ['Shift-click cards to merge lines', 'Shift 点选卡片即可合并线程']]);

  arrow(255, 200, 255, 248); small(262, 224, 'stdin JSON');
  arrow(500, 200, 500, 248); small(507, 224, ['tool calls', '工具调用']);
  arrow(748, 200, 748, 248); small(755, 224, 'log · import');
  arrow(900, 200, 900, 248); small(907, 224, 'import');
  arrow(1100, 200, 978, 248); small(1106, 222, ['terminal', '终端']);
  arrow(1215, 200, 1215, 264); small(1222, 224, ['browser', '浏览器']);

  // ---------- 2 entry points ----------
  band(228, 188, ['Entry points', '入口'], 1010);
  box(150, 250, 266, 150, C.entry, 'Hooks', [['each event runs', '每个事件运行'], '`trace-canvas hook`', ['async, `|| true`: never blocks', 'async 且 `|| true`：'], ['or breaks a session', '不拖慢、不打断会话']], { sub: '.claude/settings.json' });
  box(436, 250, 266, 150, C.entry, ['MCP server', 'MCP 服务'], [['stdio JSON-RPC · 8 trace_* tools', 'stdio JSON-RPC · 8 个 trace_* 工具'], ['allowed: capture, list,', '免确认：capture、list、'], ['read, log, open', 'read、log、open'], ['asks first: merge, import', '先问你：merge、import']], { sub: 'src/mcp.mjs · .mcp.json' });
  box(722, 250, 266, 150, C.entry, ['CLI', '命令行'], ['`log` · `capture` · `sessions`', '`merge` · `import` · `setup`', '`serve` · `mcp` · `hook`', ['no dependencies, Node ≥ 18.17', '零依赖，Node ≥ 18.17']], { sub: 'bin/trace-canvas.mjs' });

  arrow(250, 400, 250, 450);
  arrow(640, 400, 640, 450);
  arrow(745, 400, 745, 450);
  arrow(890, 400, 890, 450);

  // ---------- 3 logic ----------
  band(432, 190, ['Logic', '逻辑'], 1010);
  box(150, 452, 195, 150, C.logic, 'hook.mjs', [['event → record', '事件 → 记录'], ['per-session state file', '每个会话一个状态文件'], ['dedupe by tool_use_id', '按 tool_use_id 去重'], ['one line per repo@branch', '每个 repo@branch 一条线'], ['new branch → fork', '新分支 → 分叉']]);
  box(365, 452, 195, 150, C.logic, 'git-events.mjs', ['commit · push · merge · PR', ['read from shell commands', '从 shell 命令及其输出'], ['and their output', '中识别出来'], ['`cleanPrompt()` drops', '`cleanPrompt()` 去掉'], ['reminders, notifications', '提醒与后台通知']]);
  box(580, 452, 195, 150, C.logic, 'ops.mjs', ['`captureSession`', ['stable ids → re-runnable', '固定 id，可重复运行'], '`mergeThreads`', ['merge | combine', 'merge 或 combine'], '`mergeDataset`']);
  box(795, 452, 195, 150, C.logic, 'transcript.mjs', [['reads past sessions:', '读取过去的会话：'], '`~/.claude/projects/`', '`  …/<session>.jsonl`', ['→ the same records', '→ 产出与 hooks'], ['the hooks write', '相同的记录']]);
  arrow(347, 527, 363, 527);
  arrow(793, 527, 777, 527);
  rect(34, 556, 100, 42, ['#FFFFFF', C.logic[1]], { rx: 8, sw: 1.2 });
  text(44, 573, 'i18n.mjs', { size: 11, fill: INK, mono: true });
  small(44, 589, ['en / zh text', '中英文文案']);

  // bus: every write goes through mutate()
  s += `<path d="M250 602 V616 H677 M677 602 V616" fill="none" stroke="${SUB}" stroke-width="1.6"/>\n`;
  arrow(400, 616, 400, 656);
  small(410, 633, ['every write: `mutate(fn)`', '所有写入都经过 `mutate(fn)`'], { fill: SUB });

  // ---------- 4 storage ----------
  band(638, 180, ['Storage', '存储'], 1010);
  box(150, 658, 410, 144, C.store, 'store.mjs', [['`mutate(fn)`: one lock for every writer', '`mutate(fn)`：所有写入方共用一把锁'], ['mkdir `.lock` → read → `fn(d)`', 'mkdir `.lock` → 读取 → `fn(d)`'], ['→ write a tmp file → rename (atomic)', '→ 写临时文件 → rename（原子替换）'], ['a lock older than 5 s is cleared', '超过 5 秒的锁视为失效并清除']]);
  arrow(562, 730, 598, 730);
  box(600, 658, 390, 144, C.store, '`~/.trace-canvas/`', [['`data.json`  { threads, commits, edges }', '`data.json`  { threads, commits, edges }'], '`sessions/<id>.json` · `config.json`', ['one JSON file; move it with', '一个 JSON 文件，可用'], ['`TRACE_CANVAS_HOME`', '`TRACE_CANVAS_HOME` 改位置']]);

  // ---------- live view column ----------
  bg += `<rect x="1050" y="228" width="330" height="590" rx="14" fill="#FBF9FE" stroke="#DDD3EE" stroke-width="1"/>\n`;
  text(1066, 254, ['Live view', '实时页面'], { size: 12.5, weight: 700, fill: INK });

  rect(1070, 266, 290, 322, C.view);
  text(1084, 290, '`app/index.html`', { size: 14, weight: 700, fill: INK });
  text(1084, 310, ['one HTML file · views drawn as SVG', '单个 HTML 文件 · 视图用 SVG 绘制']);
  [['Canvas', '画布'], ['Branches', '分支'], ['Timeline', '时间线']].forEach((v, i) => {
    const x = 1084 + i * 88;
    rect(x, 322, 80, 24, ['#FFFFFF', C.view[1]], { rx: 12, sw: 1.2 });
    text(x + 40, 338, v, { size: 12, weight: 600, fill: C.view[1], anchor: 'middle' });
  });
  text(1084, 372, ['data source, chosen at load:', '数据来源（加载时选定）：'], { fill: INK });
  text(1084, 390, ['• local server: fetch + SSE', '• 本地服务：fetch + SSE']);
  text(1084, 407, ['• claude.ai artifact: db `onSnapshot`', '• claude.ai artifact：数据库 `onSnapshot`']);
  text(1084, 424, ['• otherwise: localStorage', '• 其他情况：localStorage']);
  rect(1084, 438, 262, 140, ['#FFFFFF', '#B9A3DA'], { rx: 8, sw: 1.2, dash: true });
  text(1098, 458, ['AI tidy-up', 'AI 梳理'], { size: 12.5, weight: 700, fill: INK });
  text(1098, 476, ['local: `POST /api/ai` → `claude -p`', '本地：`POST /api/ai` → `claude -p`']);
  text(1098, 493, ['(`TRACE_CANVAS_DISABLE=1`)', '（`TRACE_CANVAS_DISABLE=1`）']);
  text(1098, 510, ['in the artifact:', 'artifact 中：']);
  text(1098, 527, '`window.claude.use(\'sample\')`');
  text(1098, 547, ['Claude only suggests; you tick;', 'Claude 只给建议；你勾选，']);
  text(1098, 564, ['the page applies the ticked ones', '页面只执行勾选的项']);

  box(1070, 658, 290, 144, C.view, '`server.mjs`', ['`GET /` · `/api/data` · `/api/events`', '`PUT`·`DELETE /api/docs/…`', '`POST /api/ai` → `claude -p`', ['Host check; writes need the', '检查 Host；写入须带'], ['`X-Trace-Canvas` header', '`X-Trace-Canvas` 请求头']], { sub: '127.0.0.1:4777' });

  // live-update loop
  arrow(992, 700, 1068, 700, { color: LOOP, w: 2 }); badge(1030, 700, '1');
  arrow(1310, 656, 1310, 590, { color: LOOP, w: 2 }); badge(1310, 623, '2');
  small(1296, 627, 'SSE', { fill: LOOP, anchor: 'end' });
  arrow(1120, 590, 1120, 656, { color: LOOP, w: 2 }); badge(1120, 623, '3');
  small(1134, 627, '`GET /api/data`', { fill: LOOP });
  arrow(1068, 770, 992, 770);
  small(1030, 762, ['read / write', '读 / 写'], { anchor: 'middle' });

  // ---------- 5 data model ----------
  band(834, 118, ['Data model', '数据模型']);
  s += `<line x1="170" y1="884" x2="510" y2="884" stroke="#E4002B" stroke-width="4" stroke-linecap="round"/>\n`;
  const st = (x, y, kind) => {
    const c = '#E4002B';
    if (kind === 'idea') s += `<circle cx="${x}" cy="${y}" r="6.5" fill="#FFFFFF" stroke="${c}" stroke-width="2.5"/>`;
    if (kind === 'task') s += `<rect x="${x - 6}" y="${y - 6}" width="12" height="12" fill="#FFFFFF" stroke="${c}" stroke-width="2.5"/>`;
    if (kind === 'agent') s += `<path d="M${x} ${y - 8} L${x + 8} ${y} L${x} ${y + 8} L${x - 8} ${y} Z" fill="${c}"/>`;
    if (kind === 'decision') s += `<circle cx="${x}" cy="${y}" r="7" fill="#FFFFFF" stroke="${c}" stroke-width="2.5"/><circle cx="${x}" cy="${y}" r="3" fill="${c}"/>`;
    if (kind === 'note') s += `<circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`;
    s += '\n';
  };
  const kinds = [['idea', ['idea', '想法']], ['task', ['task', '任务']], ['agent', ['agent output', 'agent 产出']], ['decision', ['decision', '决定']], ['note', ['note', '备注']]];
  kinds.forEach(([k, label], i) => { const x = 195 + i * 75; st(x, 884, k); small(x, 910, label, { anchor: 'middle', fill: SUB }); });
  text(150, 938, ['a thread is a line (≈ git branch); a record is a station (≈ commit)', '线程是一条线（≈ git 分支），记录是一个站点（≈ 提交）'], { size: 11 });

  s += `<line x1="600" y1="900" x2="860" y2="900" stroke="#0072CE" stroke-width="4" stroke-linecap="round"/>\n`;
  s += `<path d="M640 900 C662 900 664 866 688 866 L772 866 C796 866 798 900 820 900" fill="none" stroke="#00A651" stroke-width="4" stroke-linecap="round"/>\n`;
  s += `<path d="M730 858 L738 866 L730 874 L722 866 Z" fill="#00A651"/>\n`;
  for (const x of [640, 820]) s += `<circle cx="${x}" cy="900" r="7" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/>\n`;
  small(640, 922, ['fork', '分叉'], { anchor: 'middle', fill: SUB });
  small(820, 922, ['merge', '合并'], { anchor: 'middle', fill: SUB });
  text(730, 943, ['fork from any record, merge back', '从任一记录分叉，再合并回来'], { size: 11, anchor: 'middle' });

  text(900, 866, ['`threads/<id>`  name, color, status, parent, forkOf, mergedInto, key', '`threads/<id>`  name, color, status, parent, forkOf, mergedInto, key'], { size: 11 });
  text(900, 890, ['`commits/<id>`  thread, kind, title, body, links, agent, ts, parents', '`commits/<id>`  thread, kind, title, body, links, agent, ts, parents'], { size: 11 });
  text(900, 914, ['`edges/<id>`  from, to, label: a link drawn on the canvas', '`edges/<id>`  from, to, label：画布上手动画的连线'], { size: 11 });
  text(900, 938, ['all three live in one file, `data.json`', '三者都存在同一个文件 `data.json` 里'], { size: 11 });

  // ---------- footer ----------
  text(700, 980, ['Zero dependencies · local-first · the server listens on 127.0.0.1 only', '零依赖 · 数据只存在本机 · 服务只监听 127.0.0.1'], { size: 11.5, fill: FAINT, anchor: 'middle' });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="0 0 1400 1000" font-family="${SANS}">
<title>${lang === 'zh' ? 'Trace Canvas 架构' : 'Trace Canvas architecture'}</title>
<defs>
<marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${SUB}"/></marker>
<marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${LOOP}"/></marker>
</defs>
<rect width="1400" height="1000" fill="#FFFFFF"/>
${bg}${s}</svg>
`;
}

fs.writeFileSync(path.join(OUT, 'architecture.svg'), build('en'));
fs.writeFileSync(path.join(OUT, 'architecture.zh-CN.svg'), build('zh'));
console.log('written');
