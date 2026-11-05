import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const post = (port, p, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace-Canvas': '1' } }, res => {
    let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve(JSON.parse(data)));
  });
  req.on('error', reject); req.end(JSON.stringify(body));
});

test('▶ Start opens the agent a to-do is handed to, and keeps it handed to that agent', { skip: process.platform !== 'linux' }, async () => {
  const home = process.env.TRACE_CANVAS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-start-'));
  // A stand-in terminal that writes down what it was asked to run.
  const bin = path.join(home, 'bin'), log = path.join(home, 'ran');
  fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'xterm'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\n`, { mode: 0o755 });
  Object.assign(process.env, { PATH: `${bin}:${process.env.PATH}`, DISPLAY: ':0', TERMINAL: 'xterm' });
  const ts = Date.now();
  fs.writeFileSync(path.join(home, 'data.json'), JSON.stringify({ version: 1, threads: { t1: { id: 't1', name: 'Line', ts } },
    commits: { c1: { id: 'c1', thread: 't1', kind: 'task', title: 'do it', assignee: 'codex', ts } }, edges: {}, sessions: {} }));
  const { startServer } = await import('../src/server.mjs');
  const { server } = await startServer({ port: 0 });
  try {
    const r = await post(server.address().port, '/api/start', { todo: 'c1' });
    assert.ok(!r.error, r.error);
    for (let i = 0; i < 50 && !fs.existsSync(log); i++) await new Promise(ok => setTimeout(ok, 50));
    const ran = fs.readFileSync(log, 'utf8');
    assert.match(ran, /\bcodex '/);
    assert.doesNotMatch(ran, /\bclaude\b/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8')).commits.c1.assignee, 'codex');
  } finally { server.closeAllConnections(); server.close(); }
});
