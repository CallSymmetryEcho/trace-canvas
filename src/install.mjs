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
// iFlow CLI (~/.iflow/settings.json): Claude's events and shape, timeouts in seconds; no SubagentStart.
export function iflowHooks(command) {
  const h = (timeout = 5) => [{ type: 'command', command, timeout }];
  return {
    SessionStart: [{ hooks: h(10) }], UserPromptSubmit: [{ hooks: h() }], PreToolUse: [{ hooks: h() }], PostToolUse: [{ hooks: h() }],
    Notification: [{ hooks: h() }], Stop: [{ hooks: h(10) }], SubagentStop: [{ hooks: h() }], SessionEnd: [{ hooks: h(10) }],
  };
}
// Qwen Code, Qoder and TRAE (experimental): Claude's shape; no timeouts, since their units are not documented alike.
const plainHooks = events => command => Object.fromEntries(events.map(e => [e, [{ ...(/ToolUse$/.test(e) ? { matcher: '*' } : {}), hooks: [{ type: 'command', command }] }]]));
const CLAUDE_LIKE = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
export const agentFiles = home => ({
  codex: path.join(home, '.codex', 'hooks.json'), gemini: path.join(home, '.gemini', 'settings.json'), iflow: path.join(home, '.iflow', 'settings.json'),
  qwen: path.join(home, '.qwen', 'settings.json'), qoder: path.join(home, '.qoder', 'settings.json'), trae: path.join(home, fs.existsSync(path.join(home, '.trae-cn')) ? '.trae-cn' : '.trae', 'hooks.json'),
});
// Kimi Code (~/.kimi-code/config.toml): [[hooks]] tables of event, command and timeout (seconds). A text edit, since
// Node has no TOML parser: our tables, from their header to the next one, are replaced. ponytail: the command goes in
// a literal string, so a path with a ' in it breaks it; KIMI_CODE_HOME is not followed.
const KIMI_EVENTS = { SessionStart: 10, UserPromptSubmit: 5, PreToolUse: 5, PostToolUse: 5, PermissionRequest: 5, Stop: 10, Interrupt: 5, SubagentStart: 5, SubagentStop: 5, SessionEnd: 10 };
export function installKimi(file, command) {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (raw) fs.writeFileSync(file + '.bak', raw);
  const kept = raw.split(/^(?=\[)/m).filter(t => !(t.startsWith('[[hooks]]') && t.includes(MARK))).join('').trimEnd();
  const ours = Object.entries(KIMI_EVENTS).map(([event, t]) => `[[hooks]]\nevent = "${event}"\ncommand = '${command}'\ntimeout = ${t}\n`).join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (kept ? kept + '\n\n' : '') + ours);
}
// DeepSeek Harness: its dsh-hooks-claude-code plugin runs a Claude Code hooks file, and dsh-mcp-client connects an MCP
// server. Both files go in the data folder: the hooks, and a patch that mounts the two plugins on them, to boot with.
export function installDsh(dir, cli) {
  const hooks = path.join(dir, 'dsh-hooks.json'), patch = path.join(dir, 'dsh.patch.yml'), cmd = hookCommand(cli, 'dsh');
  install(hooks, cmd, plainHooks(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop'])(cmd));
  fs.writeFileSync(patch, `# Trace Canvas for DeepSeek Harness: dsh web --patch ${patch}
- insert:
    - id: trace-canvas-hooks
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: ${JSON.stringify(hooks)}
    - id: trace-canvas-mcp
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: trace-canvas
        transport: stdio
        command: ${JSON.stringify(NODE)}
        args: [${JSON.stringify(cli)}, mcp]
        env:
          TRACE_CANVAS_AGENT: dsh
`);
  return patch;
}
// MiniMax Code: a local plugin, in the Claude Code plugin format it also reads (hooks/hooks.json, MCP servers in the
// manifest), in its data folder's plugins/ (the local marketplace). It has no Notification event.
export function installMinimax(home, cli, env = process.env) {
  const data = env.MINIMAX_DATA_DIR || env.MAVIS_DATA_DIR || [path.join(home, '.minimax'), path.join(home, '.mavis')].find(d => fs.existsSync(d)) || path.join(home, '.minimax');
  const root = path.join(data, 'plugins', 'trace-canvas'), cmd = hookCommand(cli, 'minimax');
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'trace-canvas', version: '1.0.0', description: 'Trace Canvas: records this session on the canvas and gives the agent its trace_* tools.', mcpServers: { 'trace-canvas': { command: NODE, args: [cli, 'mcp'], env: { TRACE_CANVAS_AGENT: 'minimax' } } } }, null, 2) + '\n');
  install(path.join(root, 'hooks', 'hooks.json'), cmd, plainHooks(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'SessionEnd'])(cmd));
  return root;
}
// Each other CLI: its hooks and the command that must be on the PATH for setup to wire it, or its own setup, which
// returns what to tell the person.
export const AGENT_SETUP = {
  codex: { hooks: codexHooks, bin: 'codex' }, gemini: { hooks: geminiHooks, bin: 'gemini' }, iflow: { hooks: iflowHooks, bin: 'iflow' },
  qwen: { hooks: plainHooks(CLAUDE_LIKE), bin: 'qwen' }, qoder: { hooks: plainHooks(CLAUDE_LIKE), bin: 'qodercli' }, trae: { hooks: plainHooks(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop']), bin: 'traecli' },
  kimi: { bin: 'kimi', setup: (cli, dir, home = os.homedir()) => {
    const f = path.join(home, '.kimi-code', 'config.toml');
    installKimi(f, hookCommand(cli, 'kimi'));
    installAgentMcp('kimi', cli, home);
    return `hooks in ${f}, MCP in ${path.join(home, '.kimi-code', 'mcp.json')}; start a new Kimi Code session`;
  } },
  dsh: { bin: 'dsh', setup: (cli, dir) => `add its plugins once with: dsh plugin --profile web add @deepseek-ai/dsh-hooks-claude-code @deepseek-ai/dsh-mcp-client
      then start it with: dsh web --patch ${installDsh(dir, cli)}  (or copy that file's entries into ~/.dsh/profiles/web/cordis.patch.yml)` },
  minimax: { bin: 'mcode', setup: (cli, dir, home = os.homedir()) => {
    const root = installMinimax(home, cli);
    try { execFileSync('mcode', ['plugin', 'enable', 'trace-canvas@local'], { stdio: 'ignore', timeout: 20000 }); return `plugin at ${root}, enabled`; }
    catch { return `plugin at ${root}; turn it on with: mcode plugin enable trace-canvas@local`; }
  } },
};

export function settingsPath({ user, project }) {
  if (user) return path.join(os.homedir(), '.claude', 'settings.json');
  return path.join(path.resolve(project || process.cwd()), '.claude', 'settings.local.json');
}

// Hooks and MCP servers start node by its full path: sessions started by a desktop app or over ssh
// often have a PATH without it (on bsuperstation only the system folders).
export const NODE = process.execPath;
export const hookCommand = (cli, agent) => `"${NODE}" "${cli}" hook${agent ? ` --agent ${agent}` : ''}`;
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
      execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'trace-canvas', '--', NODE, cli, 'mcp'], { stdio: 'pipe' });
      return { ok: true, where: 'user scope (claude mcp add)' };
    } catch (e) {
      return { ok: false, where: 'user scope', hint: `claude mcp add --scope user trace-canvas -- "${NODE}" "${cli}" mcp`, error: String(e.stderr || e.message || e).trim() };
    }
  }
  const file = path.join(path.resolve(project || process.cwd()), '.mcp.json');
  let cfg = {};
  if (fs.existsSync(file)) { const raw = fs.readFileSync(file, 'utf8'); cfg = raw.trim() ? JSON.parse(raw) : {}; fs.writeFileSync(file + '.bak', raw); }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), 'trace-canvas': { command: NODE, args: [cli, 'mcp'] } };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  return { ok: true, where: file };
}

