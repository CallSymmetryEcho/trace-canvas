// Example data for a first look. Every document carries example: true so the
// page can remove them in one click.
const T = {
  en: {
    threads: {
      research: ['Research: AI whiteboards and work-trace tools', 'Find out whether any tool ties scattered ideas and agent work together with a canvas, git-style branches and a timeline'],
      mvp: ['Trace Canvas MVP', 'A version good enough for daily use within a week: canvas, branches and timeline'],
      weekly: ['Q4 weekly report automation', 'Every Friday, roll up progress across all lines'],
      tpl: ['Weekly report template v2', ''],
      interview: ['Customer interview notes', 'Six interviews, find the common pain points'],
    },
    commits: {
      A1: 'Look for a tool that keeps a trace of scattered ideas and agent work',
      A2: 'Claude surveyed related projects: Nimbalyst, Flowith, RabbitHoles, Conductor…',
      A2b: 'Coding: Nimbalyst, Conductor, Vibe Kanban, Claude Squad\nCanvas: Flowith, RabbitHoles, Chorus, tldraw branching chat\nTrace logs: worklog MCP, MCP Work History',
      A3: 'Agent orchestrators all revolve around git worktrees and only serve coding',
      A4: 'Nothing fits exactly, so build an MVP ourselves',
      A4b: 'Canvas + branches + timeline, and agents can write to it directly',
      A5: 'Compare Heptabase and Obsidian Canvas as well',
      B0: 'Forked from Research: Nothing fits exactly, so build an MVP ourselves',
      B1: 'Use a transit map metaphor: threads are lines, records are stations',
      B2: 'Canvas view: drag cards, connect threads',
      B3: 'Branch view: a time-ordered git graph',
      B4: 'Timeline view done, with day / week / month scales',
      B5: 'Let agents write traces straight into the store',
      C1: 'Roll up every line into a weekly report each Friday',
      C2: 'Claude drafted the weekly report from this week’s sessions',
      C3: 'The draft is too long; the reader only wants outcomes and risks',
      D0: 'Forked from Q4 weekly report automation: the draft is too long',
      D1: 'ChatGPT proposed three templates: outcome-first, risk list, data board',
      D2: 'Go with outcome-first, one sentence per line of work',
      C4: 'Merged Weekly report template v2',
      C5: 'Send the week 43 report before Friday 17:00',
      E1: 'Clean up six customer interview recordings',
      E2: 'Claude transcribed the first three and pulled out pain points',
      E2b: 'Common thread: information is scattered across tools and context gets lost',
      I1: 'Meeting notes could be stations on a thread too',
      I2: 'Have agents attach the session link when they write, for easy lookup',
      I3: 'Export in JSON Canvas format so Obsidian can open it',
      dep: 'depends on', ref: 'references', me: 'me',
    },
  },
  zh: {
    threads: {
      research: ['竞品调研：AI 白板与留痕工具', '弄清市面上有没有把零碎想法、agent 工作用 canvas + git + timeline 串起来的工具'],
      mvp: ['留痕工具 MVP', '一周内做出能日常使用的版本：画布、分支、时间线三个视图'],
      weekly: ['Q4 周报自动化', '每周五自动汇总各条线的进展'],
      tpl: ['周报模板 v2', ''],
      interview: ['客户访谈整理', '6 场访谈，提炼共性痛点'],
    },
    commits: {
      A1: '调研有没有能把零碎想法和 agent 工作留痕的工具',
      A2: 'Claude 汇总了相关项目：Nimbalyst、Flowith、RabbitHoles、Conductor…',
      A2b: '编码类：Nimbalyst、Conductor、Vibe Kanban、Claude Squad\n画布类：Flowith、RabbitHoles、Chorus、tldraw 分支对话模板\n留痕类：worklog MCP、MCP Work History',
      A3: '编排器都围绕 git worktree，只服务写代码，不覆盖日常办公',
      A4: '没有完全对口的产品，先自己做一个 MVP',
      A4b: '画布 + 分支 + 时间线三个视图，agent 能直接写入',
      A5: '补充对比 Heptabase 与 Obsidian Canvas',
      B0: '从「竞品调研」分叉：没有完全对口的产品，先自己做一个 MVP',
      B1: '用地铁线路图做隐喻：线程是线路，记录是站点',
      B2: '画布视图：拖拽卡片、线程之间连线',
      B3: '分支视图：按时间排列的 git graph',
      B4: '时间线视图完成，支持日 / 周 / 月三种刻度',
      B5: '让 agent 直接写入留痕',
      C1: '每周五自动把各条线的进展汇总成周报',
      C2: 'Claude 根据本周的会话记录生成了周报初稿',
      C3: '初稿太长，领导只想看结论和风险',
      D0: '从「Q4 周报自动化」分叉：初稿太长',
      D1: 'ChatGPT 给了三版模板：结论先行、风险清单、数据看板',
      D2: '选「结论先行」版，每条线只写一句进展',
      C4: '合并「周报模板 v2」',
      C5: '周五 17:00 前发出第 43 周周报',
      E1: '整理 6 场客户访谈录音',
      E2: 'Claude 转写并提炼了前 3 场的痛点',
      E2b: '共性：信息散落在多个工具里，回头找不到上下文',
      I1: '会议纪要也可以当成一条线程上的站点',
      I2: 'agent 写入时顺手带上会话链接，方便回溯',
      I3: '导出时兼容 JSON Canvas 格式，Obsidian 也能打开',
      dep: '依赖', ref: '参考', me: '自己',
    },
  },
};

