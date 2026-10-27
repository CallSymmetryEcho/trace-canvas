# Changelog

## Unreleased

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
