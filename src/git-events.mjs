// Reads what a shell command did to git from the command line and its output.
// Shared by the live hooks and by transcript import so both log the same moments.
import os from 'node:os';
import path from 'node:path';

// `git commit`, also with options before the subcommand (`git -C dir -c k=v commit`), as a command
// of its own: not `git log --grep commit`, and not code that merely mentions git and commit.
export const GIT_COMMIT = /(?:^|[\s;&|(`])git(?:\s+(?:-[cC]\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)|--?[\w-]+(?:=\S*)?))*\s+commit\b/m;

// The folder a commit command ran in: `git -C <dir>`, else after the `cd <dir>`s before the commit,
// else cwd. Quotes, ~ and $HOME are handled; anything cleverer (other variables, subshells) gives cwd.
export function commandDir(cmd, cwd) {
  cmd = String(cmd || '');
  const unq = s => s.replace(/^(['"])(.*)\1$/, '$2').replace(/^(~|\$HOME)(?=\/|$)/, os.homedir());
  const hit = GIT_COMMIT.exec(cmd), at = hit ? hit.index + hit[0].indexOf('git') : -1;
  let dir = cwd || process.cwd();
  for (const m of (at >= 0 ? cmd.slice(0, at) : '').matchAll(/(?:^|[;&|(]|\s)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g)) {
    const to = unq(m[1]);
    if (to !== '-' && !to.includes('$')) dir = path.resolve(dir, to);
  }
  const c = at >= 0 && cmd.slice(at).match(/^git\b[^\n;&|]*?\s-C\s+("[^"]*"|'[^']*'|[^\s;&|]+)/);
  return c && !c[1].includes('$') ? path.resolve(dir, unq(c[1])) : dir;
}

export function gitEvents(cmd, stdout = '', stderr = '', gitOperation = null) {
  cmd = String(cmd || '');
  const out = `${stdout || ''}\n${stderr || ''}`;
  const ev = { commits: [], push: null, pr: null, merge: null };

  if (GIT_COMMIT.test(cmd) && !/--dry-run/.test(cmd)) {
    for (const m of out.matchAll(/^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm)) ev.commits.push({ sha: m[2], subject: m[3] });
    // Newer Claude Code versions also report the commit as structured data, which survives `| tail` and quiet flags.
    const op = gitOperation && gitOperation.commit;
    if (!ev.commits.length && op && op.sha && (!op.kind || op.kind === 'committed')) ev.commits.push({ sha: String(op.sha), subject: commitMessage(cmd) || String(op.branch || '') });
    // `git commit -q && git log --oneline -1` style output.
    if (!ev.commits.length) {
      const m = String(stdout || '').match(/^([0-9a-f]{7,40}) (.+)$/m);
      if (m) ev.commits.push({ sha: m[1], subject: m[2] });
    }
  }
  if (/\bgit\b[^\n;&|]*\bpush\b/.test(cmd) && !/Everything up-to-date/.test(out)) {
    const ref = out.match(/^\s*[+*\-!= ]?\s*(?:[0-9a-f]+\.\.\.?[0-9a-f]+|\[new branch\]|\[new tag\])\s+(\S+)\s+->\s+(\S+)/m);
    if (ref) ev.push = ref[2];
  }
  if (/\bgh\s+pr\s+create\b/.test(cmd)) {
    const pr = out.match(/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/(\d+)/);
    if (pr) ev.pr = { number: pr[1], url: pr[0] };
  }
  const mg = cmd.match(/\bgit\s+merge\s+(?:--?[\w-]+(?:[= ][^\s-]\S*)?\s+)*([\w./@-]+)/);
  if (mg && !/CONFLICT|Already up to date|fatal|error:/i.test(out)) ev.merge = mg[1].replace(/^origin\//, '');
  return ev;
}

// The commit subject from `-m "…"`, or from the heredoc in the usual `-m "$(cat <<'EOF' … EOF)"` form.
export function commitMessage(cmd) {
  const m = cmd.match(/<<-?\s*['"]?(\w+)['"]?\n([\s\S]*?)\n\s*\1/) || cmd.match(/\s-m\s+(["'])([\s\S]*?)\1/);
  return m ? m[2].split('\n').map(s => s.trim()).find(Boolean) || '' : '';
}

// Shell commands that change files, and the targets of `>` / `>>` redirects.
export const BASH_WRITES = /(?:^|[\s;&|(])(?:tee|sed\s+-i\S*|perl\s+-pi\S*|mv|cp|rm|mkdir|touch|ln|git\s+(?:mv|rm|apply|restore|checkout\s+--))(?=\s)/;
export function redirectTargets(cmd, cwd = '') {
  const out = [];
  // Drop heredoc bodies and quoted strings first, so a `>` inside a message is not read as a redirect.
  const bare = String(cmd)
    .replace(/<<-?[ \t]*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\s|$|\))/g, '<<$2$3')
    .replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""');
  // With cwd: each target as a full path, from the folder the command had cd-ed into by then (`cd /tmp/x && cat > a.txt`
  // writes /tmp/x/a.txt, not a.txt in the session's folder). A cd that cannot be followed ($VAR, -, quoted) drops a relative target: where it went is not known.
  const cds = cwd ? [...bare.matchAll(/(?:^|[;&|(]|\s)cd\s+([^\s;&|)"]+)/g)] : [];
  for (const m of bare.matchAll(/(?<![0-9&<>=\-])>{1,2}[ \t]*([^\s|;&<>()'"]+)/g)) {
    const f = m[1];
    if (!f || f.startsWith('&') || f.startsWith('/dev/')) continue;
    if (!cwd) { out.push(f); continue; }
    let dir = cwd, known = true;
    for (const c of cds) if (c.index < m.index) { const to = c[1].replace(/^(~|\$HOME)(?=\/|$)/, os.homedir()); if (to === '-' || to.includes('$')) known = false; else dir = path.resolve(dir, to); }
    if (known || path.isAbsolute(f)) out.push(path.resolve(dir, f));
  }
  return out;
}
// A file in a temporary folder (an agent's scratchpad, /tmp) outside the project: scratch work, not a change to the
// person's files. A project that itself lives in a temporary folder keeps its files.
const TMP = [...new Set(['/tmp', '/private/tmp', '/var/folders', '/private/var/folders', os.tmpdir()])];
const unprivate = p => String(p).replace(/^\/private(?=\/(?:var|tmp)(?:\/|$))/, ''); // macOS: /tmp and /var are /private/tmp and /private/var
const under = (f, d) => { if (!d) return false; f = unprivate(f); d = unprivate(d).replace(/\/$/, ''); return f === d || f.startsWith(d + '/'); };
export const isScratch = (f, project = '') => path.isAbsolute(String(f)) && TMP.some(t => under(String(f), t)) && !under(String(f), project);

export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// First sentence of an assistant message. Headings and code are skipped, markdown stripped.
export function headline(msg, n = 110) {
  const lines = String(msg || '').replace(/```[\s\S]*?```/g, '\n').split('\n').map(x => x.trim()).filter(Boolean);
  const pick = lines.find(l => !/^#{1,6}\s/.test(l) && l.replace(/[^\p{L}\p{N}]/gu, '').length > 2) || lines[0] || '';
  const plain = pick.replace(/^#{1,6}\s+/, '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/(^|[^\w])_{1,2}([^_\n]+?)_{1,2}(?!\w)/g, '$1$2').replace(/[*`>|]/g, '').trim(); // _emphasis_ goes, snake_case stays
  const sentence = plain.split(/(?<=[.!?])\s+|(?<=[。！？])/)[0] || plain;
  return sentence.length > n ? sentence.slice(0, n - 1) + '…' : sentence;
}

export const firstLine = (s, n) => {
  const line = String(s || '').split('\n').map(x => x.trim()).find(Boolean) || '';
  return line.length > n ? line.slice(0, n - 1) + '…' : line;
};

// User prompts arrive with pasted blocks, reminders, background-task notifications and
// command wrappers; keep what the person typed.
export function cleanPrompt(p) {
  // A message that is one paste and nothing else is what the person sent (an Autopilot or hand-off prompt pasted in):
  // keep its text. A paste among typed words is shortened. The closing tag may carry the paste's id.
  const only = /^\s*<pasted_content[^>]*>([\s\S]*?)<\/pasted_content[^>]*>\s*$/.exec(String(p || ''));
  return (only ? only[1] : String(p || ''))
    .replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted]')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    // Messages the desktop app delivers from other sessions arrive as prompts too; nobody typed them.
    .replace(/<cross-session-message\b[^>]*>[\s\S]*?<\/cross-session-message>/g, '')
    .replace(/<side-sessions-event>[\s\S]*?<\/side-sessions-event>/g, '')
    .trim();
}
