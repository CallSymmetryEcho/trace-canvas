// Browser regression (npm run test:browser): Fit on a phone and a tablet. The page opens a phone on readable cards
// (60%, panned from the top); the Fit button then shows every card inside the window, however far out that is.
import assert from 'node:assert/strict';
const [url] = process.argv.slice(2), CDP = process.env.CDP_PORT || 9333;
const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
const outside = `(() => { const cs = [...document.querySelectorAll('#cv-cards .card')]; return { cards: cs.length, out: cs.filter(c => { const b = c.getBoundingClientRect(); return b.left < 0 || b.right > innerWidth || b.top < 0 || b.bottom > innerHeight; }).length, zoom: document.querySelector('#zoom-reset').textContent }; })()`;
const res = {};
await call('Page.enable');
for (const [name, w, h] of [['phone', 390, 844], ['tablet', 820, 1180]]) {
  await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await call('Emulation.setTouchEmulationEnabled', { enabled: true });
  await call('Page.navigate', { url: 'about:blank' }); await call('Page.navigate', { url }); await wait(3000);
  const opened = await ev(outside);
  await ev(`document.querySelector('#zoom-fit').click()`); await wait(1500);
  const fitted = res[name] = await ev(outside);
  assert.equal(fitted.cards, 13); assert.equal(fitted.out, 0, `${name}: every card is inside the window after Fit (${fitted.zoom})`);
  if (name === 'phone') assert.equal(opened.zoom, '60%', 'a phone opens on readable cards');
  // Zooming out from there goes out, not back in.
  await ev(`document.querySelector('#zoom-out').click()`); await wait(900);
  assert.ok(parseInt(await ev(`document.querySelector('#zoom-reset').textContent`)) <= parseInt(fitted.zoom), `${name}: zooming out does not zoom in`);
}
console.log(JSON.stringify(res));
await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id);
console.log('PASSED'); process.exit(0);
