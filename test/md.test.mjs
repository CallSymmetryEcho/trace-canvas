import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullFile, readLinkedImage, readLinkedMd } from '../src/git-view.mjs';

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

test('the reader opens only reports (.md, .txt) and data or code (.csv, .py, .json) a record links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-md-')), f = path.join(dir, 'r.md'), txt = path.join(dir, 'plan.txt');
  const csv = path.join(dir, 'per_frame.csv');
  fs.writeFileSync(f, '# Report'); fs.writeFileSync(txt, '大纲\n- Fig.1'); fs.writeFileSync(csv, 'sequence,mid_net_DN\nS82,5472'); fs.writeFileSync(path.join(dir, 'run.sh'), 'rm -rf /');
  const d = { commits: { c1: { links: [f, txt, csv, path.join(dir, 'gone.md'), '/etc/hosts', path.join(dir, 's.json'), path.join(dir, 'run.sh')] } } };
  assert.deepEqual(readLinkedMd(d, f), { text: '# Report' });
  assert.deepEqual(readLinkedMd(d, txt), { text: '大纲\n- Fig.1' });
  assert.deepEqual(readLinkedMd(d, csv), { text: 'sequence,mid_net_DN\nS82,5472' });
  assert.match(readLinkedMd(d, path.join(dir, 's.json')).error, /missing/); // a text type, linked, not on disk
  assert.match(readLinkedMd(d, path.join(dir, 'run.sh')).error, /type/); // linked, but not a type the page reads
  assert.match(readLinkedMd(d, path.join(dir, 'analyze.py')).error, /unlinked/);
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

// The page's code colourer for diffs, taken out the same way.
const { hlLine, hlLang } = new Function('esc', `${page.slice(page.indexOf('// <hl>'), page.indexOf('// </hl>'))}; return { hlLine, hlLang };`)(esc);
test('code in a diff is coloured by language: keywords, strings, comments, numbers; text stays text', () => {
  assert.equal(hlLine("const a = 'x<y'; // 12 <b>", 'js'), '<i class="hk">const</i> a = <i class="hs">&#39;x&lt;y&#39;</i>; <i class="hc">// 12 &lt;b&gt;</i>');
  assert.equal(hlLine('  return n1 + 0.5;', 'js'), '  <i class="hk">return</i> n1 + <i class="hn">0.5</i>;');
  assert.equal(hlLine('.a:hover { color: #fff; margin: 0 4px; } /* x */', 'css'), '.a:hover { <i class="hk">color</i>: <i class="hn">#fff</i>; <i class="hk">margin</i>: <i class="hn">0</i> <i class="hn">4px</i>; } <i class="hc">/* x */</i>');
  assert.equal(hlLine('def f(x):  # go', 'py'), '<i class="hk">def</i> f(x):  <i class="hc"># go</i>');
  assert.equal(hlLine('"name": "tc", "n": 3, "ok": true', 'json'), '<i class="hk">&quot;name&quot;</i>: <i class="hs">&quot;tc&quot;</i>, <i class="hk">&quot;n&quot;</i>: <i class="hn">3</i>, <i class="hk">&quot;ok&quot;</i>: <i class="hk">true</i>');
  assert.equal(hlLine('<div class="a">x</div>', 'html'), '<i class="hk">&lt;div</i> class=<i class="hs">&quot;a&quot;</i><i class="hk">&gt;</i>x<i class="hk">&lt;/div</i><i class="hk">&gt;</i>');
  assert.equal(hlLine('## Install `npm`', 'md'), '<i class="hk">## Install `npm`</i>');
  assert.equal(hlLine('if [ -f x ]; then echo "hi" # c', 'sh'), '<i class="hk">if</i> [ -f x ]; <i class="hk">then</i> echo <i class="hs">&quot;hi&quot;</i><i class="hc"> # c</i>');
  assert.equal(hlLine('<b>x</b> const', ''), '&lt;b&gt;x&lt;/b&gt; const'); // an unknown language stays plain
  assert.deepEqual(['a/b.MJS', 'x.css', 'Makefile', 'p.lock'].map(hlLang), ['js', 'css', '', '']);
});

