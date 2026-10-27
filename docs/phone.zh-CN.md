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

## 自己指定地址（不推荐）

没有 Tailscale 时，也可以自己指定地址：

```bash
node bin/trace-canvas.mjs phone --host <域名或 IP> --bind <这台电脑上监听的地址>
```

`--bind 0.0.0.0` 会监听所有网络。这是明文 HTTP：任何能访问这个地址、又看到了密钥的人，都能读取和修改你的画布。只建议放在 VPN 或带 TLS 的反向代理后面使用。
