// On-demand real iFlow CLI smoke check. Uses a local model stub and an isolated temporary home.
// Run: node test/smoke-iflow.mjs (requires iflow on PATH, or IFLOW_BIN).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readData} from '../src/store.mjs';
const cli=fileURLToPath(new URL('../bin/trace-canvas.mjs',import.meta.url));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-iflow-real-'));
const repo=path.join(root,'repo'), data=path.join(root,'canvas'), user=path.join(root,'test-user');
fs.mkdirSync(repo);fs.mkdirSync(path.join(user,'.iflow'),{recursive:true});
execFileSync('git',['init','-q','-b','main',repo]);
const wrapper=path.join(root,'hook.mjs');
fs.writeFileSync(wrapper,`import fs from 'node:fs';import {spawnSync} from 'node:child_process';let s='';for await(const c of process.stdin)s+=c;fs.appendFileSync(${JSON.stringify(path.join(root,'events.jsonl'))},JSON.stringify(JSON.parse(s))+'\\n');const r=spawnSync(${JSON.stringify(process.execPath)},[${JSON.stringify(cli)},'hook','--agent','iflow'],{input:s,encoding:'utf8',env:process.env});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status||0);`);
const command=`"${process.execPath}" "${wrapper}"`;
const hooks=Object.fromEntries(['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','Notification','Stop','SessionEnd'].map(k=>[k,[{hooks:[{type:'command',command,timeout:10}]}]]));
let requests=0;
const server=http.createServer(async(req,res)=>{
 let s='';for await(const c of req)s+=c;
 if(req.url.includes('models')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[{id:'tc-test',object:'model'}]}));return;}
 if(!req.url.includes('chat/completions')){res.writeHead(404);res.end('{}');return;}
 requests++;const body=JSON.parse(s);
 if(body.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});for(const delta of [{role:'assistant',content:'TC_IFLOW_OK'},{}])res.write('data: '+JSON.stringify({id:'test',object:'chat.completion.chunk',created:1,model:'tc-test',choices:[{index:0,delta,finish_reason:delta.content?null:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');}
 else {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'test',object:'chat.completion',created:1,model:'tc-test',choices:[{index:0,message:{role:'assistant',content:'TC_IFLOW_OK'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const settings={selectedAuthType:'openai-compatible',apiKey:'test-only-not-a-credential',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,modelName:'tc-test',usageStatisticsEnabled:false,telemetry:{enabled:false},hooks};
fs.writeFileSync(path.join(user,'.iflow/settings.json'),JSON.stringify(settings));
const child=spawn(process.env.IFLOW_BIN || 'iflow',['--default','-p','Reply exactly TC_IFLOW_OK. Do not use tools.','--max-turns','1','--timeout','30','--telemetry=false'],{cwd:repo,env:{...process.env,HOME:user,TRACE_CANVAS_HOME:data,TRACE_CANVAS_MAP:'',TRACE_CANVAS_LANG:'en',TRACE_CANVAS_TURNS:'all',TRACE_CANVAS_THREAD:'',TRACE_CANVAS_DISABLE:'0'}});
let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);
const timer=setTimeout(()=>child.kill('SIGTERM'),45000);
const code=await new Promise(r=>child.once('exit',r));clearTimeout(timer);server.close();
const events=fs.existsSync(path.join(root,'events.jsonl'))?fs.readFileSync(path.join(root,'events.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];
const d=readData({TRACE_CANVAS_HOME:data}),records=Object.values(d.commits);
const summary={root,exit:code,requests,events:events.map(e=>e.hook_event_name),records:records.map(c=>({kind:c.kind,title:c.title,agent:c.agent})),reply:out.includes('TC_IFLOW_OK')};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
if(code!==0||!summary.reply||!events.some(e=>e.hook_event_name==='Stop')||!records.some(c=>c.agent==='iFlow CLI'&&c.title==='TCIFLOWOK')){console.error(err.slice(-2200),out.slice(-700));process.exitCode=1;}
