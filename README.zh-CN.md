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
| 画布 | 每条线程是一张带迷你线路图的卡片，可拖拽、缩放，线程之间可以画带标签的关联 |
| 分支 | git graph：所有记录按时间排列，每条线程一条泳道，分叉与合并画成曲线 |
| 时间线 | 横向时间轴（日 / 周 / 月），每行一条线程，色带是它活跃的时段 |

页面默认英文，点右上角 **中文 / EN** 切换。

## 在 Mac 上运行

只需要 Node.js 18.17 以上，不用 `npm install`。

```bash
cd graduation-affair
node tools/trace-canvas/bin/trace-canvas.mjs
```

会在 <http://localhost:4777/> 启动本地服务并自动打开浏览器。数据保存在 `~/.trace-canvas/data.json`。空页面上点 **Load example data（载入示例数据）** 可以先看效果，看完在顶栏点「清除」。

可选：加个快捷命令。

```bash
echo "alias trace-canvas='node \"$PWD/tools/trace-canvas/bin/trace-canvas.mjs\"'" >> ~/.zshrc
```

## Claude Code 自动留痕

hooks 会把 Claude Code 会话里的关键节点自动变成记录，不需要你做任何事：

| 时机 | 记下什么 |
| --- | --- |
| 会话的第一条指令 | 一条**任务**，带完整指令 |
| 改动了文件的回合 | **Agent 产出**：Claude 回复的第一句话、改动的文件、完成的待办 |
| `git commit` | **Agent 产出**：`Commit 1a2b3c4: 提交说明` |
| `git push` | **笔记**：`Pushed main` |
| `gh pr create` | **决策**，带 PR 链接 |
| `git merge <分支>` | 当前线程上一条**合并**，被合并的分支线程标为已合并 |
| 会话结束 | **笔记**：时长、指令数、文件数、提交数，以及 `claude --resume <id>` |

记录按「仓库 + 分支」归到线程。在 `main` 上工作记到 `graduation-affair`；切到分支 `lit-review` 时，会从当前位置分叉出新线程 `graduation-affair · lit-review`。这样不同分支上并行的会话会落在不同的线路上。只是回答问题、没有改动文件的回合不记录。

**这个仓库里 hooks 已经开启**：`.claude/settings.json` 里注册好了。拉下这个分支，在仓库里开一个新的 Claude Code 会话，记录就会出现。没装 Node 的机器上 hook 什么也不做。

对这台电脑上的所有项目开启：

```bash
node tools/trace-canvas/bin/trace-canvas.mjs install-hooks --user
```

只对另一个项目开启（写入该项目的 `.claude/settings.local.json`）：

```bash
node tools/trace-canvas/bin/trace-canvas.mjs install-hooks --project ~/code/some-project
```

用同样的参数运行 `uninstall-hooks` 可以移除。配置文件里的其他设置和 hooks 会保留，修改前会先写一份 `.bak`。在多个地方重复安装也没关系，同一个事件只会记一次。

### 调整

写在 `~/.trace-canvas/config.json` 里，或用环境变量：

| 设置 | 环境变量 | 可选值 | 默认 |
| --- | --- | --- | --- |
| `lang` | `TRACE_CANVAS_LANG` | `en`、`zh`：hooks 写入的记录用什么语言 | `en`（在页面上切换语言会一起切换） |
| `group` | `TRACE_CANVAS_GROUP` | `branch`、`repo`、`session`：一条线程代表什么 | `branch` |
| `prompts` | `TRACE_CANVAS_PROMPTS` | `first`、`long`（60 字符以上）、`all`、`none` | `first` |
| `turns` | `TRACE_CANVAS_TURNS` | `changes`（改了文件的回合）、`all`、`none` | `changes` |

`TRACE_CANVAS_DISABLE=1` 可以让某个会话不留痕，`TRACE_CANVAS_HOME` 可以换数据目录。

## 其他 agent 和脚本

任何 agent、脚本、定时任务都可以一行命令留痕：

```bash
node tools/trace-canvas/bin/trace-canvas.mjs log "文献对比表完成" \
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
trace-canvas [serve] [--port 4777] [--no-open]   启动页面
trace-canvas log "标题" [--thread 线程] [--kind 类型] [--body 详情] [--link 链接] [--agent 来源]
trace-canvas import <文件|->                     导入导出文件或 JSON 行
trace-canvas install-hooks [--user | --project 目录]
trace-canvas uninstall-hooks [--user | --project 目录]
trace-canvas lang <en|zh>                        hooks 写入记录的语言
trace-canvas where                               显示数据存放位置
```

## 在线版

同一个页面也作为 claude.ai artifact 运行，数据在 artifact 自己的数据库里：<https://claude.ai/artifact/Y7kykkrWyU4rH31MttYLMj>。本地版和在线版的数据互相独立，可以用「更多 → 导入 / 导出」搬运。

## 实现

```text
app/index.html        页面。可以连本地服务、claude.ai artifact 数据库或浏览器存储
bin/trace-canvas.mjs  命令行入口
src/server.mjs        只监听 127.0.0.1 的本地服务：页面、JSON API、用 SSE 实时推送更新
src/hook.mjs          Claude Code hook 处理
src/store.mjs         数据文件读写，用目录锁防止并行的 hook 进程互相覆盖
src/install.mjs       在 Claude Code 配置文件里添加或移除 hooks
src/demo.mjs          中英文示例数据
test/                 node --test 测试（npm test）
```

数据结构（一个 JSON 文件）：

```text
threads/<id>  name, color, status (active | parked | done | merged), parent, forkOf, mergedInto, x, y, note, key
commits/<id>  thread（或 "inbox"）, kind (idea | task | agent | decision | note | fork | merge), title, body,
              links[], agent, ts, parents[], done, mergeOf?, session?
edges/<id>    from, to, label
```

服务只监听 127.0.0.1，校验 `Host` 头，所有写操作都要带 `X-Trace-Canvas` 头，所以浏览器里打开的其他网站改不了你的数据。

在 `tools/trace-canvas` 目录里运行 `npm test` 跑测试。
