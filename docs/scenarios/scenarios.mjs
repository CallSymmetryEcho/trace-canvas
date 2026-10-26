#!/usr/bin/env node
// Fake-data scenarios for the docs. Each one is a complete data.json that shows what
// Trace Canvas is for. Every person, company, repository and session here is made up.
//   node docs/scenarios/scenarios.mjs <vibe|life|agents> <en|zh> > data.json
// Records carry example: true, so "Clear examples" on the page removes them.
import { fileURLToPath } from 'node:url';
import { tr } from '../../src/i18n.mjs';

const resume = id => `claude --resume ${id}`;
const commit = (sha, subject) => l => tr(l, 'commit', sha, subject);
const ended = (...a) => l => tr(l, 'sessionEnd', ...a);
const forked = (branch, parent) => l => tr(l, 'branchedFrom', branch, parent);
const merged = src => l => tr(l, 'merged', pick(src, l));
const D = 24; // hours per day, for readability below
const LD = 24 * 0.6; // the grad-school scenario squeezes a month into three weeks so the timeline shows it all

// Thread: [id, name, color, status, x, y, extra]
// Record: [id, thread, kind, hoursAgo, title, { agent, body, links, parents, done, mergeOf }]
// name/title/body: 'text', [en, zh] or lang => text.
export const SCENARIOS = {
  // One weekend, one repository, four agent sessions running in parallel.
  vibe: {
    threads: [
      ['main', 'tripsplit', '#E4002B', 'active', 300, 0, { key: 'tripsplit', note: ['Trip expense splitter: Next.js + SQLite', '出游分账网页应用：Next.js + SQLite'] }],
      ['auth', 'tripsplit · auth', '#0072CE', 'merged', 600, -250, { key: 'tripsplit@auth', parent: 'main', forkOf: 'm4', mergedInto: 'main' }],
      ['ocr', 'tripsplit · receipt-ocr', '#F29F05', 'parked', 600, 250, { key: 'tripsplit@receipt-ocr', parent: 'main', forkOf: 'm4' }],
      ['ui', 'tripsplit · ui-polish', '#00A651', 'merged', 900, -250, { key: 'tripsplit@ui-polish', parent: 'main', forkOf: 'm4', mergedInto: 'main' }],
      ['fix', 'tripsplit · fix-rounding', '#8E3A96', 'merged', 900, 250, { key: 'tripsplit@fix-rounding', parent: 'main', forkOf: 'm6', mergedInto: 'main' }],
    ],
    records: [
      ['m1', 'main', 'task', 70, ['Build a web app that splits trip expenses among friends: Next.js, SQLite, deploy on Vercel', '做一个朋友出游分账的网页应用：Next.js + SQLite，部署到 Vercel'], { agent: 'Claude Code', links: [resume('7f3b2c1e')] }],
      ['m2', 'main', 'agent', 69, ['Scaffolded the app: expenses table, trip page and a balance page', '搭好了项目骨架：账单表、行程页和结余页'], { agent: 'Claude Code', body: ['Files changed:\n- app/trips/[id]/page.tsx\n- app/balance/page.tsx\n- db/schema.sql', '改动的文件：\n- app/trips/[id]/page.tsx\n- app/balance/page.tsx\n- db/schema.sql'] }],
      ['m3', 'main', 'agent', 68.5, commit('a1c3e9f', 'Scaffold app, expenses schema and balance page'), { agent: 'Claude Code' }],
      ['m4', 'main', 'decision', 66, ['Run auth, receipt OCR and UI polish as three parallel sessions, one worktree each', '鉴权、小票识别、界面打磨拆成三个并行会话，各用一个 worktree'], { agent: 'me' }],
      ['m5', 'main', 'note', 65.5, ended(52, 7, 11, 2), { agent: 'Claude Code', links: [resume('7f3b2c1e')] }],
      ['a0', 'auth', 'fork', 65, forked('auth', 'tripsplit'), { agent: 'Claude Code', parents: ['m4'] }],
      ['a1', 'auth', 'agent', 64, ['Magic-link sign-in with NextAuth; sessions stored in SQLite', '用 NextAuth 做了邮箱魔法链接登录，会话存在 SQLite'], { agent: 'Claude Code', links: [resume('c08d41aa')] }],
      ['a2', 'auth', 'decision', 60, ['No passwords at all: magic links only', '不做密码登录，只用邮箱魔法链接'], { agent: 'me', body: ['Fewer screens, nothing to leak, friends already share an email thread.', '页面更少，没有密码可泄露，朋友们本来就在一个邮件群里。'] }],
      ['a3', 'auth', 'agent', 59, commit('5d2e7b0', 'Magic-link sign-in'), { agent: 'Claude Code' }],
      ['a4', 'auth', 'decision', 58, l => tr(l, 'prOpened', 12), { agent: 'Claude Code', links: ['https://github.com/example/tripsplit/pull/12'] }],
      ['a5', 'auth', 'note', 57.5, ended(38, 5, 6, 2), { agent: 'Claude Code', links: [resume('c08d41aa')] }],
      ['r0', 'ocr', 'fork', 64.5, forked('receipt-ocr', 'tripsplit'), { agent: 'Codex', parents: ['m4'] }],
      ['r1', 'ocr', 'agent', 63, ['Tesseract pipeline reads the total from a receipt photo', '用 Tesseract 从小票照片里读出总金额'], { agent: 'Codex' }],
      ['r2', 'ocr', 'note', 50, ['Only 71% of totals right on blurry phone photos', '模糊的手机照片只有 71% 的总额识别正确'], { agent: 'Codex', body: ['Test set: 120 receipts from 4 trips. Failures cluster on thermal paper and tilted shots.', '测试集：4 次旅行的 120 张小票。错误集中在热敏纸和拍歪的照片上。'] }],
      ['r3', 'ocr', 'agent', 48, ['Deskewing first: 74%, still not good enough', '先做倾斜校正：74%，仍然不够'], { agent: 'Codex' }],
      ['r4', 'ocr', 'task', 47, ['Try a vision model instead of Tesseract', '改用视觉模型代替 Tesseract 试试'], {}],
      ['u0', 'ui', 'fork', 62, forked('ui-polish', 'tripsplit'), { agent: 'Claude Code', parents: ['m4'] }],
      ['u1', 'ui', 'agent', 61, ['Mobile layout for the balance page and a settle-up sheet', '结余页的手机布局和"结清"弹窗'], { agent: 'Claude Code', links: [resume('e91f0b37')] }],
      ['u2', 'ui', 'decision', 31, ['Show who owes whom as arrows, not as a table', '用箭头显示谁欠谁，不用表格'], { agent: 'me' }],
      ['u3', 'ui', 'agent', 30, commit('9b41c2d', 'Mobile layout and settle-up arrows'), { agent: 'Claude Code' }],
      ['u4', 'ui', 'note', 29.5, ended(64, 9, 14, 3), { agent: 'Claude Code', links: [resume('e91f0b37')] }],
      ['m6', 'main', 'merge', 40, merged('tripsplit · auth'), { agent: 'Claude Code', mergeOf: 'auth' }],
      ['f0', 'fix', 'fork', 26.5, forked('fix-rounding', 'tripsplit'), { agent: 'Claude Code', parents: ['m6'] }],
      ['f1', 'fix', 'note', 26, ['Balances are off by one cent when 3 people split €10', '三人分 10 欧元时余额差 1 分钱'], { agent: 'me' }],
      ['f2', 'fix', 'decision', 25, ['Store amounts as integer cents; the leftover cent goes to the payer', '金额一律存整数分，多出的 1 分归付款人'], { agent: 'Claude Code' }],
      ['f3', 'fix', 'agent', 24, commit('e07a5f3', 'Integer cents; leftover cent to the payer'), { agent: 'Claude Code' }],
      ['f4', 'fix', 'agent', 23, ['40 property-based tests for splitting now pass', '分账逻辑的 40 个性质测试全部通过'], { agent: 'Claude Code', links: [resume('3aa95c60')] }],
      ['m7', 'main', 'merge', 20, merged('tripsplit · fix-rounding'), { agent: 'Claude Code', mergeOf: 'fix' }],
      ['m8', 'main', 'merge', 8, merged('tripsplit · ui-polish'), { agent: 'Claude Code', mergeOf: 'ui' }],
      ['m9', 'main', 'note', 7.5, l => tr(l, 'pushed', 'main'), { agent: 'Claude Code' }],
      ['m10', 'main', 'decision', 6, ['Ship v0.1 without receipt OCR; park it until a vision model is tried', 'v0.1 先不带小票识别发布；等试过视觉模型再说'], { agent: 'me' }],
      ['m11', 'main', 'task', 1, ['Invite three friends to test it with last month’s ski trip', '邀请三位朋友用上个月滑雪旅行的账单试用'], { agent: 'me' }],
      ['i1', 'inbox', 'idea', 44, ['Export a trip as CSV for the spreadsheet people', '导出 CSV，照顾习惯用表格的朋友'], { agent: 'me' }],
      ['i2', 'inbox', 'idea', 10, ['Currency conversion with daily ECB rates', '按欧洲央行每日汇率自动换算币种'], { agent: 'me' }],
      ['i3', 'inbox', 'idea', 3, ['Dark mode', '深色模式'], { agent: 'me' }],
    ],
    edges: [['ocr', 'main', ['planned for v0.2', '计划进 v0.2']]],
  },

  // A month of a PhD student's life: six lines of work, one of them waiting on a microscope.
  life: {
    threads: [
      ['thesis', ['Thesis chapter 3: methods', '论文第 3 章：方法'], '#0072CE', 'active', 340, 0, { note: ['Methods for the particle-tracking pipeline', '粒子追踪流程的方法部分'] }],
      ['exam', ['Qualifying exam', '资格考试'], '#E4002B', 'done', 720, 0, {}],
      ['jobs', ['Job applications', '求职'], '#8E3A96', 'active', 1100, 0, { note: ['Robotics, sensing, ML for materials', '机器人、传感、材料方向的机器学习'] }],
      ['lab', ['Lab: particle tracking at three field strengths', '实验：三种场强下的粒子追踪'], '#00A651', 'parked', 340, 300, {}],
      ['lit', ['Literature review: active matter', '文献综述：活性物质'], '#F29F05', 'active', 720, 300, {}],
      ['weekly', ['Progress updates to advisor', '给导师的进展汇报'], '#00A0B0', 'active', 1100, 300, {}],
    ],
    records: [
      ['r1', 'lit', 'task', 31 * LD, ['Read the 15 most-cited active matter reviews', '读完引用最多的 15 篇活性物质综述'], { agent: 'me' }],
      ['r2', 'lit', 'agent', 30 * LD, ['Summarized the 15 reviews into one comparison table', '把 15 篇综述整理成一张对比表'], { agent: 'ChatGPT', body: ['Imported from a ChatGPT answer that ended in JSON lines.', '来自一段以 JSON lines 结尾的 ChatGPT 回答，直接粘贴导入。'] }],
      ['t1', 'thesis', 'task', 30 * LD, ['Write chapter 3: methods for the tracking pipeline', '写第 3 章：追踪流程的方法'], { agent: 'me' }],
      ['q1', 'exam', 'task', 32 * LD, ['Book a room and send the committee a date poll', '预约教室，给委员会发时间投票'], { agent: 'me' }],
      ['q2', 'exam', 'agent', 29 * LD, ['Drafted 40 likely committee questions with short answers', '整理了 40 个委员会可能问的问题和简答'], { agent: 'Claude' }],
      ['l1', 'lab', 'task', 28 * LD, ['Track 50 particles at each of three field strengths', '每种场强追踪 50 个粒子'], { agent: 'me' }],
      ['l2', 'lab', 'agent', 27 * LD, ['Tracking script: 50 particles per video, CSV out', '追踪脚本：每段视频 50 个粒子，输出 CSV'], { agent: 'Codex' }],
      ['w1', 'weekly', 'agent', 28 * LD, ['Update 1: exam date set, tracking script works', '汇报 1：考试日期定了，追踪脚本可用'], { agent: 'Claude', body: ['Drafted from the records on the canvas since the last update.', '根据画布上自上次汇报以来的记录起草。'] }],
      ['t2', 'thesis', 'agent', 27 * LD, ['Draft of 3.1–3.3 from the lab notebook, 4,200 words', '根据实验记录起草了 3.1–3.3，约 4200 字'], { agent: 'Claude Code', links: [resume('5b7e0d92')] }],
      ['j1', 'jobs', 'task', 26 * LD, ['Shortlist 10 roles: robotics, sensing, ML for materials', '筛出 10 个职位：机器人、传感、材料机器学习'], { agent: 'me' }],
      ['j2', 'jobs', 'agent', 25 * LD, ['CV variant for sensing roles', '针对传感岗位的简历版本'], { agent: 'Claude Code' }],
      ['q3', 'exam', 'decision', 24 * LD, ['Talk opens with the open question, results second', '报告先讲核心问题，再讲结果'], { agent: 'me' }],
      ['l3', 'lab', 'note', 22 * LD, ['Third field strength drifts; suspect stage heating', '第三种场强有漂移，怀疑是载物台发热'], { agent: 'me' }],
      ['t3', 'thesis', 'note', 21 * LD, ['Advisor: merge 3.2 and 3.3, move calibration to an appendix', '导师意见：3.2 和 3.3 合并，校准移到附录'], { agent: 'me' }],
      ['w2', 'weekly', 'agent', 21 * LD, ['Update 2: chapter 3 draft out, drift found in the lab', '汇报 2：第 3 章初稿完成，实验发现漂移'], { agent: 'Claude' }],
      ['q4', 'exam', 'agent', 20 * LD, ['Built the 30-slide deck from the thesis figures', '用论文里的图做了 30 页幻灯片'], { agent: 'Claude Code' }],
      ['r3', 'lit', 'idea', 19 * LD, ['Our tracking error bars could be a short methods paper', '我们的追踪误差分析可以单独写一篇方法短文'], { agent: 'me' }],
      ['j3', 'jobs', 'agent', 18 * LD, ['Submitted: Acme Robotics, Perception Engineer', '已投递：Acme Robotics，感知工程师'], { agent: 'me' }],
      ['q5', 'exam', 'note', 17 * LD, ['Mock talk with labmates: cut 6 slides, slow down on slide 12', '组内试讲：删 6 页，第 12 页讲慢一点'], { agent: 'me' }],
      ['j4', 'jobs', 'agent', 15 * LD, ['Submitted: Northwind Labs, Materials ML Scientist', '已投递：Northwind Labs，材料机器学习科学家'], { agent: 'me' }],
      ['l4', 'lab', 'note', 14 * LD, ['Microscope booked out until next month: line parked', '显微镜下个月前都被约满了：这条线先暂停'], { agent: 'me' }],
      ['w3', 'weekly', 'agent', 14 * LD, ['Update 3: exam next week, lab paused', '汇报 3：下周考试，实验暂停'], { agent: 'Claude' }],
      ['q6', 'exam', 'decision', 13 * LD, ['Passed. Committee asks for a control experiment in chapter 3', '通过。委员会要求第 3 章补一个对照实验'], { agent: 'me', done: true }],
      ['t4', 'thesis', 'task', 12 * LD, ['Add the control experiment the committee asked for', '补上委员会要求的对照实验'], { agent: 'me' }],
      ['r4', 'lit', 'agent', 10 * LD, ['Found 3 papers with the same calibration; cited in 3.2', '找到 3 篇用同样校准方法的论文，已在 3.2 引用'], { agent: 'Claude' }],
      ['j5', 'jobs', 'note', 9 * LD, ['Acme Robotics: recruiter call on Thursday', 'Acme Robotics：周四和招聘方通电话'], { agent: 'me' }],
      ['w4', 'weekly', 'agent', 7 * LD, ['Update 4: exam passed, control experiment planned', '汇报 4：考试通过，对照实验已排期'], { agent: 'Claude' }],
      ['t5', 'thesis', 'agent', 6 * LD, ['Rewrote 3.2; calibration moved to Appendix B', '重写 3.2，校准移到附录 B'], { agent: 'Claude Code', links: [resume('91c4fa03')] }],
      ['r5', 'lit', 'task', 3 * LD, ['Add 2024–2025 papers to the table', '把 2024–2025 年的论文补进对比表'], { agent: 'me' }],
      ['j6', 'jobs', 'task', 2 * LD, ['Follow up with Northwind if there is no reply this week', '本周没回音就跟进 Northwind'], { agent: 'me' }],
      ['j7', 'jobs', 'decision', 1 * LD, ['Prioritize roles that use the thesis work directly', '优先能直接用上论文工作的职位'], { agent: 'me' }],
      ['t6', 'thesis', 'task', 0.8 * LD, ['Send the revised chapter 3 to the advisor by Friday', '周五前把修改后的第 3 章发给导师'], { agent: 'me' }],
      ['w5', 'weekly', 'agent', 0.3 * LD, ['Update 5: chapter 3 revised, two applications pending', '汇报 5：第 3 章已修改，两份申请在等回复'], { agent: 'Claude' }],
      ['i1', 'inbox', 'idea', 16 * LD, ['Ask the microscope core about weekend slots', '问问显微镜平台有没有周末时段'], { agent: 'me' }],
      ['i2', 'inbox', 'idea', 5 * LD, ['A tiny GUI for the tracking script, for the undergrad', '给本科生做个追踪脚本的小界面'], { agent: 'me' }],
      ['i3', 'inbox', 'note', 1 * LD, ['Conference abstract deadline in three weeks', '会议摘要截止还有三周'], { agent: 'me' }],
    ],
    edges: [['lit', 'thesis', ['cited in', '被引用']], ['lab', 'thesis', ['data for', '提供数据']], ['exam', 'thesis', ['feeds into', '要求补充']]],
  },

  // One piece of work spread over three agents and two computers, merged back into one line.
  agents: {
    threads: [
      ['target', ['Survey analysis', '问卷分析'], '#0072CE', 'active', 600, 0, { note: ['How 400 lab users rate the booking system', '400 名实验室用户如何评价预约系统'] }],
      ['laptop', ['Survey analysis · laptop session', '问卷分析 · 笔记本会话'], '#E4002B', 'merged', 300, -250, { key: 'session:4c1d7e20', mergedInto: 'target' }],
      ['ws', ['Survey analysis · workstation session', '问卷分析 · 工作站会话'], '#00A651', 'merged', 300, 250, { key: 'session:a93f5b18', mergedInto: 'target' }],
      ['gpt', ['Survey literature · ChatGPT', '问卷文献 · ChatGPT'], '#F29F05', 'merged', 900, -250, { mergedInto: 'target' }],
      ['cron', ['Nightly data checks', '每晚数据检查'], '#5B6B7F', 'active', 900, 250, { note: ['cron job on the workstation, logs with trace-canvas log', '工作站上的定时任务，用 trace-canvas log 留痕'] }],
    ],
    records: [
      ['t0', 'target', 'task', 9 * D, ['Find out what users dislike about the booking system, with numbers', '用数据说明用户不满意预约系统的哪些地方'], { agent: 'me' }],
      ['p1', 'laptop', 'task', 8.8 * D, ['Clean the survey export and code the free-text answers', '清洗问卷导出数据，给开放题编码'], { agent: 'Claude Code', links: [resume('4c1d7e20')] }],
      ['p2', 'laptop', 'agent', 8.6 * D, ['412 responses kept, 37 dropped as duplicates; 9 codes for free text', '保留 412 份，去重删掉 37 份；开放题分成 9 类'], { agent: 'Claude Code' }],
      ['p3', 'laptop', 'decision', 8.5 * D, ['Codes are drafted by Claude and checked by hand on a 20% sample', '编码由 Claude 起草，人工抽查 20%'], { agent: 'me' }],
      ['p4', 'laptop', 'agent', 8.4 * D, commit('2f6a913', 'Cleaning script and codebook'), { agent: 'Claude Code' }],
      ['p5', 'laptop', 'note', 8.3 * D, ended(71, 8, 5, 1), { agent: 'Claude Code', links: [resume('4c1d7e20')] }],
      ['g1', 'gpt', 'agent', 7.5 * D, ['Five validated usability scales compared (SUS, UMUX, …)', '对比了五种经过验证的可用性量表（SUS、UMUX…）'], { agent: 'ChatGPT', body: ['Pasted into the page as JSON lines.', '以 JSON lines 粘贴进页面。'] }],
      ['g2', 'gpt', 'decision', 7.4 * D, ['Report SUS so results compare with other labs', '采用 SUS，方便和其他实验室比较'], { agent: 'ChatGPT' }],
      ['c1', 'cron', 'agent', 7 * D, ['nightly-check.sh: 6 new responses, 0 schema errors', 'nightly-check.sh：新增 6 份，0 个格式错误'], { agent: 'cron' }],
      ['w1', 'ws', 'task', 6 * D, ['Fit the regression on the GPU workstation', '在 GPU 工作站上跑回归'], { agent: 'Claude Code', links: [resume('a93f5b18')] }],
      ['w2', 'ws', 'agent', 5.8 * D, ['Wait time explains most dissatisfaction (β = 0.48); UI explains little', '等待时间解释了大部分不满（β = 0.48），界面影响很小'], { agent: 'Claude Code', body: ['Ordinal logistic regression, 412 responses, 5 predictors.', '有序 logistic 回归，412 份问卷，5 个自变量。'] }],
      ['w3', 'ws', 'agent', 5.7 * D, commit('b81c4e2', 'Regression notebook and figures'), { agent: 'Claude Code' }],
      ['w4', 'ws', 'note', 5.6 * D, ['Imported from the workstation: trace-canvas import data.json', '从工作站导入：trace-canvas import data.json'], { agent: 'me' }],
      ['c2', 'cron', 'agent', 5 * D, ['nightly-check.sh: 4 new responses, 1 missing field fixed', 'nightly-check.sh：新增 4 份，修复 1 个缺失字段'], { agent: 'cron' }],
      ['t1', 'target', 'merge', 4 * D, merged(['Survey analysis · laptop session', '问卷分析 · 笔记本会话']), { agent: 'Claude Code', mergeOf: 'laptop' }],
      ['t2', 'target', 'merge', 3.9 * D, merged(['Survey literature · ChatGPT', '问卷文献 · ChatGPT']), { agent: 'Claude Code', mergeOf: 'gpt' }],
      ['t3', 'target', 'merge', 3.8 * D, merged(['Survey analysis · workstation session', '问卷分析 · 工作站会话']), { agent: 'Claude Code', mergeOf: 'ws' }],
      ['t4', 'target', 'decision', 3 * D, ['Headline finding: cut wait time first, redesign the UI later', '核心结论：先缩短等待时间，界面改版往后放'], { agent: 'me' }],
      ['t5', 'target', 'agent', 2 * D, ['Two-page summary for the facility manager, every number linked to its record', '给平台负责人的两页总结，每个数字都能追溯到记录'], { agent: 'Claude Code', links: [resume('d27a6c51')] }],
      ['c3', 'cron', 'agent', 1 * D, ['nightly-check.sh: 3 new responses, 0 schema errors', 'nightly-check.sh：新增 3 份，0 个格式错误'], { agent: 'cron' }],
      ['t6', 'target', 'task', 0.5 * D, ['Present to the facility committee on Monday', '周一向平台委员会汇报'], { agent: 'me' }],
    ],
    edges: [['cron', 'target', ['feeds', '提供数据']]],
  },
};

