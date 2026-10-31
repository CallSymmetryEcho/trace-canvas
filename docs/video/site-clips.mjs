// Not imported anywhere yet. Site clips (宣传站 v2): silent GIF scenes for the promo site, written against the
// uncommitted make.mjs of 2026-10-31 (QUIET, RETRO and their helpers). When that make.mjs is committed, paste this
// block right before `if (process.env.TC_GIFS) VIDEOS.gifs = ...` and delete this file.
// Render: TC_GIFS=handoff,quiet,retro node make.mjs gifs; the site's encoding is in site/README.md.
// handoff: the hero. On the laptop a to-do goes to Codex; the workstation does it off screen; after a sync it comes
// back ticked by Codex, on workstation; then a new Claude Code session on the laptop reads the line and carries on.
const SITE_GIFS = [
  { ...GIFS.find(g => g.name === 'machines'), name: 'handoff' },
  { name: 'handoff', page: { terminal: 'claude — laptop:~/tripsplit' }, text: [],
    run: async h => {
      const L = v => pick(v, h.lang), arg = JSON.stringify({ thread: 'receipt-ocr' });
      await h.cmd(L(['Carry on with receipt OCR', '接着做小票识别']), '> ');
      await h.wait(300);
      h.out(`⏺ trace-canvas - trace_read_thread (MCP)(${arg})`, 'k');
      h.out(`  ⎿  ${h.tools.read(MCH.ocr)}`);
      await h.wait(600);
      h.out(`⏺ trace-canvas - trace_tasks (MCP)(${arg})`, 'k');
      h.out(`  ⎿  ${h.tools.tasks(MCH.ocr)}`);
      await h.wait(600);
      h.out(L(['⏺ Codex on the workstation tried the vision model: 94% of receipt totals, against 61% for Tesseract, and ticked the to-do. Next: use it for imports. I’m on it.',
        '⏺ workstation 上的 Codex 已经试过视觉模型：小票总额认对 94%，Tesseract 只有 61%，待办也勾了。下一步把它接进导入，我来做。']), 'p');
      await h.wait(3200);
    } },
  // Gone quiet, on a computer: the dot on Goals, the row of quiet lines, one question, one click.
  { name: 'quiet', page: 'app', fresh: true, view: 'canvas', zoom: 1, focus: { x: 640, y: 360 }, text: [], preload: qtData,
    run: async h => {
      await h.move('#goals-btn', 0, 700);
      await h.wait(700);
      await mchGoals(h);
      await h.camera('.q-strip', 1.7, 600);
      for (const tid of Object.keys(QT_LINES)) await h.move(`.q-chip[data-quiet="${tid}"]`, 0, 450);
      await qtChip(h, 'sc_jcv');
      await h.wait(400);
      await h.camera('.q-ask', 1.7, 500);
      for (const s of ['done', 'parked', 'ack']) await h.move(`.q-ask [data-quiet-set="${s}"]`, 0, 400);
      await h.click('.q-ask [data-quiet-set="done"]', { ms: 350 });
      await h.wait(900);
      await h.camera('.q-strip', 1.7, 500);
      await h.wait(1200);
    } },
  // Retro: press it on a line, then the ranking: rounds, where it got stuck, the sentence that made it clear, the rule.
  { name: 'retro', page: 'app', fresh: true, view: 'canvas', zoom: 1.4, text: [], preload: rtData,
    ready: h => h.js(`(() => { const of = window.fetch; window.fetch = async (u, o) => { if (String(u).endsWith('/api/retro')) { while (!window.__rt) await new Promise(r => setTimeout(r, 100)); return new Response(JSON.stringify({ id: window.__rt })); } return of(u, o); }; })()`),
    run: async h => {
      await h.click('#cv-cards [data-tid="sc_main"] .card-head', { ms: 500 });
      await h.wait(400);
      await h.js(`document.querySelector('#detail [data-act="retro"]').scrollIntoView({ block: 'center', behavior: 'smooth' })`);
      await h.wait(600);
      await h.click('#detail [data-act="retro"]', { ms: 500 });
      await h.wait(300);
      await h.js(`document.querySelector('#detail .rt-range').scrollIntoView({ block: 'center', behavior: 'smooth' })`);
      await h.wait(500);
      await h.move('#detail .rt-range-head', 0, 450);
      await h.wait(400);
      await h.click('#detail [data-act="retro-go"]', { ms: 450 });
      await h.wait(900);
      const id = mutate(d => retroRecord(d, 'sc_main', rtRes(h.lang), h.lang).id);
      await h.js(`window.__rt = ${JSON.stringify(id)}`);
      for (let i = 0; i < 30 && !(await h.at('#detail .rt-list li')); i++) await sleep(100);
      await h.js(`document.querySelector('#detail .rt-list li').scrollIntoView({ block: 'start', behavior: 'smooth' })`);
      await h.wait(700);
      await h.move('#detail .rt-list li .rt-stats', 0, 600);
      await h.wait(900);
      for (const n of [0, 1, 2]) { await h.move('#detail .rt-list li .rt-why dd', n, 500); await h.wait(n === 2 ? 1200 : 900); }
      await h.move('#detail .rt-layer[data-n="1"]', 0, 400);
      await h.wait(1500);
    } },
];
GIFS.push(...SITE_GIFS);
