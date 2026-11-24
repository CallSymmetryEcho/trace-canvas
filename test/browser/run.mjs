// npm run test:browser: every browser regression in this folder, each on data of its own. It makes a temporary home,
// seeds it (<name>.seed.mjs), starts a page server and one headless Chrome on free ports, runs <name>.mjs and stops what
// it started; nothing reads or writes ~/.trace-canvas. Without a Chrome it says so and ends with status 0
// ("SKIPPED", not "PASSED"): set CHROME to the browser's path to point it at one.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../..');
const TESTS = ['merge-groups', 'goals-redraw', 'hand-copy'];
const onPath = n => (process.env.PATH || '').split(path.delimiter).map(d => path.join(d, n)).find(existsSync);
const chrome = process.env.CHROME || ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].map(onPath).find(Boolean)
  || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(existsSync);
if (process.env.CHROME && !existsSync(process.env.CHROME)) { console.error(`FAILED: CHROME is set to ${process.env.CHROME}, which is not there`); process.exit(1); }
if (!chrome) { console.log('SKIPPED: no Chrome found (set CHROME to its path). No browser test ran.'); process.exit(0); }

const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const up = async (url, ms = 15000) => { for (const end = Date.now() + ms; Date.now() < end;) { try { if ((await fetch(url)).ok) return true; } catch { /* not listening yet: try again */ } await new Promise(r => setTimeout(r, 200)); } return false; };
const tmp = mkdtempSync(path.join(os.tmpdir(), 'tc-browser-')), kids = [];
// Stops what this run started (and only that), waits for it to go, then removes the temporary folder.
const gone = k => new Promise(r => { if (k.exitCode !== null || k.signalCode) return r(); k.once('exit', r); k.kill(); setTimeout(() => { k.kill('SIGKILL'); }, 3000).unref(); });
const finish = async code => { await Promise.all(kids.map(gone)); 
  // Chrome's helper processes go on writing their profile for a moment after it exits: try a few times, then say so.
  for (let i = 0; ; i++) { try { rmSync(tmp, { recursive: true, force: true }); break; } catch (e) { if (i === 15) { console.error(`Left behind: ${tmp} (${e.code})`); break; } await new Promise(r => setTimeout(r, 300)); } }
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => finish(130));

const cdp = await freePort();
kids.push(spawn(chrome, ['--headless=new', `--remote-debugging-port=${cdp}`, `--user-data-dir=${path.join(tmp, 'chrome')}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' }));
if (!await up(`http://127.0.0.1:${cdp}/json/version`)) { console.error(`FAILED: Chrome did not start (${chrome})`); await finish(1); }

let failed = 0;
for (const name of TESTS) {
  const home = path.join(tmp, name), port = await freePort();
  const env = { ...process.env, HOME: home, TRACE_CANVAS_HOME: path.join(home, 'data'), TRACE_CANVAS_MAP: '', TRACE_CANVAS_MACHINE: 'verify', CDP_PORT: String(cdp) };
  const node = (args, opts = {}) => spawnSync(process.execPath, args, { cwd: repo, env, encoding: 'utf8', ...opts });
  const seed = node([path.join(here, name + '.seed.mjs')]);
  if (seed.status !== 0) { console.error(`FAILED ${name}: seeding\n${seed.stderr}`); failed++; continue; }
  const server = spawn(process.execPath, [path.join(repo, 'bin/trace-canvas.mjs'), 'serve', '--no-open', '--port', String(port)], { cwd: repo, env, stdio: 'ignore' });
  kids.push(server);
  if (!await up(`http://127.0.0.1:${port}/api/health`)) { console.error(`FAILED ${name}: the page server did not start`); failed++; server.kill(); continue; }
  const r = node([path.join(here, name + '.mjs'), `http://127.0.0.1:${port}/`], { timeout: 120000 });
  server.kill();
  if (r.status === 0) console.log(`ok ${name}`); else { failed++; console.error(`FAILED ${name}\n${r.stdout}\n${r.stderr}`); }
}
console.log(failed ? `FAILED: ${failed} of ${TESTS.length}` : `PASSED: ${TESTS.length} browser tests`);
await finish(failed ? 1 : 0);
