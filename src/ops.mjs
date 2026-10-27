import fs from 'node:fs';
// Operations shared by the MCP server and the command line:
// putting a session on the canvas, merging threads, and merging data sets.
import { INBOX, COLS, absorb, addCommit, createThread, findThreadByName, goalOf, hashId, lastCommit, readConfig, threadById, threadIdOf } from './store.mjs';
import { headline, firstLine } from './git-events.mjs';
import { AGENT, bindSession, gitRoot, logGitEvents, repoInfo, resumeLink, sessionThread, turnBody, rel } from './hook.mjs';
import { listLive } from './live.mjs';
import { AGENTS, q } from './agents.mjs';
import { desktopSessions } from './desktop.mjs';
import { tr } from './i18n.mjs';

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// A line by id or name, or else by a part of its name that matches exactly one line; several
// matches is an error that names them. For looking lines up and binding to them; creating a
// line, forking and merging keep to exact names, so a short name never lands somewhere unexpected.
export function findThreadLoose(d, ref) {
  const exact = resolveThreadRef(d, ref);
  if (exact || !norm(ref)) return exact;
  const hits = Object.values(d.threads).filter(t => norm(t.name).includes(norm(ref)));
  if (hits.length > 1) throw new Error(`"${ref}" matches several lines: ${hits.map(t => t.name).join(', ')}`);
  return hits.length ? hits[0].id : null;
}

export function resolveThreadRef(d, ref) {
  if (!ref) return null;
  if (ref === INBOX) return ref;
  const t = threadById(d, ref); // also an id the line had before it got a stable one
  return t ? t.id : findThreadByName(d, ref);
}

// A to-do is a task meant to be ticked. The first instruction of a session, which hooks and
// capture log as a task, is a record of what was asked, not a to-do; next steps Claude
// writes as highlights are to-dos.
export const isTodo = c => c.kind === 'task' && !(c.session && !c.highlight);

export { goalOf } from './store.mjs';

/**
 * Goals and to-dos per thread: the thread's goal and its tasks (open ones only unless includeDone).
 * Threads that are done or merged show up only while they still have open tasks.
 */
export function listTasks(d, { thread, includeDone = false, assignee } = {}) {
  const only = thread ? findThreadLoose(d, thread) : null;
  if (thread && !only) throw new Error(`No thread "${thread}"`);
  const by = {};
  for (const c of Object.values(d.commits)) if (isTodo(c) && (!assignee || c.assignee === assignee)) (by[threadIdOf(d, c)] ||= []).push(c);
  const ids = only ? [only] : [INBOX, ...Object.keys(d.threads)];
  return ids.map(id => {
    const th = id === INBOX ? { name: 'Inbox', status: 'active' } : d.threads[id];
    const tasks = (by[id] || []).sort((a, b) => a.ts - b.ts);
    const open = tasks.filter(c => !c.done);
    return {
      id, name: th.name, ...(th.group ? { group: th.group } : {}), goal: goalOf(th), status: th.status || 'active', done: tasks.length - open.length, total: tasks.length,
      tasks: (includeDone ? tasks : open).map(c => ({ id: c.id, title: c.title, assignee: c.assignee || null, done: !!c.done, doneBy: c.doneBy || null, doneAt: c.doneAt ? new Date(c.doneAt).toISOString() : null })),
    };
  }).filter(r => r.total || r.goal).filter(r => only || !['done', 'merged'].includes(r.status) || r.total > r.done);
}

/**
 * Marks a task done, or open again with done: false. task is its id or its title (exact, else a
 * unique partial match), within thread if given. by records who ticked it: 'human' or an agent's name.
 */
