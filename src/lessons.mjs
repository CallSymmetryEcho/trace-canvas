// Lessons from a finished project (History, step 3). When a project is archived, the local claude drafts a few
// lessons from its decisions and wrap-ups; only the ones the person ticks go to long-term memory (Theatrum), and a
// new line is handed the ones that fit it when its first sessions start (level 1). Autopilot looks further into the
// archived project's own records when a decision needs more (level 2, in its prompt).
import { spawn, spawnSync } from 'node:child_process';
import { askAgent } from './retro.mjs';

const WRAP = /^(收尾总结：|Wrap-up: )/;

/** The project's decisions and wrap-ups, oldest first, as the text the lessons are drawn from. Retro is the other
 * way experience is kept (src/retro.mjs: rules from where conversations got stuck, mid-project, per line): the rules
 * its runs already kept are listed apart, so a lesson does not say them again. */
export function lessonSource(d, group) {
  const ids = new Set(Object.values(d.threads).filter(t => t.group === group).map(t => t.id));
  const mine = Object.values(d.commits).filter(c => ids.has(c.thread));
  const src = mine.filter(c => c.kind === 'decision' || (c.kind === 'note' && WRAP.test(c.title))).sort((a, b) => a.ts - b.ts).slice(-120)
    .map(c => `[${c.id}] ${c.kind}: ${c.title}${c.body ? `\n${String(c.body).slice(0, 600)}` : ''}`).join('\n\n');
  const kept = mine.flatMap(c => (c.retro && c.retro.items) || []).filter(it => it.applied && it.rule).map(it => `- ${it.rule}`);
  return src && kept.length ? `${src}\n\nAlready kept by retro (do not repeat these):\n${kept.join('\n')}` : src;
}

export const lessonPrompt = (group, src, lang = 'zh') => `Below are the decisions and wrap-ups of a finished project, "${group}", each with its record id in brackets.
Draw 3 to 8 lessons from them that would help a future project: what to do or avoid next time and why, not a summary of what was done. Merge repeats; skip anything only this project cares about.
Answer with a JSON array only, no prose: [{"title": "one line, the lesson itself", "body": "two or three sentences: when it applies and why", "from": ["record ids it rests on"]}].
Write title and body in ${lang === 'zh' ? 'Chinese' : 'English'}.

${src}`;

export function parseLessons(text) {
  const m = String(text || '').match(/\[[\s\S]*\]/);
  try {
    return JSON.parse(m ? m[0] : '[]').filter(x => x && x.title).slice(0, 8)
      .map(x => ({ title: String(x.title).slice(0, 140), body: String(x.body || '').slice(0, 1200), from: (Array.isArray(x.from) ? x.from : []).map(String).slice(0, 6) }));
  } catch { return []; }
}

export async function draftLessons(d, group, lang, ask = askAgent) {
  const src = lessonSource(d, group);
  return src ? parseLessons(await ask(lessonPrompt(group, src, lang), { timeout: 240000 })) : [];
}

// Theatrum tags are comma-separated: a project name keeps to letters, digits and dashes there.
const tagOf = group => `project-${String(group).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`;

/** Writes one approved lesson to Theatrum (theatrum remember); resolves to an error text, or '' when it is saved. */
export function rememberLesson(l, group, { bin = 'theatrum', run = spawn } = {}) {
  const body = `${l.body}\n\nFrom the Trace Canvas project "${group}"${l.from.length ? `, records ${l.from.join(', ')}` : ''}.`;
  return new Promise(resolve => {
    const p = run(bin, ['remember', '--type', 'lesson', '--scope', 'global', '--tags', `trace-canvas,lesson,${tagOf(group)}`, '--source', 'user_requested', '--title', l.title], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', b => { err += b; });
    p.on('error', e => resolve(e.code === 'ENOENT' ? 'Theatrum is not installed here' : e.message));
    p.on('close', code => resolve(code ? (err.trim() || `theatrum exited ${code}`) : ''));
    p.stdin.end(`${l.title}\n\n${body}`);
  });
}

/** Level 1: up to three lessons that fit a line (by its name, group and goal), from `theatrum recall`; [] without it. */
export function lessonsFor(query, { bin = 'theatrum', run = spawnSync } = {}) {
  const r = run(bin, ['recall', String(query).slice(0, 200), '--limit', '10'], { encoding: 'utf8', timeout: 3000 });
  if (!r || r.status !== 0) return [];
  return String(r.stdout || '').split('\n').map(l => l.split('\t')).filter(c => c.length >= 6 && c[1] === 'lesson').slice(0, 3).map(c => ({ id: c[0], title: c[5] }));
}