const pick = (v, lang) => typeof v === 'function' ? pick(v(lang), lang) : Array.isArray(v) ? (lang === 'zh' ? v[1] : v[0]) : v || '';

export function scenarioData(name, lang = 'en', now = Date.now()) {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`unknown scenario ${name}; try ${Object.keys(SCENARIOS).join(', ')}`);
  const ts = h => Math.round(now - h * 3600e3);
  const me = lang === 'zh' ? '自己' : 'me';
  const d = { version: 1, threads: {}, commits: {}, edges: {} };
  for (const [id, name, color, status, x, y, ex] of s.threads) {
    d.threads[`sc_${id}`] = { id: `sc_${id}`, name: pick(name, lang), color, status, x, y, note: pick(ex.note, lang),
      parent: ex.parent ? `sc_${ex.parent}` : null, forkOf: ex.forkOf ? `sc_${ex.forkOf}` : null,
      mergedInto: ex.mergedInto ? `sc_${ex.mergedInto}` : null, ...(ex.key ? { key: ex.key } : {}), example: true };
  }
  // Records in time order, so each one's parent is the previous record on its line.
  const last = {};
  for (const [id, thread, kind, hrs, title, o] of [...s.records].sort((a, b) => b[3] - a[3])) {
    const tid = thread === 'inbox' ? 'inbox' : `sc_${thread}`;
    const parents = o.parents ? o.parents.map(p => `sc_${p}`)
      : o.mergeOf ? [last[tid], last[`sc_${o.mergeOf}`]].filter(Boolean)
      : last[tid] ? [last[tid]] : [];
    d.commits[`sc_${id}`] = { id: `sc_${id}`, thread: tid, kind, title: pick(title, lang), body: pick(o.body, lang),
      links: o.links || [], agent: o.agent === 'me' ? me : o.agent || '', ts: ts(hrs), parents, done: !!o.done,
      ...(o.mergeOf ? { mergeOf: `sc_${o.mergeOf}` } : {}), example: true };
    last[tid] = `sc_${id}`;
    const t = d.threads[tid];
    if (t && !t.createdAt) t.createdAt = ts(hrs);
  }
  s.edges.forEach(([from, to, label], i) => { d.edges[`sc_e${i}`] = { id: `sc_e${i}`, from: `sc_${from}`, to: `sc_${to}`, label: pick(label, lang), createdAt: now, example: true }; });
  return d;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [name, lang = 'en'] = process.argv.slice(2);
  process.stdout.write(JSON.stringify(scenarioData(name, lang)));
}
