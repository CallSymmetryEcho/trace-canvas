// The coding agents Trace Canvas works with, and how each one's hook events map onto the Claude
// Code shape the rest of the code reads. Codex hooks are nearly Claude's (no Notification event:
// a PermissionRequest is what "needs you" looks like); Gemini CLI names its events differently.
// Tools are recognised by the shape of their input, since each CLI names them its own way.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX shell quoting

export const AGENTS = {
  // remote: Remote Control on, named after the line, so the session shows in the Claude app (▶ Start).
  // wake: resume the session with a first message (Dispatch).
  claude: { name: 'Claude Code', resume: id => `claude --resume ${id}`, wake: (id, p) => `claude --resume ${id} ${q(p)}`, launch: p => `claude ${q(p)}`, remote: (name, p) => `claude --remote-control=${q(name)} ${q(p)}` },
  codex: { name: 'Codex', resume: id => `codex resume ${id}`, wake: (id, p) => `codex resume ${id} ${q(p)}`, launch: p => `codex ${q(p)}` },
  // ponytail: Gemini's resume flag is unverified until a current gemini-cli is installed.
  gemini: { name: 'Gemini CLI', resume: id => `gemini --resume ${id}`, wake: (id, p) => `gemini --resume ${id} -i ${q(p)}`, launch: p => `gemini -i ${q(p)}` },
  // iFlow CLI (Alibaba): Claude Code's hook events and payload, Claude Code-format transcripts in ~/.iflow/projects.
  iflow: { name: 'iFlow CLI', resume: id => `iflow -r ${id}`, wake: (id, p) => `iflow -r ${id} -i ${q(p)}`, launch: p => `iflow -i ${q(p)}` },
  // Experimental, from their docs and source, not yet run here. ponytail: TRAE documents no resume flag, so its is a guess.
  qwen: { name: 'Qwen Code', experimental: true, resume: id => `qwen --resume ${id}`, wake: (id, p) => `qwen --resume ${id} -i ${q(p)}`, launch: p => `qwen -i ${q(p)}` },
  qoder: { name: 'Qoder CLI', experimental: true, resume: id => `qodercli -r ${id}`, wake: (id, p) => `qodercli -r ${id} ${q(p)}`, launch: p => `qodercli ${q(p)}` },
  trae: { name: 'TRAE CLI', experimental: true, resume: id => `traecli resume ${id}`, wake: (id, p) => `traecli resume ${id} ${q(p)}`, launch: p => `traecli ${q(p)}` },
  // Kimi Code takes no first message in its terminal UI: a message runs as one non-interactive turn (-p).
  kimi: { name: 'Kimi Code', experimental: true, resume: id => `kimi --session ${id}`, wake: (id, p) => `kimi --session ${id} -p ${q(p)}`, launch: p => `kimi -p ${q(p)}` },
  // DeepSeek Harness: sessions are opened in its web UI; a message runs as one headless task in the session.
  dsh: { name: 'DeepSeek Harness', experimental: true, resume: () => 'dsh web', wake: (id, p) => `dsh headless --session-id ${id} ${q(p)}`, launch: p => `dsh headless ${q(p)}` },
  minimax: { name: 'MiniMax Code', experimental: true, resume: id => `mcode --session ${id}`, wake: (id, p) => `mcode --session ${id} ${q(p)}`, launch: p => `mcode ${q(p)}` },
};
// Claude Code pointed at another model's Anthropic-compatible API (ANTHROPIC_BASE_URL): whose model it runs.
const PROVIDERS = [[/deepseek/i, 'DeepSeek'], [/moonshot|kimi/i, 'Kimi'], [/dashscope|aliyuncs|qwen/i, 'Qwen'], [/minimax/i, 'MiniMax'], [/bigmodel|zhipu|z\.ai/i, 'GLM'], [/volces|volcengine|ark\.cn/i, 'Doubao'], [/siliconflow/i, 'SiliconFlow'], [/openrouter/i, 'OpenRouter']];
export function modelProvider(env = process.env) {
  const url = String(env.ANTHROPIC_BASE_URL || '');
  if (!url || /anthropic\.com/i.test(url)) return '';
  return (PROVIDERS.find(([re]) => re.test(url)) || [])[1] || '';
}
export const agentOf = key => AGENTS[key] || AGENTS.claude;
// AppleScript that runs cmd in a new Terminal window and brings it forward (macOS, "Open in Terminal").
export const terminalScript = cmd => `tell application "Terminal"\n  do script "${String(cmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n  activate\nend tell`;

