import test from 'node:test';
import assert from 'node:assert/strict';
import { cases, precedents } from '../src/precedents.mjs';

test('cases: decisions with rules, questions paired with the answer naming the to-do, reviews by outcome', () => {
  const T = 'tA', c = (id, ts, kind, title, x = {}) => ({ id, ts, kind, title, thread: T, body: '', ...x });
  const d = { threads: { [T]: { id: T, name: 'App' } }, commits: Object.fromEntries([
    c('caaaaaaaaaaaa1', 1, 'task', '推送 GitHub 发版'),
    c('caaaaaaaaaaaa2', 2, 'task', 'Dark mode', { done: true, toReview: true, result: 'added theme' }),
    c('caaaaaaaaaaaa3', 3, 'task', 'CSV export', { returned: { note: 'also xlsx' } }),
    c('caaaaaaaaaaaa4', 4, 'task', 'Icons', { done: true, reviewedAt: 9, result: 'svg icons' }),
    c('cbbbbbbbbbbbb1', 5, 'decision', '宣传线验收（cleared 8 · 7 wait on you） · 依据 H1、R8'),
    c('cbbbbbbbbbbbb2', 6, 'decision', 'Plan · cleared 8 · 7 wait'),
    c('cbbbbbbbbbbbb3', 7, 'note', 'Question: 推送到 GitHub 吗？ [caaaaaaaaaaaa1]'),
    c('cbbbbbbbbbbbb4', 8, 'decision', '用户：先不推 [caaaaaaaaaaaa1] · 依据 H3'),
    c('cbbbbbbbbbbbb5', 9, 'note', 'Question: Icons in SVG? [caaaaaaaaaaaa4]'),
  ].map(x => [x.id, x])) };
  const all = cases(d), by = id => all.filter(x => x.id === id);
  assert.deepEqual([by('cbbbbbbbbbbbb1')[0].rule, by('cbbbbbbbbbbbb1')[0].action], ['H1 R8', '宣传线验收（cleared 8 · 7 wait on you）']);
  assert.deepEqual([by('cbbbbbbbbbbbb2')[0].rule, by('cbbbbbbbbbbbb2')[0].action], ['', 'Plan · cleared 8 · 7 wait']);
  const q = by('cbbbbbbbbbbbb3')[0];
  assert.equal(q.type, 'question'); assert.equal(q.situation, '推送 GitHub 发版'); assert.equal(q.action, 'ask: 推送到 GitHub 吗？');
  assert.match(q.outcome, /^answered: 用户：先不推/);
  assert.equal(by('cbbbbbbbbbbbb5')[0].outcome, 'unanswered');
  assert.deepEqual(['caaaaaaaaaaaa2', 'caaaaaaaaaaaa3', 'caaaaaaaaaaaa4'].map(id => by(id)[0].outcome), ['pending', 'returned: also xlsx', 'passed']);
  assert.equal(by('caaaaaaaaaaaa1').length, 0); // an open to-do nobody ticked is not a case
  const p = precedents(d, '要不要推送 GitHub');
  assert.equal(p[0].id, 'cbbbbbbbbbbbb3');
  assert.deepEqual(precedents(d, '   '), []);
});
