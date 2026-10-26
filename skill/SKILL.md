---
name: trace-canvas
description: Put this Claude Code session on the Trace Canvas, a transit map of parallel work (threads like git branches, records like commits), log a key moment, list past sessions, or merge sessions and threads into one line. Use when the user asks to trace, capture, save or log this session or conversation, to see how parallel work fits together, or to merge sessions or threads.
when_to_use: Trigger phrases include "trace this", "put this session on the canvas", "log this", "merge these sessions", "留痕", "把这次会话放进画布", "合并会话", "合并线程".
argument-hint: "[capture | sessions | merge <threads…> | open | log <text>]"
allowed-tools: mcp__trace-canvas__trace_capture_session mcp__trace-canvas__trace_list_sessions mcp__trace-canvas__trace_list_threads mcp__trace-canvas__trace_read_thread mcp__trace-canvas__trace_log mcp__trace-canvas__trace_open
---

# Trace Canvas

Trace Canvas shows work as a transit map. A **thread** is one piece of work in progress, like a git branch. A **record** is a station on it, like a commit: idea, task, agent output, decision or note. Records are stored on this computer and shown at http://localhost:4777/.

The user asked: `$ARGUMENTS`

Pick the matching action below. With no arguments, capture the current session.

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

## sessions: list past sessions

Call `trace_list_sessions` and show a short table: when, title, prompts, files changed, commits, and the thread it is already on. Offer to capture any of them with `trace_capture_session` and `session_id`. For past sessions you have not seen, pass no highlights; the transcript import is enough.

## merge: combine sessions or threads

1. Call `trace_list_threads` and identify the threads the user means. If it is unclear, show the candidates and ask.
2. Confirm three things with the user before merging:
   - the sources
   - the target: an existing thread, or a new name
   - the mode: **merge** keeps every line and draws the merge, like git; **combine** moves every record onto the target in time order and removes the source threads
3. Call `trace_merge`. Report what happened in one line.

## open

Call `trace_open` with `open_browser: true`. Pass `view: "timeline"` or `view: "git"` if the user asked for those.

## log <text>

Call `trace_log` with the text as `title`. Use `thread` if the user named one, and pick a fitting `kind`.

## If the tools are missing

If the `trace_*` tools are not available, the MCP server is not set up. Tell the user to run this in the folder that holds Trace Canvas, then start a new session:

```bash
node bin/trace-canvas.mjs setup --user
```

Until then, single records can still be logged with the command line:

```bash
node bin/trace-canvas.mjs log "title" --thread "name" --kind agent --agent "Claude Code"
```
