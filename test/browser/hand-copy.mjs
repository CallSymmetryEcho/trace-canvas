// Browser regression (npm run test:browser): Goals' "copy the command" button. The server writes the command; when the
// server fails, the page says why and copies nothing (it used to copy its own, which may start in another folder).
import assert from 'node:assert/strict';
const [url] = process.argv.slice(2), CDP = process.env.CDP_PORT || 9333;
const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
await call('Page.enable'); await call('Page.navigate', { url }); await wait(3000);
// What the page copies is recorded instead of going to a clipboard.
await ev(`(() => { window.copied = []; const rec = t => { window.copied.push(t); return Promise.resolve(); };
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: rec }, configurable: true }); } catch { navigator.clipboard.writeText = rec; }
  document.execCommand = () => { const a = document.activeElement; window.copied.push(a && a.value); return true; }; })()`);
const press = async () => { await ev(`document.querySelector('[data-hand]').click()`); await wait(800); return ev(`({ copied: window.copied.slice(), toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent })`); };
await ev(`document.querySelector('#goals-btn').click()`); await wait(600);
const ok = await press();
assert.equal(ok.copied.length, 1); assert.match(ok.copied[0], /TRACE_CANVAS_THREAD=.*claude /);
// The server answers with an error: the reason shows, nothing more is copied.
await ev(`(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/hand') ? Promise.resolve(new Response(JSON.stringify({ error: 'No such to-do' }), { status: 400 })) : f(u, o)); })()`);
const bad = await press();
assert.equal(bad.copied.length, 1, 'nothing copied when the server fails'); assert.match(bad.toast, /No such to-do/);
// The server does not answer at all.
await ev(`(() => { const f = window.fetch; window.fetch = (u, o) => (String(u).startsWith('/api/hand') ? Promise.reject(new TypeError('Failed to fetch')) : f(u, o)); })()`);
const down = await press();
assert.equal(down.copied.length, 1); assert.match(down.toast, /Failed to fetch/);
console.log(JSON.stringify({ ok, bad, down }, null, 1));
await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id);
console.log('PASSED'); process.exit(0);
