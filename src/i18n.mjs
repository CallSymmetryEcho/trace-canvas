// Wording for records the hooks and CLI write. The page has its own table.
export const fmtTokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
// A past session's span in local time: 2026-10-23 14:02–16:40 (the end with its date when it is another day).
const when = s => { const f = ts => { const x = new Date(ts), p = n => String(n).padStart(2, '0'); return [`${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`, `${p(x.getHours())}:${p(x.getMinutes())}`]; }; const [a, b] = [f(s.start), f(s.end || s.start)]; return `${a[0]} ${a[1]}–${b[0] === a[0] ? '' : `${b[0]} `}${b[1]}`; };
const S = {
  en: {
    branchedFrom: (branch, parent) => `Branched ${branch} from ${parent}`,
    commit: (hash, subject) => `Commit ${hash}: ${subject}`,
    olderCommits: (n, day) => `${n} earlier commit${n === 1 ? '' : 's'}, from ${day}`,
    pastSession: s => `${s.agent} session · ${when(s)} · ${s.prompts} prompt${s.prompts === 1 ? '' : 's'}${s.files ? ` · ${s.files} file${s.files === 1 ? '' : 's'}` : ''}${s.commits.length ? ` · commits ${s.commits.join(', ')}` : ''}`,
    pushed: ref => `Pushed ${ref}`,
    prOpened: n => `Opened pull request #${n}`,
    merged: src => `Merged ${src}`,
    turnChanged: n => `Changed ${n} file${n === 1 ? '' : 's'}`,
    filesLabel: 'Files changed',
    todosLabel: 'Completed',
    commitsLabel: 'Commits',
    sessionEnd: (mins, prompts, files, commits) => `Session ended · ${mins} min · ${prompts} prompt${prompts === 1 ? '' : 's'} · ${files} file${files === 1 ? '' : 's'} · ${commits} commit${commits === 1 ? '' : 's'}`,
    reason: r => `Reason: ${r}`,
    resume: 'Resume',
    sessionThread: (repo, date) => `${repo} session ${date}`,
    combinedFrom: names => `Combined from ${names}`,
    inbox: 'Inbox', branchDefault: n => `${n} · branch`, forkTitle: (p, ti) => `Forked from ${p}: ${ti}`,
    retroTitle: (n, top, rounds) => `Retro: ${n} piece${n === 1 ? '' : 's'} of work; the most back-and-forth was "${top}" (${rounds} rounds)`,
    retroNone: 'Retro: nothing to rank yet',
    retroStats: r => `${r.rounds} rounds · ${r.minutes} min · ${fmtTokens(r.tokens)} tokens · ${r.corrections} corrections · ${r.sessions} session${r.sessions === 1 ? '' : 's'} · difficulty ${r.difficulty}`,
  },
  zh: {
    branchedFrom: (branch, parent) => `从 ${parent} 分出分支 ${branch}`,
    commit: (hash, subject) => `提交 ${hash}：${subject}`,
    olderCommits: (n, day) => `更早的 ${n} 个提交（从 ${day} 起）`,
    pastSession: s => `${s.agent} 会话 · ${when(s)} · ${s.prompts} 条指令${s.files ? ` · ${s.files} 个文件` : ''}${s.commits.length ? ` · 提交 ${s.commits.join('、')}` : ''}`,
    pushed: ref => `推送 ${ref}`,
    prOpened: n => `创建 PR #${n}`,
    merged: src => `合并 ${src}`,
    turnChanged: n => `修改了 ${n} 个文件`,
    filesLabel: '改动的文件',
    todosLabel: '完成的待办',
    commitsLabel: '提交',
    sessionEnd: (mins, prompts, files, commits) => `会话结束 · ${mins} 分钟 · ${prompts} 条指令 · ${files} 个文件 · ${commits} 次提交`,
    reason: r => `结束原因：${r}`,
    resume: '恢复会话',
    sessionThread: (repo, date) => `${repo} 会话 ${date}`,
    combinedFrom: names => `由 ${names} 合并而来`,
    inbox: '收件箱', branchDefault: n => `${n} · 分支`, forkTitle: (p, ti) => `从「${p}」分叉：${ti}`,
    retroTitle: (n, top, rounds) => `复盘：${n} 件事，来回最多的是「${top}」（${rounds} 轮）`,
    retroNone: '复盘：还没有可排行的事',
    retroStats: r => `${r.rounds} 轮 · ${r.minutes} 分钟 · ${fmtTokens(r.tokens)} token · 纠正 ${r.corrections} 次 · ${r.sessions} 个会话 · 难度 ${r.difficulty}`,
  },
};
export function tr(lang, key, ...args) {
  const table = S[lang] || S.en;
  const v = table[key] ?? S.en[key];
  return typeof v === 'function' ? v(...args) : v;
}
