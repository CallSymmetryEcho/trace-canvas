// An agent's decisions as cases: {situation, rule, action, outcome}. Exported as data for later ("ask or act"
// classifier, rule tuning) and searched as precedents when Autopilot is unsure: what was done in a like case and how
// the person judged it. Built from what the canvas already keeps; nothing new is stored.
import { AUTOPILOT_ASK, isTodo } from './store.mjs';

const RULE = /\b[HR]\d{1,2}\b/g;
const named = (c, ids) => ((`${c.title} ${c.body || ''}`).match(/\bc[a-z0-9]{12,14}\b/g) || []).filter(id => ids.has(id));
const short = s => String(s || '').split('\n')[0].slice(0, 300);

/** Every case on the canvas (or on one line), oldest first:
 * - decision: "what was done · the rule it rests on"; outcome 'logged'.
 * - question: "Question: … [to-do id]"; outcome is the person's answer (the next decision on the line naming that
 *   to-do) or 'unanswered'.
 * - review: a to-do an agent ticked, with its result; outcome 'passed', 'returned: <reason>' or 'pending'. */
export function cases(d, { thread } = {}) {
  const all = Object.values(d.commits).filter(c => !thread || c.thread === thread).sort((a, b) => a.ts - b.ts);
  const todos = new Map(all.filter(isTodo).map(c => [c.id, c]));
  const ids = new Set(todos.keys());
  const line = c => (d.threads[c.thread] || {}).name || '';
  const about = c => { const t = named(c, ids)[0]; return t ? { todo: t, situation: short(todos.get(t).title) } : { todo: null, situation: line(c) }; };
  const out = [];
  for (const c of all) {
    const base = { id: c.id, ts: c.ts, line: line(c) };
    if (c.kind === 'decision') {
      // "what · why": the last " · " followed by a rule (a title may hold other dots, "cleared 8 · 7 wait on you").
      const i = c.title.lastIndexOf(' · '), why = i > 0 && /依据|rule|\b[HR]\d/i.test(c.title.slice(i)) ? c.title.slice(i + 3) : '';
      out.push({ ...base, type: 'decision', ...about(c), rule: [...new Set(why.match(RULE) || [])].join(' ') || why, action: short(why ? c.title.slice(0, i) : c.title), outcome: 'logged' });
    } else if (c.kind === 'note' && AUTOPILOT_ASK.test(c.title)) {
      const a = about(c);
      const ans = a.todo && all.find(x => x.ts > c.ts && x.thread === c.thread && x.kind === 'decision' && named(x, ids).includes(a.todo));
      out.push({ ...base, type: 'question', ...a, rule: '', action: 'ask: ' + short(c.title.replace(AUTOPILOT_ASK, '').replace(/\s*\[c[a-z0-9]+\]\s*$/, '').trim()), outcome: ans ? `answered: ${short(ans.title)}` : 'unanswered' });
    }
    if (isTodo(c) && (c.toReview || c.reviewedAt || c.returned)) {
      out.push({ ...base, type: 'review', todo: c.id, situation: short(c.title), rule: '', action: short(c.result || 'ticked'),
        outcome: c.returned ? `returned: ${c.returned.note || '(no reason)'}` : c.toReview ? 'pending' : 'passed' });
    }
  }
  return out;
}

// Words and, for Chinese, character pairs: enough to match "推送" in one record with "推送到 GitHub" in another.
const terms = s => { const t = String(s).toLowerCase(); return new Set([...(t.match(/[a-z0-9]{2,}/g) || []), ...[...t.replace(/[^\p{Script=Han}]+/gu, ' ').matchAll(/(?=(\p{Script=Han}{2}))/gu)].map(m => m[1])]); };

/** The cases most like query, the ones where the person spoke (an answer, a return, a pass) first among equals. */
export function precedents(d, query, { limit = 8, thread } = {}) {
  const q = terms(query);
  if (!q.size) return [];
  const said = c => (c.type === 'question' && c.outcome !== 'unanswered') || (c.type === 'review' && c.outcome !== 'pending');
  return cases(d, { thread }).map(c => { const t = terms(`${c.situation} ${c.action}`); let n = 0; for (const w of q) if (t.has(w)) n++; return { c, s: n / Math.sqrt(t.size + 1) + (n && said(c) ? 0.05 : 0) }; })
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.c);
}
