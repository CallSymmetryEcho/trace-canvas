#!/usr/bin/env node
// Trace Canvas command line.
//   trace-canvas [serve] [--port 4777] [--no-open]   open the page
//   trace-canvas hook                                 Claude Code hook entry (reads JSON on stdin)
//   trace-canvas log <title> [--thread T] [--kind K] [--body B] [--link URL] [--agent A]
//   trace-canvas import <file.json|->                 import an export or agent JSON lines
//   trace-canvas install-hooks [--user | --project DIR]
//   trace-canvas uninstall-hooks [--user | --project DIR]
//   trace-canvas lang <en|zh>                         language for records the hooks write
//   trace-canvas where                                print the data file location
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addCommit, dataFile, ensureThread, importText, INBOX, mutate, writeConfig } from '../src/store.mjs';
import { handleHook, readStdin } from '../src/hook.mjs';
import { install, settingsPath, uninstall } from '../src/install.mjs';

const SELF = fileURLToPath(import.meta.url);
const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'serve';

function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : true;
}
function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}

const HELP = `Trace Canvas — a transit map of your work

Usage
  trace-canvas [serve] [--port 4777] [--no-open]   Start the local page and open it
  trace-canvas log "title" [--thread name] [--kind agent|idea|task|decision|note]
                   [--body text] [--link url] [--agent name]
  trace-canvas import <file|->                     Import an export or JSON lines
  trace-canvas install-hooks [--user | --project dir]
  trace-canvas uninstall-hooks [--user | --project dir]
  trace-canvas lang <en|zh>                        Language of records the hooks write
  trace-canvas where                               Show where data is stored

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
    case 'log': {
      const thread = flag('thread', null), kind = flag('kind', 'agent'), body = flag('body', ''), link = flag('link', null), agent = flag('agent', '');
      const title = argv.join(' ').trim();
      if (!title) { console.error('Usage: trace-canvas log "title" [--thread name] [--kind agent]'); process.exit(1); }
      const c = mutate(d => addCommit(d, { thread: thread ? ensureThread(d, thread) : INBOX, kind, title, body: body === true ? '' : body, links: link && link !== true ? [link] : [], agent: agent === true ? '' : agent }));
      console.log(`Logged ${c.id}`);
      break;
    }
    case 'import': {
      const src = argv[0];
      if (!src) { console.error('Usage: trace-canvas import <file|->'); process.exit(1); }
      const text = src === '-' ? await readStdin() : fs.readFileSync(src, 'utf8');
      const n = mutate(d => importText(d, text));
      console.log(`Imported ${n} item${n === 1 ? '' : 's'}`);
      break;
    }
    case 'install-hooks':
    case 'uninstall-hooks': {
      const user = flag('user', false), project = flag('project', null);
      const file = settingsPath({ user, project: project === true ? null : project });
      if (cmd === 'install-hooks') {
        install(file, `node "${SELF}" hook`);
        console.log(`Hooks added to ${file}`);
        console.log('Start a new Claude Code session to pick them up.');
      } else {
        console.log(uninstall(file) ? `Hooks removed from ${file}` : `No Trace Canvas hooks in ${file}`);
      }
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
