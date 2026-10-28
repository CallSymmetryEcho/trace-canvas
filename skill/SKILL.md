---
name: trace-canvas
description: Put an agent session on the Trace Canvas, a transit map of parallel work (threads like git branches, records like commits), log a key moment, list past Claude Code sessions, merge sessions and threads into one line, or hand new to-dos to the agents working on each line. Use when the user asks to trace, capture, save or log this session or conversation, to see how parallel work fits together, or to merge sessions or threads, including "留痕", "把这次会话放进画布", "合并会话", "合并线程" and "分派".
allowed-tools: mcp__trace-canvas__trace_capture_session mcp__trace-canvas__trace_list_sessions mcp__trace-canvas__trace_list_threads mcp__trace-canvas__trace_read_thread mcp__trace-canvas__trace_log mcp__trace-canvas__trace_open mcp__trace-canvas__trace_live mcp__trace-canvas__trace_bind mcp__trace-canvas__trace_tasks mcp__trace-canvas__trace_task_done mcp__trace-canvas__trace_fork
---

# Trace Canvas

Trace Canvas shows work as a transit map. A **thread** is one piece of work in progress, like a git branch. A **record** is a station on it, like a commit: idea, task, agent output, decision or note. Records are stored on this computer and shown at http://localhost:4777/.

In Claude Code, invoke `/trace-canvas` (arguments: `$ARGUMENTS`). In Codex, invoke `$trace-canvas` and read the action from the user's request.

Actions: `capture`, `all`, `sessions`, `tasks`, `pick`, `dispatch [lines or to-dos…]`, `retro <thread>`, `live`, `bind <thread>`, `fork <thread>`, `merge <threads…>`, `open`, `log <text>`.

Pick the matching action below. With no arguments, capture the current session.

Current-session capture works with the agent's live hook records and the highlights you write. Historical transcript discovery (`all` and `sessions`) currently reads Claude Code transcripts only. To inspect recorded Codex sessions, use `trace_live` or `trace_read_thread`. If the capture tool cannot identify the current session, do not guess: establish the intended thread with the user and add the highlights there with `trace_log`.

## capture (default): put this session on the canvas

1. Look back over this conversation and write **2–6 highlights**. Each one is a single moment that matters later:
   - `decision`: a choice that was made and why, in one line
   - `agent`: an outcome that exists now (a file, a result, a fix)
   - `task`: an open next step that is not done yet
   - `note`: a finding or constraint worth remembering
   Titles are one sentence, at most 100 characters. Put detail in `body`. Only include things that actually happened in this session.
2. Write a **summary** of 2–3 sentences: what the session set out to do, what it did, where it stopped.
3. Write a **name** for the work: 2–6 words, like a branch name a person would choose ("Methods chapter draft", "开题报告时间线"). It names the session's line if it gets one.
4. Write all of these in the language the user has been using.
5. Call `trace_capture_session` with `summary`, `highlights` and `name`. Leave `session_id` empty to capture the current session.
   - If the user named a thread, pass it as `thread`.
   - If they want this session as its own line, pass `separate: true`.
6. Reply in two or three lines: which thread it went to, how many records were added, and the address the tool returned. If the page is not running, offer to open it with `trace_open`.

## all: put every Claude Code session of this project on the canvas

For "put all my sessions on the canvas" and the like (the first thing many people type after setup):

1. Call `trace_list_sessions` with `limit: 50`.
2. For each session that is not on the canvas yet, call `trace_capture_session` with its `session_id` and no highlights; the transcript import is enough. For the current session, write highlights and a summary as in **capture**.
3. Call `trace_open` with `open_browser: true`.
4. Reply in two or three lines: how many sessions went on, on which lines, and the address.

## sessions: list past Claude Code sessions

Call `trace_list_sessions` and show a short table: when, title, prompts, files changed, commits, and the thread it is already on. Offer to capture any of them with `trace_capture_session` and `session_id`. For past sessions you have not seen, pass no highlights; the transcript import is enough.

## fork <thread>: branch a new line off another

Call `trace_fork` with `from` (the thread or record the user named) and `name`. Pass `bind: true` when this session should work on the new line. Report the new thread's name in one line.

## merge: combine sessions or threads

