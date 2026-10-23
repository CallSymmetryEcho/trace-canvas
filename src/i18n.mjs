// Wording for records the hooks and CLI write. The page has its own table.
const S = {
  en: {
    branchedFrom: (branch, parent) => `Branched ${branch} from ${parent}`,
    commit: (hash, subject) => `Commit ${hash}: ${subject}`,
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
  },
  zh: {
    branchedFrom: (branch, parent) => `从 ${parent} 分出分支 ${branch}`,
    commit: (hash, subject) => `提交 ${hash}：${subject}`,
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
  },
};
export function tr(lang, key, ...args) {
  const table = S[lang] || S.en;
  const v = table[key] ?? S.en[key];
  return typeof v === 'function' ? v(...args) : v;
}