// A to-do by id, or by title (exact, else a unique partial match) among the open (or done) ones.
export function findTodo(d, { task, thread, done = false }) {
  const ref = String(task || '').trim();
  if (!ref) throw new Error('Which task? Pass its id or title');
  if (d.commits[ref] && d.commits[ref].kind === 'task') return d.commits[ref];
  const tid = thread ? findThreadLoose(d, thread) : null;
  if (thread && !tid) throw new Error(`No thread "${thread}"`);
  const pool = Object.values(d.commits).filter(x => isTodo(x) && !!x.done === !!done && (!tid || threadIdOf(d, x) === tid));
  const want = norm(ref), exact = pool.filter(x => norm(x.title) === want);
  const hits = exact.length ? exact : pool.filter(x => norm(x.title).includes(want));
  if (hits.length !== 1) throw new Error(hits.length ? `${hits.length} tasks match "${ref}"; pass the id or the thread` : `No ${done ? 'done' : 'open'} task matches "${ref}"`);
  return hits[0];
}

export function setTaskDone(d, { task, thread, done = true, by = 'human' }) {
  const c = findTodo(d, { task, thread, done: !done });
  c.done = !!done;
  if (done) { c.doneBy = by; c.doneAt = Date.now(); } else { delete c.doneBy; delete c.doneAt; }
  return c;
}

/**
 * Hands a to-do (or a whole thread) to an agent: sets the to-do's assignee and returns the command
 * that starts that agent on the thread. TRACE_CANVAS_THREAD binds the new session through the
 * SessionStart hook; the prompt also asks for trace_bind in case the hook cannot see it.
 */
export function handTo(d, { ref, to, thread, remote = false }, env = process.env) {
  const ag = AGENTS[to];
  if (!ag) throw new Error(`Hand to whom? One of ${Object.keys(AGENTS).join(', ')}`);
  let todo = null, tid = d.commits[ref] && d.commits[ref].kind !== 'task' ? null : resolveThreadRef(d, ref);
  if (!tid || tid === INBOX) { todo = findTodo(d, { task: ref, thread }); tid = threadIdOf(d, todo); todo.assignee = to; }
  const th = tid === INBOX ? null : d.threads[tid];
  if (!th) throw new Error('Put the to-do on a line first; the inbox has no folder or goal to hand over');
  const live = listLive(env).filter(s => sessionThreadOf(d, s, env) === tid).sort((a, b) => b.lastSeen - a.lastSeen);
  const dir = lineDir(th) || (live[0] ? live[0].cwd : '');
  const prompt = oneLine(`You are taking over the Trace Canvas line "${th.name}" (thread ${tid}). First call the MCP tool trace_bind with thread "${tid}". Then read the line with trace_read_thread (ideas logged on it are there) and call trace_tasks with mine: true for the goal and your to-dos, work through them, and tick each one with trace_task_done when it is done. Log decisions and results with trace_log.${todo ? ` Start with: ${todo.title}` : ''}`);
  const run = remote && ag.remote ? ag.remote(oneLine(th.name), prompt) : ag.launch(prompt);
  return { thread: th, todo, live, command: `${dir ? `cd ${q(dir)} && ` : ''}TRACE_CANVAS_THREAD=${tid} ${run}` };
}
// The command is typed into a terminal, so a name or to-do with a line break must not end it early.
const oneLine = s => String(s).replace(/[\x00-\x1f\x7f]+/g, ' ');
const sessionThreadOf = (d, s, env) => sessionThread(d, s, env).threadId;
// The folder a line works in: the repository path the hooks keep in its note.
const lineDir = th => { const n = String((th && th.note) || '').trim(); return /^\/\S*$/.test(n) && fs.existsSync(n) ? n : ''; };
const RESUME = /^(claude --resume|codex resume|gemini --resume) \S+$/;

/**
 * Every session the canvas knows, newest first, each on the line it stays on: the session table,
 * plus older sessions known only from their records (their newest record's line). `command`
 * resumes it from its folder, so anyone can pick a line's session up again instead of starting anew.
 */
