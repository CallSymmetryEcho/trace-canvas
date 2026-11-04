# Common questions

Run `trace-canvas doctor` first (or **More → Check setup** on the page). It checks Node, the hooks, the page server, whether it starts with the computer, the version, sync and phone access, and prints one line on how to fix each problem.

[中文](faq.zh-CN.md)

## Installing and starting

**The page is gone after I restart the computer.**
`trace-canvas serve` does not start by itself. To start it with the computer:

- **Linux** (systemd user service): save as `~/.config/systemd/user/trace-canvas.service`, then `systemctl --user enable --now trace-canvas` and `loginctl enable-linger $USER`.
  ```ini
  [Unit]
  Description=Trace Canvas
  [Service]
  ExecStart=/full/path/to/node /full/path/to/trace-canvas/bin/trace-canvas.mjs serve --no-open
  Restart=on-failure
  [Install]
  WantedBy=default.target
  ```
  A service started before you log in has no desktop, so buttons that open a terminal window do nothing until it is restarted after login (`systemctl --user restart trace-canvas`).
- **macOS** (launchd): save as `~/Library/LaunchAgents/trace-canvas.plist`, then `launchctl load ~/Library/LaunchAgents/trace-canvas.plist`.
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0"><dict>
    <key>Label</key><string>trace-canvas</string>
    <key>ProgramArguments</key><array>
      <string>/full/path/to/node</string><string>/full/path/to/trace-canvas/bin/trace-canvas.mjs</string><string>serve</string><string>--no-open</string>
    </array>
    <key>RunAtLoad</key><true/>
  </dict></plist>
  ```

**"Port 4777 is in use".**
Another page server is already running; open http://localhost:4777/. `serve` exits instead of starting a second one.

**Which Node do I need?**
18.17 or newer (22 recommended). A terminal can find an older `node` first on PATH (for example an old `/usr/local/bin/node`). `trace-canvas setup` writes the full path of the Node it ran with into the hooks and the `trace-canvas` command, so they keep working; `doctor` warns when the `node` on PATH is older, and when the Node the hooks use has been removed (run `trace-canvas setup --user` again).

## Updating

**I updated but the page looks the same.**
The update may only have touched the website (`site/`), or the new feature is not released yet. `trace-canvas update --check` lists what is new; **More** shows a dot when there is something to get.

**After updating, my agent sessions still behave the old way.**
A running Claude Code or Codex session keeps the hooks it started with. Start it again (or resume it) to use the new version.

**The page server is a systemd service and `update` fought with it.**
Fixed: `update` now restarts the service with `systemctl`. Older versions started a second server from the terminal.

## Several machines

**Records from my other machine are missing.**
Sync goes through your location map repository; if it cannot be reached, nothing travels. **More** gets a dot when the last sync failed or another machine has not updated in over a day; open **Sync with other machines** to see why. Check that the map repository can be pulled on both machines (`git -C <map> pull`), then sync.

**Line ids changed after my first sync.**
Lines get ids that are the same on every machine. The old id stays as an alias, so sessions and folders bound to it still land on the line.

**On the other machine a session's first prompt shows only its title, and some text reads `[redacted]`.**
By design: prompts travel as titles only, and text that looks like an IP address or a key is masked.

**A commit from another machine says the repository is not on this computer.**
The page looks for a clone of the same repository on this machine, in any folder. Without one it reads the change on the machine it was made on, over ssh (turn this off in **More → Other machines' changes**); when that machine cannot be reached it says which one has it.

## Sessions, dispatch, jumping

**A session disappeared from the canvas overnight.**
Fixed in 0.3.2: a session counts as running while its process runs, however long it is quiet.

**Dispatch said it started an agent, but nothing opened (macOS).**
Opening a Terminal window needs Automation permission. Allow it in **System Settings → Privacy & Security → Automation**; dispatch now says when the window did not open and prints the command to run yourself.

**Agents open in new windows; I want tabs.**
On macOS, install iTerm2 (`brew install --cask iterm2`): with it installed, dispatch and **Open in Terminal** open each agent in a new iTerm2 tab. `trace-canvas terminal terminal` goes back to Terminal windows, `trace-canvas terminal iterm` to iTerm2 tabs. The first time, macOS asks whether the page may control iTerm: allow it. On Linux, Konsole, GNOME Terminal and Xfce Terminal open tabs; other terminals open windows.

**The symbols in my prompt look broken in iTerm2.**
Prompt themes such as agnoster or powerlevel10k draw arrows and branch marks that only some fonts have. Use the same font as in your other terminal (iTerm2 → Settings → Profiles → Text → Font), and turn on **Use built-in Powerline glyphs** in the same place; for powerlevel10k, pick a Nerd Font such as MesloLGS NF. Set that profile as the default (Profiles → Other Actions → Set as Default) so new agent tabs use it too.

**On Linux, dispatch opens a terminal window by itself.**
That is how it starts or resumes an agent there (a tab in Konsole, GNOME Terminal and Xfce Terminal). `dispatch --print` only shows what it would do.

**A question I asked an agent in a project folder became a record on that project's line.**
The folder decides the line. Move the record to another line in its panel, or delete it.

## Retro

**"No conversations of this line were found on this machine".**
Retro reads the conversations that ran on this line, on this machine. Run it on the machine where the line's sessions ran.

## Phone

**The phone cannot open the page.**
Tailscale must be running on both. Use the address `trace-canvas phone` prints, with its key: without the key the page refuses (403). See [phone.md](phone.md).

## History

**`trace-canvas history` says no line stands for this repository.**
A line made by hand is not tied to a repository yet: `trace-canvas history <line> --repo <folder>`.
