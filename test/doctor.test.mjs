import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../src/doctor.mjs';

test('doctor names what is missing and how to fix it, and passes what is in place', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-doctor-')), homeDir = path.join(root, 'home'), tc = path.join(root, 'tc');
  fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true }); fs.mkdirSync(tc);
  const env = { ...process.env, TRACE_CANVAS_HOME: tc, TRACE_CANVAS_MAP: '' };
  const byId = () => Object.fromEntries(doctor(env, homeDir).map(r => [r.id, r]));
  let r = byId();
  assert.deepEqual([r.hooks.ok, r.mcp.ok, r.skill.ok, r.server.ok, r.sync.ok], [false, false, false, false, 'warn']);
  assert.match(r.hooks.fix, /setup --user/);
  // Hooks that start a Node which is gone are a problem too.
  const cmd = node => ({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `"${node}" "/x/trace-canvas/bin/trace-canvas.mjs" hook` }] }] } });
  fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify(cmd('/no/such/node')));
  assert.match(byId().hooks.detail, /\/no\/such\/node, which is gone/);
  fs.writeFileSync(path.join(homeDir, '.claude', 'settings.json'), JSON.stringify(cmd(process.execPath)));
  fs.writeFileSync(path.join(homeDir, '.claude.json'), JSON.stringify({ mcpServers: { 'trace-canvas': {} } }));
  fs.mkdirSync(path.join(homeDir, '.claude', 'skills', 'trace-canvas'), { recursive: true });
  fs.writeFileSync(path.join(homeDir, '.claude', 'skills', 'trace-canvas', 'SKILL.md'), 'x');
  fs.writeFileSync(path.join(tc, 'server.json'), JSON.stringify({ pid: process.pid, port: 4777 }));
  r = byId();
  assert.deepEqual([r.hooks.ok, r.mcp.ok, r.skill.ok, r.server.ok], [true, true, true, true]);
});
