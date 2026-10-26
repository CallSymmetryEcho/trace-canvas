#!/usr/bin/env node
// Renders the scenario screenshots in docs/scenarios/ with headless Chrome, against a
// throwaway data folder (your own ~/.trace-canvas is never touched).
//   node docs/scenarios/shoot.mjs            # every shot, both languages
//   node docs/scenarios/shoot.mjs vibe-git   # shots whose name starts with this
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scenarioData } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4790, DEBUG = 9339, W = 1440, H = 900, SCALE = 1.5;
// [name, scenario, view, action, height]; action: 'fit' or 'month'.
const SHOTS = [
  ['vibe-git', 'vibe', 'git'],
  ['vibe-canvas', 'vibe', 'canvas', 'fit'],
  ['life-timeline', 'life', 'timeline', 'month', 640],
  ['life-canvas', 'life', 'canvas', 'fit'],
  ['agents-git', 'agents', 'git'],
];

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-shots-'));
process.env.TRACE_CANVAS_HOME = path.join(home, 'data');
const { startServer } = await import('../../src/server.mjs');
const { server } = await startServer({ port: PORT });
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(home, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const waiting = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const cdp = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async expr => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

const only = process.argv[2] || '';
const now = Date.now();
for (const lang of ['en', 'zh']) {
  for (const [name, scenario, view, action, height = H] of SHOTS.filter(s => s[0].startsWith(only))) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: W, height, deviceScaleFactor: SCALE, mobile: false });
    fs.mkdirSync(process.env.TRACE_CANVAS_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.TRACE_CANVAS_HOME, 'data.json'), JSON.stringify(scenarioData(scenario, lang, now)));
    fs.writeFileSync(path.join(process.env.TRACE_CANVAS_HOME, 'config.json'), JSON.stringify({ lang }));
    // Same origin first, to forget the language and view the last shot left in localStorage.
    await cdp('Page.navigate', { url: `http://localhost:${PORT}/api/health` });
    await sleep(300);
    await js('localStorage.clear()');
    await cdp('Page.navigate', { url: `http://localhost:${PORT}/#${view}` });
    await sleep(1500);
    if (action === 'fit') await js(`document.getElementById('zoom-fit').click()`);
    else if (action === 'month') {
      await js(`document.querySelector('#tl-zoom [data-z="month"]').click()`);
      await sleep(300);
      await js(`document.getElementById('tl-scroll').scrollLeft -= 230`); // bring the first week in, keep "now"
    }
    await sleep(700);
    const { result } = await cdp('Page.captureScreenshot', { format: 'png' });
    const file = path.join(here, `${name}.${lang}.png`);
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log(path.relative(process.cwd(), file));
  }
}
ws.close();
chrome.kill();
await new Promise(r => chrome.once('exit', r));
server.close();
fs.rmSync(home, { recursive: true, force: true });
process.exit(0);
