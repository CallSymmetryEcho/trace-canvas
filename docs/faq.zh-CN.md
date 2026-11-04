# 常见问题

遇到问题先运行 `trace-canvas doctor`，也可以在页面上点「更多 → 检查设置」。它会检查这几项：Node、钩子、页面服务、是否开机自启、版本、同步、手机访问。每个有问题的项都附一句怎么修。

[English](faq.md)

## 安装和启动

**电脑重启后，页面打不开了。**
`trace-canvas serve` 不会自己启动。想让它开机自启，按系统设置：

- **Linux**（systemd 用户服务）
  1. 把下面的内容存为 `~/.config/systemd/user/trace-canvas.service`。
  2. 运行 `systemctl --user enable --now trace-canvas`。
  3. 运行 `loginctl enable-linger $USER`。
  ```ini
  [Unit]
  Description=Trace Canvas
  [Service]
  ExecStart=/node 的完整路径 /trace-canvas 的完整路径/bin/trace-canvas.mjs serve --no-open
  Restart=on-failure
  [Install]
  WantedBy=default.target
  ```
  如果服务在你登录桌面之前就启动了，它拿不到桌面环境，页面上打开终端窗口的按钮会没有反应。登录后重启一次服务就好：`systemctl --user restart trace-canvas`。
- **macOS**（launchd）
  1. 把下面的内容存为 `~/Library/LaunchAgents/trace-canvas.plist`。
  2. 运行 `launchctl load ~/Library/LaunchAgents/trace-canvas.plist`。
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>trace-canvas</string>
    <key>ProgramArguments</key><array>
      <string>/node 的完整路径</string><string>/trace-canvas 的完整路径/bin/trace-canvas.mjs</string><string>serve</string><string>--no-open</string>
    </array>
    <key>RunAtLoad</key><true/>
  </dict></plist>
  ```

**提示「Port 4777 is in use」。**
说明已经有一个页面服务在运行，直接打开 http://localhost:4777/ 就行。`serve` 发现端口被占会直接退出，不会再起第二个。

**需要什么版本的 Node？**
需要 18.17 或更新的版本，推荐 22。
- 终端里的 PATH 有时会先找到一个旧版 `node`，比如旧的 `/usr/local/bin/node`。
- `trace-canvas setup` 会把它运行时所用 Node 的完整路径写进钩子和 `trace-canvas` 命令，所以这两者不受影响。
- 遇到下面两种情况，`doctor` 会提醒你：
  - PATH 里的 `node` 太旧；
  - 钩子用的那个 Node 已经被删掉了。这时重新运行 `trace-canvas setup --user` 即可。

## 更新

**更新了，页面却没有变化。**
可能有两种原因：
- 这次更新只改了网站（`site/`）；
- 新功能还没发布。

`trace-canvas update --check` 会列出有哪些新改动；有更新可拿时，「更多」按钮上会有一个小点。

**更新后，agent 会话还是旧的样子。**
正在运行的 Claude Code 或 Codex 会话，用的还是它启动时的钩子。重新开一个会话，或者恢复（resume）一次，就会用上新版。

**页面服务交给 systemd 管理后，`update` 跟它冲突。**
已修复：现在 `update` 会用 `systemctl` 重启服务。旧版会在终端里另起一个服务，抢走端口。

## 多台电脑

**另一台电脑上的记录没有同步过来。**
- 同步要经过你的位置地图仓库，连不上它，就什么都传不过去。
- 遇到下面两种情况，「更多」上会出现一个小点：
  - 上次同步失败；
  - 别的电脑超过一天没有更新。
- 点开「和其他电脑同步」能看到原因。
- 先在两台电脑上分别确认地图仓库能拉取（`git -C <地图目录> pull`），再同步一次。

**第一次同步后，线的 id 变了。**
同步会给每条线一个在所有电脑上都相同的 id。旧 id 会保留为别名，绑在旧 id 上的会话和文件夹仍然会落到这条线上。

**在另一台电脑上，会话的第一条提示只剩标题，有些文字显示为 `[redacted]`。**
这是有意的设计：提示只同步标题；看起来像 IP 地址或密钥的文字会被打码。

**另一台电脑上的提交，显示「这台电脑上没有这个仓库」。**
页面会按下面的顺序找这个提交：
1. 在本机找同一个仓库的克隆，放在哪个文件夹都行。
2. 本机没有克隆，就通过 ssh 到提交所在的那台电脑上去读。这个功能可以在「更多 → 其他电脑的提交改动」里关掉。
3. 那台电脑也连不上时，页面会写明仓库在哪台电脑上。

## 会话、派发和跳转

**会话过了一夜就从画布上消失了。**
0.3.2 已修复。现在只要会话的进程还在，就算它在运行，不管多久没有动静。

**dispatch 说已经启动了 agent，但什么窗口都没打开（macOS）。**
打开终端窗口需要「自动化」权限，请到「系统设置 → 隐私与安全性 → 自动化」里放行。现在窗口没打开时，dispatch 会如实报告，并给出可以自己运行的命令。

**agent 都开在新窗口里，我想要标签页。**
- macOS：装上 iTerm2（`brew install --cask iterm2`）以后，dispatch 和「在终端打开」会把每个 agent 开在 iTerm2 的新标签页里。
  - `trace-canvas terminal terminal`：改回「终端」新窗口。
  - `trace-canvas terminal iterm`：改用 iTerm2 标签页。
  - 第一次用时，macOS 会问是否允许页面控制 iTerm，点允许即可。
- Linux：Konsole、GNOME Terminal 和 Xfce Terminal 会开新标签页，其他终端开新窗口。

**在 iTerm2 里，命令提示符的符号显示不对。**
agnoster、powerlevel10k 这类主题会画箭头、分支等符号，只有部分字体带这些符号。按下面三步设置：
1. 在「iTerm2 → Settings → Profiles → Text → Font」里，选和你原来终端一样的字体。
2. 在同一页勾选 **Use built-in Powerline glyphs**。如果用的是 powerlevel10k，请选 MesloLGS NF 这类 Nerd Font。
3. 在「Profiles → Other Actions → Set as Default」把这个配置设为默认，这样 agent 新开的标签页也会用它。

**在 Linux 上，dispatch 会自己弹出终端窗口。**
这是它在 Linux 上启动或恢复 agent 的方式（Konsole、GNOME Terminal 和 Xfce Terminal 会开成标签页）。如果只想看它打算做什么，用 `dispatch --print`。

**在项目文件夹里随口问了 agent 一句话，结果成了那个项目线上的一条记录。**
记录落在哪条线上，由所在的文件夹决定。可以在这条记录的详情里把它换到别的线，或者删掉。

## 复盘

**提示「No conversations of this line were found on this machine」。**
复盘只读本机上、在这条线上运行过的会话。请到运行过这条线会话的那台电脑上做复盘。

## 手机

**手机打不开页面。**
- 手机和电脑都要开着 Tailscale。
- 要用 `trace-canvas phone` 打印出来的带密钥的地址；不带密钥，页面会拒绝访问（403）。

详见 [phone.zh-CN.md](phone.zh-CN.md)。

## 历史导入

**`trace-canvas history` 说没有线对应这个仓库。**
手动建的线还没有关联仓库。运行 `trace-canvas history <线> --repo <文件夹>` 关联一下。