// MCP for Codex and Gemini, with TRACE_CANVAS_AGENT so the server knows who is calling.
export function installAgentMcp(agent, cli, home = os.homedir()) {
  if (agent === 'codex') {
    try { execFileSync('codex', ['mcp', 'remove', 'trace-canvas'], { stdio: 'ignore' }); } catch {}
    try { execFileSync('codex', ['mcp', 'add', 'trace-canvas', '--env', 'TRACE_CANVAS_AGENT=codex', '--', NODE, cli, 'mcp'], { stdio: 'pipe' }); return { ok: true }; }
    catch (e) { return { ok: false, hint: `codex mcp add trace-canvas --env TRACE_CANVAS_AGENT=codex -- "${NODE}" "${cli}" mcp` }; }
  }
  // Gemini CLI, iFlow CLI and Qwen Code: mcpServers in their settings.json; Kimi Code: in its mcp.json. The others by hand.
  const file = agent === 'kimi' ? path.join(home, '.kimi-code', 'mcp.json') : ['gemini', 'iflow', 'qwen'].includes(agent) && agentFiles(home)[agent];
  if (!file) return { ok: false, hint: agent === 'qoder' ? `qodercli mcp add trace-canvas -- "${NODE}" "${cli}" mcp` : `add an MCP server running "${NODE}" "${cli}" mcp with TRACE_CANVAS_AGENT=${agent}` };
  const s = fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  s.mcpServers = { ...(s.mcpServers || {}), 'trace-canvas': { command: NODE, args: [cli, 'mcp'], env: { TRACE_CANVAS_AGENT: agent } } };
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
/**
 * The PATH with the user's own bin folders added at the end where they exist: started over ssh or as a service, the
 * canvas gets a PATH without them, and claude and codex usually live there (~/.local/bin and the like).
 */
export function withUserBins(PATH = '', home = os.homedir()) {
  const have = PATH.split(path.delimiter).filter(Boolean);
  const more = [path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
    .filter(d => !have.includes(d) && fs.existsSync(d));
  return [...have, ...more].join(path.delimiter);
}
export const onPath = (cmd, env = process.env) => { try { execFileSync('which', [cmd], { stdio: 'ignore', env }); return true; } catch { return false; } };

// The trace-canvas command: a small script in the user's own bin folder on the PATH (~/.local/bin, ~/bin, else the
// folder of the node on the PATH when it is the user's, as with npm -g; never a system folder), so the README's commands
// work as typed. It runs this clone's CLI with the node that ran setup, as the hooks do:
// another shell (a login shell over ssh, say) may find an older node first. Otherwise the alias line to add.
const CMD_MARK = '# trace-canvas command (setup)';
export function linkCommand(cli, env = process.env, homeDir = os.homedir(), node = NODE) {
  const onIt = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const nodeDir = onIt.find(d => { try { return fs.statSync(path.join(d, 'node')).isFile() && fs.statSync(d).uid === process.getuid(); } catch { return false; } });
  for (const dir of [path.join(homeDir, '.local', 'bin'), path.join(homeDir, 'bin'), nodeDir].filter(Boolean)) {
    if (!onIt.includes(dir)) continue;
    try { fs.accessSync(dir, fs.constants.W_OK); } catch { continue; }
    const dest = path.join(dir, 'trace-canvas');
    let st = null; try { st = fs.lstatSync(dest); } catch {}
    if (st && !st.isSymbolicLink() && !fs.readFileSync(dest, 'utf8').includes(CMD_MARK)) continue; // not ours: leave it
    if (st) fs.unlinkSync(dest);
    fs.writeFileSync(dest, `#!/bin/sh\n${CMD_MARK}\nexec "${node}" "${cli}" "$@"\n`, { mode: 0o755 });
    return { ok: true, where: dest };
  }
  return { hint: `echo "alias trace-canvas='\\"${node}\\" \\"${cli}\\"'" >> ~/.zshrc` };
}

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
