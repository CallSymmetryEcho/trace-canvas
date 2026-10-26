#!/usr/bin/env node
// Trace Canvas command line. Run `trace-canvas help` for the list of commands.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, dataFile, ensureThread, importText, INBOX, mutate, writeConfig } from '../src/store.mjs';
import { handleHook, readStdin } from '../src/hook.mjs';
import { allowSafeTools, install, installMcp, installSkill, settingsPath, uninstall } from '../src/install.mjs';

const SELF = fileURLToPath(import.meta.url);
const SKILL_DIR = path.join(path.dirname(SELF), '..', 'skill');
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'serve';

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
}
const str = v => (v === true || v == null ? '' : String(v));
function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
function scope() {
  const user = flag('user', false), project = flag('project', null);
  return { user: !!user, project: project === true ? process.cwd() : project };
}

const HELP = `Trace Canvas — a transit map of your work

Page
  trace-canvas [serve] [--port 4777] [--no-open]   Start the local page and open it

Records
  trace-canvas log "title" [--thread name] [--kind agent|idea|task|decision|note]
                   [--body text] [--link url] [--agent name]
  trace-canvas capture [--session id] [--project dir] [--thread name] [--separate] [--all]
                                                   Put a Claude Code session on the canvas
  trace-canvas sessions [--project dir]            List Claude Code sessions of a project
  trace-canvas merge <thread>... --into <thread> [--combine]
                                                   Merge threads (combine folds them into one line)
  trace-canvas import <file|->                     Merge an export, another data.json, or JSON lines

Setup (pass --user for every project, or --project dir for one)
  trace-canvas setup            Hooks + MCP server + /trace-canvas skill
  trace-canvas install-hooks    Automatic traces from Claude Code sessions
  trace-canvas install-mcp      MCP tools: trace_capture_session, trace_merge, …
  trace-canvas install-skill    The /trace-canvas skill
  trace-canvas uninstall-hooks
  trace-canvas mcp              Run the MCP server on stdio (Claude Code starts this)
  trace-canvas lang <en|zh>     Language of records the hooks write
  trace-canvas where            Show where data is stored

Data: ${dataFile()}`;