export function sessionList(d, tid = null) {
  const rec = new Map();
  for (const c of Object.values(d.commits)) {
    if (!c.session) continue;
    const r = rec.get(c.session) || { last: 0, at: Infinity };
    if (c.ts > r.last) Object.assign(r, { last: c.ts, thread: threadIdOf(d, c), agent: c.agent || r.agent, machine: c.machine || r.machine });
    if (c.kind === 'task' && c.ts < r.at) Object.assign(r, { at: c.ts, title: c.title });
    const link = (c.links || []).find(l => RESUME.test(l));
    if (link) r.resume = link;
    rec.set(c.session, r);
  }
  const table = d.sessions || {};
  const all = [...new Set([...Object.keys(table), ...rec.keys()])].map(id => {
    const r = rec.get(id) || {}, e = table[id] || {};
    const th = table[id] ? threadById(d, e.thread) : d.threads[r.thread] || null;
    const cwd = e.cwd || lineDir(th), resume = e.resume || r.resume || resumeLink(id);
    return { id, thread: th ? th.id : null, agent: e.agent || r.agent || AGENT, title: e.title || r.title || '', bound: !!e.bound, last: Math.max(e.last || 0, r.last || 0), machine: e.machine || r.machine || '', cwd, resume, command: `${cwd ? `cd ${q(cwd)} && ` : ''}${resume}` };
  }).sort((a, b) => b.last - a.last);
  return tid ? all.filter(s => s.thread === tid) : all;
}

/**
 * Running sessions with their thread, title and the session that started them (from the
 * desktop app's records), plus `others`: sessions that started a running one but are not
 * running themselves, so each chain stays whole in the agent view.
 */
export function liveSessions(d, env = process.env) {
  const desk = desktopSessions(env);
  const sessions = listLive(env).map(s => {
    const k = desk.get(s.id) || {};
    return { ...s, ...sessionThread(d, s, env), title: s.title || k.title || '', parent: k.parent || null, desktopId: k.desktopId || null };
  });
  const seen = new Set(sessions.map(s => s.id)), others = [];
  for (const s of sessions) {
    for (let p = s.parent; p && !seen.has(p); p = (desk.get(p) || {}).parent) {
      const k = desk.get(p);
      if (!k) break;
      seen.add(p);
      others.push({ id: p, title: k.title, parent: k.parent, status: 'off', agents: [], desktopId: k.desktopId || null });
    }
  }
  return { sessions, others };
}

/**
 * Forks a new thread from a record, or from a thread's newest record when `from` names a thread.
 * Same shape as forkFrom on the page: the new thread points at its parent and fork point, and
 * starts with a fork record whose parent is that point. Returns { thread, record }.
 */
export function forkThread(d, { from, name, agent = '' } = {}, env = process.env) {
  const cfg = readConfig(env);
  let c = d.commits[from];
  if (!c) {
    const tid = resolveThreadRef(d, from);
    if (!tid) throw new Error(`No record or thread "${from}"`);
    c = lastCommit(d, tid);
    if (!c) throw new Error(`"${from}" has no records to fork from yet`);
  }
  const ptid = threadIdOf(d, c), pname = ptid === INBOX ? tr(cfg.lang, 'inbox') : d.threads[ptid].name;
  const thread = createThread(d, { name: String(name || '').trim() || tr(cfg.lang, 'branchDefault', pname), parent: ptid, forkOf: c.id, extra: ptid !== INBOX && d.threads[ptid].group ? { group: d.threads[ptid].group } : {} });
  const record = addCommit(d, { thread: thread.id, kind: 'fork', title: tr(cfg.lang, 'forkTitle', pname, c.title).slice(0, 120), parents: [c.id], ts: Math.max(Date.now(), c.ts + 1), agent });
  return { thread, record };
}

/**
 * Binds a running session to a thread (id or name; a new name creates the thread),
 * or unbinds it when thread is empty. Returns the thread, or null after unbinding.
 */