// The desktop session's display, for a server started over ssh, which has none: borrowed from the desktop shell's own
// environment (this user's processes only). env itself when it has a display; null when there is no desktop.
function desktopEnv(env) {
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return env;
  const KEEP = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR'];
  for (const pid of fs.existsSync('/proc') ? fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)) : []) {
    try {
      if (fs.statSync(`/proc/${pid}`).uid !== process.getuid() || !/^(plasmashell|gnome-shell|kwin_x11|kwin_wayland|xfce4-session|cinnamon|mate-session|sway|Hyprland)$/.test(fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim())) continue;
      const vars = Object.fromEntries(fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
      if (vars.DISPLAY || vars.WAYLAND_DISPLAY) return { ...env, ...Object.fromEntries(KEEP.filter(k => vars[k]).map(k => [k, vars[k]])) };
    } catch {}
  }
  return null;
}
const which = (name, env) => (env.PATH || '').split(path.delimiter).map(d => path.join(d, name)).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });

/**
 * How to run cmd in a new terminal window ("Open in Terminal", ▶ Start, dispatch): [program, args, env], or null when
 * this machine has no terminal to open. macOS: Terminal. Linux: $TERMINAL, then the usual ones, on the desktop's
 * display; the window stays open in a login shell once cmd is done. Going to an existing tab is macOS only.
 */
export function terminalCommand(cmd, env = process.env, platform = process.platform) {
  if (platform === 'darwin') return ['osascript', ['-e', terminalScript(cmd)], env];
  if (platform !== 'linux') return null;
  const shown = desktopEnv(env);
  const term = shown && [env.TERMINAL, 'x-terminal-emulator', 'konsole', 'gnome-terminal', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'xterm'].filter(Boolean).map(t => [path.basename(t), which(t, env) || (path.isAbsolute(t) && t)]).find(([, p]) => p);
  if (!term) return null;
  const sh = env.SHELL || '/bin/sh', run = [sh, '-lc', `${cmd}; exec ${q(sh)} -l`];
  const lead = { 'gnome-terminal': ['--'], 'xfce4-terminal': ['-x'], wezterm: ['start', '--'] }[term[0]] || ['-e'];
  return [term[1], [...lead, ...run], shown];
}
/** Runs cmd in a new terminal window; false when there is none to open. */
export function openTerminal(cmd, env = process.env) {
  const t = terminalCommand(cmd, env);
  if (!t) return false;
  spawn(t[0], t[1], { stdio: 'ignore', detached: true, env: t[2] }).unref();
  return true;
}
// AppleScript that brings the Terminal or iTerm2 tab with this tty to the front and prints "ok",
// or nothing when no tab has it (Go to the terminal). null for other terminals.
export function focusScript({ tty = '', term = '' } = {}) {
  if (!/^\/dev\/ttys\d+$/.test(tty)) return null;
  if (term === 'Apple_Terminal') return `tell application "Terminal"\n  repeat with w in windows\n    repeat with t in tabs of w\n      if tty of t is "${tty}" then\n        set selected of t to true\n        set index of w to 1\n        activate\n        return "ok"\n      end if\n    end repeat\n  end repeat\nend tell`;
  if (term === 'iTerm.app') return `tell application "iTerm2"\n  repeat with w in windows\n    repeat with t in tabs of w\n      repeat with s in sessions of t\n        if tty of s is "${tty}" then\n          tell w to select\n          tell t to select\n          tell s to select\n          activate\n          return "ok"\n        end if\n      end repeat\n    end repeat\n  end repeat\nend tell`;
  return null;
}
// Which agent the current process serves: set in each CLI's MCP config; Claude Code needs none.
export const agentKey = (env = process.env) => (AGENTS[env.TRACE_CANVAS_AGENT] ? env.TRACE_CANVAS_AGENT : 'claude');

