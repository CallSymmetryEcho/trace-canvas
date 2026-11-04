import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLinkedMd } from '../src/git-view.mjs';

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

test('the reader opens only .md files a record links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-md-')), f = path.join(dir, 'r.md');
  fs.writeFileSync(f, '# Report');
  const d = { commits: { c1: { links: [f, path.join(dir, 'gone.md'), '/etc/hosts'] } } };
  assert.deepEqual(readLinkedMd(d, f), { text: '# Report' });
  assert.match(readLinkedMd(d, path.join(dir, 'other.md')).error, /unlinked/);
  assert.match(readLinkedMd(d, '/etc/hosts').error, /type/);
  assert.match(readLinkedMd(d, path.join(dir, 'gone.md')).error, /missing/);
});