export function bindLiveSession(d, { sessionId, thread, agent }, env = process.env) {
  if (!sessionId) throw new Error('No session to bind; pass its id');
  let tid = null;
  if (thread) {
    tid = findThreadLoose(d, thread);
    if (tid === INBOX) throw new Error('A session goes on a thread, not the inbox');
    if (!tid) tid = createThread(d, { name: String(thread).trim() }).id;
  }
  bindSession(d, sessionId, tid, env);
  // The tools know who calls them; the hooks fill this in too, but they may not have run yet
  // (or at all, when Codex has not trusted them), and the line's session list needs it.
  const e = d.sessions[sessionId], ag = AGENTS[agent];
  if (e && ag && !e.agent) Object.assign(e, { agent: ag.name, agentKey: agent, resume: ag.resume(sessionId), machine: e.machine || readConfig(env).machine, last: Date.now() });
  return tid ? d.threads[tid] : null;
}

/**
 * Puts one session on the canvas.
 * parsed: output of parseTranscript (may be null when only highlights are given).
 * Returns { thread, added, skipped }.
 */
export function captureSession(d, parsed, { sessionId, thread, separate = false, name, summary, highlights = [], detail = 'key', agent = 'Claude' } = {}, env = process.env) {
  const cfg = readConfig(env);
  const sid = sessionId || (parsed && parsed.sessionId) || 'manual';
  const existing = Object.values(d.commits).filter(c => c.session === sid);
  const sessionTitle = name || (parsed && (parsed.title || (parsed.turns[0] && firstLine(parsed.turns[0].prompt, 60)))) || `Session ${sid.slice(0, 8)}`;

  // Pick the thread: an explicit one, the one this session already lives on, or a new line for it.
  let tid = null;
  if (thread) {
    tid = resolveThreadRef(d, thread);
    if (!tid) tid = createThread(d, { name: String(thread), key: null }).id;
  } else if (separate || !existing.length) {
    let t = Object.values(d.threads).find(x => x.key === `session:${sid}`);
    if (!t) {
      const from = existing.length ? existing.slice().sort((a, b) => a.ts - b.ts)[0] : null;
      const parentId = from ? threadIdOf(d, from) : null;
      const before = parentId ? Object.values(d.commits).filter(c => threadIdOf(d, c) === parentId && c.ts < from.ts && c.session !== sid).sort((a, b) => b.ts - a.ts)[0] : null;
      t = createThread(d, { name: sessionTitle, key: `session:${sid}`, parent: parentId && parentId !== INBOX ? parentId : null, forkOf: before ? before.id : null, note: parsed && parsed.cwd ? parsed.cwd : '' });
    }
    tid = t.id;
  } else {
    const counts = {};
    for (const c of existing) { const t = threadIdOf(d, c); counts[t] = (counts[t] || 0) + 1; }
    tid = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }
  if (separate) for (const c of existing) c.thread = tid;
  // A session's own line takes the name the agent gives it, replacing one made from the first prompt.
  if (name && d.threads[tid] && d.threads[tid].key === `session:${sid}`) d.threads[tid].name = String(name).slice(0, 120);

  const seenTitles = new Set(Object.values(d.commits).filter(c => c.session === sid).map(c => norm(c.title)));
  let added = 0, skipped = 0;
  const put = (id, rec) => {
    if (d.commits[id] || seenTitles.has(norm(rec.title))) { skipped++; return; }
    const c = addCommit(d, { thread: tid, ...rec, extra: { session: sid, ...(rec.extra || {}) } });
    delete d.commits[c.id]; c.id = id; d.commits[id] = c;
    seenTitles.add(norm(rec.title)); added++;
  };

  if (parsed && parsed.turns.length) {
    const root = parsed.cwd || '';
    const info = parsed.cwd ? repoInfo(parsed.cwd) : null;
    const links = [resumeLink(sid)];
    const roots = new Map(); // folder → its repository, so each commit records where it lives
    const rootOf = dir => { if (!roots.has(dir)) roots.set(dir, gitRoot(dir)); return roots.get(dir); };
    parsed.turns.forEach((t, i) => {
      const last = i === parsed.turns.length - 1;
      if (i === 0) put(hashId('c', `${sid}:${t.uuid}:prompt`), { kind: 'task', title: firstLine(t.prompt, 120), body: t.prompt.slice(0, 3000), agent: AGENT, ts: t.ts, links, extra: { actor: 'human' } });
      for (const g of t.git) {
        // Git moments go through the same writer as the hooks, keyed by their content.
        const before = new Set(Object.keys(d.commits));
        logGitEvents(d, { ...g, repo: g.dir ? rootOf(g.dir) : null }, { info, cfg, sid, ts: g.ts, thread: () => d.threads[tid] || { id: tid } });
        for (const id of Object.keys(d.commits)) if (!before.has(id)) {
          const c = d.commits[id];
          delete d.commits[id];
          if (seenTitles.has(norm(c.title))) { skipped++; continue; }
          c.thread = tid; c.id = hashId('c', `${sid}:${c.title}`);
          if (d.commits[c.id]) { skipped++; continue; }
          d.commits[c.id] = c; seenTitles.add(norm(c.title)); added++;
        }
      }
      const acted = t.files.length > 0 || t.actions > 0;
      if (t.text && (detail === 'all' || acted || last)) {
        const files = t.files.map(f => rel(root, f));
        const body = (detail === 'all' && i > 0 ? `> ${firstLine(t.prompt, 300)}\n\n` : '') + turnBody(cfg.lang, t.text, files, t.todos);
        put(hashId('c', `${sid}:${t.uuid}:turn`), { kind: 'agent', title: headline(t.text) || tr(cfg.lang, 'turnChanged', files.length), body, agent: AGENT, ts: t.textTs || t.ts, links, extra: files.length ? { files: files.slice(0, 50) } : {} });
      }
    });
  }

  const now = Date.now();
  highlights.forEach((h, i) => {
    if (!h || !String(h.title || '').trim()) return;
    const kind = ['idea', 'task', 'agent', 'decision', 'note'].includes(h.kind) ? h.kind : 'note';
    put(hashId('c', `${sid}:hl:${norm(h.title)}`), { kind, title: String(h.title).slice(0, 300), body: String(h.body || ''), links: Array.isArray(h.links) ? h.links : [], agent, ts: now + i, extra: { highlight: true } });
  });
  if (summary && String(summary).trim()) {
    put(hashId('c', `${sid}:summary:${norm(summary).slice(0, 200)}`), { kind: 'note', title: headline(summary, 120), body: String(summary), agent, ts: now + highlights.length + 1, links: [resumeLink(sid)], extra: { summary: true } });
  }
  return { thread: d.threads[tid] || { id: INBOX, name: 'Inbox' }, added, skipped, sessionId: sid };
}

