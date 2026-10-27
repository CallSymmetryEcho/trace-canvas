// Adds or removes the Trace Canvas hooks in a Claude Code settings file.
// Existing settings and other hooks are kept; a backup is written first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARK = 'trace-canvas.mjs" hook';

// PostToolUse and UserPromptSubmit fire often, so they run in the background, as do the
// events that only update the live status (SessionStart, PreToolUse, Notification, SubagentStart/Stop).
// Stop and SessionEnd stay synchronous so the record lands before the session moves on.
export function hookConfig(command) {
  const h = (extra = {}) => [{ type: 'command', command, ...extra }];
  return {
    SessionStart: [{ hooks: h({ async: true }) }],
    UserPromptSubmit: [{ hooks: h({ async: true }) }],
    PreToolUse: [{ hooks: h({ async: true }) }],
    Notification: [{ hooks: h({ async: true }) }],
    SubagentStart: [{ hooks: h({ async: true }) }],
    SubagentStop: [{ hooks: h({ async: true }) }],
    PostToolUse: [{ matcher: 'Bash|Write|Edit|MultiEdit|NotebookEdit|TodoWrite', hooks: h({ async: true }) }],
    Stop: [{ hooks: h({ timeout: 10 }) }],
    SessionEnd: [{ hooks: h({ timeout: 10 }) }],
  };
}

export function settingsPath({ user, project }) {
  if (user) return path.join(os.homedir(), '.claude', 'settings.json');
  return path.join(path.resolve(project || process.cwd()), '.claude', 'settings.local.json');
}

const isOurs = group => (group.hooks || []).some(x => typeof x.command === 'string' && x.command.includes(MARK));

export function install(file, command) {
  let settings = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    settings = raw.trim() ? JSON.parse(raw) : {};
    fs.writeFileSync(file + '.bak', raw);
  }
  settings.hooks = settings.hooks || {};
  for (const [ev, groups] of Object.entries(hookConfig(command))) {
    const kept = (settings.hooks[ev] || []).filter(g => !isOurs(g));
    settings.hooks[ev] = [...kept, ...groups];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

// MCP tools that only add records or read, so asking each time adds nothing. Merging and importing still ask.
export const SAFE_TOOLS = ['trace_capture_session', 'trace_list_sessions', 'trace_list_threads', 'trace_read_thread', 'trace_log', 'trace_open', 'trace_live', 'trace_bind', 'trace_tasks', 'trace_task_done', 'trace_fork'].map(t => `mcp__trace-canvas__${t}`);

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

// Skill. Linked rather than copied, so pulling a newer Trace Canvas updates it too.
export function installSkill({ user, project }, skillDir) {
  const base = user ? path.join(os.homedir(), '.claude', 'skills') : path.join(path.resolve(project || process.cwd()), '.claude', 'skills');
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
