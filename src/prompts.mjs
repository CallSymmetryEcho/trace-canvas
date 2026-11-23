// The openings of every prompt Trace Canvas itself writes for an agent: a hand-over, a dispatch, an Autopilot round and
// its pushes, a reply's wake-up line. Whoever writes one (src/ops.mjs, src/hook.mjs, src/mcp.mjs, the page) and whoever
// has to know one when it comes back as a session's prompt (the hooks: it restates work already on the line, so it is
// never logged as a new to-do) go by this one table. test/prompt.test.mjs feeds what each writer really produces,
// the page's included, back through the hook.
export const HEADS = {
  hand: 'You are taking over the Trace Canvas line',
  handZh: '你接手 Trace Canvas 上的线',
  todos: 'New to-dos on the Trace Canvas line',
  read: 'Read the Trace Canvas line',
  readZh: '读 Trace Canvas 上的线',
  autopilot: 'Autopilot (beta) on the Trace Canvas line',
  nudge: 'Autopilot is on for the line',
  evolve: 'Autopilot self-iteration is on for the line',
  reply: 'A reply was left for you on Trace Canvas',
};
// Anywhere in the message, not only at its start: it also arrives pasted, or after a few words of the person's own.
export const isHandoff = p => { const s = String(p || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''); return Object.values(HEADS).some(h => s.includes(h)); };
// The Stop hook's own push, which Gemini CLI hands back as a prompt: not the person speaking.
export const isNudge = p => [HEADS.nudge, HEADS.evolve].some(h => String(p || '').trimStart().startsWith(`${h} `));
