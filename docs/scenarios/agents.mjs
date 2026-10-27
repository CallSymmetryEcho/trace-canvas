#!/usr/bin/env node
// Made-up running sessions for the agent view: a session that started two others (one of
// which started a third), subagents in several states, an idle session on its own, and a
// parent that is no longer running. Written with the same updateLive() the hooks use, plus
// fake desktop-app records for "who started whom". Pairs with the `vibe` scenario's threads.
//   node docs/scenarios/agents.mjs <data dir> <desktop dir> [en|zh]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateLive } from '../../src/live.mjs';

const L = (en, zh) => ({ en, zh });
const M = 60e3;
// [id, title, parent, repo/branch, thread key, events]
const SESSIONS = [
  ['weekend', L('Weekend sprint: plan', '周末冲刺：总体规划'), null, null, null, null],
  ['release', L('Plan the v0.2 release', '规划 v0.2 发布'), 'weekend', 'main', 'tripsplit', [
    ['UserPromptSubmit', 50, { prompt: L('Split v0.2 into receipt OCR and the launch post, one session each', '把 v0.2 拆成小票识别和发布文章，各开一个会话') }],
    ['PreToolUse', 1, { tool_name: 'mcp__ccd_session__start_session', tool_input: { description: L('Write the launch post', '写发布文章') } }],
  ]],
  ['ocr', L('Receipt OCR with a vision model', '用视觉模型做小票识别'), 'release', 'receipt-ocr', 'tripsplit@receipt-ocr', [
    ['PreToolUse', 3, { tool_name: 'Bash', tool_input: { command: 'python eval_receipts.py --model vision --set blurry' } }],
    ['Notification', 1, { notification_type: 'permission_prompt', message: L('Claude needs your permission to use Bash', 'Claude 需要你批准使用 Bash') }],
  ], [
    ['a-survey', 'Explore', L('Survey vision OCR APIs and their prices', '调研视觉 OCR 接口和价格'), 30, 22, L('Three options fit; the cheapest reads totals at 94%.', '有三个可选，最便宜的总额识别率 94%。')],
    ['a-bench', 'general-purpose', L('Benchmark 120 receipts from 4 trips', '用 4 次旅行的 120 张小票做基准测试'), 8, null],
  ]],
  ['post', L('Write the launch post', '写发布文章'), 'release', 'main', 'tripsplit', [
    ['PreToolUse', 1, { tool_name: 'Edit', tool_input: { file_path: '/Users/dev/tripsplit/blog/launch-v0.2.md' } }],
  ], [
    ['a-heads', 'fork', L('Draft three headline options', '起草三个标题方案'), 6, null],
  ]],
  ['video', L('Record the demo video', '录制演示视频'), 'post', 'main', 'tripsplit', [
    ['PreToolUse', 0.5, { tool_name: 'Bash', tool_input: { command: 'npx remotion render Demo out/demo.mp4' } }],
  ]],
  ['review', L('Weekly review notes', '每周回顾笔记'), null, 'main', 'notes', [
    ['Stop', 15, { last_assistant_message: L('I drafted this week’s review from the canvas records.', '我根据画布上的记录起草了本周回顾。') }],
  ]],
];

export function writeAgentsDemo({ home, desktop, lang = 'en', now = Date.now() }) {
  const env = { ...process.env, TRACE_CANVAS_HOME: home };
  const pick = v => (v && typeof v === 'object' && 'en' in v ? v[lang] : v);
  const deep = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' && !('en' in v) ? deep(v) : pick(v)]));
  const dir = path.join(desktop, 'demo-org', 'demo-account');
  fs.mkdirSync(dir, { recursive: true });
  const transcripts = path.join(home, 'demo-transcripts');
  for (const [id, title, parent, branch, key, events, agents = []] of SESSIONS) {
    const sid = `demo-${id}`, transcript = path.join(transcripts, `${sid}.jsonl`);
    fs.writeFileSync(path.join(dir, `local_${id}.json`), JSON.stringify({ sessionId: `local_${id}`, cliSessionId: sid, title: pick(title), ...(parent ? { spawnedFrom: { sessionId: `local_${parent}` } } : {}) }));
    if (!events) continue; // started others, not running any more
    const repo = key && key.startsWith('notes') ? 'notes' : 'tripsplit';
    const base = { session_id: sid, cwd: `/Users/dev/${repo}`, transcript_path: transcript };
    updateLive({ ...base, hook_event_name: 'SessionStart', session_title: pick(title), model: 'claude-opus-5-5' }, { env, info: { repo, branch, root: base.cwd }, key, now: now - 60 * M });
    for (const [ev, minsAgo, extra] of events) updateLive({ ...base, hook_event_name: ev, ...deep(extra) }, { env, now: now - minsAgo * M });
    for (const [aid, type, description, startedAgo, doneAgo, last] of agents) {
      fs.mkdirSync(path.join(transcripts, sid, 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(transcripts, sid, 'subagents', `agent-${aid}.meta.json`), JSON.stringify({ agentType: type, description: pick(description), spawnDepth: 1 }));
      updateLive({ ...base, hook_event_name: 'SubagentStart', agent_id: aid, agent_type: type }, { env, now: now - startedAgo * M });
      if (doneAgo != null) updateLive({ ...base, hook_event_name: 'SubagentStop', agent_id: aid, agent_type: type, last_assistant_message: pick(last) }, { env, now: now - doneAgo * M });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [home, desktop, lang = 'en'] = process.argv.slice(2);
  if (!home || !desktop) { console.error('Usage: node docs/scenarios/agents.mjs <data dir> <desktop dir> [en|zh]'); process.exit(1); }
  writeAgentsDemo({ home, desktop, lang });
  console.log(`Wrote demo sessions to ${home}/live and desktop records to ${desktop}`);
}
