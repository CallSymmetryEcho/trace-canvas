// Is a long-running process (the page server, a session's MCP server) on older code than its own clone now has?
// It notes the commit it started from; stale means src/ or bin/ changed between that and the clone's HEAD (a page-only
// or docs-only change needs no restart). Not a git clone, or nothing changed: ''.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (root, args) => { try { return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000 }); } catch { return { status: -1, stdout: '' }; } };
export const repoHead = (root = ROOT) => String(git(root, ['rev-parse', 'HEAD']).stdout || '').trim();
/** '' when the process is on the clone's code; else the clone's HEAD it has fallen behind. */
export function staleAgainst(head0, root = ROOT) {
  const now = repoHead(root);
  return head0 && now && now !== head0 && git(root, ['diff', '--quiet', head0, now, '--', 'src', 'bin']).status === 1 ? now : '';
}
