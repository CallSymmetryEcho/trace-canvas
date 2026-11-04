// trace-canvas doctor: the setup problems people actually hit, checked in one go, each with one line on how to fix it.
// Read-only and quick (no network but Tailscale's local status): the CLI prints it, More → Check setup shows it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { home, readConfig } from './store.mjs';
import { systemdUnit } from './live.mjs';
import { syncStatus } from './sync.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_NODE = [18, 17];
const older = (v, [a, b]) => { const [x, y] = String(v).replace(/^v/, '').split('.').map(Number); return x < a || (x === a && y < b); };
const run = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// This computer on Tailscale, or null when Tailscale is not running: { dns, ip }.
export function tailscaleSelf() {
  for (const bin of ['tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale']) {
    try {
      const s = JSON.parse(execFileSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      const self = s.Self || {}, ip = (self.TailscaleIPs || []).find(a => a.includes('.'));
      return s.BackendState === 'Running' && self.DNSName && ip ? { dns: self.DNSName.replace(/\.$/, ''), ip } : null;
    } catch {}
  }
  return null;
}

/** Every check: { id, ok: true | false | 'warn', detail, fix? }. */
export function doctor(env = process.env, homeDir = os.homedir()) {
  const out = [], add = (id, ok, detail, fix) => out.push({ id, ok, detail, ...(ok === true ? {} : { fix }) });
  const cfg = readConfig(env);

  // Node: the one running this, and the one a plain `node` in a terminal finds (it is the one people run by hand).
  const pathNode = run('node', ['-v']);
  if (older(process.versions.node, MIN_NODE)) add('node', false, `Node ${process.versions.node}`, `Install Node ${MIN_NODE.join('.')} or newer`);
  else if (pathNode && older(pathNode, MIN_NODE)) add('node', 'warn', `Node ${process.versions.node} here, but \`node\` in a terminal is ${pathNode}`, `Put a newer Node first on PATH, or always start it with the trace-canvas command`);
  else add('node', true, `Node ${process.versions.node}`);

  // Hooks, MCP server and skill for Claude Code (user scope). Hooks name node by its full path: it must still exist.
  const hooks = JSON.stringify((readJson(path.join(homeDir, '.claude', 'settings.json')) || {}).hooks || {});
  const hookNode = (hooks.match(/\\"([^"\\]+)\\" \\"[^"\\]*trace-canvas[^"\\]*\\" hook/) || [])[1];
  if (!hooks.includes('trace-canvas')) add('hooks', false, 'No Trace Canvas hooks in ~/.claude/settings.json', 'trace-canvas setup --user');
  else if (hookNode && !fs.existsSync(hookNode)) add('hooks', false, `The hooks start ${hookNode}, which is gone`, 'trace-canvas setup --user (writes the current Node into them)');
  else add('hooks', true, 'Claude Code hooks are installed');
  const mcp = ((readJson(path.join(homeDir, '.claude.json')) || {}).mcpServers || {})['trace-canvas'];
  add('mcp', mcp ? true : false, mcp ? 'MCP server is registered' : 'No trace-canvas MCP server for Claude Code', 'trace-canvas setup --user');
  const skill = fs.existsSync(path.join(homeDir, '.claude', 'skills', 'trace-canvas', 'SKILL.md'));
  add('skill', skill ? true : false, skill ? '/trace-canvas skill is installed' : 'The /trace-canvas skill is missing', 'trace-canvas setup --user');

  // The page server, and whether it comes back after a restart.
  const srv = readJson(path.join(home(env), 'server.json'));
  const up = srv && alive(srv.pid);
  add('server', up ? true : false, up ? `Page server runs on port ${srv.port}` : 'The page server is not running', 'trace-canvas serve');
  const unit = up && systemdUnit(srv.pid);
  const agent = process.platform === 'darwin' && (() => { try { return fs.readdirSync(path.join(homeDir, 'Library', 'LaunchAgents')).some(f => /trace-canvas/i.test(f)); } catch { return false; } })();
  if (unit || agent) add('autostart', true, unit ? `Starts with the computer (systemd ${unit.name})` : 'Starts with the computer (launchd)');
  else add('autostart', 'warn', 'Does not start with the computer: after a restart the page is down until you run it', process.platform === 'linux' ? 'A systemd user service (see the FAQ)' : process.platform === 'darwin' ? 'A launchd agent (see the FAQ)' : 'Start it with trace-canvas serve after a restart');

  // Version: commits waiting upstream (as of the last fetch; the page and update fetch).
  const behind = Number(run('git', ['-C', ROOT, 'rev-list', '--count', 'HEAD..@{u}']));
  const version = (readJson(path.join(ROOT, 'package.json')) || {}).version;
  if (behind > 0) add('version', 'warn', `${version}, ${behind} new commit${behind === 1 ? '' : 's'} upstream`, 'trace-canvas update');
  else add('version', true, `Version ${version}${run('git', ['-C', ROOT, 'status', '--porcelain', '--untracked-files=no']) ? ' (with local changes)' : ''}`);

  // Sync through the location map: set up, last result, other machines gone quiet.
  if (!cfg.map) add('sync', 'warn', 'No location map: this canvas does not sync with other machines', 'Only if you use several machines: setup --map <folder of your map repository>');
  else {
    const st = syncStatus(env);
    if (!st) add('sync', 'warn', 'Not synced yet', 'trace-canvas sync');
    else if (st.failed) add('sync', false, `The last sync failed: ${st.failed}`, 'Check that the map repository can be reached (git -C <map> pull), then trace-canvas sync');
    else add('sync', true, 'The last sync worked');
    const quiet = Object.entries((st && st.others) || {}).filter(([, ts]) => Date.now() - ts > 864e5);
    if (quiet.length) add('machines', 'warn', `Not updated in over a day: ${quiet.map(([m, ts]) => `${m} (${Math.floor((Date.now() - ts) / 864e5)} d)`).join(', ')}`, 'That machine may be off, or its sync failing: run trace-canvas doctor there');
  }

  // Phone access needs Tailscale up (when it is on).
  if (cfg.phone && !cfg.phone.bind?.startsWith?.('0.')) {
    const ts = tailscaleSelf();
    add('phone', ts ? true : false, ts ? 'Tailscale is up for the phone' : 'Phone access is on but Tailscale is not running', 'Open Tailscale, then restart the page server');
  }
  return out;
}
