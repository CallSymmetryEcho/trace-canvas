# Trace Canvas

English | [中文](README.zh-CN.md)

A transit map of your work. When you work with AI agents, ideas and tasks run in parallel and scatter across sessions. Trace Canvas keeps a trace of them and shows how they relate:

- A **thread** is one piece of work in progress, like a git branch. It is drawn as a line.
- A **record** is a station on that line, like a commit: an idea ○, a task □, agent output ◆, a decision ◉ or a note •.
- **Fork** a new thread from any record and **merge** it back when it is done. Forks and merges are drawn as interchanges.
- The **inbox** holds loose ideas until you file them.

**One entry point for your agents.** Agents can read the same map: through the MCP tools `trace_list_threads` and `trace_read_thread`, a new Claude Code session catches up on all your projects in seconds instead of rereading old chats. Hooks and the `/trace-canvas` skill keep the map up to date while you work.

![Records from agents arrive on the canvas, a new session appears as its own line, and two lines are merged back (made-up data)](docs/demo.en.gif)

Videos: [2-minute tutorial](https://github.com/CallSymmetryEcho/trace-canvas/releases/tag/v0.1.0) in English and Chinese.

Three views of the same data:

| View | What it shows |
| --- | --- |
| Canvas | One card per thread with a mini line map. Drag, zoom, draw labeled links, and select several threads to merge them. |
| Branches | A git graph: every record in time order, one lane per thread, forks and merges as curves. |
| Timeline | A time axis (day / week / month). One row per thread; the band shows when it was active. |

The page is in English by default. Switch with the **中文 / EN** button in the header.

**What is it good for?** Three scenarios with made-up data (four agents building an app in parallel, three weeks of a PhD student's life, one analysis spread over three agents and two computers), the advantages for vibe coding and AI collaboration, and the open problems: [docs/why.md](docs/why.md).

## Run it on your Mac

Needs Node.js 18.17 or newer and nothing else (no `npm install`).

```bash
git clone https://github.com/CallSymmetryEcho/trace-canvas.git
cd trace-canvas
node bin/trace-canvas.mjs
```

This starts a local server on <http://localhost:4777/> and opens it in your browser. Data is stored in `~/.trace-canvas/data.json`. Click **Load example data** on the empty page for a first look, then **Clear** it from the header when you're done.

Optional: make `trace-canvas` a command.

```bash
echo "alias trace-canvas='node \"$PWD/bin/trace-canvas.mjs\"'" >> ~/.zshrc
```

## Three ways Claude Code fills the canvas

| | When it happens | What you do |
| --- | --- | --- |
| **Hooks** | Automatically, at key moments of every session | Nothing |
| **`/trace-canvas` skill** | When you ask | Type `/trace-canvas`, or say "put this session on the canvas" |
| **MCP tools** | Whenever Claude decides it fits, or the skill calls them | Nothing; Claude uses them |

One command, run from this folder, sets up all three.

For every project on this computer, run once:

```bash
node bin/trace-canvas.mjs setup --user
```

This adds the hooks to `~/.claude/settings.json`, registers the MCP server with `claude mcp add --scope user`, links the skill into `~/.claude/skills/`, and lets the capture, log and read tools run without asking. Merging and importing always ask first. Use `--project <dir>` instead of `--user` for one project only; Claude Code then asks once, in that project, to approve the `trace-canvas` MCP server.

### Hooks: automatic traces

| When | What gets logged |
| --- | --- |
| The first instruction of a session | a **task** with the full prompt |
| A turn that changed files | **agent output**: the first sentence of Claude's reply, the files changed and the to-dos completed |
| `git commit` | **agent output**: `Commit 1a2b3c4: message` |
| `git push` | a **note**: `Pushed main` |
| `gh pr create` | a **decision** with the pull request link |
| `git merge <branch>` | a **merge** on the current thread; the branch thread is marked merged |
| The session ends | a **note** summarizing duration, prompts, files and commits, with `claude --resume <id>` |

Records go to one thread per repository and branch. Working on `main` logs to `graduation-affair`. Switching to a branch `lit-review` forks a new thread `graduation-affair · lit-review` from where you were, so parallel sessions on different branches land on different lines. Turns that only answer a question are not logged. Files written from the shell (`>`, `tee`, `sed -i`, …) count as changes.

### `/trace-canvas`: put this session on the canvas

| You type | What happens |
| --- | --- |
| `/trace-canvas` | Claude writes 2–6 highlights of this session (decisions, outcomes, next steps), a short summary and a name, and adds them together with the key moments read from the session transcript. |
| `/trace-canvas sessions` | Lists this project's past sessions and which are already on the canvas, and offers to add any of them. |
| `/trace-canvas merge <threads…>` | Merges sessions or threads. Claude confirms the sources, the target and the mode with you first. |
| `/trace-canvas open` | Starts the page and opens it. |
| `/trace-canvas log <text>` | Adds one record. |

Plain language works too: "put this session on the canvas", "把这次会话放进画布", "merge the two survey sessions".

Capturing is safe to repeat: records already on the canvas are skipped. If the hooks already logged the session, the capture completes that thread; ask for "its own line" (`separate`) to pull the session out into a thread of its own.

### MCP tools

| Tool | What it does |
| --- | --- |
| `trace_capture_session` | Puts the current session (or a past one by `session_id`) on the canvas, with the highlights, summary and name Claude passes |
| `trace_list_sessions` | Lists Claude Code sessions of a project from their transcripts |
| `trace_list_threads` | Lists threads with status, record count, last update; `query` searches |
| `trace_read_thread` | Returns the records on one thread |
| `trace_merge` | Merges any number of threads, in `merge` or `combine` mode (below) |
| `trace_log` | Adds one record |
| `trace_import_data` | Merges another data set: an export, `data.json` from another computer, or JSON lines |
| `trace_open` | Starts the page if needed and returns its address |

## Merging sessions and threads

Several sessions about the same piece of work can become one line, in two ways:

- **Merge** keeps every source line, marks it merged and draws the merge into the target, like git. History stays visible.
- **Combine** moves every record onto the target in time order and removes the source threads. Links to them now point to the target.

The target can be an existing thread or a new one. Three places to do it:

- **On the canvas**: Shift-click cards (or turn on **Select** in the toolbar, handy on touch screens), pick a target or type a new name, then **Merge** or **Combine**.
- **In Claude Code**: `/trace-canvas merge`, or ask in your own words.
- **On the command line**: `trace-canvas merge "Survey A" "Survey B" --into "Survey analysis" --combine`.

Data from another computer (for example a workstation) merges with `trace-canvas import other-data.json`. Threads with the same repository/branch or session key, or the same name, become one line, and records already present are skipped.

## Tuning the hooks

Set these in `~/.trace-canvas/config.json` or as environment variables:

| Setting | Env variable | Values | Default |
| --- | --- | --- | --- |
| `lang` | `TRACE_CANVAS_LANG` | `en`, `zh`: language of records the hooks write | `en` (switching the page language also switches this) |
| `group` | `TRACE_CANVAS_GROUP` | `branch`, `repo`, `session`: what one thread stands for | `branch` |
| `prompts` | `TRACE_CANVAS_PROMPTS` | `first`, `long` (60+ characters), `all`, `none` | `first` |
| `turns` | `TRACE_CANVAS_TURNS` | `changes` (turns that changed something), `all`, `none` | `changes` |

`TRACE_CANVAS_DISABLE=1` turns the hooks off for one session. `TRACE_CANVAS_HOME` moves the data folder. `TRACE_CANVAS_DEBUG=1` writes every hook event to `~/.trace-canvas/debug.log`.

## Logging from other agents and scripts

Any agent, script or cron job can log one line:

```bash
node bin/trace-canvas.mjs log "Finished the literature table" \
  --thread "Proposal" --kind agent --agent Codex --link https://example.com/doc
```

Agents without shell access (ChatGPT, for example) can end their answer with JSON lines. Paste the whole output into the box at the bottom of the page and press Enter, or run `trace-canvas import file.jsonl`:

```json
{"thread": "Proposal", "kind": "agent", "title": "Outlined chapter 2", "body": "Next: figures", "agent": "ChatGPT"}
```

## AI tidy-up

If the `claude` command is installed, **AI tidy-up** in the header asks Claude to file inbox records into threads, suggest links between threads and point out threads that look stalled. Nothing changes until you tick the suggestions and apply them. It runs `claude -p` on your own account; the hooks are switched off for that call.

## Commands

```text
Page
  trace-canvas [serve] [--port 4777] [--no-open]   Start the page and open it

Records
  trace-canvas log "title" [--thread T] [--kind K] [--body B] [--link URL] [--agent A]
  trace-canvas capture [--session ID] [--project DIR] [--thread T] [--separate] [--all]
  trace-canvas sessions [--project DIR]            List Claude Code sessions of a project
  trace-canvas merge <thread>... --into <thread> [--combine]
  trace-canvas import <file|->                     Merge an export, another data.json, or JSON lines

Setup (--user for every project, --project DIR for one)
  trace-canvas setup            Hooks + MCP server + skill
  trace-canvas install-hooks | install-mcp | install-skill | uninstall-hooks
  trace-canvas mcp              Run the MCP server on stdio (Claude Code starts this)
  trace-canvas lang <en|zh>     Language of records the hooks write
  trace-canvas where            Show where the data is stored
```

## Online version

The same page also runs as a claude.ai artifact, with its data in the artifact's own database: <https://claude.ai/artifact/Y7kykkrWyU4rH31MttYLMj>. The local version and the online version keep separate data; use **More → Import / export** to move data between them.

## How it works

![Architecture](docs/architecture.svg)

```text
app/index.html        The page. Works against the local server, a claude.ai artifact database, or browser storage.
bin/trace-canvas.mjs  Command line entry point.
skill/SKILL.md        The /trace-canvas skill.
src/server.mjs        Local server on 127.0.0.1: page, JSON API, live updates over server-sent events.
src/mcp.mjs           MCP server (stdio JSON-RPC, no dependencies).
src/hook.mjs          Claude Code hook handler.
src/transcript.mjs    Reads Claude Code session transcripts (~/.claude/projects/…/<session>.jsonl).
src/ops.mjs           Capturing sessions, merging threads, merging data sets.
src/git-events.mjs    Reads commits, pushes, merges and pull requests from shell commands and their output.
src/store.mjs         The data file. A directory lock keeps parallel processes from overwriting each other.
src/install.mjs       Adds or removes hooks, the MCP server, the skill and permissions.
src/demo.mjs          Example data in English and Chinese.
test/                 node --test suites (npm test), with transcript fixtures.
docs/architecture.mjs Draws the architecture diagram (English and Chinese SVG).
docs/scenarios/       Made-up scenario data and the script that renders their screenshots.
```

Data model, stored as one JSON file:

```text
threads/<id>  name, color, status (active | parked | done | merged), parent, forkOf, mergedInto, x, y, note,
              key (repo, repo@branch or session:<id>)
commits/<id>  thread (or "inbox"), kind (idea | task | agent | decision | note | fork | merge), title, body,
              links[], agent, ts, parents[], done, mergeOf?, session?
edges/<id>    from, to, label
```

The server only listens on 127.0.0.1, checks the `Host` header, and requires an `X-Trace-Canvas` header on every write, so other websites open in your browser cannot change your data.

Run the tests with `npm test` in this folder.

## License

MIT, see [LICENSE](LICENSE).
