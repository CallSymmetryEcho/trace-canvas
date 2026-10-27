# 在手机上用 Trace Canvas

*这个功能只在 `phone` 分支上。* 它把画布开放给你的手机：离开电脑时也能看各条线的进展，往线里放想法，并让 agent 去读某条线。agent 照样在电脑上跑，手机只是同一张画布的另一个窗口。

## 前提

- 电脑上开着 Trace Canvas（`node bin/trace-canvas.mjs`）。
- 电脑和手机都装了 [Tailscale](https://tailscale.com)，并登录同一个账号。两者之间的流量走 Tailscale 的加密隧道，所以不会向公网开放，也不需要证书。

## 打开

```bash
node bin/trace-canvas.mjs phone
```

这条命令会：
- 找到这台电脑在 Tailscale 上的地址；
- 生成一个密钥；
- 在终端里打印手机用的地址和二维码，并把它们存进 `~/.trace-canvas/config.json`。

然后重启页面（`node bin/trace-canvas.mjs`），它就会多监听这台电脑的 Tailscale 地址，但绝不会监听所有网络。页面上**更多 → 在手机上打开**会显示同一个二维码，用手机相机扫一下就行。

第一次用带密钥的地址打开时，手机上会存一个 cookie，之后用不带密钥的地址也能打开。不是从电脑本机发出的请求都必须带这个密钥。另外，有几件事只能在电脑上做：打开终端、和其他电脑同步、AI 整理、载入示例数据。

- `trace-canvas phone --rotate`：换一个新密钥（要重新扫码，旧的作废）。
- `trace-canvas phone --off`：关闭手机访问，然后重启页面。

## 在手机上能做什么

- **看：** 画布、每条线的记录、目标和待办，以及分支视图、时间线，和电脑上一样。
- **加想法：** 用底部的输入框。选一条线和类型（想法、待办……），或者直接以 `#线名` 开头，就会归到那条线上。
- **让 agent 去读一条线：** 打开那条线，点**给 agent 的提示**，会复制一段提示：让 agent 用 `trace_read_thread` 和 `trace_tasks` 读这条线，接着做未完成的待办，做完勾掉。把它粘贴给某个会话，比如你在手机 Claude app 里通过 Remote Control 操作的那个。

## 在手机上开工（macOS）

一条线上没有会话在跑时，点 **▶ 开始** 就会开一个。这个按钮在线面板上，也在**目标**里每一项待办旁边。它默认关闭，要先打开：

```bash
node bin/trace-canvas.mjs phone --allow-start
```

点它会在 Mac 上打开一个终端窗口。窗口进入这条线的文件夹，运行 Claude Code，开着 Remote Control，名字就是线名：

```bash
claude --remote-control='<线名>' '<提示>'
```

提示会让它先读这条线，包括你在线上记下的想法，然后按目标和未完成的待办往下做，每做完一项就勾掉。从某一项待办点开始，它会先做那一项。稍等片刻，这个会话会出现在 Claude app 里。你在 app 里跟进它，照常批准它要用的工具：这个按钮不会放宽任何权限。

- **线上已经有会话在跑：** 按钮不会再开第二个，而是指向正在跑的那个，你在 Claude app 里给它发消息就行。
- **手机只发线或待办的 id。** 命令在 Mac 上根据画布数据生成，线名和提示都做了转义。
- **局限：**
  - Mac 要开着、已登录，因为会话跑在终端窗口里。
  - `claude` 命令要已经登录（运行一次 `claude`，然后输入 `/login`）。
  - 这条线的文件夹要已经在 Claude Code 里信任过；新文件夹会先在 Mac 上询问。
  - 只有 Claude Code 有 Remote Control。
- `trace-canvas phone --deny-start` 可以再关掉它。

## 自己指定地址（不推荐）

没有 Tailscale 时，也可以自己指定地址：

```bash
node bin/trace-canvas.mjs phone --host <域名或 IP> --bind <这台电脑上监听的地址>
```

`--bind 0.0.0.0` 会监听所有网络。这是明文 HTTP：任何能访问这个地址、又看到了密钥的人，都能读取和修改你的画布。只建议放在 VPN 或带 TLS 的反向代理后面使用。
