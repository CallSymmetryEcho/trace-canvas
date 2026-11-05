import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLinkedImage, readLinkedMd } from '../src/git-view.mjs';

// The page's own Markdown renderer, taken out of app/index.html between its markers.
const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const { mdHTML } = new Function('esc', `${page.slice(page.indexOf('// <md>'), page.indexOf('// </md>'))}; return { mdHTML };`)(esc);

test('a report reads as Markdown, and its text stays text', () => {
  const html = mdHTML([
    '# 结论', '', 'E°cell ≈ **+0.05 V**, see `pvp.md` and https://x.org/a.', '第二行 [方案](plan/a.md)', '',
    '- one', '  - nested', '- [x] done', '', '1. first', '2. second', '',
    '| a | b |', '|---|:-:|', '| 1 | <b>2</b> |', '', '> quoted', '', '```js', 'const a = 1 < 2;', '```', '---', '<script>alert(1)</script>',
  ].join('\n'));
  assert.match(html, /^<h1>结论<\/h1><p>E°cell ≈ <strong>\+0\.05 V<\/strong>, see <code>pvp\.md<\/code> and <a href="https:\/\/x\.org\/a"/);
  assert.match(html, /<br>第二行 <span class="md-ref" title="plan\/a\.md">方案<\/span><\/p>/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>☑ done<\/li><\/ul><ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>&lt;b&gt;2&lt;\/b&gt;<\/td><\/tr>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote><pre><code>const a = 1 &lt; 2;<\/code><\/pre><hr>/);
  assert.doesNotMatch(html, /<script>/);
});

test('the reader opens only .md and .txt files a record links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-md-')), f = path.join(dir, 'r.md'), txt = path.join(dir, 'plan.txt');
  fs.writeFileSync(f, '# Report'); fs.writeFileSync(txt, '大纲\n- Fig.1');
  const d = { commits: { c1: { links: [f, txt, path.join(dir, 'gone.md'), '/etc/hosts', path.join(dir, 's.json')] } } };
  assert.deepEqual(readLinkedMd(d, f), { text: '# Report' });
  assert.deepEqual(readLinkedMd(d, txt), { text: '大纲\n- Fig.1' });
  assert.match(readLinkedMd(d, path.join(dir, 's.json')).error, /type/);
  assert.match(readLinkedMd(d, path.join(dir, 'other.md')).error, /unlinked/);
  assert.match(readLinkedMd(d, '/etc/hosts').error, /type/);
  assert.match(readLinkedMd(d, path.join(dir, 'gone.md')).error, /missing/);
});

