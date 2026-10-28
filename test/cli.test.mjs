import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/trace-canvas.mjs', import.meta.url));

test('--help or -h anywhere prints the help and runs nothing', () => {
  const env = { ...process.env, TRACE_CANVAS_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cli-')), TRACE_CANVAS_DISABLE: '1' };
  for (const args of [['--help'], ['-h'], ['help'], ['dispatch', '--help'], ['sync', '-h']]) {
    const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env, timeout: 10000 });
    assert.match(out, /trace-canvas dispatch \[line\|to-do/, args.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(env.TRACE_CANVAS_HOME, 'data.json'))); // nothing ran
});
