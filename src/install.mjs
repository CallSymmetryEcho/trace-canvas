// Adds or removes the Trace Canvas hooks in a Claude Code settings file.
// Existing settings and other hooks are kept; a backup is written first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARK = 'trace-canvas.mjs" hook';

// PostToolUse fires often, so it runs in the background, as do the events that only update the
// live status (PreToolUse, Notification, SubagentStart/Stop). SessionStart and UserPromptSubmit print
// context for the agent, and Stop and SessionEnd write before the session moves on, so they wait.
export function hookConfig(command) {
  const h = (extra = {}) => [{ type: 'command', command, ...extra }];
  return {
    SessionStart: [{ hooks: h({ timeout: 10 }) }], // prints the context a session starts with, so it can't be async
    UserPromptSubmit: [{ hooks: h({ timeout: 5 }) }], // prints the to-do reminder
    PreToolUse: [{ hooks: h({ async: true }) }],
    Notification: [{ hooks: h({ async: true }) }],
    SubagentStart: [{ hooks: h({ async: true }) }],
    SubagentStop: [{ hooks: h({ async: true }) }],
    PostToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit|TodoWrite', hooks: h({ async: true }) }],
    Stop: [{ hooks: h({ timeout: 10 }) }],
    SessionEnd: [{ hooks: h({ timeout: 10 }) }],
  };
}

// Codex (~/.codex/hooks.json): Claude's shape, timeouts in seconds. It has no Notification event;
// PermissionRequest stands in for it. Codex trusts each hook by its position, so ours always go last.
export function codexHooks(command) {
  const h = (timeout = 5) => [{ type: 'command', command, timeout }];
  return {
    SessionStart: [{ hooks: h(10) }], UserPromptSubmit: [{ hooks: h() }], PreToolUse: [{ hooks: h() }], PermissionRequest: [{ hooks: h() }],
    PostToolUse: [{ hooks: h() }], Stop: [{ hooks: h(10) }], Interrupt: [{ hooks: h() }], SubagentStart: [{ hooks: h() }], SubagentStop: [{ hooks: h() }], SessionEnd: [{ hooks: h(10) }],
  };
}
// Gemini CLI (~/.gemini/settings.json): its own event names, timeouts in milliseconds.
export function geminiHooks(command) {
  const h = (timeout = 5000) => [{ type: 'command', command, timeout }];
  return {
    SessionStart: [{ hooks: h(10000) }], BeforeAgent: [{ hooks: h() }], AfterAgent: [{ hooks: h(10000) }], BeforeTool: [{ hooks: h() }],
    AfterTool: [{ hooks: h() }], Notification: [{ hooks: h() }], SessionEnd: [{ hooks: h(10000) }],
  };
}
export const agentFiles = home => ({ codex: path.join(home, '.codex', 'hooks.json'), gemini: path.join(home, '.gemini', 'settings.json') });

export function settingsPath({ user, project }) {
  if (user) return path.join(os.homedir(), '.claude', 'settings.json');
  return path.join(path.resolve(project || process.cwd()), '.claude', 'settings.local.json');
}

const isOurs = group => (group.hooks || []).some(x => typeof x.command === 'string' && x.command.includes(MARK));

export function install(file, command, events = hookConfig(command)) {
  let settings = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    settings = raw.trim() ? JSON.parse(raw) : {};
    fs.writeFileSync(file + '.bak', raw);
  }
  settings.hooks = settings.hooks || {};
  for (const [ev, groups] of Object.entries(events)) {
    const kept = (settings.hooks[ev] || []).filter(g => !isOurs(g));
    settings.hooks[ev] = [...kept, ...groups];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

// MCP tools that only add records or read, so asking each time adds nothing. Merging and importing still ask.
export const SAFE_TOOLS = ['trace_capture_session', 'trace_list_sessions', 'trace_list_threads', 'trace_read_thread', 'trace_log', 'trace_open', 'trace_live', 'trace_bind', 'trace_tasks', 'trace_task_done', 'trace_fork', 'trace_where'].map(t => `mcp__trace-canvas__${t}`);

function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}
export function allowSafeTools(file) {
  const s = readSettings(file);
  s.permissions = s.permissions || {};
  s.permissions.allow = [...new Set([...(s.permissions.allow || []), ...SAFE_TOOLS])];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

// MCP server. User scope goes through `claude mcp add`; a project gets an entry in its .mcp.json.
export function installMcp({ user, project }, cli) {
  if (user) {
    try { execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'trace-canvas'], { stdio: 'ignore' }); } catch {}
    try {
      execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'trace-canvas', '--', 'node', cli, 'mcp'], { stdio: 'pipe' });
      return { ok: true, where: 'user scope (claude mcp add)' };
    } catch (e) {
      return { ok: false, where: 'user scope', hint: `claude mcp add --scope user trace-canvas -- node "${cli}" mcp`, error: String(e.stderr || e.message || e).trim() };
    }
  }
  const file = path.join(path.resolve(project || process.cwd()), '.mcp.json');
  let cfg = {};
  if (fs.existsSync(file)) { const raw = fs.readFileSync(file, 'utf8'); cfg = raw.trim() ? JSON.parse(raw) : {}; fs.writeFileSync(file + '.bak', raw); }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), 'trace-canvas': { command: 'node', args: [cli, 'mcp'] } };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { ok: true, where: file };
}

