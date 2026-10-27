// Reads Claude Code session transcripts (~/.claude/projects/<project>/<session>.jsonl)
// and turns them into the same kind of records the live hooks write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitEvents, commandDir, redirectTargets, BASH_WRITES, EDIT_TOOLS, cleanPrompt } from './git-events.mjs';
import { listLive } from './live.mjs';

export function projectsRoot(env = process.env) {
  return env.CLAUDE_PROJECTS_DIR || path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
}
// Claude Code names a project's folder after its path, with every other character replaced by '-'.
export const encodeProjectDir = dir => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');

function readHead(file, bytes = 65536) {
  const fd = fs.openSync(file, 'r');
  try { const buf = Buffer.alloc(bytes); const n = fs.readSync(fd, buf, 0, bytes, 0); return buf.slice(0, n).toString('utf8'); }
  finally { fs.closeSync(fd); }
}

// Transcript files for a project, newest first.
export function findTranscripts(projectDir, env = process.env) {
  const root = projectsRoot(env);
  const list = dir => {
    try {
      return fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => {
        const p = path.join(dir, f);
        return { path: p, sessionId: f.slice(0, -6), mtime: fs.statSync(p).mtimeMs };
      });
    } catch { return []; }
  };
  let files = list(path.join(root, encodeProjectDir(projectDir)));
  if (!files.length) {
    // Fall back to matching the cwd recorded inside each project's newest transcript.
    const want = path.resolve(projectDir);
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch {}
    for (const d of dirs) {
      const fs2 = list(path.join(root, d)).sort((a, b) => b.mtime - a.mtime);
      if (!fs2.length) continue;
      const m = readHead(fs2[0].path).match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (m && path.resolve(JSON.parse(`"${m[1]}"`)) === want) { files = fs2; break; }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

/**
 * The session that is calling. An explicit id wins; then CLAUDE_CODE_SESSION_ID, which Claude Code
 * sets for the MCP servers and shell commands it starts; then the newest transcript of the project,
 * but only if no other transcript there changed in the last 10 minutes: two sessions working in one
 * folder cannot be told apart by their files, so guessing would put records on the wrong session.
 */
export function currentSessionId({ sessionId, projectDir, env = process.env, now = Date.now() } = {}) {
  if (sessionId) return sessionId;
  if (env.CLAUDE_CODE_SESSION_ID) return env.CLAUDE_CODE_SESSION_ID;
  // Codex and Gemini set no such variable; their hooks keep a live file per session, with the agent and cwd.
  const key = env.TRACE_CANVAS_AGENT;
  if (key && key !== 'claude') {
    const mine = listLive(env).filter(s => s.agentKey === key && (!projectDir || s.cwd === path.resolve(projectDir)) && now - s.lastSeen < 10 * 60e3);
    if (mine.length > 1) throw new Error(`${mine.length} ${key} sessions are active in ${projectDir}, so it is not clear which one is calling; pass session_id`);
    if (mine.length) return mine[0].id;
  }
  const files = projectDir ? findTranscripts(projectDir, env) : [];
  const recent = files.filter(f => now - f.mtime < 10 * 60e3);
  if (recent.length > 1) throw new Error(`${recent.length} sessions in ${projectDir} were active in the last 10 minutes, so it is not clear which one is calling; pass session_id`);
  return files[0] ? files[0].sessionId : null;
}

export function findTranscript({ sessionId, projectDir, transcriptPath }, env = process.env) {
  if (transcriptPath) return fs.existsSync(transcriptPath) ? transcriptPath : null;
  if (sessionId) {
    const local = projectDir ? findTranscripts(projectDir, env).find(f => f.sessionId === sessionId) : null;
    if (local) return local.path;
    const root = projectsRoot(env);
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch {}
    for (const d of dirs) { const p = path.join(root, d, sessionId + '.jsonl'); if (fs.existsSync(p)) return p; }
    return null;
  }
  const newest = projectDir ? findTranscripts(projectDir, env)[0] : null;
  return newest ? newest.path : null;
}

const isNoise = text => /^\s*<(command-name|command-message|command-args|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|user-memory-input)\b/.test(text)
  || /^\s*\[Request interrupted/.test(text) || /^\s*Caveat: The messages below/.test(text);
const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '';
const toolResultText = b => typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.filter(x => x && x.type === 'text').map(x => x.text).join('\n') : '';

// Parses a transcript into turns. Each turn starts with something the person typed.
export function parseTranscript(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const s = { sessionId: path.basename(file, '.jsonl'), cwd: null, branch: null, title: null, startedAt: null, endedAt: null, turns: [] };
  const pending = new Map();
  let turn = null;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    const ts = j.timestamp ? Date.parse(j.timestamp) : null;
    if (ts) { s.startedAt = s.startedAt ?? ts; s.endedAt = ts; }
    if (j.sessionId) s.sessionId = j.sessionId;
    if (j.cwd && !s.cwd) s.cwd = j.cwd;
    if (j.gitBranch) s.branch = j.gitBranch;
    for (const k of ['customTitle', 'aiTitle', 'title', 'summary']) if (/title|summary/i.test(j.type || '') && typeof j[k] === 'string' && j[k].trim()) { s.title = j[k].trim(); break; }
    if (j.isSidechain || !j.message) continue;
    const content = j.message.content;

    if (j.type === 'user') {
      const results = Array.isArray(content) ? content.filter(b => b && b.type === 'tool_result') : [];
      if (results.length) {
        for (const b of results) {
          const use = pending.get(b.tool_use_id);
          if (!use || !turn || b.is_error) continue;
          if (use.name === 'Bash') {
            const r = j.toolUseResult && typeof j.toolUseResult === 'object' ? j.toolUseResult : {};
            const g = gitEvents(use.input.command, r.stdout ?? toolResultText(b), r.stderr, r.gitOperation);
            if (g.commits.length || g.push || g.pr || g.merge) turn.git.push({ ...g, ts: ts || turn.ts, ...(g.commits.length ? { dir: commandDir(use.input.command, j.cwd || s.cwd) } : {}) });
          }
        }
        continue;
      }
      const text = textOf(content);
      if (j.isMeta || !text.trim() || isNoise(text)) continue;
      const prompt = cleanPrompt(text);
      if (!prompt) continue;
      turn = { prompt, ts: ts || Date.now(), uuid: j.uuid || String(s.turns.length), files: [], actions: 0, git: [], todos: [], text: '', textTs: null };
      s.turns.push(turn);
    } else if (j.type === 'assistant' && turn && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text && b.text.trim()) { turn.text = b.text.trim(); turn.textTs = ts; }
        else if (b.type === 'tool_use') {
          const input = b.input || {};
          pending.set(b.id, { name: b.name, input });
          if (EDIT_TOOLS.has(b.name)) { const f = input.file_path || input.notebook_path; if (f && !turn.files.includes(f)) turn.files.push(f); }
          else if (b.name === 'Bash') {
            const targets = redirectTargets(input.command || '');
            for (const f of targets) if (!turn.files.includes(f)) turn.files.push(f);
            if (targets.length || BASH_WRITES.test(input.command || '')) turn.actions++;
          } else if (b.name === 'TodoWrite' && Array.isArray(input.todos)) {
            for (const td of input.todos) if (td && td.status === 'completed' && td.content && !turn.todos.includes(td.content)) turn.todos.push(td.content);
          }
        }
      }
    }
  }
  return s;
}

// A short description of a session for listings.
export function describeSession(file) {
  const s = parseTranscript(file);
  const first = s.turns[0];
  return {
    sessionId: s.sessionId, path: file, cwd: s.cwd, branch: s.branch,
    title: s.title || (first ? first.prompt.split('\n')[0].slice(0, 100) : ''),
    startedAt: s.startedAt, lastActivity: s.endedAt, prompts: s.turns.length,
    filesChanged: new Set(s.turns.flatMap(t => t.files)).size,
    commits: s.turns.reduce((n, t) => n + t.git.reduce((m, g) => m + g.commits.length, 0), 0),
  };
}
