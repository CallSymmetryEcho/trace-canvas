import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importText, emptyData, mutate, readData } from '../src/store.mjs';
import { allowSafeTools, install, uninstall } from '../src/install.mjs';

test('importText reads agent JSON lines and creates missing threads', () => {
  const d = emptyData();
  const n = importText(d, '{"thread":"Proposal","kind":"agent","title":"Outline done","agent":"Codex"}\n{"title":"Loose idea","kind":"idea"}\nnot json');
  assert.equal(n, 2);
  const threads = Object.values(d.threads);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].name, 'Proposal');
  const cs = Object.values(d.commits);
  assert.equal(cs.find(c => c.title === 'Outline done').thread, threads[0].id);
  assert.equal(cs.find(c => c.title === 'Loose idea').thread, 'inbox');
});

test('concurrent writers through the lock never lose records', async () => {
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-lock-')) };
  const { spawn } = await import('node:child_process');
  const script = `import { mutate, addCommit } from ${JSON.stringify(new URL('../src/store.mjs', import.meta.url).href)};
    for (let i = 0; i < 25; i++) mutate(d => { addCommit(d, { title: process.argv[1] + i }); }, process.env);`;
  await Promise.all([1, 2, 3, 4].map(k => new Promise((res, rej) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', script, `w${k}-`], { env, stdio: 'inherit' });
    p.on('exit', code => code === 0 ? res() : rej(new Error('writer failed')));
  })));
  assert.equal(Object.keys(readData(env).commits).length, 100);
});

test('install keeps other settings and hooks, uninstall removes only ours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-set-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
  install(file, 'node "/opt/tc/bin/trace-canvas.mjs" hook');
  install(file, 'node "/opt/tc/bin/trace-canvas.mjs" hook');
  let s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(s.model, 'x');
  assert.equal(s.hooks.Stop.length, 2);
  assert.equal(s.hooks.PostToolUse.length, 1);
  assert.equal(s.hooks.PostToolUse[0].hooks[0].async, true);
  assert.ok(fs.existsSync(file + '.bak'));
  allowSafeTools(file);
  s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(s.permissions.allow.includes('mcp__trace-canvas__trace_capture_session'));
  assert.ok(!s.permissions.allow.includes('mcp__trace-canvas__trace_merge'));
  uninstall(file);
  s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(s.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
  assert.equal(s.permissions, undefined);
});

test('server serves the page and data, and refuses writes without its header', async () => {
  process.env.TRACE_CANVAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-srv-'));
  const { startServer } = await import('../src/server.mjs');
  const { server, url } = await startServer({ port: 0 });
  try {
    const page = await (await fetch(url)).text();
    assert.match(page, /window\.TRACE_CANVAS_SERVER=/);
    assert.match(page, /<title>Trace Canvas<\/title>/);
    const doc = { thread: 'inbox', kind: 'idea', title: 'From the page', ts: 1, parents: [] };
    const denied = await fetch(url + 'api/docs/commits/c1', { method: 'PUT', body: JSON.stringify(doc) });
    assert.equal(denied.status, 403);
    const ok = await fetch(url + 'api/docs/commits/c1', { method: 'PUT', headers: { 'X-Trace-Canvas': '1' }, body: JSON.stringify(doc) });
    assert.equal(ok.status, 200);
    const data = await (await fetch(url + 'api/data')).json();
    assert.equal(data.commits[0].title, 'From the page');
    const demo = await fetch(url + 'api/demo', { method: 'POST', headers: { 'X-Trace-Canvas': '1' }, body: '{"lang":"zh"}' });
    assert.equal(demo.status, 200);
    assert.ok(readData().threads.ex_research.name.startsWith('竞品调研'));
  } finally {
    server.close();
    fs.unwatchFile(path.join(process.env.TRACE_CANVAS_HOME, 'data.json'));
  }
});

test('two paths to one folder are one place, and no file compares a working folder with === any more', async () => {
  const { samePlace, insidePlace } = await import('../src/store.mjs');
  const fsx = await import('node:fs'), osx = await import('node:os'), px = await import('node:path');
  // The same folder reached two ways, as /tmp and /private/tmp are on a Mac: here through a symlink.
  const root = fsx.mkdtempSync(px.join(osx.tmpdir(), 'tc-place-')), real = px.join(root, 'private', 'proj'), link = px.join(root, 'proj');
  fsx.mkdirSync(px.join(real, 'sub'), { recursive: true }); fsx.symlinkSync(real, link);
  assert.equal(samePlace(link, real), true);
  assert.equal(samePlace(link + '/', real), true);
  assert.equal(samePlace(px.join(link, 'sub', '..'), real), true);
  assert.equal(samePlace(px.join(link, 'sub'), real), false);
  assert.equal(insidePlace(px.join(link, 'sub'), real), true);
  assert.equal(insidePlace(real, px.join(link, 'sub')), false);
  assert.equal(insidePlace(real + '-other', link), false);           // a name that only starts the same
  assert.equal(samePlace(px.join(root, 'gone'), px.join(root, 'gone') + '/'), true); // not there any more: as written
  assert.equal(samePlace('', real), false);
  // A scan in place of a lint rule. A line that means the text of a path (another machine's, a note being set right) says so: // path-text:
  const src = new URL('../src/', import.meta.url), bad = [];
  for (const f of fsx.readdirSync(src).filter(f => f.endsWith('.mjs'))) fsx.readFileSync(new URL(f, src), 'utf8').split('\n').forEach((l, i) => {
    if ((/\b(cwd|projectDir)\b[^=\n]{0,30}(===|!==)|(===|!==)[^=\n]{0,30}\b(cwd|projectDir)\b|\bcwd\b[^\n]{0,12}\.startsWith\(/.test(l)) && !/path-text:|process\.cwd\(\)|fs\.existsSync\(s\.cwd\)|samePlace\(|insidePlace\(/.test(l)) bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`);
  });
  assert.deepEqual(bad, []);
});