/**
 * Merges any number of threads.
 * mode 'merge'   keeps every line and draws a merge into the target, like git.
 * mode 'combine' folds all records into the target and removes the source threads.
 * target may be an existing thread (id or name) or a new name.
 */
export function mergeThreads(d, { sources = [], target, newName, mode = 'merge' } = {}, env = process.env) {
  const cfg = readConfig(env);
  const srcIds = [];
  const missing = [];
  for (const ref of sources) {
    const id = resolveThreadRef(d, ref);
    if (!id || id === INBOX) missing.push(ref); else if (!srcIds.includes(id)) srcIds.push(id);
  }
  if (missing.length) throw new Error(`No thread named ${missing.map(m => `"${m}"`).join(', ')}`);
  let tid = target ? resolveThreadRef(d, target) : null;
  if (tid === INBOX) throw new Error('The inbox cannot be a merge target');
  if (!tid) {
    const nm = String(newName || target || srcIds.map(id => d.threads[id].name).join(' + ')).slice(0, 120);
    const first = d.threads[srcIds[0]];
    tid = createThread(d, { name: nm }).id;
    if (first) { d.threads[tid].x = (first.x || 0) + 300; d.threads[tid].y = first.y || 0; }
  }
  const sids = srcIds.filter(id => id !== tid);
  if (!sids.length) throw new Error('Pick at least one thread other than the target');
  const names = sids.map(id => d.threads[id].name);

  if (mode === 'combine') {
    for (const c of Object.values(d.commits)) if (sids.includes(c.thread)) c.thread = tid;
    for (const t of Object.values(d.threads)) {
      if (sids.includes(t.parent)) t.parent = t.id === tid ? null : tid;
      if (sids.includes(t.mergedInto)) t.mergedInto = tid;
    }
    const seen = new Set();
    for (const e of Object.values(d.edges)) {
      if (sids.includes(e.from)) e.from = tid;
      if (sids.includes(e.to)) e.to = tid;
      const k = `${e.from}>${e.to}:${e.label}`;
      if (e.from === e.to || seen.has(k)) delete d.edges[e.id]; else seen.add(k);
    }
    const t = d.threads[tid];
    absorb(t, sids.map(id => d.threads[id]));
    for (const id of sids) delete d.threads[id];
    const note = tr(cfg.lang, 'combinedFrom', names.join(', '));
    t.note = t.note ? `${t.note}\n${note}` : note;
    if (t.status === 'merged') { t.status = 'active'; t.mergedInto = null; }
  } else {
    for (const id of sids) {
      const src = d.threads[id];
      const srcTip = lastCommit(d, id), tip = lastCommit(d, tid);
      addCommit(d, { thread: tid, kind: 'merge', title: tr(cfg.lang, 'merged', src.name), parents: [tip && tip.id, srcTip && srcTip.id].filter(Boolean), ts: Math.max(Date.now(), srcTip ? srcTip.ts + 1 : 0), extra: { mergeOf: id } });
      src.status = 'merged'; src.mergedInto = tid;
    }
  }
  return { target: d.threads[tid], sources: names, mode };
}

