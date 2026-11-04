// Generates docs/autopilot.svg and docs/autopilot.zh-CN.svg: how Autopilot (beta) decides.
//   node docs/autopilot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] || path.dirname(fileURLToPath(import.meta.url));
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";
// One quiet palette: white cards, hairline borders, a single soft accent for the round and its loop back.
const LINE = '#DFE3E8', SOFT = '#F7F8FA', ACC = '#7C98C4';
const C = { src: ['#FFFFFF', LINE], prof: [SOFT, LINE], run: ['#FFFFFF', ACC], ok: ['#FFFFFF', LINE], split: ['#FFFFFF', LINE], ask: ['#FFFFFF', LINE], rec: [SOFT, LINE] };
const INK = '#3A4450', SUB = '#7A8591', LOOP = ACC, ARROW = '#B8C0CA';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const W = 1270, H = 820;

function build(lang) {
  const P = v => (Array.isArray(v) ? v[lang === 'zh' ? 1 : 0] : v);
  let s = '';
  const text = (x, y, str, { size = 12, weight = 400, fill = SUB, anchor = 'start' } = {}) => {
    s += `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}>${esc(P(str))}</text>\n`;
  };
  const box = (x, y, w, h, [fill, stroke], title, lines = []) => {
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1"/>\n`;
    text(x + 16, y + 26, title, { size: 14, weight: 600, fill: INK });
    lines.forEach((l, i) => text(x + 16, y + 48 + i * 18, l));
  };
  const arrow = (x1, y1, x2, y2, color = ARROW) => { s += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${color}" stroke-width="1" fill="none" marker-end="url(#${color === LOOP ? 'ao' : 'a'})"/>\n`; };

  text(36, 42, ['Autopilot (beta): how it decides', 'Autopilot（beta）：它怎么做决定'], { size: 20, weight: 600, fill: INK });
  text(36, 64, ['Three sources make one decision profile; each round follows it, and what the person overrides or adds goes back into it.',
    '三个来源汇成一份决策画像；每一轮都照它判断，用户推翻的、新定的，再回到画像里。'], { size: 12.5 });

  // 1 the sources
  const src = [
    [['Decisions on the lines', '线上的决定'], [['grouped by topic and counted', '按话题归组、数次数'], ['a rule needs repeat support', '多次出现的才算规则']]],
    [['What the person set', '用户当面定的'], [['hard rules H1–H7', '硬规矩 H1–H7'], ['always above the rest', '永远排在最前']]],
    [['Rules from retros', '复盘提炼的规则'], [['suggested by a retro', '复盘给出建议'], ['in only with a yes', '用户点头才进']]],
  ];
  src.forEach(([t, l], i) => { const x = 40 + i * 380; box(x, 90, 340, 96, C.src, t, l); arrow(x + 170, 186, 590 + (i - 1) * 120, 244); });

  // 2 the profile
  box(240, 248, 700, 112, C.prof, ['Decision profile', '决策画像']);
  [[['H · hard rules', 'H · 硬规矩'], ['never broken', '一律照做']], [['R · stable rules', 'R · 稳定规则'], ['well supported', '支持多次']], [['Swinging', '摇摆'], ['always ask', '一律先问']], [['One-offs', '个例'], ['not a rule', '不当规则']]]
    .forEach(([a, b], i) => { const x = 254 + i * 170; s += `<rect x="${x}" y="${290}" width="158" height="56" rx="6" fill="#FFFFFF" stroke="${LINE}"/>\n`; text(x + 12, 312, a, { size: 12.5, weight: 600, fill: INK }); text(x + 10, 332, b); });
  arrow(590, 360, 590, 404);

  // 3 one round
  box(240, 408, 700, 76, C.run, ['Autopilot: one round per click', 'Autopilot：按一次跑一轮'], [['every open to-do on the line, one by one; at each decision point, check the profile', '这条线上所有没做完的待办，一条条做；每个决定点都对照画像判断']]);
  const outs = [
    [C.ok, ['Do it, log the rule', '照做，记依据'], [['a rule covers it, or it follows', '规则覆盖到的，或者'], ['from what is already there', '按一致能推出来的']]],
    [C.split, ['Propose a split first', '先给拆分方案'], [['work that can run in parallel', '能并行的活'], ['(H5, H6: speed vs tokens)', '（H5、H6：效率和省 token）']]],
    [C.ask, ['Stop and ask', '停下问用户'], [['security, pushing, publishing,', '安全、推送、对外发布、'], ['not covered, or swinging', '没覆盖到的、摇摆的']]],
  ];
  outs.forEach(([col, t, l], i) => { const x = 40 + i * 380; arrow(590 + (i - 1) * 120, 484, x + 170, 532); box(x, 536, 340, 96, col, t, l); arrow(x + 170, 632, 590 + (i - 1) * 120, 684); });

  // 4 the record, and the loop back
  box(240, 688, 700, 92, C.rec, ['Records on the line, and the summary', '线上记录和小结'], [['each decision as "what · which rule"; the round ends with an Autopilot summary', '每个决定写成「做了什么 · 依据哪条规则」；一轮结束写一条 Autopilot 小结'], ['what the person overrides drops to "ask"; what they decide joins the profile', '用户推翻的规则降为「要问」；用户的新决定进画像']]);
  s += `<path d="M940 734 C1215 734 1215 304 944 304" stroke="${LOOP}" stroke-width="1" stroke-dasharray="4 4" fill="none" marker-end="url(#ao)"/>\n`;
  text(1206, 500, '↻', { size: 18, weight: 400, fill: LOOP, anchor: 'middle' });
  text(1206, 524, ['back into', '回到'], { size: 12, fill: LOOP, anchor: 'middle' });
  text(1206, 541, ['the profile', '决策画像'], { size: 12, fill: LOOP, anchor: 'middle' });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${SANS}">
<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="${ARROW}"/></marker>
<marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="${LOOP}"/></marker></defs>
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${s}</svg>
`;
}

fs.writeFileSync(path.join(OUT, 'autopilot.svg'), build('en'));
fs.writeFileSync(path.join(OUT, 'autopilot.zh-CN.svg'), build('zh'));
