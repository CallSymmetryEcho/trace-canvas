// Browser regression (npm run test:browser): the loops on an Autopilot card. They animate transform and opacity only
// (so the compositor runs them: an idle page recalculates no style), and a redraw of the canvas, which rebuilds every
// card, goes on from where they were instead of from their start.
import assert from 'node:assert/strict';
const [url] = process.argv.slice(2), CDP = process.env.CDP_PORT || 9333;
const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await call('Page.enable'); await call('Page.navigate', { url }); await wait(3000);
if (await ev(`matchMedia('(hover: none)').matches`)) { console.log('This browser reports no mouse, so the page keeps motion off: nothing to check.'); console.log('PASSED'); await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id); process.exit(0); }
const loops = `document.getAnimations().filter(a => a.effect.getComputedTiming().iterations === Infinity)`;
const props = await ev(`[...new Set(${loops}.flatMap(a => a.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))].sort()`);
assert.deepEqual(props, ['opacity', 'transform'], 'the loops animate transform and opacity only');
// Where each loop is on the document's clock, in 50 ms steps (a hair before the loop's end counts as its start): the same after a redraw.
const phase = `${loops}.map(a => { const g = a.effect.getComputedTiming(), d = g.duration; return a.animationName + ':' + Math.round(((((a.currentTime - g.delay - document.timeline.currentTime) % d) + d) % d) / 50) % Math.round(d / 50); }).sort().join(' ')`;
const before = await ev(phase);
assert.ok(before.split(' ').length >= 5, 'two rings, two tickers and a glow run: ' + before);
await ev(`window.__card = document.querySelector('.card.ap-on')`);
const quiet = await ev(`fetch('/api/data').then(r => r.json()).then(d => d.threads.find(t => t.name === 'Quiet').id)`);
await ev(`fetch('/api/docs/commits/redraw1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Trace-Canvas': '1' }, body: JSON.stringify({ id: 'redraw1', thread: ${JSON.stringify(quiet)}, kind: 'note', title: 'A record on another line', body: '', ts: Date.now(), parents: [], links: [] }) }).then(r => r.status)`);
await wait(2500);
assert.equal(await ev(`window.__card !== document.querySelector('.card.ap-on')`), true, 'the canvas was redrawn');
assert.equal(await ev(phase), before, 'the loops go on where they were');
await call('Performance.enable');
const count = async () => (await call('Performance.getMetrics')).result.metrics.find(m => m.name === 'RecalcStyleCount').value;
const a = await count(); await wait(3000); const n = await count() - a;
assert.ok(n < 10, `an idle page recalculates style ${n} times in 3 s`);
console.log(JSON.stringify({ props, before, recalcIn3s: n }, null, 1));
await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id);
console.log('PASSED'); process.exit(0);
