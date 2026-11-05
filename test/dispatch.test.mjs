import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyData, addCommit, createThread, machineName } from '../src/store.mjs';
import { dispatch } from '../src/ops.mjs';

test('dispatch hands each line\'s new to-dos to the agent working on it, and says how to wake it', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dispatch-'));
  // The machine the records here say they are from.
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(tmp, 'home'), TRACE_CANVAS_DESKTOP_DIR: path.join(tmp, 'desk'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: machineName() };
  const now = Date.now(), live = path.join(tmp, 'home', 'live');
  fs.mkdirSync(live, { recursive: true });
  const running = (id, agent, agentKey, status) => fs.writeFileSync(path.join(live, `${id}.json`), JSON.stringify({ id, agent, agentKey, status, startedAt: now - 9e5, lastSeen: now, cwd: tmp }));
  const d = emptyData();
  const [thesis, promo, app, scripts, mine, videos, tools] = ['Thesis', 'Promo', 'App', 'Scripts', 'Mine', 'Videos', 'Tools'].map(name => createThread(d, { name }).id);
  const session = (id, thread, agent, ago) => { d.sessions[id] = { id, thread, agent, cwd: tmp, last: now - ago }; };
  // A to-do the person logged (on the page or the phone), or one an agent logged (from a session, if known).
  const todo = (thread, title, agent = '', fromSession) => addCommit(d, { thread, kind: 'task', title, agent, ts: now - 6e5, extra: fromSession ? { fromSession } : {} });

  // A stopped Claude Code session: what the person logged and what another session logged are new to it.
  session('s1', thesis, 'Claude Code', 7e6);
  todo(thesis, 'Its own to-do', 'Claude Code', 's1'); todo(thesis, 'An older agent to-do', 'Claude Code');
  const fig = todo(thesis, 'Redo figure 3'); todo(thesis, 'Cite the 2024 survey', 'Codex', 'c9');
  // No session yet: a new one.
  const cut = todo(promo, 'Cut a 30 s version');
  // A running Claude Code session gets a message; a working Codex one waits; a stopped Codex one is resumed.
  session('s3', app, 'Claude Code', 0); running('s3', 'Claude Code', 'claude', 'idle');
  todo(app, 'Fix the login bug');
  session('c1', scripts, 'Codex', 7e6);
  todo(scripts, 'Rename the build script');
  session('me', mine, 'Claude Code', 0); running('me', 'Claude Code', 'claude', 'working');
  todo(mine, 'Write the summary');
  // The line's agent is whoever last worked there: a session that sits on another line but logged here since.
  session('old', videos, 'Claude Code', 9e6);
  session('v', tools, 'Claude Code', 0);
  addCommit(d, { thread: videos, kind: 'agent', title: 'Video 21 is scheduled', agent: 'Claude Code', ts: now - 3e5, extra: { fromSession: 'v' } });
  todo(videos, 'Post the vertical cut');
  // Ending is not working there: the note the hooks write when an idle session ends does not make it the line's agent.
  addCommit(d, { thread: videos, kind: 'note', title: 'Session ended · 600 min · 1 prompt', agent: 'Claude Code', ts: now - 1e5, extra: { session: 'old' } });

  const rows = dispatch(d, { self: 'me' }, env);
  const by = Object.fromEntries(rows.map(r => [r.thread.name, r]));
  assert.deepEqual(rows.map(r => [r.thread.name, r.action, r.agent, r.session && r.session.id, r.todos.map(c => c.title)]).sort(), [
    ['App', 'message', 'claude', 's3', ['Fix the login bug']],
    ['Mine', 'self', 'claude', 'me', ['Write the summary']],
    ['Promo', 'start', 'claude', undefined, ['Cut a 30 s version']],
    ['Scripts', 'resume', 'codex', 'c1', ['Rename the build script']],
    ['Thesis', 'resume', 'claude', 's1', ['Redo figure 3', 'Cite the 2024 survey']],
    ['Videos', 'resume', 'claude', 'v', ['Post the vertical cut']],
  ]);
  assert.equal(by.Thesis.command, `cd '${tmp}' && claude --resume s1 '${by.Thesis.prompt}'`);
  assert.match(by.Thesis.prompt, new RegExp(`are yours: 1\\) Redo figure 3 \\[${fig.id}\\]; 2\\) Cite`));
  assert.match(by.Scripts.command, /&& codex resume c1 'New to-dos/);
  assert.match(by.Promo.command, new RegExp(`TRACE_CANVAS_THREAD=${promo} claude --remote-control='Promo' `));
  assert.equal(by.App.session.status, 'idle');
  assert.equal(d.commits[cut.id].assignee, 'claude');

  assert.deepEqual(dispatch(d, {}, env), []); // handed out once
  running('c1', 'Codex', 'codex', 'working');
  todo(scripts, 'Add a lint step');
  const [busy] = dispatch(d, { refs: ['Scripts'] }, env);
  assert.equal(busy.action, 'busy');
  assert.match(busy.command, /TRACE_CANVAS_THREAD=.* codex /); // B: a new session, when the person would rather not wait
  assert.deepEqual(dispatch(d, { refs: ['Thesis'], all: true }, env)[0].todos.map(c => c.title), ['Its own to-do', 'An older agent to-do']);
  // A to-do named goes to its line's agent, even one that agent logged itself.
  assert.deepEqual(dispatch(d, { refs: ['Its own to-do'] }, env).map(r => [r.thread.name, r.session.id, r.todos.map(c => c.title)]), [['Thesis', 's1', ['Its own to-do']]]);
  assert.throws(() => dispatch(d, { refs: ['Nope'] }, env), /No line or open to-do "Nope"/);

  // A line worked on from another machine: resumed there over ssh, in its login shell; running there, it is busy.
  const far = createThread(d, { name: 'Far' }).id;
  d.sessions.r1 = { id: 'r1', thread: far, agent: 'Claude Code', cwd: '/home/u/proj', last: now, machine: 'bsuper' };
  todo(far, 'Rerun the benchmark');
  const off = dispatch(d, { refs: ['Far'], awayLive: () => ({ sessions: [] }) }, env)[0];
  assert.equal(off.action, 'resume');
  assert.equal(off.session.machine, 'bsuper');
  assert.match(off.command, /^ssh -t bsuper 'exec "\$SHELL" -lc .*PATH="\$HOME\/\.local\/bin:\$PATH"; if cd .*\/home\/u\/proj.* 2>\/dev\/null; then claude --resume r1 /);
  // It runs there in tmux, named by the session; the attach and the by-hand command are plain ssh -t.
  assert.deepEqual([off.tmux.machine, off.tmux.name, off.tmux.attach], ['bsuper', 'tc-r1', `ssh -t bsuper 'exec "$SHELL" -lc '\\''PATH="$HOME/.local/bin:$PATH"; tmux attach -t tc-r1'\\'''`]);
  // Its folder may be gone there: then a new session on the line instead of a resume that cannot find it.
  assert.match(off.tmux.cmd, /^if cd .*\/home\/u\/proj.* 2>\/dev\/null; then claude --resume r1 .*; else echo .*is gone: a new session instead.*; TRACE_CANVAS_THREAD=\S+ claude .*; fi$/);
  todo(far, 'Plot the results');
  assert.equal(dispatch(d, { refs: ['Far'], awayLive: () => ({ sessions: [{ id: 'r1', status: 'idle' }] }) }, env)[0].action, 'busy');

  // A session whose first prompt landed on a line and that was bound to another since has left it: a to-do it logs
  // there goes to the line's own agent, not back to it.
  const kit = createThread(d, { name: 'Kit' }).id, box = createThread(d, { name: 'Box' }).id;
  session('k', kit, 'Claude Code', 5e6);
  addCommit(d, { thread: kit, kind: 'agent', title: 'Kit is set up', agent: 'Claude Code', ts: now - 5e6, extra: { session: 'k' } });
  session('b', box, 'Claude Code', 0); d.sessions.b.bound = true;
  addCommit(d, { thread: kit, kind: 'task', title: 'Its first prompt, before it was bound', agent: 'Claude Code', ts: now - 2e5, extra: { session: 'b' } });
  todo(kit, 'Import the history', 'Claude Code', 'b');
  assert.deepEqual(dispatch(d, { refs: ['Kit'] }, env).map(r => [r.session && r.session.id, r.todos.map(c => c.title)]), [['k', ['Import the history']]]);
  // A result it logs there from its own line does not take Kit from Kit's own session, which has worked there.
  addCommit(d, { thread: kit, kind: 'agent', title: 'Found the old exporter', agent: 'Claude Code', ts: now - 1e5, extra: { fromSession: 'b' } });
  todo(kit, 'Write the import docs');
  assert.deepEqual(dispatch(d, { refs: ['Kit'] }, env).map(r => [r.session.id, r.todos.map(c => c.title)]), [['k', ['Write the import docs']]]);

  // A line nobody is on any more goes to the session that last worked there, though it moved to another line since.
  const left = createThread(d, { name: 'Left' }).id;
  addCommit(d, { thread: left, kind: 'agent', title: 'Drafted the intro', agent: 'Claude Code', ts: now - 4e5, extra: { session: 'b' } });
  todo(left, 'Polish the intro');
  assert.deepEqual(dispatch(d, { refs: ['Left'] }, env).map(r => [r.session && r.session.id, r.action]), [['b', 'resume']]);

  // Worked on from two machines: none running, this machine's session; the other machine's when it is running there.
  const two = createThread(d, { name: 'Two' }).id, here = env.TRACE_CANVAS_MACHINE;
  d.sessions.m1 = { id: 'm1', thread: two, agent: 'Claude Code', cwd: tmp, last: now - 9e5, machine: here };
  d.sessions.b1 = { id: 'b1', thread: two, agent: 'Claude Code', cwd: '/home/u/two', last: now - 1e5, machine: 'bsuper' };
  addCommit(d, { thread: two, kind: 'agent', title: 'Here', agent: 'Claude Code', ts: now - 9e5, extra: { session: 'm1' } });
  addCommit(d, { thread: two, kind: 'agent', title: 'There, later', agent: 'Claude Code', ts: now - 1e5, extra: { session: 'b1' } });
  const idle = () => ({ sessions: [] }), busyThere = () => ({ sessions: [{ id: 'b1', status: 'working' }] });
  todo(two, 'First');
  assert.deepEqual(dispatch(d, { refs: ['Two'], awayLive: idle }, env).map(r => [r.session.id, r.action]), [['m1', 'resume']]);
  todo(two, 'Second');
  assert.deepEqual(dispatch(d, { refs: ['Two'], awayLive: busyThere }, env).map(r => [r.session.id, r.action]), [['b1', 'busy']]);
  // A to-do for a machine goes to that machine's latest session on the line; a machine without one gets a new session there.
  const third = todo(two, 'Third, on bsuper'); third.on = 'bsuper';
  todo(two, 'Fourth, anywhere');
  const rowsTwo = dispatch(d, { refs: ['Two'], awayLive: idle }, env);
  assert.deepEqual(rowsTwo.map(r => [r.on || '', r.session.id, r.todos.map(c => c.title)]).sort(), [['', 'm1', ['Fourth, anywhere']], ['bsuper', 'b1', ['Third, on bsuper']]]);
  assert.match(rowsTwo.find(r => r.on).command, /^ssh -t bsuper .*if cd .*\/home\/u\/two.* 2>\/dev\/null; then claude --resume b1 /);
  todo(two, 'Fifth');
  const lab = dispatch(d, { refs: ['Two'], on: 'lab', awayLive: idle }, env)[0];
  assert.deepEqual([lab.action, lab.machine, lab.on], ['start', 'lab', 'lab']);
  assert.match(lab.command, /^ssh -t lab 'exec "\$SHELL" -lc .*TRACE_CANVAS_THREAD=/);
  assert.doesNotMatch(lab.command, /cd /); // this machine's folder means nothing there
  assert.equal(lab.tmux.name, `tc-${lab.todos[0].id}`); // a new one, by its first to-do
});

test('a to-do assigned to an agent goes to that agent\'s session, keeps its assignee, and skips heartbeat sessions', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-dispatch-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(tmp, 'home'), TRACE_CANVAS_DESKTOP_DIR: path.join(tmp, 'desk'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: machineName() };
  const now = Date.now(), d = emptyData();
  const videos = createThread(d, { name: 'Videos' }).id;
  // A Claude Code session made the videos; a Codex heartbeat on the line worked there last.
  d.sessions.cc = { id: 'cc', thread: videos, agent: 'Claude Code', cwd: tmp, last: now - 9e5, title: 'Make video 24' };
  d.sessions.hb = { id: 'hb', thread: videos, agent: 'Codex', cwd: tmp, last: now - 1e5, title: '<heartbeat>' };
  d.sessions.cx = { id: 'cx', thread: videos, agent: 'Codex', cwd: tmp, last: now - 8e5, title: 'Post video 23' };
  addCommit(d, { thread: videos, kind: 'agent', title: 'Video 24 is ready', agent: 'Claude Code', ts: now - 9e5, extra: { session: 'cc' } });
  addCommit(d, { thread: videos, kind: 'agent', title: 'Video 23 posted', agent: 'Codex', ts: now - 8e5, extra: { session: 'cx' } });
  addCommit(d, { thread: videos, kind: 'agent', title: 'Heartbeat: nothing new', agent: 'Codex', ts: now - 1e5, extra: { session: 'hb' } });
  const v25 = addCommit(d, { thread: videos, kind: 'task', title: 'Make video 25', agent: 'Claude Code', ts: now, extra: { assignee: 'claude' } });
  const post = addCommit(d, { thread: videos, kind: 'task', title: 'Post video 25', ts: now });

  const rows = dispatch(d, { refs: [v25.id, post.id] }, env);
  assert.deepEqual(rows.map(r => [r.agent, r.session && r.session.id, r.todos.map(c => c.title)]).sort(), [
    ['claude', 'cc', ['Make video 25']],
    ['codex', 'cx', ['Post video 25']], // the latest real worker; the heartbeat does not count
  ]);
  assert.equal(d.commits[v25.id].assignee, 'claude');
});

test('Autopilot hands every open to-do on a line to its agent with the decision profile, and runs until it is stopped', async () => {
  const { startAutopilot, stopAutopilot, listTasks } = await import('../src/ops.mjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-autopilot-'));
  const env = { ...process.env, TRACE_CANVAS_HOME: path.join(tmp, 'home'), TRACE_CANVAS_DESKTOP_DIR: path.join(tmp, 'desk'), TRACE_CANVAS_LANG: 'en', TRACE_CANVAS_MACHINE: machineName() };
  const d = emptyData(), now = Date.now();
  const app = createThread(d, { name: 'App' }).id, rules = createThread(d, { name: 'Rules' }).id;
  d.sessions.s1 = { id: 's1', thread: app, agent: 'Claude Code', cwd: tmp, last: now - 7e6 };
  addCommit(d, { thread: app, kind: 'agent', title: 'Worked here', agent: 'Claude Code', ts: now - 7e6, extra: { session: 's1' } });
  const a = addCommit(d, { thread: app, kind: 'task', title: 'Fix the login bug', ts: now - 6e5 });
  const b = addCommit(d, { thread: app, kind: 'task', title: 'Its own to-do', agent: 'Claude Code', ts: now - 5e5, extra: { fromSession: 's1' } });
  assert.throws(() => startAutopilot(d, { thread: 'Rules' }, env), /no open to-dos/);
  const p = addCommit(d, { thread: rules, kind: 'decision', title: 'Autopilot decision profile v0', ts: now - 1e5 });
  addCommit(d, { thread: rules, kind: 'decision', title: 'Decision profile v0, addition: H5', ts: now - 5e4 }); // adds to it, is not it
  addCommit(d, { thread: rules, kind: 'decision', title: 'Fixed the decision profile numbering', ts: now - 4e4 });

  const [row] = startAutopilot(d, { thread: 'App' }, env);
  assert.deepEqual(row.todos.map(c => c.id).sort(), [a.id, b.id].sort()); // every open one, its own agent's too
  assert.equal(row.action, 'resume');
  assert.match(row.command, /^cd .* && claude --resume s1 'Autopilot \(beta\) on the Trace Canvas line "App"/);
  assert.match(row.prompt, new RegExp(`decision profile, record ${p.id}`));
  assert.match(row.prompt, /Never send email[^.]*push, publish/);
  // Asked is not running: it shows only once a session's hook has taken the prompt (test/hook.test.mjs).
  assert.equal(listTasks(d, { thread: app })[0].autopilot, undefined);
  d.threads[app].autopilot.session = 's1';
  assert.equal(listTasks(d, { thread: app })[0].autopilot, true);
  // It stays on until the person stops it: the summary only closes what was open, then the agent waits (--wait).
  assert.match(row.prompt, /stays on until the person turns it off.*trace-canvas autopilot "\S+" --wait/);
  const { autopilotNews } = await import('../src/ops.mjs');
  d.threads[app].autopilot.at = now - 10;
  d.commits[a.id].done = true;
  assert.deepEqual(autopilotNews(d, app), { todos: [] }); // b was in the prompt: not news
  addCommit(d, { thread: app, kind: 'note', title: 'Autopilot summary: 2 done', ts: now + 1 });
  assert.ok(d.threads[app].autopilot);
  assert.deepEqual(autopilotNews(d, app), { todos: [] }); // b was left for the person: the agent waits
  const c = addCommit(d, { thread: app, kind: 'task', title: 'A new one', ts: now + 2 });
  assert.deepEqual(autopilotNews(d, app), { todos: [{ id: c.id, title: 'A new one' }] });
  stopAutopilot(d, { thread: 'App' });
  assert.equal(d.threads[app].autopilot, undefined);
  assert.deepEqual(autopilotNews(d, app), { off: true });
});

test('an archived project is out of the to-do list and of dispatch, unless its line is named', async () => {
  const { listTasks } = await import('../src/ops.mjs');
  const d = emptyData();
  const a = createThread(d, { name: 'Old' }).id, b = createThread(d, { name: 'New' }).id;
  addCommit(d, { thread: a, kind: 'task', title: 'Left over' });
  addCommit(d, { thread: b, kind: 'task', title: 'To do' });
  d.threads[a].archived = Date.now();
  assert.deepEqual(listTasks(d).map(x => x.name).filter(n => n !== 'Inbox'), ['New']);
  assert.equal(listTasks(d, { thread: 'Old' })[0].tasks.length, 1);
});

test('another machine\'s agent starts in tmux there and a window watches it; without tmux, the ssh -t window as before', async () => {
  const { launchRow, startDetached } = await import('../src/agents.mjs');
  let got;
  const ssh = code => (cmd, args, o, cb) => { got = args; cb(code ? Object.assign(new Error('x'), { code }) : null, '', code === 255 ? 'ssh: connect to host lab port 22: Connection refused' : ''); };
  assert.equal(await startDetached({ machine: 'lab', name: 'tc-c1', cmd: "claude 'go'" }, ssh(0)), '');
  assert.deepEqual(got.slice(0, 5), ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'lab']);
  // What the remote login shell runs, unquoted once by it:
  const inner = (await import('node:child_process')).execFileSync('sh', ['-c', `printf %s ${got[5].replace(/^exec "\$SHELL" -lc /, '')}`], { encoding: 'utf8' });
  assert.equal(inner, `command -v tmux >/dev/null || exit 3; tmux has-session -t 'tc-c1' 2>/dev/null && exit 4; tmux new-session -d -s 'tc-c1' 'exec "$SHELL" -lc '\\''PATH="$HOME/.local/bin:$PATH"; claude '\\''\\'\\'''\\''go'\\''\\'\\'''\\'''\\''' \\; set-option -t 'tc-c1' remain-on-exit on; sleep 3; `
    + `if [ "$(tmux display-message -p -t 'tc-c1' '#{pane_dead}')" = 1 ]; then tmux capture-pane -p -S -200 -t 'tc-c1' | grep -v -e '^[[:space:]]*$' -e '^Pane is dead' | tail -5; tmux kill-session -t 'tc-c1'; exit 5; fi; tmux set-option -t 'tc-c1' remain-on-exit off`);
  assert.equal(await startDetached({ machine: 'lab', name: 'n', cmd: 'x' }, ssh(3)), 'no-tmux');
  assert.equal(await startDetached({ machine: 'lab', name: 'n', cmd: 'x' }, ssh(4)), 'exists');
  assert.match(await startDetached({ machine: 'lab', name: 'n', cmd: 'x' }, ssh(255)), /Connection refused/);
  // It died at once (claude not found, its folder gone): what it printed is the error.
  const dead = (cmd, args, o, cb) => cb(Object.assign(new Error('x'), { code: 5 }), 'zsh:1: command not found: claude\n', '');
  assert.equal(await startDetached({ machine: 'lab', name: 'n', cmd: 'x' }, dead), 'the agent stopped at once on lab: zsh:1: command not found: claude');

  const opened = [], open = async c => { opened.push(c); return null; };
  const row = { command: 'ssh -t lab plain', tmux: { machine: 'lab', name: 'tc-c1', cmd: 'x', attach: 'ssh -t lab attach' } };
  assert.deepEqual(await launchRow(row, { open, start: async () => '' }), { detached: true });
  assert.deepEqual(await launchRow(row, { open, start: async () => 'exists' }), { detached: true, already: true });
  assert.deepEqual(await launchRow(row, { open: async () => 'no window', start: async () => '' }), { detached: true, noWatch: 'no window' });
  assert.deepEqual(await launchRow(row, { open, start: async () => 'no-tmux' }), { failed: null, noTmux: true });
  assert.deepEqual(await launchRow(row, { open, start: async () => 'refused' }), { failed: 'refused' });
  assert.deepEqual(await launchRow({ command: 'claude here' }, { open, start: async () => { throw new Error('not for this machine'); } }), { failed: null });
  assert.deepEqual(opened, ['ssh -t lab attach', 'ssh -t lab attach', 'ssh -t lab plain', 'claude here']);
});

