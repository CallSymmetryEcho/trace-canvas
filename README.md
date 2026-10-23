# Trace Canvas

English | [中文](README.zh-CN.md)

A transit map of your work. When you work with AI agents, ideas and tasks run in parallel and scatter across sessions. Trace Canvas keeps a trace of them and shows how they relate:

- A **thread** is one piece of work in progress, like a git branch. It is drawn as a line.
- A **record** is a station on that line, like a commit: an idea ○, a task □, agent output ◆, a decision ◉ or a note •.
- **Fork** a new thread from any record and **merge** it back when it is done. Forks and merges are drawn as interchanges.
- The **inbox** holds loose ideas until you file them.

![Canvas view](docs/canvas.png)

Three views of the same data:

| View | What it shows |
| --- | --- |
| Canvas | One card per thread with a mini line map. Drag, zoom, and draw labeled links between threads. |
| Branches | A git graph: every record in time order, one lane per thread, forks and merges as curves. |
| Timeline | A time axis (day / week / month). One row per thread; the band shows when it was active. |

The page is in English by default. Switch with the **中文 / EN** button in the header.

## Run it on your Mac

Needs Node.js 18.17 or newer and nothing else (no `npm install`).

```bash
cd graduation-affair
node tools/trace-canvas/bin/trace-canvas.mjs
```

This starts a local server on <http://localhost:4777/> and opens it in your browser. Data is stored in `~/.trace-canvas/data.json`. Click **Load example data** on the empty page for a first look, then **Clear** it from the header when you're done.

Optional: make `trace-canvas` a command.

```bash
echo "alias trace-canvas='node \"$PWD/tools/trace-canvas/bin/trace-canvas.mjs\"'" >> ~/.zshrc
```

## Automatic traces from Claude Code

The hooks turn the moments that matter in a Claude Code session into records, with no extra steps:

| When | What gets logged |
| --- | --- |
| The first instruction of a session | a **task** with the full prompt |
| A turn that changed files | **agent output**: the first sentence of Claude's reply, the files changed and the to-dos completed |
| `git commit` | **agent output**: `Commit 1a2b3c4: message` |
| `git push` | a **note**: `Pushed main` |
| `gh pr create` | a **decision** with the pull request link |
| `git merge <branch>` | a **merge** on the current thread; the branch thread is marked merged |
| The session ends | a **note** summarizing duration, prompts, files and commits, with `claude --resume <id>` |

Records go to one thread per repository and branch. Working on `main` logs to `graduation-affair`. Switching to a branch `lit-review` forks a new thread `graduation-affair · lit-review` from where you were, so parallel sessions on different branches land on different lines. Turns that only answer a question are not logged.

**In this repository the hooks are already on**: `.claude/settings.json` registers them. Pull the branch, start a new Claude Code session in the repo, and records start appearing. If Node isn't installed the hook does nothing.

To turn them on for every project on this computer:

```bash
node tools/trace-canvas/bin/trace-canvas.mjs install-hooks --user
```

For one other project only (writes that project's `.claude/settings.local.json`):

```bash
node tools/trace-canvas/bin/trace-canvas.mjs install-hooks --project ~/code/some-project
```

`uninstall-hooks` with the same flag removes them. Other hooks and settings in the file are kept, and a `.bak` copy is written first. Installing in several places is safe: repeated events are only logged once.

### Tuning

Set these in `~/.trace-canvas/config.json` or as environment variables:

| Setting | Env variable | Values | Default |
| --- | --- | --- | --- |
| `lang` | `TRACE_CANVAS_LANG` | `en`, `zh`: language of records the hooks write | `en` (switching the page language also switches this) |
| `group` | `TRACE_CANVAS_GROUP` | `branch`, `repo`, `session`: what one thread stands for | `branch` |
| `prompts` | `TRACE_CANVAS_PROMPTS` | `first`, `long` (60+ characters), `all`, `none` | `first` |
| `turns` | `TRACE_CANVAS_TURNS` | `changes` (turns that edited files), `all`, `none` | `changes` |

`TRACE_CANVAS_DISABLE=1` turns the hooks off for one session. `TRACE_CANVAS_HOME` moves the data folder.

## Logging from other agents and scripts

Any agent, script or cron job can log one line:

```bash
node tools/trace-canvas/bin/trace-canvas.mjs log "Finished the literature table" \
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
trace-canvas [serve] [--port 4777] [--no-open]   Start the page
trace-canvas log "title" [--thread T] [--kind K] [--body B] [--link URL] [--agent A]
trace-canvas import <file|->                     Import an export or JSON lines
trace-canvas install-hooks [--user | --project DIR]
trace-canvas uninstall-hooks [--user | --project DIR]
trace-canvas lang <en|zh>                        Language of records the hooks write
trace-canvas where                               Show where the data is stored
```

## Online version

The same page also runs as a claude.ai artifact, with its data in the artifact's own database: <https://claude.ai/artifact/Y7kykkrWyU4rH31MttYLMj>. The local version and the online version keep separate data; use **More → Import / export** to move data between them.

## How it works

```text
app/index.html      The page. Works against the local server, a claude.ai artifact database, or browser storage.
bin/trace-canvas.mjs  Command line entry point.
src/server.mjs      Local server on 127.0.0.1: page, JSON API, live updates over server-sent events.
src/hook.mjs        Claude Code hook handler.
src/store.mjs       The data file. A directory lock keeps parallel hook processes from overwriting each other.
src/install.mjs     Adds or removes hooks in a Claude Code settings file.
src/demo.mjs        Example data in English and Chinese.
test/               node --test suites (npm test).
```

Data model, stored as one JSON file:

```text
threads/<id>  name, color, status (active | parked | done | merged), parent, forkOf, mergedInto, x, y, note, key
commits/<id>  thread (or "inbox"), kind (idea | task | agent | decision | note | fork | merge), title, body,
              links[], agent, ts, parents[], done, mergeOf?, session?
edges/<id>    from, to, label
```

The server only listens on 127.0.0.1, checks the `Host` header, and requires an `X-Trace-Canvas` header on every write, so other websites open in your browser cannot change your data.

Run the tests with `npm test` inside `tools/trace-canvas`.