const GEMINI_EVENTS = { BeforeAgent: 'UserPromptSubmit', AfterAgent: 'Stop', BeforeTool: 'PreToolUse', AfterTool: 'PostToolUse' };
const PATCH_FILE = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;

// ["bash", "-lc", "git commit …"] → "git commit …"; a string stays as it is.
function commandOf(c) {
  if (!Array.isArray(c)) return String(c);
  const i = c.findIndex(x => x === '-lc' || x === '-c');
  return String(i >= 0 && c[i + 1] != null ? c[i + 1] : c.join(' '));
}

/** Turns one hook payload from the `key` CLI into the shape handleHook expects; `_agent` says whose it is. */
export function normalize(key, input) {
  if (!input || typeof input !== 'object') return input;
  const k = AGENTS[key] ? key : 'claude';
  const out = { ...input, _agent: k };
  if (k === 'claude') return out;
  let ev = input.hook_event_name;
  if (k === 'gemini') {
    ev = GEMINI_EVENTS[ev] || ev;
    if (input.hook_event_name === 'AfterAgent') out.last_assistant_message = input.prompt_response || input.last_assistant_message || '';
    if (ev === 'Notification' && /permission/i.test(String(input.notification_type || ''))) out.notification_type = 'permission_prompt';
  }
  // Codex, Kimi Code and MiniMax Code have no Notification event: a PermissionRequest is what "needs you" looks like.
  // Our hook prints nothing for it, so the CLI asks the person as usual. Interrupt ends a turn in place of Stop.
  if (k === 'codex' || k === 'kimi' || k === 'minimax') {
    if (ev === 'PermissionRequest') { ev = 'Notification'; out.notification_type = 'permission_prompt'; out.message = input.message || `${input.tool_name || 'A tool'} needs your permission`; }
    if (ev === 'Interrupt') ev = 'Stop';
  }
  // Kimi Code: the prompt as content parts, the tool's result as tool_output.
  if (Array.isArray(input.prompt)) out.prompt = input.prompt.map(p => (p && typeof p.text === 'string' ? p.text : '')).join('');
  if (typeof input.tool_output === 'string' && input.tool_response == null) out.tool_response = input.tool_output;
  out.hook_event_name = ev;
  const ti = input.tool_input;
  if (ti && typeof ti === 'object' && (ev === 'PreToolUse' || ev === 'PostToolUse')) {
    const cmd = ti.command != null ? commandOf(ti.command) : null;
    const patch = [ti.patch, ti.input, cmd].find(s => typeof s === 'string' && /\*\*\* (Begin Patch|(Add|Update|Delete) File:)/.test(s));
    const file = ti.file_path || ti.absolute_path || ti.path;
    if (patch) {
      const files = [...patch.matchAll(PATCH_FILE)].map(m => m[1].trim());
      out.tool_name = 'Edit'; out.tool_input = { files, file_path: files[0] };
    } else if (cmd != null) {
      out.tool_name = 'Bash'; out.tool_input = { ...ti, command: cmd };
    } else if (file && ('content' in ti || 'old_string' in ti || 'new_string' in ti)) {
      out.tool_name = 'Edit'; out.tool_input = { ...ti, file_path: file }; // Gemini write_file / replace
    }
  }
  if (typeof out.tool_response === 'string') out.tool_response = { stdout: out.tool_response };
  // A CLI that does not hand the reply to its Stop hook (iFlow): the last thing the agent said, from its transcript.
  if (ev === 'Stop' && !out.last_assistant_message && input.transcript_path) out.last_assistant_message = lastReply(input.transcript_path);
  return out;
}

// The text of the newest assistant message in a Claude Code-format transcript (its last 256 KB), or ''.
export function lastReply(file) {
  try {
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size, n = Math.min(size, 256 * 1024), buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd);
    for (const line of buf.toString('utf8').split('\n').reverse()) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== 'assistant' || !j.message) continue;
      const c = j.message.content, text = typeof c === 'string' ? c : (c || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n');
      if (text.trim()) return text.trim();
    }
  } catch {}
  return '';
}
