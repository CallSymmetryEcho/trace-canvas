# Trace Canvas on your phone

*This lives on the `phone` branch only.* It opens your canvas to your phone, so you can read your lines away from the desk, drop ideas into them, and send an agent to read a line. Your agents keep running on the computer; the phone is a window onto the same canvas.

## What you need

- Trace Canvas running on the computer (`node bin/trace-canvas.mjs`).
- [Tailscale](https://tailscale.com) on the computer and on the phone, signed in to the same account. Traffic between them goes through Tailscale's encrypted tunnel, so nothing is opened to the internet and no certificates are needed.

## Turn it on

```bash
node bin/trace-canvas.mjs phone
```

This finds this computer on Tailscale, makes a key, prints the phone address with a QR code in the terminal, and keeps both in `~/.trace-canvas/config.json`. Restart the page (`node bin/trace-canvas.mjs`) so it also listens on the computer's Tailscale address, never on every network. **More → Open on your phone** on the page shows the same QR code. Scan it with the phone camera.

The first visit with the key sets a cookie on the phone; after that the plain address works. Anything that does not come from the computer itself needs that key, and a few things stay on the computer: opening a terminal, syncing with other machines, AI tidy-up and loading example data.

- `trace-canvas phone --rotate` makes a new key (scan the new code; the old one stops working).
- `trace-canvas phone --off` turns phone access off; restart the page.

## On the phone

- **Read:** the canvas, a line's records and its goal and to-dos, the branches and the timeline, as on the computer.
- **Add ideas:** the box at the bottom. Pick a line and a kind (idea, to-do, …), or start with `#line name` to file it on that line.
- **Send an agent to a line:** open the line and press **Prompt for an agent**. It copies a prompt that tells an agent to read the line with `trace_read_thread` and `trace_tasks`, carry on with its open to-dos and tick them off. Paste it to a session, for example one you drive from the Claude app on the phone through Remote Control.

## Your own address (not recommended)

Without Tailscale you can give an address yourself:

```bash
node bin/trace-canvas.mjs phone --host <name or IP> --bind <address on this computer>
```

`--bind 0.0.0.0` listens on every network. This is plain HTTP: anyone who can reach the address and sees the key can read and change your canvas. Use it only behind a VPN or a reverse proxy with TLS.
