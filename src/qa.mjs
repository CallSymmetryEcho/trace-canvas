// Q&A notes for a research line. A line with `qa` on keeps the questions the person asked and the answers that had
// something in them in one Markdown file, instead of a record per sentence: the line shows one record that links the
// file. The hook appends a turn that only talked and got a real answer (QA_MIN characters or more); an agent may
// tidy an entry into its points afterwards. Turned on per line: `trace-canvas qa <line>`, or /qa in the page's box.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addCommit, home } from './store.mjs';

export const QA_MIN = 300;

/** The line's file: in its project (notes/qa-<line>.md) when it has a folder here, else in the canvas's own folder. */
export function qaFile(th, root, env = process.env) {
  const note = String(th.note || '').trim(), dir = [note, root].find(p => p && path.isAbsolute(p) && path.resolve(p) !== os.homedir() && fs.existsSync(p));
  const slug = String(th.name || th.id).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 60) || th.id;
  return dir ? path.join(dir, 'notes', `qa-${slug}.md`) : path.join(home(env), 'qa', `${th.id}.md`);
}

/** Appends one question and its answer to the line's file, and keeps the line's one record of it. Returns the file. */
export function appendQa(d, th, { prompt, reply, agent = '', resume = '', root = '', lang = 'en' }, env = process.env) {
  const file = qaFile(th, root, env), zh = lang === 'zh', at = new Date(), two = n => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}:${two(at.getMinutes())}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, zh ? `# 问答记录：${th.name}\n\n这条线上的问答，新的在后。可以把一条整理成要点，原话在所附的会话里。\n` : `# Q&A notes: ${th.name}\n\nQuestions and answers on this line, newest last. An entry may be tidied into its points; the words as said are in the session it names.\n`);
  fs.appendFileSync(file, `\n## ${when} · ${agent}\n\n**${zh ? '问' : 'Q'}:** ${prompt.trim()}\n\n**${zh ? '答' : 'A'}:**\n\n${reply.trim()}\n${resume ? `\n<sub>${resume}</sub>\n` : ''}`);
  const rec = Object.values(d.commits).find(c => c.qa && c.thread === th.id && (c.links || [])[0] === file)
    || addCommit(d, { thread: th.id, kind: 'note', title: zh ? `问答记录：${th.name}` : `Q&A notes: ${th.name}`, agent: 'Trace Canvas', links: [file], extra: { qa: 0 } });
  rec.qa = (rec.qa || 0) + 1; rec.updated = Date.now();
  rec.body = zh ? `${rec.qa} 条问答，最近一条：${prompt.trim().slice(0, 80)}` : `${rec.qa} entr${rec.qa === 1 ? 'y' : 'ies'}; the latest: ${prompt.trim().slice(0, 80)}`;
  return file;
}