// MCP for Codex and Gemini, with TRACE_CANVAS_AGENT so the server knows who is calling.
export function installAgentMcp(agent, cli, home = os.homedir()) {
  if (agent === 'codex') {
    try { execFileSync('codex', ['mcp', 'remove', 'trace-canvas'], { stdio: 'ignore' }); } catch {}
    try { execFileSync('codex', ['mcp', 'add', 'trace-canvas', '--env', 'TRACE_CANVAS_AGENT=codex', '--', 'node', cli, 'mcp'], { stdio: 'pipe' }); return { ok: true }; }
    catch (e) { return { ok: false, hint: `codex mcp add trace-canvas --env TRACE_CANVAS_AGENT=codex -- node "${cli}" mcp` }; }
  }
  const file = agentFiles(home).gemini;
  const s = fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  s.mcpServers = { ...(s.mcpServers || {}), 'trace-canvas': { command: 'node', args: [cli, 'mcp'], env: { TRACE_CANVAS_AGENT: 'gemini' } } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  return { ok: true };
}
// Codex runs hooks inside its workspace-write sandbox, which blocks writes outside the project, so
// the data folder goes on the sandbox's writable list. A text edit, since Node has no TOML parser.
// ponytail: a root-level dotted `sandbox_workspace_write.x = …` key would clash with the table; add it by hand then.
export function codexWritable(file, dir) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const entry = JSON.stringify(dir); // a TOML basic string too
  if (raw.includes(entry)) return false;
  let t;
  const head = /^\[sandbox_workspace_write\][^\n]*(\n|$)/m.exec(raw);
  if (!head) t = `${raw.replace(/\n*$/, raw ? '\n\n' : '')}[sandbox_workspace_write]\nwritable_roots = [${entry}]\n`;
  else {
    const start = head.index + head[0].length;
    const end = (/^\[/m.exec(raw.slice(start)) || { index: raw.length - start }).index + start;
    const section = raw.slice(start, end);
    const roots = /^(writable_roots\s*=\s*\[)/m;
    t = raw.slice(0, start) + (roots.test(section) ? section.replace(roots, `$1${entry}, `) : `writable_roots = [${entry}]\n${section}`) + raw.slice(end);
  }
  if (raw) fs.writeFileSync(file + '.bak', raw);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, t);
  return true;
}
export const onPath = cmd => { try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } };

// Skill. Linked rather than copied, so pulling a newer Trace Canvas updates it too.
export function installSkill({ user, project }, skillDir, agent = 'claude') {
  if (agent !== 'claude' && agent !== 'codex') throw new Error(`Skill installation is not supported for ${agent}`);
  const base = path.join(user ? os.homedir() : path.resolve(project || process.cwd()), agent === 'codex' ? '.agents' : '.claude', 'skills');
  const dest = path.join(base, 'trace-canvas');
  fs.mkdirSync(base, { recursive: true });
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) fs.unlinkSync(dest);
    else fs.renameSync(dest, `${dest}.bak-${Date.now()}`);
  } catch {}
  try { fs.symlinkSync(skillDir, dest, 'dir'); }
  catch { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(path.join(skillDir, 'SKILL.md'), path.join(dest, 'SKILL.md')); }
  return dest;
}

export function uninstall(file) {
  if (!fs.existsSync(file)) return false;
  const raw = fs.readFileSync(file, 'utf8');
  const settings = raw.trim() ? JSON.parse(raw) : {};
  if (!settings.hooks) return false;
  fs.writeFileSync(file + '.bak', raw);
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = (settings.hooks[ev] || []).filter(g => !isOurs(g));
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  if (settings.permissions && Array.isArray(settings.permissions.allow)) {
    settings.permissions.allow = settings.permissions.allow.filter(r => !SAFE_TOOLS.includes(r));
    if (!settings.permissions.allow.length) delete settings.permissions.allow;
    if (!Object.keys(settings.permissions).length) delete settings.permissions;
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return true;
}