/**
 * Merges another Trace Canvas data set (an export, or data.json from another machine).
 * Threads with the same id, the same key (repository/branch or session) or, without a key,
 * the same name are treated as one line.
 */
export function mergeDataset(d, incoming) {
  const src = { threads: [], commits: [], edges: [] };
  for (const col of COLS) {
    const v = incoming && incoming[col];
    src[col] = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  }
  const map = new Map();
  const added = new Set();
  let threads = 0, commits = 0, edges = 0;
  for (const t of src.threads) {
    if (!t || !t.id) continue;
    const same = d.threads[t.id] ? t.id : (Object.values(d.threads).find(x => (t.key && x.key === t.key) || (!t.key && !x.key && norm(x.name) === norm(t.name))) || {}).id;
    if (same) { map.set(t.id, same); continue; }
    const placed = createThread(d, { name: t.name });
    delete d.threads[placed.id];
    d.threads[t.id] = { ...t, x: placed.x, y: placed.y };
    map.set(t.id, t.id); added.add(t.id); threads++;
  }
  const mapT = id => (id && id !== INBOX ? map.get(id) || (d.threads[id] ? id : null) : id);
  for (const id of added) {
    const t = d.threads[id];
    t.parent = mapT(t.parent) || null;
    t.mergedInto = mapT(t.mergedInto) || null;
  }
  for (const c of src.commits) {
    if (!c || !c.id || d.commits[c.id]) continue;
    d.commits[c.id] = { ...c, thread: c.thread === INBOX ? INBOX : (mapT(c.thread) || INBOX), ...(c.mergeOf ? { mergeOf: mapT(c.mergeOf) } : {}) };
    commits++;
  }
  const have = new Set(Object.values(d.edges).map(e => `${e.from}>${e.to}:${e.label}`));
  for (const e of src.edges) {
    if (!e || !e.id) continue;
    const from = mapT(e.from), to = mapT(e.to);
    const k = `${from}>${to}:${e.label}`;
    if (!from || !to || from === to || d.edges[e.id] || have.has(k)) continue;
    d.edges[e.id] = { ...e, from, to }; have.add(k); edges++;
  }
  return { threads, commits, edges, unified: [...map.entries()].filter(([a, b]) => a !== b).length };
}

