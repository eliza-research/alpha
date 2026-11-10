import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {parseNativeHistoryCommand} from '../.eliza/client-features/plugins/plugin-browser/src/native-client-command.ts';
import {BROWSER_DISPATCH_FAILURE_KINDS} from '../vendor/eliza/plugins/plugin-browser/src/dispatch-types.ts';

// Runs the mounted browser's real command handler and the agent's view executor
// against stub tab state, so a refusal before Browser.command is typed and nothing dispatches.
const browser=fs.readFileSync('apps/app/src/prototype/browser-adapter.ts','utf8'),agent=fs.readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
const ts=s=>stripTypeScriptTypes(s,{mode:'strip'});
const commandStart=browser.indexOf('    this.browserCommand = async');
const commandCode=ts(browser.slice(commandStart,browser.indexOf('    this.browserNavigateApproved =',commandStart)));
const executorStart=agent.indexOf('    connectionController.setViewInteractionExecutor(');
const executorCode=ts(agent.slice(executorStart,agent.indexOf('\n    });',executorStart)+8));

function harness({command=async()=>({session:'native-session',id:'tab'}),view='browser',committed=true,canBack=true,canForward=true}={}){
 const calls=[],shell={S:()=>({view,shade:false})},tabState={cur:'tab'},info={committed,canBack,canForward,url:'https://browser-fixture.invalid/',error:'',loading:false,navigation:'n1'};
 const host={};
 new Function('parseNativeHistoryCommand','state','tabInfo','tabs','disposed','Capacitor','document','shell','Browser','session',commandCode).call(host,
  parseNativeHistoryCommand,()=>tabState,()=>info,{has:id=>id==='tab'},false,{isNativePlatform:()=>true},{hidden:false},shell,
  {command:async input=>{calls.push(input);return command(input);}},'native-session');
 return {calls,run:raw=>host.browserCommand(raw,new AbortController().signal,()=>{})};
}

test('an unsupported command returns UNSUPPORTED and never dispatches',async()=>{
 const h=harness();
 for(const raw of [{subaction:'click'},{subaction:'back',tabId:'server-tab'},null]){
  const result=await h.run(raw);
  assert.equal(result.ok,false);assert.equal(result.code,'UNSUPPORTED');assert.equal(typeof result.message,'string');
 }
 assert.equal(h.calls.length,0);
});

test('a changed or unready browser tab returns UNAVAILABLE and never dispatches',async()=>{
 for(const options of [{view:'notes'},{committed:false}]){
  const h=harness(options),result=await h.run({subaction:'back'});
  assert.deepEqual([result.ok,result.code],[false,'UNAVAILABLE']);assert.equal(h.calls.length,0);
 }
});

test('history commands refuse unavailable directions before native dispatch',async()=>{
 for(const [subaction,options] of [['back',{canBack:false}],['forward',{canForward:false}]]){
  const h=harness(options),result=await h.run({subaction});
  assert.equal(result.code,'UNAVAILABLE');assert.equal(h.calls.length,0);
 }
});

test('refusal codes are typed dispatch failures the agent decodes',()=>{
 for(const code of ['UNSUPPORTED','UNAVAILABLE'])assert.ok(BROWSER_DISPATCH_FAILURE_KINDS.includes(code));
});

test('a Browser.command failure still throws because its outcome is unknown',async()=>{
 const h=harness({command:async()=>{throw Error('bridge lost');}});
 await assert.rejects(h.run({subaction:'back'}),/bridge lost/);assert.equal(h.calls.length,1);
});

test('a supported command dispatches once and asks for readback',async()=>{
 const h=harness(),result=await h.run({subaction:'back'});
 assert.deepEqual(result,{ok:true,data:{dispatched:true,completed:false,requiresReadback:true}});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].command,'back');
});

test('the view executor refuses a browser command without a live browser as UNAVAILABLE',async()=>{
 let executor;
 const run=self=>new Function('connectionController',executorCode).call(self,{setViewInteractionExecutor:fn=>executor=fn});
 for(const self of [{live:false,browserCommand:async()=>assert.fail('dispatched')},{live:true}]){
  run(self);const result=await executor('browser','browser-command',{command:{subaction:'back'}},new AbortController().signal,()=>{});
  assert.deepEqual(result,{ok:false,code:'UNAVAILABLE',message:'Native view capability is unavailable'});
 }
 run({live:true,browserCommand:async()=>assert.fail('dispatched')});
 await assert.rejects(executor('notes','browser-command',{},new AbortController().signal,()=>{}),/Native view capability is unavailable/);
});
