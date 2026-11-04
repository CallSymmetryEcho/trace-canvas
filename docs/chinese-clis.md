# Chinese coding CLIs on the cn-clis branch

Run the setup from this checkout. Only CLIs found on PATH are configured:

```sh
node bin/trace-canvas.mjs setup --user --agents iflow,qwen,qoder,trae,kimi,minimax
```

Setup keeps existing hooks and MCP servers. MiniMax intentionally receives MCP tools only; upgrading an older Trace Canvas plugin removes only Trace Canvas hooks and keeps a backup. It does not enable automatic recording for MiniMax.

## Verification scope (2026-11-04)

| CLI | Integration | Checked here |
| --- | --- | --- |
| iFlow CLI 0.4.11 | Hooks, MCP, live identity, resume, history, Retro | Installed CLI connected to a local OpenAI-compatible test server in an isolated temporary home; prompt, start, stop and end hooks plus final reply recorded. This is not a test of the retired hosted service. |
| Qwen Code | Claude-shaped hooks and settings.json MCP | Official hook schema, payload replay and setup tests; authenticated model session not run. |
| Qoder | Current `qoder` and legacy `qodercli`; hooks and settings.json MCP | Official schema and resume flags, setup/dispatch tests; authenticated model session not run. |
| TRAE CLI | CLI 2 MCP in `~/.trae/traecli.toml`; experimental CLI 1 hooks.json compatibility | Official CLI 2 MCP schema and preservation tests. CLI 2 automatic hooks are not claimed. |
| Kimi Code 2.4.0 | TOML hooks, mcp.json, identity and resume | Payload replay; generated config checked with the installed `kimi doctor config`. Authenticated model session not run. |
| MiniMax Code 0.7.2 | MCP-only local plugin | Installed plugin loader plus MCP protocol and migration tests. Authenticated model session not run. |

The existing experimental DeepSeek Harness bridge remains on this branch; it requires its bridge/MCP plugins and explicit patch at launch.

Claude Code using DeepSeek, Kimi, Qwen, MiniMax, GLM or Doubao retains the Claude Code agent identity for dispatch and shows the provider in its record label. Compatible proxies can identify the model from `ANTHROPIC_MODEL` or the hook model field.

Reproduce the installed-CLI check without a hosted account:

```sh
node test/smoke-iflow.mjs
```

It uses a local model stub, an isolated temporary home and normal approval mode. `IFLOW_BIN` can name a particular installed CLI. The temporary folder is printed so its event log can be inspected.

## Real iFlow findings

The installed CLI reports a transcript path under the project's basename, while it saves under the encoded full directory. Its assistant content blocks can contain `text` with no `type`, and Stop can fire before that reply is persisted. Trace Canvas resolves only the same session filename, reads these text blocks, and completes the pending turn at the next prompt or SessionEnd. A new user message prevents reusing a stale prior reply. Fixtures preserve these real payload shapes with anonymised paths and identifiers.

## Primary references

- [iFlow official retirement notice: 2026-04-17](https://github.com/iflow-ai/iflow-cli/blob/main/README_CN.md)
- [Qwen Code hooks](https://qwenlm.github.io/qwen-code-docs/en/users/features/hooks/)
- [Qoder hooks](https://docs.qoder.com/cli/hooks-reference)
- [Qoder CLI commands](https://docs.qoder.com/cli/cli-reference)
- [TRAE CLI 2 configuration](https://docs.trae.cn/cli_config-file)
- [TRAE CLI commands](https://docs.trae.cn/cli_command-line-parameters)
- [Kimi Code documentation](https://moonshotai.github.io/kimi-code/)

The archived iFlow CLI remains usable with another compatible endpoint, but the official hosted service is closed. Account login or live provider availability is separate from the local integration checks above.