export function listThreads(d, { query, includeDone = true } = {}) {
  const q = norm(query);
  const by = {};
  for (const c of Object.values(d.commits)) (by[threadIdOf(d, c)] ||= []).push(c);
  const rows = [{ id: INBOX, name: 'Inbox', status: 'active' }, ...Object.values(d.threads).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))]
    .filter(t => includeDone || !['done', 'merged'].includes(t.status))
    .map(t => {
      const cs = (by[t.id] || []).sort((a, b) => a.ts - b.ts);
      const hits = q ? cs.filter(c => norm(`${c.title} ${c.body}`).includes(q)).length : 0;
      return {
        id: t.id, name: t.name, ...(t.group ? { group: t.group } : {}), status: t.status || 'active', records: cs.length,
        lastUpdate: cs.length ? new Date(cs[cs.length - 1].ts).toISOString() : null,
        sessions: [...new Set(cs.map(c => c.session).filter(Boolean))].length,
        ...(t.parent ? { forkedFrom: (d.threads[t.parent] || {}).name || 'Inbox' } : {}),
        ...(t.mergedInto ? { mergedInto: (d.threads[t.mergedInto] || {}).name } : {}),
        ...(q ? { matches: hits } : {}),
        latest: cs.length ? cs[cs.length - 1].title : '',
      };
    });
  return q ? rows.filter(r => r.matches || norm(r.name).includes(q)) : rows;
}

// A line's sessions with their live status ('off' when not running).
export function threadSessions(d, tid, env = process.env) {
  const live = new Map(listLive(env).map(s => [s.id, s])), me = readConfig(env).machine;
  return sessionList(d, tid).map(s => {
    const l = live.get(s.id), cwd = s.cwd || (l && l.cwd) || '', here = `${cwd ? `cd ${q(cwd)} && ` : ''}${s.resume}`;
    // Another machine's session resumes there, over ssh (machine names are the ssh aliases).
    return { ...s, status: l ? l.status : 'off', cwd, command: s.machine && s.machine !== me ? `ssh -t ${s.machine} ${q(here)}` : here };
  });
}

export function readThread(d, ref, { limit = 50 } = {}, env = process.env) {
  const id = findThreadLoose(d, ref);
  if (!id) throw new Error(`No thread named "${ref}"`);
  const t = id === INBOX ? { id: INBOX, name: 'Inbox', status: 'active' } : d.threads[id];
  const cs = Object.values(d.commits).filter(c => threadIdOf(d, c) === id).sort((a, b) => a.ts - b.ts);
  return {
    id: t.id, name: t.name, ...(t.group ? { group: t.group } : {}), status: t.status, goal: goalOf(t), note: t.note || '', total: cs.length,
    sessions: threadSessions(d, id, env).slice(0, 10).map(s => ({ id: s.id, agent: s.agent, title: s.title, status: s.status, last: new Date(s.last).toISOString(), resume: s.command })),
    records: cs.slice(-limit).map(c => ({ id: c.id, at: new Date(c.ts).toISOString(), kind: c.kind, title: c.title, ...(c.body ? { body: c.body.slice(0, 600) } : {}), ...(c.agent ? { agent: c.agent } : {}), ...(c.session ? { session: c.session } : {}), ...(c.gitCommit ? { commit: c.gitCommit, ...(c.repo ? { repo: c.repo } : {}) } : {}), ...(c.links && c.links.length ? { links: c.links } : {}) })),
  };
}
