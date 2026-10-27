// Operations shared by the MCP server and the command line:
// putting a session on the canvas, merging threads, and merging data sets.
import { INBOX, COLS, addCommit, createThread, findThreadByName, lastCommit, readConfig, threadIdOf } from './store.mjs';
import { headline, firstLine } from './git-events.mjs';
import { AGENT, bindSession, logGitEvents, repoInfo, resumeLink, turnBody, rel } from './hook.mjs';
import { tr } from './i18n.mjs';

// Stable ids, so capturing the same session twice updates instead of duplicating.
function hashId(prefix, s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return prefix + (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function resolveThreadRef(d, ref) {
  if (!ref) return null;
  if (ref === INBOX || d.threads[ref]) return ref;
  return findThreadByName(d, ref);
}

/**
 * Binds a running session to a thread (id or name; a new name creates the thread),
 * or unbinds it when thread is empty. Returns the thread, or null after unbinding.
 */
export function bindLiveSession(d, { sessionId, thread }, env = process.env) {
  if (!sessionId) throw new Error('No session to bind; pass its id');
  let tid = null;
  if (thread) {
    tid = resolveThreadRef(d, thread);
    if (tid === INBOX) throw new Error('A session goes on a thread, not the inbox');
    if (!tid) tid = createThread(d, { name: String(thread).trim() }).id;
  }
  bindSession(sessionId, tid, env);
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
    parsed.turns.forEach((t, i) => {
      const last = i === parsed.turns.length - 1;
      if (i === 0) put(hashId('c', `${sid}:${t.uuid}:prompt`), { kind: 'task', title: firstLine(t.prompt, 120), body: t.prompt.slice(0, 3000), agent: AGENT, ts: t.ts, links });
      for (const g of t.git) {
        // Git moments go through the same writer as the hooks, keyed by their content.
        const before = new Set(Object.keys(d.commits));
        logGitEvents(d, g, { info, cfg, sid, ts: g.ts, thread: () => d.threads[tid] || { id: tid } });
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
    for (const id of sids) delete d.threads[id];
    const t = d.threads[tid];
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
        id: t.id, name: t.name, status: t.status || 'active', records: cs.length,
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

export function readThread(d, ref, { limit = 50 } = {}) {
  const id = resolveThreadRef(d, ref);
  if (!id) throw new Error(`No thread named "${ref}"`);
  const t = id === INBOX ? { id: INBOX, name: 'Inbox', status: 'active' } : d.threads[id];
  const cs = Object.values(d.commits).filter(c => threadIdOf(d, c) === id).sort((a, b) => a.ts - b.ts);
  return {
    id: t.id, name: t.name, status: t.status, note: t.note || '', total: cs.length,
    records: cs.slice(-limit).map(c => ({ id: c.id, at: new Date(c.ts).toISOString(), kind: c.kind, title: c.title, ...(c.body ? { body: c.body.slice(0, 600) } : {}), ...(c.agent ? { agent: c.agent } : {}), ...(c.session ? { session: c.session } : {}), ...(c.links && c.links.length ? { links: c.links } : {}) })),
  };
}