test('math: $…$ inline and $$…$$ on its own lines become MathML; code, money and bad formulas stay text', () => {
  assert.equal(mdHTML('Energy $E = mc^2$ here'), '<p>Energy <math><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow></math> here</p>');
  assert.equal(mdHTML('Before\n$$\n\\frac{a}{b}\n$$\nafter'), '<p>Before</p><div class="md-math"><math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math></div><p>after</p>');
  assert.equal(mdHTML('$$x_i$$'), '<div class="md-math"><math display="block"><msub><mi>x</mi><mi>i</mi></msub></math></div>');
  assert.equal(mdHTML('`$x$` costs $5 and $10, or $5-$10, and \\$3'), '<p><code>$x$</code> costs $5 and $10, or $5-$10, and $3</p>');
  assert.equal(mdHTML('see $\\foo{x}$ and $x^{$ then'), '<p>see <code class="md-math-err">$\\foo{x}$</code> and <code class="md-math-err">$x^{$</code> then</p>');
  assert.equal(mdHTML('$a < b$ & $\\text{<b>hi</b>}$'), '<p><math><mrow><mi>a</mi><mo>&lt;</mo><mi>b</mi></mrow></math> &amp; <math><mtext>&lt;b&gt;hi&lt;/b&gt;</mtext></math></p>');
  // What a thesis report holds: the Gor'kov potential, an aligned derivation, a matrix, cases, sums and integrals.
  const thesis = [
    '$$U = \\frac{4\\pi a^3}{3}\\left[f_1 \\frac{\\langle p^2\\rangle}{2\\rho_0 c_0^2} - f_2 \\frac{3\\rho_0 \\langle v^2\\rangle}{4}\\right]$$',
    '$$\n\\begin{aligned}\nF &= -\\nabla U \\\\\n  &\\approx 4\\pi a^3 \\Phi\\, k E_{ac} \\sin(2kx)\n\\end{aligned}\n$$',
    '$$\\mathbf{J} = \\begin{pmatrix} \\partial_x u & \\partial_y u \\\\ \\partial_x v & \\partial_y v \\end{pmatrix}, \\quad f(x) = \\begin{cases} 1 & x > 0 \\\\ 0 & \\text{otherwise} \\end{cases}$$',
    'Inline $\\sum_{i=1}^{N} \\int_0^\\infty e^{-\\lambda t}\\,\\mathrm{d}t \\leq \\sqrt[3]{x} \\pm \\hat{\\theta}\'$ and $\\lim_{n \\to \\infty} \\sin^2 x$.',
  ].join('\n\n');
  const html = mdHTML(thesis);
  assert.doesNotMatch(html, /md-math-err/);
  assert.equal((html.match(/<math/g) || []).length, 5);
  assert.match(html, /<mo stretchy="true">\[<\/mo>.*<mo stretchy="true">\]<\/mo>/);
  assert.match(html, /<mtable><mtr><mtd style="text-align:right"><mi>F<\/mi><\/mtd><mtd style="text-align:left"><mrow><mo>=<\/mo>/);
  assert.match(html, /<mo stretchy="true">\(<\/mo><mtable>/);
  assert.match(html, /<munderover><mo>∑<\/mo><mrow><mi>i<\/mi><mo>=<\/mo><mn>1<\/mn><\/mrow><mi>N<\/mi><\/munderover>/);
  assert.match(html, /<msubsup><mo>∫<\/mo><mn>0<\/mn><mi>∞<\/mi><\/msubsup>/);
  assert.match(html, /<mroot><mi>x<\/mi><mn>3<\/mn><\/mroot>/);
  assert.match(html, /<munder><mo movablelimits="true">lim<\/mo>.*<msup><mi>sin<\/mi><mn>2<\/mn><\/msup><mo>\u2061<\/mo>/);
});

test('images: a linked one, or one a linked report shows; nothing else, 10 MB at most; outside the reader an image is its name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-img-')), r = path.join(dir, 'report.md');
  fs.mkdirSync(path.join(dir, 'fig'));
  for (const f of ['fig/a.png', 'b.jpg', 'c.svg', 'loose.png']) fs.writeFileSync(path.join(dir, f), 'IMG');
  fs.writeFileSync(path.join(dir, 'huge.png'), ''); fs.truncateSync(path.join(dir, 'huge.png'), (10 << 20) + 1);
  fs.writeFileSync(r, `# R\n\n![field](fig/a.png)\n\n![abs](${path.join(dir, 'c.svg')} "title")\n\n![big](huge.png)\n`);
  const d = { commits: { c1: { links: [r, path.join(dir, 'b.jpg')] } } };
  assert.deepEqual(readLinkedImage(d, path.join(dir, 'b.jpg')), { type: 'image/jpeg', data: Buffer.from('IMG') });
  assert.equal(readLinkedImage(d, 'fig/a.png', r).type, 'image/png'); // relative to the report's folder
  assert.equal(readLinkedImage(d, path.join(dir, 'c.svg'), r).type, 'image/svg+xml');
  assert.equal(readLinkedImage(d, path.join(dir, 'loose.png')).error, 'unlinked'); // no record links it
  assert.equal(readLinkedImage(d, 'loose.png', r).error, 'unlinked'); // the report does not show it
  assert.equal(readLinkedImage(d, 'fig/a.png', path.join(dir, 'other.md')).error, 'unlinked'); // the report is not linked
  assert.equal(readLinkedImage(d, 'huge.png', r).error, 'bigImg');
  assert.equal(readLinkedImage(d, r).error, 'type');
  fs.rmSync(path.join(dir, 'fig', 'a.png'));
  assert.equal(readLinkedImage(d, 'fig/a.png', r).error, 'missing');
  assert.equal(mdHTML('See ![field map](fig/a.png) and ![](https://x.org/p.png)'), '<p>See <span class="md-ref" title="fig/a.png">field map</span> and <span class="md-ref" title="https://x.org/p.png">p.png</span></p>');
});

test('math: \\mathrm keeps its letters upright, also around spaces and scripts', () => {
  assert.equal(mdHTML('$\\mathrm{J\\,m^{-3}}$'), '<p><math><mrow><mi mathvariant="normal">J</mi><mspace width="0.167em"></mspace><msup><mi mathvariant="normal">m</mi><mrow><mo>−</mo><mn>3</mn></mrow></msup></mrow></math></p>');
});
