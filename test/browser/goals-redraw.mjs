// Browser regression, not part of npm test (it needs a Chrome with --remote-debugging-port=9333 and a page server on
// data of its own). Run it after changing how Goals redraws:
//   export TRACE_CANVAS_HOME=$(mktemp -d) TRACE_CANVAS_MAP= TRACE_CANVAS_MACHINE=verify
//   seed a line "Trip" with a dozen open to-dos and one an agent ticked (toReview), then: trace-canvas serve --no-open --port 4799 &
//   node test/browser/goals-redraw.mjs http://localhost:4799/ "$PWD"
// It opens Goals, starts a Return reason, has three to-dos added from outside, and passes when they show while the
// reason's text, focus and caret are as typed and the top row has not moved.
import { execFileSync } from 'node:child_process';
const [url, repo] = process.argv.slice(2);
const v = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 700, deviceScaleFactor: 1, mobile: false });
await call('Page.enable'); await call('Page.navigate', { url }); await wait(3000);
await ev(`document.querySelector('#goals-btn').click()`); await wait(600);
await ev(`document.querySelector('[data-return]').click()`); await wait(400);
await ev(`document.querySelector('.gl-ret').focus()`);
await call('Input.insertText', { text: 'the total is off by one' });
await ev(`(()=>{const b=document.querySelector('.gl-ret'); b.setSelectionRange(4,9); document.querySelector('#sheet-body').scrollTop = 60;})()`); await wait(200);
const snap = `(()=>{const b=document.querySelector('.gl-ret'), sb=document.querySelector('#sheet-body'), top=sb.getBoundingClientRect().top, row=[...sb.querySelectorAll('li[data-k]')].find(e=>e.getBoundingClientRect().bottom>top);
  return {value:b&&b.value, focused:document.activeElement===b, caret:b&&[b.selectionStart,b.selectionEnd], row:row&&row.dataset.k, rowTop:row&&Math.round(row.getBoundingClientRect().top-top), rows:sb.querySelectorAll('li[data-k]').length};})()`;
const before = await ev(snap);
for (let i = 0; i < 3; i++) execFileSync('node', [repo + '/bin/trace-canvas.mjs', 'log', 'Added while typing ' + i, '--thread', 'Trip', '--kind', 'task'], { stdio: 'ignore' });
await wait(3000);
const after = await ev(snap);
console.log(JSON.stringify({ before, after }, null, 1));
const ok = after.rows === before.rows + 3 && after.value === before.value && after.focused && String(after.caret) === String(before.caret) && after.row === before.row && Math.abs(after.rowTop - before.rowTop) <= 1;
console.log(ok ? 'PASS' : 'FAIL');
await fetch('http://127.0.0.1:9333/json/close/' + v.id); process.exit(ok ? 0 : 1);
