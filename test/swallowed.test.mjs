import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// An empty catch (catch {}, catch (e) {}, .catch(() => {}), .catch(() => null)) with nothing after it on its line.
export const silent = text => text.split('\n').map((l, i) => {
  const all = [...l.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\(\)\s*=>\s*(\{\s*\}|null)\)/g)];
  if (!all.length) return 0;
  const last = all[all.length - 1], rest = l.slice(last.index + last[0].length);
  return /\/[/*]\s*\S.{8,}/.test(rest) ? 0 : i + 1;
}).filter(Boolean);

// A scan in place of a lint rule. A failure that is swallowed either does not matter, and then the line says why in a
// comment after the catch, or it matters to the person, and then it is reported (returned, printed, shown on the page).
test('no failure is swallowed without a reason on the same line', () => {
  assert.deepEqual(silent('try { a(); } catch {}\ntry { b(); } catch {} // no file yet: the defaults\nx.catch(() => {});\ntry { c(); } catch { /* already gone, nothing to do */ }\n// why\ntry { d(); } catch (e) {}'), [1, 3, 6]);
  const files = [...['src', 'bin'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).filter(f => f.endsWith('.mjs')).map(f => path.join(d, f))), 'app/index.html'];
  const bad = files.flatMap(f => silent(fs.readFileSync(path.join(ROOT, f), 'utf8')).map(n => `${f}:${n}`));
  assert.deepEqual(bad, [], 'say after the catch why it can be ignored, or report the failure');
});

test('a browser that cannot be opened is reported, not taken as opened', async () => {
  const { openBrowser } = await import('../src/agents.mjs');
  const why = await openBrowser('http://localhost:1/', 'linux', (cmd, args, opts) => spawn('/nonexistent/opener', args, opts));
  assert.match(why, /^xdg-open: ENOENT/);
  assert.equal(await openBrowser('http://localhost:1/', 'linux', (cmd, args, opts) => spawn(process.execPath, ['-e', ''], opts)), '');
});

test('a hook that fails does not fail the turn, and doctor shows what went wrong', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-swallow-')), env = { ...process.env, TRACE_CANVAS_HOME: dir, TRACE_CANVAS_MAP: '', TRACE_CANVAS_DEBUG: '' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/trace-canvas.mjs'), 'hook'], { input: '{"hook_event_name": "Stop", broken', env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const line = JSON.parse(fs.readFileSync(path.join(dir, 'hook-errors.log'), 'utf8').trim());
  assert.match(line.error, /JSON/);
  const { doctor } = await import('../src/doctor.mjs');
  const row = doctor(env, dir).find(x => x.id === 'hook-errors');
  assert.equal(row.ok, 'warn'); assert.match(row.detail, /A hook failed 1 time in the last day.*JSON/);
  fs.rmSync(dir, { recursive: true, force: true });
});
