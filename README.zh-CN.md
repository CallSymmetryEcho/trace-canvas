# Trace Canvas 留痕

[English](README.md) | 中文

把 AI agent 办公时零碎的想法和并行的工作，画成一张「地铁线路图」：

- **线程**：一件在推进的事，相当于 git 分支，画成一条线路。
- **记录**：线路上的站点，相当于提交：想法 ○、任务 □、Agent 产出 ◆、决策 ◉、笔记 •。
- 可以从任意记录**分叉**出新线程，做完再**合并**回去，分叉与合并画成换乘站。
- **收件箱**放还没归类的零碎想法。

**agent 的统一入口。** 这张图 agent 也能读：通过 MCP 工具 `trace_list_threads` 和 `trace_read_thread`，新开的 Claude Code 会话几秒钟就能了解你手上所有项目的进展，不用再翻旧聊天记录。工作时，hooks 和 `/trace-canvas` skill 会自动更新这张图。

![agent 的记录陆续出现在画布上，新会话成为一条新线路，再把两条线合并回来（虚构数据）](docs/demo.zh.gif)

视频：[中英文教程](https://github.com/CallSymmetryEcho/trace-canvas/releases/tag/v0.1.0)。

![分支视图：实时线头、批准、你的决定和 agent 的产出](docs/gif-branches.zh.gif)

*分支视图：正在运行的会话以线头显示在各自线路的顶端。橙色的在等你；批准后变绿，你的决定显示为深色，agent 的产出用线路的颜色。虚构数据。*

同一份数据，四个视图：

| 视图 | 用途 |
| --- | --- |
| 画布 | 每条线程是一张带迷你线路图的卡片，可拖拽、缩放、画带标签的关联，也可以多选线程一起合并 |
| 分支 | git graph：所有记录按时间排列，每条线程一条泳道，分叉与合并画成曲线 |
| 时间线 | 横向时间轴（日 / 周 / 月），每行一条线程，色带是它活跃的时段 |
| Agent | 正在运行的会话画成一棵树：谁启动了谁，以及每个会话的子 agent（见 [Agent 视图](#agent-视图谁启动了谁)） |

![时间线视图：在日、周、月之间切换](docs/gif-timeline.zh.gif)

*时间线：按日、周、月查看。色带是每条线活跃的时段，虚线曲线是分叉与合并。虚构数据。*

页面默认英文，点右上角 **中文 / EN** 切换。

**它能用来做什么？** 用虚构数据演示的三个场景（四个 agent 并行做一个应用、一个研究生的三周、一项分析分散在三个 agent 和两台电脑上），它在 vibe coding 和 AI 协作中的优势，以及还没解决的问题：[docs/why.zh-CN.md](docs/why.zh-CN.md)。

## 在 Mac 上运行

只需要 Node.js 18.17 以上，不用 `npm install`。

```bash
git clone https://github.com/CallSymmetryEcho/trace-canvas.git
cd trace-canvas
node bin/trace-canvas.mjs
```

会在 <http://localhost:4777/> 启动本地服务并自动打开浏览器。数据保存在 `~/.trace-canvas/data.json`。空页面上点 **Load example data（载入示例数据）** 可以先看效果，看完在顶栏点「清除」。

可选：加个快捷命令。

```bash
echo "alias trace-canvas='node \"$PWD/bin/trace-canvas.mjs\"'" >> ~/.zshrc
```

## Claude Code 写入画布的三种方式

| | 什么时候发生 | 你要做什么 |
| --- | --- | --- |
| **Hooks** | 每个会话的关键节点自动记录 | 什么都不用做 |
| **`/trace-canvas` skill** | 你主动调用时 | 输入 `/trace-canvas`，或者直接说「把这次会话放进画布」 |
| **MCP 工具** | Claude 判断合适时，或 skill 调用时 | 什么都不用做，Claude 自己用 |

在这个文件夹里运行一条命令，三样都会配好。

要对这台电脑上的所有项目开启，运行一次：

```bash
node bin/trace-canvas.mjs setup --user
```

它会把 hooks 写进 `~/.claude/settings.json`，用 `claude mcp add --scope user` 注册 MCP 服务，把 skill 链接到 `~/.claude/skills/`，并让「放进画布、记录、读取」这几个工具不用每次确认。合并和导入始终会先问你。只对某个项目开启时，把 `--user` 换成 `--project <目录>`；之后 Claude Code 会在那个项目里问一次是否批准 `trace-canvas` MCP 服务。

### Hooks：自动留痕

| 时机 | 记下什么 |
| --- | --- |
| 会话的第一条指令 | 一条**任务**，带完整指令 |
| 改动了文件的回合 | **Agent 产出**：Claude 回复的第一句话、改动的文件、完成的待办 |
| `git commit` | **Agent 产出**：`Commit 1a2b3c4: 提交说明` |
| `git push` | **笔记**：`Pushed main` |
| `gh pr create` | **决策**，带 PR 链接 |
| `git merge <分支>` | 当前线程上一条**合并**，被合并的分支线程标为已合并 |
| 会话结束 | **笔记**：时长、指令数、文件数、提交数，以及 `claude --resume <id>` |

记录按「仓库 + 分支」归到线程。在 `main` 上工作记到 `graduation-affair`；切到分支 `lit-review` 时，会从当前位置分叉出新线程 `graduation-affair · lit-review`。这样不同分支上并行的会话会落在不同的线路上。只是回答问题的回合不记录；用 shell 写文件（`>`、`tee`、`sed -i` 等）也算改动。

### `/trace-canvas`：把当前会话放进画布

| 你输入 | 发生什么 |
| --- | --- |
| `/trace-canvas` | Claude 为这次会话写 2–6 条要点（决策、产出、下一步）、一段简短总结和一个线程名，再加上从会话记录里读出的关键节点，一起放进画布 |
| `/trace-canvas sessions` | 列出这个项目过去的会话，标出哪些已经在画布上，可以挑着加进去 |
| `/trace-canvas merge <线程…>` | 合并会话或线程。Claude 会先跟你确认来源、目标和合并方式 |
| `/trace-canvas open` | 启动并打开页面 |
| `/trace-canvas log <内容>` | 记一条 |

直接用自然语言也行：「把这次会话放进画布」「put this session on the canvas」「把两次问卷分析的会话合并」。

重复放进去没关系，已经在画布上的记录会跳过。如果 hooks 已经记过这次会话，会补全到那条线程上；想让这次会话「单独成一条线」时（`separate`），会把它的记录移到新线程里。

### MCP 工具

| 工具 | 作用 |
| --- | --- |
| `trace_capture_session` | 把当前会话（或用 `session_id` 指定的过去会话）放进画布，附上 Claude 写的要点、总结和线程名 |
| `trace_list_sessions` | 从会话记录文件列出某个项目的 Claude Code 会话 |
| `trace_list_threads` | 列出线程：状态、记录数、最近更新；`query` 可搜索 |
| `trace_read_thread` | 读取一条线程上的记录 |
| `trace_merge` | 合并任意多条线程，`merge` 或 `combine` 两种方式（见下） |
| `trace_log` | 记一条 |
| `trace_import_data` | 合并另一份数据：导出文件、另一台电脑的 `data.json`、或 JSON 行 |
| `trace_live` | 列出正在运行的会话：状态、当前动作、所属线 |
| `trace_bind` | 把一个运行中的会话（默认是当前会话）放到某条线上 |
| `trace_tasks` | 返回每条线的目标和待办，以及完成了几项 |
| `trace_task_done` | 勾选一项待办（或重新打开），并记下是谁勾的 |
| `trace_open` | 必要时启动页面，返回地址 |

## 实时会话

本地页面会显示此刻有哪些 Claude Code 会话在运行。页头下方的一栏列出它们，等你处理的排在最前：

| 状态 | 什么时候 |
| --- | --- |
| **工作中**（绿色） | Claude 正在干活，栏里显示当前这一步，比如 `Edit hook.mjs` 或 `$ npm test` |
| **等你**（橙色） | 等你批准权限、回答问题（`AskUserQuestion`）、确认计划，或回答 MCP 服务的提问 |
| **空闲**（灰色） | 这一轮做完了，栏里显示 Claude 回复的第一句 |

所有视图里，你写的站点（你的指令和决定）画成深色并带人形标记，agent 的站点用线路颜色并带星形标记，一眼能看出每条线是谁推进的。分支视图里，正在某条线上工作的会话会出现在这条泳道的顶端，是一个脉动的线头（绿色是工作中，橙色是等你），并用虚线连到这条线最新的记录；点它会打开会话面板。每张卡片会显示这条线上有几个会话在运行。点开一个会话，可以看到它的仓库、分支、目录和最近的指令，复制 `claude --resume <id>`，或者把它换到另一条线。会话默认按仓库和分支自动归线；要手动绑定，可以在页面上选线，运行 `trace-canvas bind "<线名>"`，或者让 Claude 来做（`trace_bind`）。绑定之后，这个会话的记录也会记到那条线上。

实时状态需要 SessionStart、PreToolUse、Notification 和 SubagentStart/Stop 这几个 hook，`setup` 会自动加上（更新后再运行一次）。状态存在 `~/.trace-canvas/live/` 里，每个会话、每个子 agent 各一个小文件，和你的记录分开。会话结束或 12 小时没有动静后就不再显示。只有本地页面能看到实时会话。

### Agent 视图：谁启动了谁

**Agent** 标签页把正在运行的 agent 画成一棵从左到右的树。每个会话启动它右边的会话；虚线小卡片是它的子 agent（Explore、general-purpose、fork 等），运行中显示为绿色。启动过别的会话、自己已经不在运行的会话，会以虚线的"未运行"卡片留在链条里；有会话在等你的那棵树排在最前。点开一个会话，看到的面板和实时栏里的一样，另外多了：由谁启动、它启动的会话，以及各个子 agent 和它们最后一句话。

![Agent 视图](docs/scenarios/live-agents.zh.png)

![Agent 视图的实时变化](docs/gif-agents.zh.gif)

*等待批准的会话批准后变成绿色，子 agent 完成后变淡，面板显示这个会话由谁启动。虚构数据。*

子 agent 来自 SubagentStart/Stop 这两个 hook，以及 Claude Code 在每个子 agent 会话记录旁边保存的 `.meta.json`。谁启动了谁，读的是 Claude 桌面版自己的会话记录（`~/Library/Application Support/Claude/claude-code-sessions/`），只读、尽力而为：这个格式属于桌面版，随时可能变；没有桌面版时，每个会话各自成一棵树。可以用 `TRACE_CANVAS_DESKTOP_DIR` 指向别的位置。截图里的虚构会话由 `node docs/scenarios/agents.mjs <数据目录> <桌面记录目录>` 生成。

## 目标和待办：和 agent 异步推进

页头的**目标**按钮会打开一个清单，列出你想达到什么、做到哪了，主页面不会因此多出任何东西：

| | 是什么 | 放在哪 |
| --- | --- | --- |
| **目标** | 一条线要达到的结果 | 这条线的"目标和背景"字段 |
| **待办** □ | 具体的下一步，你或 agent 都可以去做，做完勾上 | 线上的任务记录 |
| **进度** | 实际发生了什么 | agent 的产出、提交、决定 |
| **收件箱** | 还没想清楚的零散想法 | 收件箱 |

清单按线分组，显示每条线的目标、进度条（完成/总数），以及此刻有没有会话在做。待办可以直接在清单里勾选或新增。hooks 记下的每个会话第一条指令，记录的是"当时要求做什么"，不算待办，不会出现在清单里；Claude 导入会话时写下的"下一步"会出现。

agent 用的是同一份清单：开工时用 `trace_tasks` 读目标和待办，做完一项就调用 `trace_task_done`，清单上会标出是谁勾的。这样你写下想要的结果，离开时 agent 照样推进，回来一看就知道做到哪了。命令行里是 `trace-canvas tasks` 和 `trace-canvas done "<待办>"`（脚本或其他 agent 加 `--agent Codex`）。

![目标和待办：agent 在共用的清单上勾掉待办](docs/gif-goals.zh.gif)

*agent 在共用的清单上勾掉待办：一项由 Claude Code 勾选，一项由 Codex 勾选，这条线的进度条随之前进。虚构数据。*

## 合并会话与线程

同一件事的多次会话可以并成一条线，有两种方式：

- **合并（merge）**：保留每条来源线路，标为已合并，像 git 一样画出合并到目标的曲线，历史都还看得见。
- **并成一条（combine）**：把所有记录按时间移到目标线程上，删除来源线程，指向它们的关联改为指向目标。

目标可以是已有线程，也可以新建。三个地方都能做：

- **画布上**：Shift+点击卡片（触屏上可以先打开工具栏的「多选」），选目标或输入新名字，点「合并」或「并成一条」。
- **Claude Code 里**：`/trace-canvas merge`，或直接说。
- **命令行**：`trace-canvas merge "问卷 A" "问卷 B" --into "问卷分析" --combine`。

另一台电脑（比如工作站）上的数据用 `trace-canvas import other-data.json` 合并进来。仓库/分支或会话的 key 相同、或名字相同的线程会并成一条，已有的记录会跳过。

![在画布上合并两条线](docs/gif-merge.zh.gif)

*在画布上：先近看一张卡片（深色站点是你的，彩色的是 agent 的），再 Shift 点选两条线，选择目标后点「合并」。虚构数据。*

## 调整 hooks

写在 `~/.trace-canvas/config.json` 里，或用环境变量：

| 设置 | 环境变量 | 可选值 | 默认 |
| --- | --- | --- | --- |
| `lang` | `TRACE_CANVAS_LANG` | `en`、`zh`：hooks 写入的记录用什么语言 | `en`（在页面上切换语言会一起切换） |
| `group` | `TRACE_CANVAS_GROUP` | `branch`、`repo`、`session`：一条线程代表什么 | `branch` |
| `prompts` | `TRACE_CANVAS_PROMPTS` | `first`、`long`（60 字符以上）、`all`、`none` | `first` |
| `turns` | `TRACE_CANVAS_TURNS` | `changes`（有改动的回合）、`all`、`none` | `changes` |

`TRACE_CANVAS_DISABLE=1` 可以让某个会话不留痕，`TRACE_CANVAS_HOME` 可以换数据目录，`TRACE_CANVAS_DEBUG=1` 会把每个 hook 事件写进 `~/.trace-canvas/debug.log`。

## 其他 agent 和脚本

任何 agent、脚本、定时任务都可以一行命令留痕：

```bash
node bin/trace-canvas.mjs log "文献对比表完成" \
  --thread "开题报告" --kind agent --agent Codex --link https://example.com/doc
```

不能跑命令的 agent（比如 ChatGPT）可以在回答末尾输出 JSON 行，整段粘贴进页面底部输入框回车即可，或者运行 `trace-canvas import file.jsonl`：

```json
{"thread": "开题报告", "kind": "agent", "title": "第二章提纲完成", "body": "下一步：配图", "agent": "ChatGPT"}
```

## AI 梳理

本机装了 `claude` 命令时，顶栏的 **AI 梳理** 会让 Claude 把收件箱里的记录归到线程、建议线程之间的关联、指出看起来停滞的线程。勾选并点应用之前不会改动任何东西。它用你自己的账号运行 `claude -p`，这次调用不会触发留痕 hooks。

## 命令

```text
页面
  trace-canvas [serve] [--port 4777] [--no-open]   启动并打开页面

记录
  trace-canvas log "标题" [--thread 线程] [--kind 类型] [--body 详情] [--link 链接] [--agent 来源]
  trace-canvas capture [--session ID] [--project 目录] [--thread 线程] [--separate] [--all]
  trace-canvas sessions [--project 目录]           列出某个项目的 Claude Code 会话
  trace-canvas merge <线程>... --into <线程> [--combine]
  trace-canvas import <文件|->                     合并导出文件、另一份 data.json 或 JSON 行

目标和待办
  trace-canvas tasks [--thread 线程] [--all]       每条线的目标和未完成的待办
  trace-canvas done <待办> [--thread 线程] [--agent 来源] [--undo]
                                                   按 id 或标题勾选待办

实时会话
  trace-canvas live                                正在运行的会话：状态、当前动作、所属线
  trace-canvas bind <线程> [--session ID]          把运行中的会话放到某条线上（默认是当前会话）
  trace-canvas bind --unbind [--session ID]        改回按仓库和分支自动归线

安装（--user 对所有项目，--project 目录 只对一个项目）
  trace-canvas setup            hooks + MCP 服务 + skill
  trace-canvas install-hooks | install-mcp | install-skill | uninstall-hooks
  trace-canvas mcp              以 stdio 运行 MCP 服务（由 Claude Code 启动）
  trace-canvas lang <en|zh>     hooks 写入记录的语言
  trace-canvas where            显示数据存放位置
```

## 在线版

同一个页面也作为 claude.ai artifact 运行，数据在 artifact 自己的数据库里：<https://claude.ai/artifact/Y7kykkrWyU4rH31MttYLMj>。本地版和在线版的数据互相独立，可以用「更多 → 导入 / 导出」搬运。

## 实现

![架构图](docs/architecture.zh-CN.svg)

```text
app/index.html        页面。可以连本地服务、claude.ai artifact 数据库或浏览器存储
bin/trace-canvas.mjs  命令行入口
skill/SKILL.md        /trace-canvas skill
src/server.mjs        只监听 127.0.0.1 的本地服务：页面、JSON API、用 SSE 实时推送更新
src/mcp.mjs           MCP 服务（stdio JSON-RPC，无依赖）
src/hook.mjs          Claude Code hook 处理
src/live.mjs          实时会话：每个运行中的会话、每个子 agent 各一个状态文件，由 hooks 写入
src/desktop.mjs       谁启动了谁：读取 Claude 桌面版的会话记录
src/transcript.mjs    读取 Claude Code 会话记录（~/.claude/projects/…/<session>.jsonl）
src/ops.mjs           放入会话、合并线程、合并数据集
src/git-events.mjs    从 shell 命令及其输出里识别提交、推送、合并和 PR
src/store.mjs         数据文件读写，用目录锁防止并行进程互相覆盖
src/install.mjs       添加或移除 hooks、MCP 服务、skill 和权限
src/demo.mjs          中英文示例数据
test/                 node --test 测试（npm test），含会话记录样例
docs/architecture.mjs 生成架构图（中英文两版 SVG）
docs/scenarios/       虚构的场景数据，以及生成场景截图的脚本
```

数据结构（一个 JSON 文件）：

```text
threads/<id>  name, color, status (active | parked | done | merged), parent, forkOf, mergedInto, x, y, note,
              key（repo、repo@branch 或 session:<id>）
commits/<id>  thread（或 "inbox"）, kind (idea | task | agent | decision | note | fork | merge), title, body,
              links[], agent, ts, parents[], done, mergeOf?, session?
edges/<id>    from, to, label
```

服务只监听 127.0.0.1，校验 `Host` 头，所有写操作都要带 `X-Trace-Canvas` 头，所以浏览器里打开的其他网站改不了你的数据。

在这个文件夹里运行 `npm test` 跑测试。

## 许可

MIT，见 [LICENSE](LICENSE)。