1. Call `trace_list_threads` and identify the threads the user means. If it is unclear, show the candidates and ask.
2. Confirm three things with the user before merging:
   - the sources
   - the target: an existing thread, or a new name
   - the mode: **merge** keeps every line and draws the merge, like git; **combine** moves every record onto the target in time order and removes the source threads
3. Call `trace_merge`. Report what happened in one line.

## tasks: goals and to-dos

Call `trace_tasks` (it answers for the line this session works on; pass `thread` if the user named another, or `all: true` when they want every line) and show each thread's goal, its progress (done/total) and its open to-dos. When you finish a to-do during the session, call `trace_task_done` with its id. To add a to-do, call `trace_log` with `kind: "task"` and the thread.

## pick: take the next to-do and do it

1. Call `trace_tasks` with `mine: true`. If nothing is assigned to you, call `trace_tasks` for the line you work on and take its oldest open to-do that nobody has.
2. Say in one line which to-do you take, then do it.
3. When it is done, call `trace_task_done` with its id and `trace_log` the result on the same line.

## dispatch [lines or to-dos…]: hand new to-dos to each line's agent and wake it

1. Run `node <this skill's folder>/../bin/trace-canvas.mjs dispatch` (`trace-canvas dispatch` if it is on the PATH) with the lines the user named, or none for every line; when they name particular to-dos, pass each one's id (find it with `trace_tasks`) and only those go out, whoever logged them; add `--all` if they also want the to-dos a line's agent logged itself. It gives each line's new to-dos (the user's own, or logged by another session) to the agent that last worked on that line, and on macOS it resumes stopped sessions and starts new ones in new Terminal windows by itself.
2. Where it says **send it this message**, send that message to the running session with your messaging tool if you have one (in Claude Code: SendMessage to the `local_…` id it prints, or to the session's name from ListAgents). Otherwise give the user the session and the message.
3. **Your own line** means those to-dos are yours: do them after the others are handed out. An agent that is **working** and not Claude Code takes its message only when it stops: tell the user.
4. Report one row per line: which agent got which to-dos and how it was woken. Only to-dos are handed out; if the user's new items are ideas, say so and offer to make them to-dos.

## retro <thread>: which work took the most back-and-forth, and what to keep

1. Run `node <this skill's folder>/../bin/trace-canvas.mjs retro "<thread>"` (the line the user named, or the one you work on; `trace-canvas retro` if it is on the PATH). It reads the line's conversations on this machine and asks the local claude or codex to group them, so it takes a minute or two; run it in the background if your tool times out sooner. It puts the ranking on the line as a note and writes nothing else.
2. Show the top items: title, rounds, minutes, tokens, corrections, and for each suggested rule what it was stuck on, the sentence that made it clear and the rule with its layer (project = CLAUDE.md and AGENTS.md, line = a decision on the line, memory = long-term memory).
3. Ask the user about each rule, one by one. Write only the ones they approve, in the layer they choose, with the same command: `… retro --apply <record> <n> [--layer project|line|memory]`. Never edit the rule files yourself.

## live: what is running now

Call `trace_live` and show a short table: status (working, needs you, idle), title, what it is doing, its thread, which session started it, and its subagents. Put sessions that need the user first.

## bind <thread>: put this session on a thread

Call `trace_bind` with the thread the user named (a new name creates the thread). Leave `session_id` empty for the current session. `unbind: true` goes back to the repository/branch line. Report the thread in one line.

## open

Call `trace_open` with `open_browser: true`. Pass `view: "timeline"` or `view: "git"` if the user asked for those.

## log <text>

Call `trace_log` with the text as `title`. Use `thread` if the user named one, and pick a fitting `kind`.

## If the tools are missing

If the `trace_*` tools are not available, the MCP server is not set up. Tell the user to run this in the folder that holds Trace Canvas, then start a new session:

```bash
node bin/trace-canvas.mjs setup --user
```

For Codex, add `--agents codex` to install its hooks, MCP server and skill. If the hooks and MCP server already work, run `node bin/trace-canvas.mjs install-skill --user --agents codex` to install just the skill.

Until then, single records can still be logged with the command line:

```bash
node bin/trace-canvas.mjs log "title" --thread "name" --kind agent --agent "Claude Code"
```