test('another machine\'s session in tmux opens by its pane, or for an older record the pane with its tty', async () => {
  const { tmuxAttach } = await import('../src/agents.mjs');
  const { execFileSync } = await import('node:child_process');
  const inner = cmd => execFileSync('sh', ['-c', `printf %s ${execFileSync('sh', ['-c', `printf %s ${cmd.replace(/^ssh -t \S+ /, '')}`], { encoding: 'utf8' }).replace(/^exec "\$SHELL" -lc /, '')}`], { encoding: 'utf8' });
  assert.equal(inner(tmuxAttach({ machine: 'bs', term: 'tmux', tty: '/dev/pts/8', tmux: '/tmp/tmux-1000/default', pane: '%0' })),
    `PATH="$HOME/.local/bin:$PATH"; p='%0'; [ -n "$p" ] && tmux -S '/tmp/tmux-1000/default' has-session -t "$p" 2>/dev/null || { echo 'Its tmux pane is gone.'; exit 1; }; tmux -S '/tmp/tmux-1000/default' select-window -t "$p"; tmux -S '/tmp/tmux-1000/default' select-pane -t "$p"; exec tmux -S '/tmp/tmux-1000/default' attach -t "$p"`);
  assert.match(inner(tmuxAttach({ machine: 'bs', term: 'tmux', tty: '/dev/pts/8' })), /^PATH=.*; p="\$\(tmux list-panes -a -F '#\{pane_tty\} #\{pane_id\}' \| awk '\$1=="\/dev\/pts\/8"\{print \$2\}'\)"; .*exec tmux attach -t "\$p"$/);
  assert.equal(tmuxAttach({ machine: 'bs', term: 'iTerm.app', tty: '/dev/ttys001' }), ''); // not in tmux
  assert.equal(tmuxAttach({ machine: 'bs', term: 'tmux', tty: '/dev/pts/8; rm -rf ~' }), ''); // only a real tty goes in
});
