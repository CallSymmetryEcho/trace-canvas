# Changelog

## Unreleased

- **Autopilot goes on by itself, in a session of its own.** When its agent stops while it could go on (no summary since your last message, to-dos still open on its line), the Stop hook hands it the next to-do, so you do not have to keep prompting it; it stops when it logs a summary to ask you, or when a push brought no progress. A line's session is kept only when it worked on nothing but this line (it keeps its memory of the line); one that also worked elsewhere gets a new session bound to the line, so other lines' to-dos stay out. The switch lights when the line's own agent starts it, and when another agent hands it on in its own words. Claude Code for now.
- **Autopilot stays on until you turn it off.** It no longer switches off after its summary: the agent works until it reaches what it cannot decide, logs an "Autopilot summary" and asks; when you answer in its session it goes on to the next thing it cannot decide (the hook reminds it the switch is still on). Only Stop turns it off. The card's ticker says when it has stopped to ask.
- **A simpler More menu.** Choices of one kind share a row, folded to one dot per choice (filled: on) until you tap the row, which opens it to its buttons: Hide (finished · merged), Theme, Language and Other computers (Sync now · Show their sessions · Read their changes over ssh). Open on your phone, Focus and fold groups, Connect an AI agent, Import / export and Help follow; New thread left it (the canvas toolbar and N have it).
- **A finished or parked line opens to look, not to reopen.** ▸ on its folded card shows its stations in place, floating over its neighbours, and ▾ folds it; its status stays (the line panel's Status changes it). "· N merged in" on a line opens the lines merged into it, just there.
- **Sync cannot delete what it never saw.** A record in this machine's sync file that this data folder never held (another folder wrote it under the same name, such as a dev copy with an old snapshot) is taken in, not deleted; more than 50 deletions in one sync are refused until `trace-canvas sync --allow-deletes`; a rebase left half done in the map repository is ended before the next pull, and the rebase itself no longer runs under a timeout; a data folder of its own (`TRACE_CANVAS_HOME`) no longer syncs to `~/agent-map` by default. On 11-04 such a copy wrote 124 deletions; they were restored.
- **Autopilot shows on every machine at once.** When a line's Autopilot is asked, taken up by a session, stopped or ended by its summary, the page server syncs straight away and asks the other machines to pull now (`trace-canvas sync --nudge`), so their pages show it within seconds instead of up to four minutes later.
- **Another machine's session in tmux opens from the page.** Its panel and the live list get **Open in a terminal (tmux)**: a tab here that connects over ssh and attaches to its pane, and the command to copy attaches too, instead of a resume that would start a second copy. Sessions recorded before this update are found by their terminal.
- **An agent sent to another machine that cannot start says so.** A tmux session there is checked after 3 s: when the agent stopped at once, dispatch reports it with what it printed (`command not found`, a folder that is gone) instead of "attached". Commands run on another machine put `~/.local/bin` on PATH, where claude's and codex's installers put them but a non-interactive login shell does not look; and a session whose folder is gone there gets a new session on the line instead of a resume that cannot find it.
- **Go to its terminal, inside tmux.** A session running in tmux (Claude Code, or Codex from its `codex resume` process) gets **Go to its terminal**: tmux switches to its window and pane, and the terminal tab attached to that tmux session comes forward (iTerm2, Terminal, GNOME Terminal or Konsole, found from the tmux client). With no terminal attached, a new tab attaches to it. Sessions started before this update get it from their next session.
- **Agents sent to another machine keep running.** Dispatch and Autopilot start an agent for another machine in a detached tmux session there (`tc-<to-do>` for a new one, `tc-<session>` for a resumed one), then open a window attached to it: closing the window or losing the network no longer stops the agent. Each row also prints the plain `ssh -t` command for running it by hand, and the panel's resume command stays that one. A machine without tmux gets the `ssh -t` window as before, with a line saying to install tmux. This machine's agents are unchanged.
- **Formulas in records and reports.** `$…$` in a record's details or a linked `.md` report reads as a formula in the line, `$$…$$` on lines of its own as a centred one, drawn by the browser itself (MathML: no library, works offline). Fractions, roots, scripts, Greek, operators, accents, `\left…\right`, matrices, `cases` and `aligned` are covered; a formula it cannot read shows as its source. A `$` in code, or money such as "$5 and $10", stays text.
- **Images in the reader.** A record that links an image (png, jpg, gif, webp, svg) gets **View**, which opens it in the reader; a linked report's `![alt](path)` images show in it, a relative path taken from the report's folder. Images load only when you open them, up to 10 MB, and only ones a record or a linked report points to.

## 0.3.4 (2026-11-04)

Autopilot you can see, a History wall for finished projects with the lessons they leave, and records that read well.

### New

- **Autopilot (beta).** One round on a line, from the slider under Status in its panel or `trace-canvas autopilot <line>`: the line's agent works through every open to-do by your decision profile, logs each decision with the rule it rests on, never sends email or messages to people, pushes, publishes or changes permissions, and stops to ask about anything risky or not covered. The slider has three steps (off · asked · running): it shows running only once the agent's hook has taken the prompt, so a prompt that never reached a session does not look like work. While a round runs, a light goes round the card and the line panel, a ticker names the to-do in hand, and the track fills with racing pixels; none of it when the system asks for less motion. The round ends with a summary record. [docs/autopilot.svg](docs/autopilot.svg) shows how it decides.
- **The History wall.** A finished project is archived from its group's panel: its lines leave the workspace and it gets a frosted plaque on the History wall (its own button, between Goals and More), with its line map, outputs and wins from the wrap-ups. **Replay** grows the map from the first station to the last, with play, pause and drag; **Restore** puts the project back. The wall has its own quiet palette.
- **Lessons from a finished project.** On a plaque, **Draw lessons** asks the local claude for 3–8 lessons from the project's decisions and wrap-ups; only the ones you tick are kept, in Theatrum. A new line's first sessions are handed up to three that fit it, and Autopilot looks there, and at archived projects' decisions, before it asks you. Rules a retro already kept are not drawn again.
- **Done lines fold, with a wrap-up.** Marking a line done opens a wrap-up drafted from the line, saved as its last station; the line folds like a parked one, in the done colour with a check.
- **Records that read well.** A record's details read as Markdown (headings, lists, tables, code); **Edit** turns them back into text, and the box grows with it. **Read** opens long details, or a `.md` report a record links, in a wide reader. Long titles wrap; titles in the line panel get two lines, and a card's rows show the full title on hover.
- **Go to its terminal, for more sessions.** GNOME Terminal and Konsole tabs on Linux, selected over D-Bus (on X11 the window is raised with `wmctrl`); Codex sessions in a terminal, found from their `codex resume` process.
- **Open on claude.ai.** A session with Remote Control on gets **Open on claude.ai** beside Go to its terminal: the same session, also from the phone. A background session copies `claude attach`, not `--resume`.

### Changed

- **Arrange lays a group out as a tree.** A fork sits right of its line and later forks below, so fork links never cross.

### Fixed

- **A stray keystroke is not a to-do.** Input typed into a session rather than asked of it (`:q`, `login`, `ok`, a lone command word) is no longer logged.
- **Pasted prompts are recognised.** A message that is one paste, or a paste with a few words of your own, counts as the Autopilot or hand-off prompt it carries.
- **Long agent commands reach macOS terminals whole.** Past the terminal's 1024-byte line limit, a self-deleting script holds the command.
- **Goals keep their place.** A redraw keeps the list where it was, and adding a to-do no longer scrolls it.

## 0.3.3 (2026-11-04)

See what is wrong at a glance: `trace-canvas doctor` and Common questions, a dot when sync fails, commits from other machines that open, parked lines that fold away, and agents that open in a tab.

- **Agents open in a tab, not a pile of windows.** On macOS, dispatch and Start open agents in a new iTerm2 tab when iTerm2 is installed, and in a new Terminal window otherwise; `trace-canvas terminal iterm|terminal` picks one. On Linux, konsole, gnome-terminal and xfce4-terminal open a new tab; other terminals still open a window.
- **A hand-off prompt is not a new to-do.** The prompts that dispatch, `hand` and the page write to start an agent on a line restate its to-dos; the hooks no longer log them as another to-do that stays open after the real one is ticked.
- **Each goal card shows its finished to-dos on its own.** On the Goals page, a card's progress (✓ 14/24 ▸) opens and closes that card's done to-dos, remembered per browser; the tip at the top says so. The page-wide **Show done** switch is gone: one switch per card is enough.
- **`trace-canvas doctor`, and Common questions.** One command (also **More → Check setup**) checks Node, the hooks, MCP server and skill, the page server and whether it starts with the computer, the version, sync and other machines, and phone access, with one line on how to fix each problem; it also notices hooks that start a Node which has since been removed. [docs/faq.md](docs/faq.md) answers the questions people actually ran into, including how to start the page with the computer.
- **A failed sync shows, quietly.** When the last sync failed, or another machine has not updated in over a day, More and its sync item get a small dot; opening the item then says what is wrong and offers **Sync now** (without trouble it syncs straight away, as before). `trace-canvas sync` no longer reports a sync whose commits did not reach the remote as fine, and exits 1 then.
- **Shortcuts and help reads cleanly.** Each key sits in its own column.
- **Fold a group from the canvas.** Each group's label has a switch: ▾ folds the group into a small chip, ▸ on the chip unfolds it.
- **Parked means folded.** A parked line shows as its head only on the canvas and leaves the branch view and the timeline, like a folded group; ▸ on it makes it active again, and so does any new record on it. Parking a line that has gone quiet folds it.
- **A commit made on another machine shows its changes here.** This machine's clone of the same repository is used, in whatever folder; without one, the changes are read on the machine the commit was made on, over ssh (the same machine names as the live bar). **More → Other machines' changes** turns the ssh reading off; then the panel says which computer the repository is on.
- **Update works with a systemd service.** When the page server is a systemd service's main process, `trace-canvas update` restarts it with `systemctl` instead of starting a second server that took the port from it. `serve` exits when its port is taken, so a service manager no longer keeps an idle copy running.

## 0.3.2 (2026-11-04)

Open sessions stay on the map, dispatch says what it did, a fork can become its own line, and AI tidy-up suggests instead of acting.

- **Make a fork its own line.** A forked line that turned into separate work can stand alone: **Make it its own line** in its panel, `trace-canvas detach <line> [--take <record>]`, or the MCP tool `trace_detach`. The fork record goes and nothing on the line points back at the one it came from; `--take` moves the request that started it over as its first record, and the old line closes the gap.
- **Sessions that sat quiet are found again.** The canvas also reads Claude Code's own register of running sessions, so a session open in the desktop app or with `claude --bg` counts as running (with its real process) even when it has been quiet for days, and dispatch prints the name to message it by.
- **Dispatch says plainly what happened.** A Terminal window that did not open (a macOS Automation prompt denied or left unanswered) is reported, with the command to run yourself, instead of being taken for a started agent. A line nobody is on any more goes to the session that last worked on it, which may still be open. When that session is busy, dispatch prints both choices: paste the message into it when it stops, or start a new session with the command shown.
- **An open terminal stays on the map.** A session counts as running while its Claude Code or Codex process runs, however long it sits quiet (a lid closed overnight used to drop it after 12 hours), and it leaves as soon as the window is closed. Sessions whose process can't be found keep the 12-hour rule.
- **AI tidy-up suggests, you click.** It now reads every line with its recent records and open to-dos and suggests three things: two lines that are the same work (**Merge**), lines ready to wrap up (**Mark done**, or **Park** when work is left over; never a line a session is running on), and open to-dos that later records show are done (**Tick off**). Each suggestion quotes its evidence and has its own button and **Undo**; nothing is applied in bulk. Filing the inbox, drawing links between lines and the old "stalled" list are gone (Gone quiet covers stalled lines).
- **A quieter header.** AI tidy-up and the language moved into **More**. The language item reads "Language · 语言" in both languages, with the current one in bold, so it can be found from either.
- **The page starts in your language.** Until a language is chosen (on the page, in the config, or `?lang=`), the page follows the browser: Chinese if the browser lists Chinese before English, otherwise English. The first visit saves it, so the records the hooks write use the same language.

## 0.3.1 (2026-10-30)

Two fixes: dispatch respects who a to-do is for, and quiet commits get their station and diff.

### Fixed

- **Dispatch respects the assignee.** A to-do assigned to Claude Code, Codex or Gemini CLI goes only to that agent's sessions on its line (a running one first, as before), or to a new session of that agent; before, it went to whichever session had worked on the line last, and its assignee was then rewritten to that session's agent. An assignee someone set is never changed. Automated sessions whose prompt is a tag such as Codex's `<heartbeat>` no longer count as the line's agent.
- **`dispatch --print` changes nothing.** It used to assign the to-dos it printed and save them.
- **Quiet commits are recorded.** `git commit -q`, or a commit whose output is cut off, printed no sha, so no commit station was made and the commit had no diff on the canvas (0.3.0's own commit was one). The hook now reads HEAD instead, when the commit did not fail, HEAD was made in the last two minutes and carries the command's message, and it is not on the canvas yet.

## 0.3.0 (2026-10-30)

Trace Canvas now spans machines and hands work out: several machines share one canvas, to-dos are dispatched to the agent working on each line, Retro shows where the back-and-forth went, and the map itself got easier to read: filter the Branches view by kind, click a line to bring it forward, merged lines fold into the line they went into, and lines that have gone quiet say so without getting in the way.

**Upgrading from 0.2.0:** run `trace-canvas update` (or `git pull`), then `node bin/trace-canvas.mjs setup --user` once so the hooks, MCP tools and skill are refreshed. To share the canvas between machines, see the note on syncing further down.

### Reading the map

- **Show only some kinds (Branches).** Next to the lines' legend, **Show** picks idea, to-do, agent output, decision or note (several at once; kept in this browser). Branches drops the other records but keeps forks and merges and draws each line over its whole time span, so lines stay whole; the matching stations get a halo in the line's colour. The canvas and the timeline dim the rest the way search does.
- **A legend that fits.** The lines' chips sit in one row that scrolls sideways; **All N** wraps them and **Collapse** folds them back (remembered). **Show** stays on the same row. On a phone the kinds are icons (named on long-press and for screen readers), the chips are taller to tap, and the row still fits.
- **Click a line (Branches).** Clicking a line, or its chip, brings it forward: it thickens, the other lines, stations, links and live tips fade, the other rows dim, and the line's panel opens; clicking it again lets go. Hovering a line thickens it and names it. Each line's click area is no wider than the gap to its neighbour, stations stay on top and open their own record, and on a phone a tap between stations picks the nearest line within a fingertip (12 px).
- **Columns are reused, like `git log --graph`.** A line holds a column only from its first record to its last (plus its fork and merge curves and, for an open line, the stub above it); after that a later line takes the column. A fork takes the free column nearest the line it came from, and a merged line the one nearest its target, so the curves between them stay short. Columns are wider (28 px on a computer) for a calmer graph. On real data 23 lines needed 15 columns instead of 23.
- **Merged lines fold into their target.** A merged line no longer has a card or a legend chip of its own: the target's card says **N merged in**, its panel links each merged line, and Branches still draws the merged history. Nothing is moved or deleted; **More → Show merged threads** lays them out again.
- **Merge, not combine.** The canvas's merge bar offers only **Merge** (it keeps every line and can be undone). Combine, which deletes the source lines, stays on the command line (`--combine`) and in `trace_merge`, and agents are told to use it only when you ask for it by name.
- **Lines that have gone quiet.** A line still for three times its usual gap between active days (at least three days), with no session on it, puts a small dot on **Goals** and a chip under **Gone quiet** at the top of the list; nothing pops up. A chip opens one sentence and three answers: with no open to-dos it asks whether the line is finished (**Done** first), with open to-dos whether to park it (**Parked** first); **Still on it** counts as activity, so it asks again only after another quiet spell. It never changes a line by itself.

### Working across agents and machines

- **Dispatch:** `/trace-canvas dispatch` (or `trace-canvas dispatch [line…]`) hands each line's new to-dos to the agent working on that line (the session that last did work there; one that only ended there, only logged to-dos for it from another line, or was bound to another line since does not count; a session on another line that logged a result there counts only when the line's own sessions have not worked there) and wakes it: a running Claude Code session gets a message from the agent you asked, a stopped session is resumed with its to-dos, and a line nobody works on gets a new session, each in a new Terminal window on macOS. New means nobody has it and that agent does not know it yet: you logged it, or another session did; a to-do named instead of a line goes out on its own. A record an agent logs now keeps the session it was logged in (**Logged in** in its panel, `from` in `trace_read_thread`), so the conversation behind a to-do can be found again.
- **Retro:** Retro in a line's panel (also `trace-canvas retro` and `/trace-canvas retro`) ranks the line's work by back-and-forth with the agents: rounds, time, tokens, corrections and sessions per piece of work, read from this machine's Claude Code and Codex transcripts and grouped by your local `claude` or `codex`. For the worst ones it names what was missing, the sentence that made it clear and a rule; a rule is written only when you press Write, to the project's CLAUDE.md and AGENTS.md, the line, or long-term memory.
- **Fewer tokens:** `trace_tasks` answers for the session's own line unless asked for another (`thread`) or all (`all: true`), open to-dos leave out empty fields, and tool results are sent as compact JSON. `trace-canvas tokens` shows how much of recent Claude Code sessions' tokens went to Trace Canvas (about 1%).
- **Open the chat.** From the live panel, the Agent view (↗) and the line's session list: a session the Claude desktop app runs opens its chat there (macOS, Linux and Windows), a Codex session opens in the Codex app, and a session running in Terminal or iTerm2 (macOS) brings its tab to the front (**Go to its terminal**).
- **The `trace-canvas` command:** `setup --user` puts a small script in `~/.local/bin` or `~/bin` when one is on the PATH (it runs the CLI with the node that ran setup, as the hooks do), or prints the alias line with the clone's own path. `--help` and `-h` print the help wherever they are.
- **Across machines:** the live bar can show other machines' running sessions (More → Other machines' sessions, off by default; read over ssh every 15 s while a page is open), marked with their machine and resumed over ssh; dispatch wakes a stopped session on another machine over ssh. `setup` can also put the command next to the user's own node, for machines without `~/.local/bin` on the PATH.
- **Another machine's session** resumes over ssh in the login shell there, which has `claude` and `codex` on its PATH; the README says which macOS switch lets ssh sessions into Desktop and Documents.
- **History from before:** a repository's new line takes in the repository's history in the background: the default branch's commits (first parent, the newest 500, older ones as one record where the line starts) and, one record each, the Claude Code and Codex sessions that ran there (Codex's own reviewer sessions and one-prompt sessions that changed nothing are left out). Commits already on the canvas are recognised by sha, or by subject and author time after a rebase; ids are the same on every machine. `trace-canvas history` lists and `--all` imports it for the lines from before; `--off` leaves a line out.
- **Started over ssh:** the CLI adds the user's own bin folders (~/.local/bin and the like) to a bare PATH, so a page server started over ssh or as a service still finds claude and codex for Retro and AI tidy-up; without either, Retro says so instead of "spawn claude ENOENT".
- **Updating:** `trace-canvas update` fast-forwards the clone, refreshes copied skill files and restarts the page server on its port; the page checks for a newer version at start and twice a day and offers it under More (one click on the computer itself; on the phone it names the command).
- **Machines stay in step:** the page server syncs in the background every 2 minutes (once the machine has synced by hand), not only when a session ends, so a long session's records reach the other machine within minutes.
- **Retro picks up where it stopped:** by default it reads the messages since the line's last retro, up to now; Retro opens a form with that range to narrow it or take everything (`--since`, `--until`, `--all` on the command line), and the note keeps the range.
- **Retro, wherever the conversations are:** a line without sessions of its own uses the sessions that logged on it from their own line, and a session on another machine is read there over ssh (`trace-canvas prompts`) and analysed with the rest. When nothing can be read, it says why instead of "No conversations".
- **Dispatch across machines:** a running session comes first (this machine's before another's), then this machine's latest, then the latest anywhere. A to-do can name the machine to do it on (`on` in `trace_log`, `log --on`, or `dispatch --on <machine>`): it goes to that machine's latest session on the line, or a new session started there over ssh.
- **Which machine, in Branches and the line panel:** in Branches each station from another machine has its name next to the agent; a line's panel marks each machine's latest session when the line was worked on from more than one.
- **One repository, several lines:** `trace-canvas folder <line> <folder>` gives a folder of a repository to a line; sessions working in it go there, the rest stay on the repository's line.
- **History, filled in:** `trace-canvas history <line> --repo <folder>` puts a line made by hand on a repository (it takes the repository's name as its key, an old key stays as an alias) and takes in its history. Sessions from the repository's worktrees (`.claude/worktrees`) and subfolders come in too; a folder line without git brings the sessions that ran in that folder.
- **Terminals on Linux:** Open in Terminal, ▶ Start and dispatch open a new terminal window on a Linux desktop too (`$TERMINAL`, else x-terminal-emulator, Konsole, GNOME Terminal, kitty and the like), on the desktop's display even when the server was started over ssh. Going to an existing tab stays macOS only.
- **Which machine:** a group on the canvas names the other machines that wrote on its lines (**from mac** seen from bsuperstation, **from bsuperstation** seen from the Mac); this machine is never named and single cards stay plain.
- **Folding groups:** fold the groups you rarely use (a group's panel, or More → Focus on a group…) and they stay out of every view, with a small chip on the canvas that unfolds them; a bar names what is folded, with Unfold all. Focus mode still shows a folded group when you pick it. Arrange gives folded groups no block: their chips go on a shelf after the last group, so the canvas stays compact.
- **Focus mode:** pick a group (More → Focus on a group…, or its panel) and every view shows only its lines: the canvas, the branches, the timeline and the goals. A bar under the header names the group; the choice stays after a reload until you leave it. Arrange then arranges just them.
- **On a phone:** Goals is a tab with a page of its own, one to-do per row; lines and records open as full pages with ← (the back gesture closes them); Branches keeps the graph to two fifths of the screen so titles stay readable. The desktop layout is unchanged.
- Branches: each title stays level with its station (rows were a pixel taller than the graph's step).
- **Merging lines on the canvas:** the bar lists the lines you picked, keeps the first one by default (click another to keep it) and says what goes into what; the kept card has a solid outline. Merge no longer goes into a new line unless you choose one. In focus mode, the menus that pick a line (the box at the bottom, a record's or a session's line, the merge target) list only the group's lines, and the live bar shows only the sessions on them.
- **Themes:** More → Theme switches between matching the system, light, dark and Mist, a soft blue-grey palette that also tones down the lines' colours.
- **Goals:** click a line's goal to edit it in place, and on a phone a to-do's row has Edit. A half-typed to-do stays when you tap elsewhere, with an Add button next to it. On a phone, ← on a line or record page no longer misses a tap while sessions are updating.
- **Open in Terminal (macOS):** next to Hand to it, starts the agent on the line in a new Terminal window. **`/trace-canvas pick`** has an agent take its next to-do.
- A goal or note you just saved no longer disappears for a while when an older refresh of the page answers late (many sessions ending at once). On a phone, tapping a kind in the box at the bottom no longer misses on Safari. Copy buttons work on the phone too: the page is plain http there, where browsers withhold the clipboard API, so copying falls back to the older copy command, and if that fails as well the text opens selected, to copy by hand.
- A Codex session whose turn has ended shows as idle, read from its rollout, even when Codex did not run the Stop hook (some sessions stayed "working" for hours).
- A part of a line's name finds the line when only one line has it (resume, bind, tasks, trace_read_thread). Commit records keep the repository's real path, and More works while a sheet is open.

- **Groups and arranging.** Lines can be put in a group (Select → Group, the line's panel, or `trace-canvas group`); a group is a frame on the canvas whose label moves, renames, arranges or ungroups it, and forks join their line's group. **Arrange** lays the canvas out by group, forks after their lines, and can be undone.

**Upgrading:** run `node bin/trace-canvas.mjs setup --user --machine <name> --map <repo clone>` once, then `trace-canvas sync`. The first sync gives lines that belong to a repository a stable id (the old one stays as an alias) and keeps a copy of the data first (`data.json.before-first-sync`).

### Added

- **Several machines, one canvas.** `trace-canvas sync` (also **More → Sync with other machines**, and in the background after a session ends) shares the canvas through a private git repository: each machine writes `canvas/<machine>.jsonl`, and per document the newest change wins. Prompts travel as titles only; public IPs and secret-looking text are blanked. Records and sessions carry their machine; another machine's session resumes over ssh. `trace_where` and `trace-canvas where` look things up in a location map.

- **See what changed.** A commit station lists the files it changed, biggest first, with a diff for each, and compares with another commit station. The diffs are read from git when you open them (`/api/git/commit`, `/api/git/diff`); the canvas keeps only each commit's sha and repository, which commit records now carry, also for commits made with `cd other && git commit` or in a worktree.

## 0.2.0 (2026-10-27)

Trace Canvas now follows your agents while they work, not only after: live sessions, several agents on one machine, goals and to-dos they share with you, and sessions that stay on their line.

**Upgrading from 0.1.0:** run `node bin/trace-canvas.mjs setup --user` again (add `--agents codex` for Codex), then start new sessions. Setup changes two hooks to run synchronously and adds the new MCP tools and the skill's new actions.

### Added

- **One-step install.** The README opens with a prompt you paste into Claude Code to install it, and the first thing to type afterwards: `/trace-canvas put all my sessions on the canvas` (the skill's new `all` action).
- **Live sessions.** Running sessions show on the canvas with their status (working, needs you, idle) and what they are doing; put one on a line from the page, with `trace-canvas bind` or `trace_bind`. `trace_live` and `trace-canvas live` list them.
- **Agent view.** A live tree of who started whom: sessions, the sessions they started and their subagents, with the one that needs you on top.
- **Who did what.** Stations you wrote are drawn dark with a person mark, agents' stations in the line's colour with a star; running sessions sit as live tips on top of their lines in the Branches view.
- **Goals and to-dos.** Each line has a goal and a to-do list that you and your agents share (`trace_tasks`, `trace_task_done`, `trace-canvas tasks`, `trace-canvas done`). New goals and next steps you mention become to-dos as you say them: with every message the hook tells the agent its line and open to-dos, and the same open to-do twice stays one.
- **Several agents on one machine.** Codex and Gemini CLI get the same hooks and MCP tools (`setup --user --agents codex,gemini`). A to-do can be assigned to Claude Code, Codex or Gemini CLI and handed over with `trace-canvas hand` or the **Hand to it** button, which copies a command that starts that agent on the line. A new session is told its line, goal, its own to-dos and where things are on this machine. Checked against real Codex 0.164 sessions.
- **Forking from agents.** `trace_fork` and `trace-canvas fork` branch a new line off a record or a line's tip.
- **Sessions stay on their line.** A session's line is kept in the canvas data, so a session that ends and is resumed under the same id goes on where it was. Each thread panel lists **Sessions on this line** with a button that copies the command that resumes each; `trace-canvas resume <thread>` and `trace_read_thread` return the same list.
- **Videos and GIFs.** A tutorial, a promo, an Agents view and a Goals video in English and Chinese, a 20-second short in a vertical format, `make.mjs replay` to replay one of your own sessions from your canvas, and silent GIFs for each feature.

### Changed

- A line's goal has its own field; the note keeps paths and "combined from" lines, which no longer show as the goal.
- MCP tools act on the session that calls them (`CLAUDE_CODE_SESSION_ID`) instead of the newest transcript in the folder.
- Combining lines hands the folded lines' repository key and ids to the line you keep, so sessions in that folder land on it.
- The live bar names MCP tools by their short name (`navigate`, not `mcp__Claude_Browser__navigate`).

### Fixed

- A resumed session fell back to its folder's line and logged its first instruction again.
- Codex hooks could not write `~/.trace-canvas` from inside Codex's sandbox; setup now adds it to `writable_roots`.
- With two sessions in one folder, capture and bind could pick the other session.
- The goals list stopped refreshing once a checkbox or menu in it had focus.

## 0.1.0 (2026-10-26)

First public release: threads and records in a canvas, a branch graph and a timeline; Claude Code hooks, an MCP server and the `/trace-canvas` skill; merging sessions and threads; English and Chinese.
