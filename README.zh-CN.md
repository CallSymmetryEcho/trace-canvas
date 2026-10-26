# Trace Canvas 留痕

[English](README.md) | 中文

把 AI agent 办公时零碎的想法和并行的工作，画成一张「地铁线路图」：

- **线程**：一件在推进的事，相当于 git 分支，画成一条线路。
- **记录**：线路上的站点，相当于提交：想法 ○、任务 □、Agent 产出 ◆、决策 ◉、笔记 •。
- 可以从任意记录**分叉**出新线程，做完再**合并**回去，分叉与合并画成换乘站。
- **收件箱**放还没归类的零碎想法。

![时间线视图](docs/timeline-zh.png)

同一份数据，三个视图：

| 视图 | 用途 |
| --- | --- |
| 画布 | 每条线程是一张带迷你线路图的卡片，可拖拽、缩放、画带标签的关联，也可以多选线程一起合并 |
| 分支 | git graph：所有记录按时间排列，每条线程一条泳道，分叉与合并画成曲线 |
| 时间线 | 横向时间轴（日 / 周 / 月），每行一条线程，色带是它活跃的时段 |

页面默认英文，点右上角 **中文 / EN** 切换。

**它能用来做什么？** 用虚构数据演示的三个场景（四个 agent 并行做一个应用、一个研究生的三周、一项分析分散在三个 agent 和两台电脑上），它在 vibe coding 和 AI 协作中的优势，以及还没解决的问题：[docs/why.zh-CN.md](docs/why.zh-CN.md)。

## 在 Mac 上运行

只需要 Node.js 18.17 以上，不用 `npm install`。

```bash
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
| `trace_open` | 必要时启动页面，返回地址 |

## 合并会话与线程

同一件事的多次会话可以并成一条线，有两种方式：

- **合并（merge）**：保留每条来源线路，标为已合并，像 git 一样画出合并到目标的曲线，历史都还看得见。
- **并成一条（combine）**：把所有记录按时间移到目标线程上，删除来源线程，指向它们的关联改为指向目标。

目标可以是已有线程，也可以新建。三个地方都能做：

- **画布上**：Shift+点击卡片（触屏上可以先打开工具栏的「多选」），选目标或输入新名字，点「合并」或「并成一条」。
- **Claude Code 里**：`/trace-canvas merge`，或直接说。
- **命令行**：`trace-canvas merge "问卷 A" "问卷 B" --into "问卷分析" --combine`。

另一台电脑（比如工作站）上的数据用 `trace-canvas import other-data.json` 合并进来。仓库/分支或会话的 key 相同、或名字相同的线程会并成一条，已有的记录会跳过。

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
