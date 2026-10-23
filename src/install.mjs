// Adds or removes the Trace Canvas hooks in a Claude Code settings file.
// Existing settings and other hooks are kept; a backup is written first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARK = 'trace-canvas.mjs" hook';

// PostToolUse and UserPromptSubmit fire often, so they run in the background.
// Stop and SessionEnd stay synchronous so the record lands before the session moves on.
export function hookConfig(command) {
  const h = (extra = {}) => [{ type: 'command', command, ...extra }];
  return {
    UserPromptSubmit: [{ hooks: h({ async: true }) }],
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
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return true;
}