test('a report a record changed opens from that record, and one only another machine has is pulled into a copy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pull-')), env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_MACHINE: 'here' };
  const repo = path.join(root, 'repo'), there = path.join(root, 'there'); // `there` stands for the other machine's disk
  fs.mkdirSync(path.join(repo, 'sub', 'deep'), { recursive: true }); fs.mkdirSync(path.join(there, 'proj', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'reports.md'), '# Here'); fs.writeFileSync(path.join(repo, 'here.png'), 'PNG-here'); fs.writeFileSync(path.join(repo, 'key.json'), '{}');
  fs.mkdirSync(path.join(there, 'proj', 'fig')); fs.writeFileSync(path.join(there, 'proj', 'fig', 'a b.png'), 'PNG-far');
  fs.writeFileSync(path.join(there, 'proj', 'far.md'), '# Far\n![a](fig/a%20b.png) ![gone](fig/no.png) ![out](../../../../../../../../etc/x.png) ![web](https://x.org/y.png)'); fs.writeFileSync(path.join(there, 'abs.md'), '# Abs');
  const d = { commits: {
    a: { id: 'a', session: 's1', machine: 'here', links: [], files: ['reports.md', 'key.json'] },
    b: { id: 'b', session: 's2', machine: 'mac', links: [], files: ['far.md', path.join(there, 'abs.md'), 'nope.md'] },
    c: { id: 'c', session: 's3', machine: '-oProxyCommand=x', links: [], files: ['far.md'] },
  }, sessions: { s1: { id: 's1', cwd: path.join(repo, 'sub', 'deep') }, s2: { id: 's2', cwd: path.join(there, 'proj', 'sub') }, s3: { id: 's3', cwd: there } } };
  fs.writeFileSync(path.join(repo, 'reports.md'), '# Here\n![h](here.png)');
  assert.deepEqual(readLinkedMd(d, 'reports.md', 'a', env), { text: '# Here\n![h](here.png)' }); // found from the session's folder upward
  assert.equal(String(readLinkedImage(d, 'here.png', 'reports.md', 'a', env).data), 'PNG-here'); // its image: beside the report where it really is
  assert.equal(readLinkedMd(d, 'reports.md', null, env).error, 'unlinked'); // not without the record
  assert.equal(readLinkedMd(d, 'key.json', 'a', env).error, 'unlinked'); // changed, but data: only when linked
  assert.equal(readLinkedMd(d, 'reports.md', 'b', env).error, 'unlinked'); // another record's file
  assert.deepEqual(readLinkedMd(d, 'far.md', 'b', env), { error: 'away', machine: 'mac' });
  assert.equal(readLinkedMd(d, 'far.md', 'c', env).error, 'missing'); // a machine name that is not a plain name is never called
  // A stand-in ssh that runs the command here: what the other machine would be asked to run.
  const bin = path.join(root, 'bin'), old = process.env.PATH;
  fs.mkdirSync(bin); fs.writeFileSync(path.join(bin, 'ssh'), '#!/bin/sh\nfor a; do last=$a; done\nexec /bin/sh -c "$last"\n', { mode: 0o755 });
  process.env.PATH = `${bin}:${old}`;
  try {
    assert.deepEqual(await pullFile(d, 'far.md', 'b', env), { ok: true });
    assert.deepEqual(await pullFile(d, path.join(there, 'abs.md'), 'b', env), { ok: true });
    assert.deepEqual(await pullFile(d, 'nope.md', 'b', env), { error: 'gone', machine: 'mac' });
    assert.equal((await pullFile(d, 'key.json', 'a', env)).error, 'unlinked');
  } finally { process.env.PATH = old; }
  const got = readLinkedMd(d, 'far.md', 'b', env);
  assert.match(got.text, /^# Far/); assert.equal(got.from, 'mac');
  // The report brought its image along; one that is gone there, or outside this machine's folder for that one, is left.
  const img = readLinkedImage(d, 'fig/a%20b.png', 'far.md', 'b', env);
  assert.equal(String(img.data), 'PNG-far'); assert.equal(img.from, 'mac');
  assert.equal(readLinkedImage(d, 'fig/no.png', 'far.md', 'b', env).error, 'missing');
  assert.equal(readLinkedImage(d, '../../../../../../../../etc/x.png', 'far.md', 'b', env).error, 'missing'); assert.ok(got.at > 0);
  assert.equal(readLinkedMd(d, path.join(there, 'abs.md'), 'b', env).text, '# Abs');
  assert.ok(fs.existsSync(path.join(root, 'home', 'files', 'mac', there, 'proj', 'sub', 'far.md'))); // kept under the data folder, by machine
});

test('a file this machine does not have is looked for on the machine whose home it is under, and a reply\'s full paths are linked', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-else-')), env = { ...process.env, TRACE_CANVAS_HOME: path.join(root, 'home'), TRACE_CANVAS_MACHINE: 'here' };
  // An agent here wrote /Users/ann/cv/roles.md on the Mac over ssh and linked that path; its record says "here".
  const d = { commits: {
    a: { id: 'a', thread: 't1', machine: 'here', links: ['/Users/ann/cv/roles.md', '~/cv/notes.md', '/home/nobody/x.md'] },
  }, sessions: { m1: { id: 'm1', machine: 'mac', thread: 't1', cwd: '/Users/ann/cv', last: 2 }, h1: { id: 'h1', machine: 'here', thread: 't1', cwd: '/home/me', last: 3 } } };
  assert.deepEqual(readLinkedMd(d, '/Users/ann/cv/roles.md', 'a', env), { error: 'away', machine: 'mac' }); // by its home folder
  assert.deepEqual(readLinkedMd(d, '~/cv/notes.md', 'a', env), { error: 'away', machine: 'mac' }); // ~: the other machine on the line
  assert.equal(readLinkedMd(d, '/home/nobody/x.md', 'a', env).error, 'missing'); // nobody's home: nowhere to ask
  const { namedReports } = await import('../src/hook.mjs');
  assert.deepEqual(namedReports('Saved on the Mac at `~/cv/roles.md`，also /home/me/proj/in.md, /home/me/out.txt and https://x.org/home/a.md', '/home/me/proj'), ['~/cv/roles.md', '/home/me/out.txt']);
});
