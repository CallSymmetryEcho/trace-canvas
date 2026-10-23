import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importText, emptyData, mutate, readData } from '../src/store.mjs';
import { install, uninstall } from '../src/install.mjs';

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
  uninstall(file);
  s = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(s.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
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
