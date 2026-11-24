// Browser regression (npm run test:browser): a card that has keyboard focus keeps it when the canvas is redrawn by a
// record added from outside (another tab, an agent). The redraw replaces every card, so focus is given to the new one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const [url, repo = process.cwd()] = process.argv.slice(2), CDP = process.env.CDP_PORT || 9333;
const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false });
await call('Page.enable'); await call('Page.navigate', { url }); await wait(3000);
const card = `[...document.querySelectorAll('#cv-cards .card')].find(c => c.getAttribute('aria-label') === 'Trip')`;
await ev(`(() => { window.__old = ${card}; window.__old.focus(); })()`);
assert.equal(await ev(`document.activeElement === window.__old`), true, 'the card takes focus');
execFileSync('node', [repo + '/bin/trace-canvas.mjs', 'log', 'Added from outside', '--thread', 'Other', '--kind', 'idea'], { stdio: 'ignore' });
await wait(3000);
const after = await ev(`({ redrawn: ${card} !== window.__old, focused: document.activeElement === ${card}, tag: document.activeElement.tagName })`);
console.log(JSON.stringify(after));
assert.equal(after.redrawn, true, 'the canvas was redrawn'); assert.equal(after.focused, true, 'focus is on the same line\'s new card');
await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id);
console.log('PASSED'); process.exit(0);