async function main() {
  switch (cmd) {
    case 'serve': {
      const port = Number(flag('port', process.env.TRACE_CANVAS_PORT || 4777));
      const noOpen = flag('no-open', false);
      const { startServer } = await import('../src/server.mjs');
      try {
        const { url, ai } = await startServer({ port });
        console.log(`Trace Canvas is running at ${url}`);
        console.log(`Data: ${dataFile()}`);
        console.log(ai ? 'AI tidy-up: on (uses your local `claude` CLI)' : 'AI tidy-up: off (install Claude Code to enable it)');
        console.log('Press Ctrl+C to stop.');
        if (!noOpen) openBrowser(url);
      } catch (e) {
        if (e.code === 'EADDRINUSE') {
          console.log(`Port ${port} is in use; Trace Canvas may already be running at http://localhost:${port}/`);
          if (!noOpen) openBrowser(`http://localhost:${port}/`);
        } else throw e;
      }
      break;
    }
    case 'hook': {
      // Never break the Claude Code session: swallow everything, print nothing.
      // TRACE_CANVAS_DEBUG=1 appends each event and its outcome to <data dir>/debug.log.
      let raw = '', outcome;
      try { raw = await readStdin(); if (raw.trim()) outcome = handleHook(JSON.parse(raw)); }
      catch (e) { outcome = { error: String(e && e.stack || e) }; }
      if (process.env.TRACE_CANVAS_DEBUG) {
        try { fs.appendFileSync(path.join(path.dirname(dataFile()), 'debug.log'), `${new Date().toISOString()} ${raw.slice(0, 4000)}\n  -> ${JSON.stringify(outcome ?? 'logged')}\n`); } catch {}
      }
      process.exit(0);
    }
    case 'mcp': {
      const { runMcp } = await import('../src/mcp.mjs');
      runMcp();
      break;
    }
    case 'log': {
      const thread = flag('thread', null), kind = flag('kind', 'agent'), body = flag('body', ''), link = flag('link', null), agent = flag('agent', '');
      const title = argv.join(' ').trim();
      if (!title) { console.error('Usage: trace-canvas log "title" [--thread name] [--kind agent]'); process.exit(1); }
      const c = mutate(d => addCommit(d, { thread: thread && thread !== true ? ensureThread(d, thread) : INBOX, kind: str(kind) || 'agent', title, body: str(body), links: str(link) ? [str(link)] : [], agent: str(agent) }));
      console.log(`Logged ${c.id}`);
      break;
    }
    case 'capture': {
      const { findTranscript, parseTranscript } = await import('../src/transcript.mjs');
      const { captureSession } = await import('../src/ops.mjs');
      const session = str(flag('session', '')), project = str(flag('project', '')) || process.cwd(), thread = str(flag('thread', ''));
      const separate = !!flag('separate', false), all = !!flag('all', false);
      const file = findTranscript({ sessionId: session || undefined, projectDir: project });
      if (!file) { console.error(session ? `No transcript for session ${session}` : `No Claude Code transcripts for ${project}`); process.exit(1); }
      const r = mutate(d => captureSession(d, parseTranscript(file), { sessionId: session || undefined, thread: thread || undefined, separate, detail: all ? 'all' : 'key' }));
      console.log(`Added ${r.added} record${r.added === 1 ? '' : 's'} to "${r.thread.name}"${r.skipped ? ` (${r.skipped} already there)` : ''}`);
      break;
    }
    case 'sessions': {
      const { findTranscripts, describeSession } = await import('../src/transcript.mjs');
      const project = str(flag('project', '')) || process.cwd();
      const files = findTranscripts(project).slice(0, 20);
      if (!files.length) { console.log(`No Claude Code transcripts for ${project}`); break; }
      for (const f of files) {
        const s = describeSession(f.path);
        const when = s.lastActivity ? new Date(s.lastActivity).toISOString().replace('T', ' ').slice(0, 16) : '';
        console.log(`${s.sessionId}  ${when}  ${String(s.prompts).padStart(3)} prompts  ${String(s.filesChanged).padStart(3)} files  ${s.title}`);
      }
      break;
    }
    case 'merge': {
      const { mergeThreads } = await import('../src/ops.mjs');
      const into = str(flag('into', '')), name = str(flag('name', '')), combine = !!flag('combine', false);
      if (!argv.length) { console.error('Usage: trace-canvas merge <thread>... --into <thread> [--combine]'); process.exit(1); }
      const r = mutate(d => mergeThreads(d, { sources: argv, target: into || undefined, newName: name || undefined, mode: combine ? 'combine' : 'merge' }));
      console.log(`${combine ? 'Combined' : 'Merged'} ${r.sources.map(s => `"${s}"`).join(', ')} into "${r.target.name}"`);
      break;
    }
    case 'import': {
      const src = argv[0];
      if (!src) { console.error('Usage: trace-canvas import <file|->'); process.exit(1); }
      const text = src === '-' ? await readStdin() : fs.readFileSync(src, 'utf8');
      let parsed = null;
      try { parsed = JSON.parse(text); } catch {}
      if (parsed && !Array.isArray(parsed) && (parsed.threads || parsed.commits)) {
        const { mergeDataset } = await import('../src/ops.mjs');
        const r = mutate(d => mergeDataset(d, parsed));
        console.log(`Merged ${r.commits} records, ${r.threads} new threads, ${r.edges} links; ${r.unified} threads joined an existing line`);
      } else {
        const n = mutate(d => importText(d, text));
        console.log(`Imported ${n} item${n === 1 ? '' : 's'}`);
      }
      break;
    }
    case 'install-hooks':
    case 'uninstall-hooks': {
      const s = scope();
      const file = settingsPath(s);
      if (cmd === 'install-hooks') { install(file, `node "${SELF}" hook`); console.log(`Hooks added to ${file}`); }
      else console.log(uninstall(file) ? `Hooks removed from ${file}` : `No Trace Canvas hooks in ${file}`);
      break;
    }
    case 'install-mcp': {
      const s = scope();
      const r = installMcp(s, SELF);
      if (r.ok) allowSafeTools(settingsPath(s));
      console.log(r.ok ? `MCP server added: ${r.where}` : `Couldn't add the MCP server (${r.error}).\nRun this yourself:\n  ${r.hint}`);
      break;
    }
    case 'install-skill': {
      console.log(`Skill installed at ${installSkill(scope(), SKILL_DIR)}`);
      break;
    }
    case 'setup': {
      const s = scope();
      if (!s.user && !s.project) { console.error('Usage: trace-canvas setup --user   (or --project <dir>)'); process.exit(1); }
      const file = settingsPath(s);
      install(file, `node "${SELF}" hook`);
      console.log(`1. Hooks added to ${file}`);
      const m = installMcp(s, SELF);
      allowSafeTools(file);
      console.log(m.ok ? `2. MCP server added: ${m.where}` : `2. Couldn't add the MCP server. Run this yourself:\n   ${m.hint}`);
      console.log(`   Capturing, logging and reading run without asking; merging and importing still ask (${file}).`);
      console.log(`3. Skill installed at ${installSkill(s, SKILL_DIR)}`);
      console.log('Start a new Claude Code session, then type /trace-canvas to put it on the canvas.');
      break;
    }
    case 'lang': {
      const lang = argv[0];
      if (lang !== 'en' && lang !== 'zh') { console.error('Usage: trace-canvas lang <en|zh>'); process.exit(1); }
      writeConfig({ lang });
      console.log(`Hooks will write records in ${lang === 'en' ? 'English' : 'Chinese'}`);
      break;
    }
    case 'where': console.log(dataFile()); break;
    case 'help': case '--help': case '-h': console.log(HELP); break;
    default: console.log(HELP); process.exit(1);
  }
}
main().catch(e => { console.error(e.message || e); process.exit(1); });
