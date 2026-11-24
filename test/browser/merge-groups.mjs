// Browser regression: run with `npm run test:browser` (test/browser/run.mjs seeds data of its own, starts a page server
// and a headless Chrome, and stops both). Run it after changing merging, groups or the multi-select banner.
// It clicks through the six cases of the 2026-11-23 report: the banner over the first row, lines of one group merged
// into a new line, a merge that would make a circle, the panel's default target, undoing a merge, a group renamed
// onto another group's name (asked first, undone from the toast) and dissolved (undone too).
import assert from 'node:assert/strict';
const [url, shot] = process.argv.slice(2), CDP = process.env.CDP_PORT || 9333;
const v = await (await fetch('http://127.0.0.1:' + CDP + '/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise(r => ws.onopen = r);
const call = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await call('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
// A real click at the element's middle (cards take pointer gestures, not click events).
const click = async (sel, fy = 0.5) => {
  const p = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * ${fy} }; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await wait(500);
};
const data = async () => {
  const d = await ev(`fetch('/api/data').then(r => r.json())`), name = Object.fromEntries(d.threads.map(t => [t.id, t.name]));
  const line = Object.fromEntries(d.threads.map(t => [t.name, t]));
  return { d, line, st: n => (line[n] ? [line[n].status, line[n].group || '', name[line[n].mergedInto] || ''].join('/') : 'gone'), count: g => d.threads.filter(t => t.group === g).length };
};
const post = (path, body) => ev(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace-Canvas': '1' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(r => r.json())`);
const card = n => `.card[data-tid="${L.line[n].id}"]`;
const toast = () => ev(`document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent`);
const setVal = (sel, value, type) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); })()`);

await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 757, deviceScaleFactor: 1, mobile: false });
await call('Page.enable'); await call('Page.navigate', { url }); await wait(3000);
let L = await data();
const out = {};

// 6. The banner does not lie over a card.
await ev(`document.querySelector('#select-btn').click()`); await wait(300);
await click(card('A'), 0.8);
out.bannerOver = await ev(`(() => { const r = document.querySelector('#multi-banner').getBoundingClientRect(); return [...document.querySelectorAll('.card')].filter(el => { const c = el.getBoundingClientRect(); return c.top < r.bottom && c.bottom > r.top && c.left < r.right && c.right > r.left; }).length; })()`);
assert.equal(out.bannerOver, 0, 'no card under the banner');
// 3. A and B of G1 into a new line N: all three in G1.
await click(card('B'), 0.2); // the top of a first-row card can be clicked now
await setVal('#multi-target', '__new', 'change'); await wait(300);
await setVal('#multi-name', 'N', 'input');
out.flow = await ev(`document.querySelector('.mb-flow').textContent`);
assert.equal(out.flow, 'A、B → N', 'the flow hint follows the typed name');
await ev(`document.querySelector('[data-multi="merge"]').click()`); await wait(1200);
L = await data(); out.newLine = ['N', 'A', 'B', 'F'].map(L.st);
assert.deepEqual(out.newLine, ['active/G1/', 'merged/G1/N', 'merged/G1/N', 'active/G1/']);
// 1. N into A (which is merged into N) is refused and changes nothing.
out.circle = (await post('/api/merge', { sources: [L.line.N.id], target: L.line.A.id })).error;
assert.match(out.circle, /circle/);
L = await data(); assert.deepEqual(['N', 'A'].map(L.st), ['active/G1/', 'merged/G1/N']);
// A is merged into N already: a second merge is refused and leaves one merge record.
out.again = (await post('/api/merge', { sources: [L.line.A.id], target: L.line.N.id })).error;
assert.match(out.again, /already merged/);
L = await data(); assert.equal(L.d.commits.filter(c => c.mergeOf === L.line.A.id).length, 1);
// 2. The panel's "Merge into…" offers no inbox.
await click(card('H'), 0.1); await ev(`document.querySelector('[data-act="merge-open"]').click()`); await wait(300);
out.panelTargets = await ev(`[...document.querySelectorAll('#t-merge option')].map(o => o.value)`);
assert.ok(out.panelTargets.length > 1 && !out.panelTargets.includes('inbox'), 'the inbox is not offered');
// It starts on no line: Merge is off, and clicking it does nothing.
out.panelStart = await ev(`[document.querySelector('#t-merge').value, document.querySelector('[data-act="merge"]').disabled]`);
assert.deepEqual(out.panelStart, ['', true]);
await ev(`(() => { const b = document.querySelector('[data-act="merge"]'); b.disabled = false; b.click(); })()`); await wait(800);
L = await data(); assert.equal(L.st('H'), 'active//', 'H is merged into nothing');
await ev(`document.querySelector('[data-act="merge-cancel"]').click()`); await wait(200);
// 4. D (G2, with an open to-do) into E, then undone from D's panel: as before.
const todoOn = () => { const c = L.d.commits.find(x => x.title === 'D open to-do'); return L.d.threads.find(t => t.id === c.thread).name; };
const recs = () => L.d.commits.filter(c => c.kind === 'merge' && c.mergeOf === L.line.D.id).length;
await click(card('D'), 0.1); await ev(`document.querySelector('[data-act="merge-open"]').click()`); await wait(300);
await setVal('#t-merge', L.line.E.id, 'change'); await ev(`document.querySelector('[data-act="merge"]').click()`); await wait(1200);
L = await data(); out.merged = [L.st('D'), todoOn(), recs()];
assert.deepEqual(out.merged, ['merged//E', 'E', 1]);
await click(card('E'), 0.1); await ev(`document.querySelector('[data-act="goto-thread"][data-tid="${L.line.D.id}"]').click()`); await wait(400);
await ev(`document.querySelector('[data-act="unmerge"]').click()`); await wait(1200);
L = await data(); out.undone = [L.st('D'), todoOn(), recs()]; out.undoToast = await toast();
assert.deepEqual(out.undone, ['active/G2/', 'D', 0]);
// The line the merge made goes when its last source is back.
await post('/api/unmerge', { thread: L.line.A.id }); await post('/api/unmerge', { thread: L.line.B.id }); await wait(600);
L = await data(); out.newLineUndone = ['N', 'A', 'B'].map(L.st);
assert.deepEqual(out.newLineUndone, ['gone', 'active/G1/', 'active/G1/']);
// 5. G1 renamed to G2: asked first; joined on yes; undone from the toast; dissolving is undone too.
const g0 = [L.count('G1'), L.count('G2')];
await click('.grp-label[data-group="G1"]');
await setVal('#g-name', 'G2', 'change'); await wait(400);
out.asked = await ev(`document.querySelector('[data-act="g-join"]')?.parentElement.textContent`);
L = await data(); assert.ok(out.asked, 'asked before joining'); assert.deepEqual([L.count('G1'), L.count('G2')], g0, 'nothing joined before the answer');
await ev(`document.querySelector('[data-act="g-join"]').click()`); await wait(1000);
L = await data(); out.joined = [L.count('G1'), L.count('G2')]; assert.deepEqual(out.joined, [0, g0[0] + g0[1]]);
await ev(`document.querySelector('#toast .toast-act').click()`); await wait(1000);
L = await data(); out.joinUndone = [L.count('G1'), L.count('G2')]; assert.deepEqual(out.joinUndone, g0);
await ev(`document.querySelector('[data-act="g-ungroup"]').click()`); await wait(1000);
L = await data(); assert.equal(L.count('G1'), 0);
await ev(`document.querySelector('#toast .toast-act').click()`); await wait(1000);
L = await data(); out.dissolveUndone = [L.count('G1'), L.count('G2')]; assert.deepEqual(out.dissolveUndone, g0);

// Grouping lines picked on the canvas can be undone from the toast: each goes back to the group it had, or to none.
await ev(`document.querySelector('.detail [data-act="close"], #detail-close')?.click()`); await wait(300);
const shown = new Set(await ev(`[...document.querySelectorAll('#cv-cards .card')].map(c => c.dataset.tid)`));
const picks = ['G1', 'G2', ''].map(g => L.d.threads.find(t => shown.has(t.id) && t.status !== 'merged' && (t.group || '') === g)).filter(Boolean);
assert.ok(picks.length >= 2, 'lines of two groups are on the canvas');
const groupsOf = async () => { L = await data(); return picks.map(t => L.line[t.name].group || ''); }, was = await groupsOf();
if (await ev(`document.querySelector('#select-btn').getAttribute('aria-pressed')`) !== 'true') { await ev(`document.querySelector('#select-btn').click()`); await wait(300); }
for (const t of picks) await click(`.card[data-tid="${t.id}"]`, 0.8);
await setVal('#multi-group', 'Transit', 'input');
await ev(`document.querySelector('[data-multi="group"]').click()`); await wait(1000);
assert.deepEqual(await groupsOf(), picks.map(() => 'Transit'));
out.groupToast = await toast(); assert.ok(await ev(`!!document.querySelector('#toast .toast-act')`), 'the toast offers Undo');
await ev(`document.querySelector('#toast .toast-act').click()`); await wait(1000);
out.groupUndone = await groupsOf(); assert.deepEqual(out.groupUndone, was);
await call('Page.reload'); await wait(2500);
assert.deepEqual(await groupsOf(), was, 'and after a reload');

// Branches draws a merged line by More → Hide → Merged alone, also with "Hide finished threads" on
// (2026-11-24: the merge row was left with no line leading to it, and the merged history could not be seen).
await ev(`fetch('/api/docs/commits/kept1', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Trace-Canvas': '1' }, body: JSON.stringify({ id: 'kept1', thread: ${JSON.stringify(picks[0].id)}, kind: 'note', title: 'A note that stays on the merged line', body: '', ts: Date.now(), parents: [], links: [] }) }).then(r => r.status)`);
await post('/api/merge', { sources: [picks[0].id], target: picks[1].id });
await ev(`localStorage.setItem('tc.hideDone', 'true')`); await call('Page.reload'); await wait(2500);
await ev(`document.querySelector('#tab-git').click()`); await wait(800);
out.mergedInBranches = await ev(`!!document.querySelector('#git-body [data-cid="kept1"]')`);
assert.equal(out.mergedInBranches, true, 'the merged line has its rows in Branches');
// More → Hide → Merged is what takes it out of Branches; the canvas keeps "N merged in" on the target's card either way.
await ev(`localStorage.setItem('tc.showMerged', 'false')`); await call('Page.reload'); await wait(2500);
await ev(`document.querySelector('#tab-canvas').click()`); await wait(800);
assert.equal(await ev(`!!document.querySelector('#cv-cards .card[data-tid="${picks[1].id}"] [data-merged-tog]')`), true, 'the card offers its merged lines');
assert.equal(await ev(`!!document.querySelector('#cv-cards .card[data-tid="${picks[0].id}"]')`), false, 'a merged line has no card until they are opened');
await ev(`document.querySelector('#tab-git').click()`); await wait(800);
assert.equal(await ev(`!!document.querySelector('#git-body [data-cid="kept1"]')`), false, 'hidden with the switch');

console.log(JSON.stringify(out, null, 1));
if (shot) { const s = await call('Page.captureScreenshot'); (await import('node:fs')).writeFileSync(shot, Buffer.from(s.result.data, 'base64')); }
await fetch('http://127.0.0.1:' + CDP + '/json/close/' + v.id);
console.log('PASSED');
process.exit(0);