export function demoData(lang = 'en', now = Date.now()) {
  const L = T[lang] || T.en, c = L.commits;
  const h = n => now - n * 3600e3;
  const th = (id, key, color, status, created, x, y, parent = null, forkOf = null, mergedInto = null) =>
    ({ id, name: L.threads[key][0], note: L.threads[key][1], color, status, createdAt: h(created), parent, forkOf, mergedInto, x, y, example: true });
  const threads = [
    th('ex_research', 'research', '#0072CE', 'active', 216, 300, 0),
    th('ex_mvp', 'mvp', '#E4002B', 'active', 169, 600, 0, 'ex_research', 'exA4'),
    th('ex_weekly', 'weekly', '#00A651', 'active', 140, 300, 300),
    th('ex_tpl', 'tpl', '#F29F05', 'merged', 97, 600, 300, 'ex_weekly', 'exC3', 'ex_weekly'),
    th('ex_interview', 'interview', '#8E3A96', 'parked', 200, 0, 300),
  ];
  // [id, thread, kind, title, hoursAgo, agent, body, links, parents, done, extra]
  const raw = [
    ['exA1', 'ex_research', 'idea', c.A1, 216, c.me],
    ['exA2', 'ex_research', 'agent', c.A2, 214, 'Claude', c.A2b, ['https://tldraw.dev/starter-kits/branching-chat']],
    ['exA3', 'ex_research', 'note', c.A3, 190],
    ['exA4', 'ex_research', 'decision', c.A4, 170, '', c.A4b],
    ['exA5', 'ex_research', 'task', c.A5, 60],
    ['exB0', 'ex_mvp', 'fork', c.B0, 169, '', '', [], ['exA4']],
    ['exB1', 'ex_mvp', 'decision', c.B1, 150],
    ['exB2', 'ex_mvp', 'task', c.B2, 120, 'Claude Code', '', [], null, true],
    ['exB3', 'ex_mvp', 'task', c.B3, 96, 'Claude Code', '', [], null, true],
    ['exB4', 'ex_mvp', 'agent', c.B4, 30, 'Claude Code'],
    ['exB5', 'ex_mvp', 'task', c.B5, 5],
    ['exC1', 'ex_weekly', 'idea', c.C1, 140, c.me],
    ['exC2', 'ex_weekly', 'agent', c.C2, 100, 'Claude'],
    ['exC3', 'ex_weekly', 'note', c.C3, 98],
    ['exD0', 'ex_tpl', 'fork', c.D0, 97, '', '', [], ['exC3']],
    ['exD1', 'ex_tpl', 'agent', c.D1, 80, 'ChatGPT'],
    ['exD2', 'ex_tpl', 'decision', c.D2, 50],
    ['exC4', 'ex_weekly', 'merge', c.C4, 20, '', '', [], ['exC3', 'exD2'], false, { mergeOf: 'ex_tpl' }],
    ['exC5', 'ex_weekly', 'task', c.C5, 2],
    ['exE1', 'ex_interview', 'task', c.E1, 200],
    ['exE2', 'ex_interview', 'agent', c.E2, 180, 'Claude', c.E2b],
    ['exI1', 'inbox', 'idea', c.I1, 40, c.me],
    ['exI2', 'inbox', 'idea', c.I2, 8, c.me],
    ['exI3', 'inbox', 'note', c.I3, 3, '', '', ['https://jsoncanvas.org']],
  ];
  const last = {};
  const commits = raw.map(([id, thread, kind, title, hrs, agent = '', body = '', links = [], parents = null, done = false, extra = {}]) => {
    const doc = { id, thread, kind, title, body, links, agent, ts: h(hrs), parents: parents || (last[thread] ? [last[thread]] : []), done, example: true, ...extra };
    last[thread] = id;
    return doc;
  });
  const edges = [
    { id: 'ex_e1', from: 'ex_weekly', to: 'ex_mvp', label: c.dep, createdAt: h(90), example: true },
    { id: 'ex_e2', from: 'ex_interview', to: 'ex_research', label: c.ref, createdAt: h(150), example: true },
  ];
  return { threads, commits, edges };
}
