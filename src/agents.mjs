// The coding agents Trace Canvas works with, and how each one's hook events map onto the Claude
// Code shape the rest of the code reads. Codex hooks are nearly Claude's (no Notification event:
// a PermissionRequest is what "needs you" looks like); Gemini CLI names its events differently.
// Tools are recognised by the shape of their input, since each CLI names them its own way.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readConfig } from './store.mjs';

export const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX shell quoting

export const AGENTS = {
  // remote: Remote Control on, named after the line, so the session shows in the Claude app (▶ Start).
  // wake: resume the session with a first message (Dispatch).
  claude: { name: 'Claude Code', resume: id => `claude --resume ${id}`, wake: (id, p) => `claude --resume ${id} ${q(p)}`, launch: p => `claude ${q(p)}`, remote: (name, p) => `claude --remote-control=${q(name)} ${q(p)}` },
  codex: { name: 'Codex', resume: id => `codex resume ${id}`, wake: (id, p) => `codex resume ${id} ${q(p)}`, launch: p => `codex ${q(p)}` },
  // ponytail: Gemini's resume flag is unverified until a current gemini-cli is installed.
  gemini: { name: 'Gemini CLI', resume: id => `gemini --resume ${id}`, wake: (id, p) => `gemini --resume ${id} -i ${q(p)}`, launch: p => `gemini -i ${q(p)}` },
};
export const agentOf = key => AGENTS[key] || AGENTS.claude;
// AppleScript that runs cmd in a new Terminal window and brings it forward (macOS, "Open in Terminal").
const asText = cmd => `"${String(cmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const terminalScript = cmd => `tell application "Terminal"\n  do script ${asText(cmd)}\n  activate\nend tell`;
// iTerm2 opens a new tab in its front window (a window when it has none), so agents do not pile up as windows.
export const itermScript = cmd => `tell application "iTerm"\n  activate\n  if (count of windows) = 0 then\n    create window with default profile\n  else\n    tell current window to create tab with default profile\n  end if\n  tell current session of current window to write text ${asText(cmd)}\nend tell`;
// Which macOS terminal opens agents: the one chosen (trace-canvas terminal iterm|terminal), else iTerm2 when installed.
export const macTerminal = (env = process.env, has = p => fs.existsSync(p)) => {
  const pick = env.TRACE_CANVAS_TERMINAL || readConfig(env).terminal;
  if (pick === 'iterm' || pick === 'terminal') return pick;
  return ['/Applications/iTerm.app', path.join(env.HOME || '', 'Applications', 'iTerm.app')].some(has) ? 'iterm' : 'terminal';
};

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
  if (platform === 'darwin') return ['osascript', ['-e', (macTerminal(env) === 'iterm' ? itermScript : terminalScript)(cmd)], env];
  if (platform !== 'linux') return null;
  const shown = desktopEnv(env);
  const term = shown && [env.TERMINAL, 'x-terminal-emulator', 'konsole', 'gnome-terminal', 'xfce4-terminal', 'kitty', 'alacritty', 'wezterm', 'xterm'].filter(Boolean).map(t => [path.basename(t), which(t, env) || (path.isAbsolute(t) && t)]).find(([, p]) => p);
  if (!term) return null;
  const sh = env.SHELL || '/bin/sh', run = [sh, '-lc', `${cmd}; exec ${q(sh)} -l`];
  // A new tab where the terminal has a flag for it; a new window everywhere else.
  const lead = { konsole: ['--new-tab', '-e'], 'gnome-terminal': ['--tab', '--'], 'xfce4-terminal': ['--tab', '-x'], wezterm: ['start', '--'] }[term[0]] || ['-e'];
  return [term[1], [...lead, ...run], shown];
}
/**
 * Runs cmd in a new terminal window. Resolves to null once the window is open, or to why it is not.
 * macOS waits for Terminal's answer: an Automation prompt left unanswered times out after 2 minutes, and a
 * denied one (error -1743) fails at once, so nobody is told an agent started when no window opened.
 */
export function openTerminal(cmd, env = process.env) {
  const t = terminalCommand(cmd, env);
  if (!t) return Promise.resolve('no terminal to open on this machine');
  if (t[0] === 'osascript') return new Promise(done => execFile(t[0], t[1], { env: t[2], timeout: 150e3 }, (err, out, errOut) => {
    if (!err) return done(null);
    const why = String(errOut || err.message).trim();
    done(/-1743|not allowed|Not authorized/i.test(why) ? `macOS did not allow this app to control the terminal (System Settings → Privacy & Security → Automation): ${why}`
      : /-1712|timed out/i.test(why) || err.killed ? `Terminal did not answer in time; an Automation prompt may be waiting for an answer: ${why}` : why);
  }));
  return new Promise(done => {
    const c = spawn(t[0], t[1], { stdio: 'ignore', detached: true, env: t[2] });
    c.on('error', e => done(e.message)).on('spawn', () => { c.unref(); done(null); });
  });
}
// AppleScript that brings the Terminal or iTerm2 tab with this tty to the front and prints "ok",
// or nothing when no tab has it (Go to the terminal). null for other terminals.
export function focusScript({ tty = '', term = '' } = {}) {
  if (!/^\/dev\/ttys\d+$/.test(tty)) return null;
  if (term === 'Apple_Terminal') return `tell application "Terminal"\n  repeat with w in windows\n    repeat with t in tabs of w\n      if tty of t is "${tty}" then\n        set selected of t to true\n        set index of w to 1\n        activate\n        return "ok"\n      end if\n    end repeat\n  end repeat\nend tell`;
  if (term === 'iTerm.app') return `tell application "iTerm2"\n  repeat with w in windows\n    repeat with t in tabs of w\n      repeat with s in sessions of t\n        if tty of s is "${tty}" then\n          tell w to select\n          tell t to select\n          tell s to select\n          activate\n          return "ok"\n        end if\n      end repeat\n    end repeat\n  end repeat\nend tell`;
  return null;
}
const run = (file, args) => new Promise(done => execFile(file, args, { timeout: 5000 }, (err, out) => done(err ? null : String(out))));
const dbus = (dest, obj, method, ...args) => run('gdbus', ['call', '--session', '--dest', dest, '--object-path', obj, '--method', method, ...args]);
const SEARCH = ['org.gnome.Terminal', '/org/gnome/Terminal/SearchProvider', 'org.gnome.Shell.SearchProvider2.'];
/**
 * Go to the terminal: brings a live session's tab to the front; true when it did. On a Mac the Terminal or iTerm2
 * tab with its tty. On Linux the GNOME Terminal or Konsole tab terminalOf noted, selected over D-Bus; KDE does not
 * let an app raise itself over another (focus-stealing prevention), so wmctrl raises the window (X11).
 * ponytail: with several GNOME Terminal windows open only the tab is selected (its window asks for attention);
 * Konsole's /Windows/N is taken to be its /konsole/MainWindow_N; Wayland raises nothing past what the app does.
 */
export async function focusTab({ tty = '', term = '', tab = '' } = {}) {
  const script = focusScript({ tty, term });
  if (script) return (await run('osascript', ['-e', script]) || '').trim() === 'ok';
  if (term === 'gnome-terminal') {
    const id = tab.replace('/org/gnome/Terminal/screen/', '').replace(/_/g, '-');
    // Its search provider knows each tab by this id: no result means the tab is closed.
    if (!/^[0-9a-f-]{36}$/.test(id) || !/'id'/.test(await dbus(SEARCH[0], SEARCH[1], SEARCH[2] + 'GetResultMetas', `['${id}']`) || '')) return false;
    await dbus(SEARCH[0], SEARCH[1], SEARCH[2] + 'ActivateResult', id, '[]', '0');
    const wins = (await run('wmctrl', ['-lx']) || '').split('\n').filter(l => /\sgnome-terminal-server\./.test(l));
    if (wins.length === 1) await run('wmctrl', ['-i', '-a', wins[0].split(/\s/)[0]]);
    return true;
  }
  const [svc, win, ses] = tab.split(' ');
  if (term !== 'konsole' || !/^(:\d+\.\d+|org\.kde\.konsole[\w.-]*)$/.test(svc) || !/^\/Windows\/\d+$/.test(win) || !/^\/Sessions\/\d+$/.test(ses)) return false;
  if (await dbus(svc, ses, 'org.kde.konsole.Session.title', '0') == null) return false; // the tab, or Konsole, is closed
  await dbus(svc, win, 'org.kde.konsole.Window.setCurrentSession', ses.slice('/Sessions/'.length));
  const wid = / (\d+),\)/.exec(await dbus(svc, '/konsole/MainWindow_' + win.slice('/Windows/'.length), 'org.kde.KMainWindow.winId') || '');
  if (wid) await run('wmctrl', ['-i', '-a', '0x' + Number(wid[1]).toString(16)]);
  return true;
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
  if (k === 'codex') {
    // Our hook prints nothing for it, so Codex asks the person as usual.
    if (ev === 'PermissionRequest') { ev = 'Notification'; out.notification_type = 'permission_prompt'; out.message = input.message || `${input.tool_name || 'A tool'} needs your permission`; }
    if (ev === 'Interrupt') ev = 'Stop';
  }
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
  if (typeof input.tool_response === 'string') out.tool_response = { stdout: input.tool_response };
  return out;
}
