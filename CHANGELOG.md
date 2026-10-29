# Changelog

## Unreleased

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
