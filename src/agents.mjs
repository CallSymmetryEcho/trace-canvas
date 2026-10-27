// The coding agents Trace Canvas works with, and how each one's hook events map onto the Claude
// Code shape the rest of the code reads. Codex hooks are nearly Claude's (no Notification event:
// a PermissionRequest is what "needs you" looks like); Gemini CLI names its events differently.
// Tools are recognised by the shape of their input, since each CLI names them its own way.
export const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX shell quoting

export const AGENTS = {
  claude: { name: 'Claude Code', resume: id => `claude --resume ${id}`, launch: p => `claude ${q(p)}` },
  codex: { name: 'Codex', resume: id => `codex resume ${id}`, launch: p => `codex ${q(p)}` },
  // ponytail: Gemini's resume flag is unverified until a current gemini-cli is installed.
  gemini: { name: 'Gemini CLI', resume: id => `gemini --resume ${id}`, launch: p => `gemini -i ${q(p)}` },
};
export const agentOf = key => AGENTS[key] || AGENTS.claude;
// AppleScript that runs cmd in a new Terminal window and brings it forward (macOS, "Open in Terminal").
export const terminalScript = cmd => `tell application "Terminal"\n  do script "${String(cmd).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\n  activate\nend tell`;
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
