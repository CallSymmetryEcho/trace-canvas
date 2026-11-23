// npm test: the tests run with a home folder of their own, and without the caller's Trace Canvas variables, so no test
// (and nothing a test starts) can read or write the person's canvas, sync repository, agent settings or git config.
// PATH stays: the tests need node, git and sh. ponytail: a test that wants a stand-in binary puts its folder first on PATH itself.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-test-home-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(TRACE_CANVAS_|CLAUDE|CODEX_|XDG_)/.test(k)));
Object.assign(env, { HOME: home, TRACE_CANVAS_HOME: path.join(home, '.trace-canvas'), GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid' });
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs')).map(f => path.join('test', f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env });
fs.rmSync(home, { recursive: true, force: true });
process.exit(r.status ?? 1);
