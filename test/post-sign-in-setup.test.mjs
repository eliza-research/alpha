import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Owner report 2026-10-30: after a verified email code the app held "Checking your code…" and an
// "AI is off" / billing sheet for the agent's whole first boot (about 27 s) before access setup.
// These run the shipped source: setup opens once the account is admitted, the agent restarts behind
// it shown as starting, and the earlier failure rules (P-43, a refused key) still hold.
const ui=readFileSync(new URL('../apps/app/src/runtime/connection-ui.tsx',import.meta.url),'utf8');
const between=(text,start,end)=>{const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from,start);return text.slice(from,to);};
const residentSignedIn=stripTypeScriptTypes(between(ui,'async function residentSignedIn(','/** The key is stored;'),{mode:'transform'});
const showPostSignInSetup=stripTypeScriptTypes(between(ui,'function showPostSignInSetup(','/**\n * A verified sign-in on the resident flow'),{mode:'transform'});
const ISSUED='11111111-1111-4111-8111-111111111111';

function harness({admission={binding:'cloud'},admitted=true,refusedAccount=false,connect}={}){
  // The agent before the sign-in ran without Cloud AI ('unavailable').
  const events=[],state={signIn:{step:'code'},open:true,busy:true,message:'Checking your code…',kind:'starting',purpose:'agent',setupRevision:0,cloudAccount:null,residentPlanNotice:null,residentStarting:false,residentInference:'unavailable'};
  let stored={credentialId:ISSUED};
  const box={state,events,active:null,residentAlwaysPresent:true,cloud:{environment:'production'},
    update:patch=>{Object.assign(state,patch);events.push({update:patch,snapshot:{...state}});},
    retire:()=>{events.push('retire');state.kind='starting';},
    residentEnvironment:()=>'production',cloudServiceName:()=>'Eliza Cloud',
    cloudCredentialStore:{read:async()=>stored,clear:async()=>{events.push('clear key');stored=null;}},
    admitCloudResident:async signal=>{events.push({admit:{...state}});signal.throwIfAborted();if(admitted===true)state.cloudAccount=refusedAccount?null:{userId:'owner'};if(admitted instanceof Error)throw admitted;return admission;},
    connectResident:async(signal,given)=>{events.push({connect:given,during:{...state}});if(connect)await connect(state);},
  };
  vm.createContext(box);vm.runInContext(showPostSignInSetup+'\n'+residentSignedIn+';globalThis.run=residentSignedIn;',box);
  return box;
}
const updates=box=>box.events.filter(event=>event.update).map(event=>event.update);

test('a verified sign-in opens setup as soon as the account is admitted and restarts the agent behind it',async()=>{
  const admission={binding:'cloud',credentialId:ISSUED,account:{}};
  const box=harness({admission});
  await box.run(new AbortController().signal,false);
  const steps=box.events.map(event=>typeof event==='string'?event:event.connect?'connect':event.admit?'admit':'update');
  assert.deepEqual(steps.slice(0,3),['retire','update','admit']);
  // While the account is admitted the verified step says it is signing in: the code check has ended,
  // and the retired agent's binding ("AI is off") is no longer reported.
  const admitting=box.events.find(event=>event.admit).admit;
  assert.deepEqual({signIn:admitting.signIn,message:admitting.message,inference:admitting.residentInference},{signIn:{step:'code'},message:'Signing in…',inference:null});
  const connect=box.events.find(event=>event.connect);
  // The start reuses the admission it was given (no second account read) and runs behind setup.
  assert.equal(connect.connect,admission);
  assert.deepEqual({signIn:connect.during.signIn,open:connect.during.open,starting:connect.during.residentStarting,message:connect.during.message,setup:connect.during.setupRevision,purpose:connect.during.purpose},
    {signIn:null,open:false,starting:true,message:'',setup:1,purpose:'agent'});
  // The operation that ran it (work) ends the starting state together with busy.
  assert.equal(box.state.residentStarting,true);
  assert.equal(box.state.setupRevision,1,'setup is opened once');
  assert.ok(!box.events.includes('clear key'));
});

test('a binding notice from the restart stays within setup instead of opening over it',async()=>{
  const error='AI could not be connected to your Eliza Cloud plan: synthetic. Your agent is running; check your plan again in Settings.';
  const box=harness({connect:async state=>{Object.assign(state,{open:true,purpose:'agent',error});}});
  await box.run(new AbortController().signal,false);
  assert.deepEqual({open:box.state.open,error:box.state.error,setup:box.state.setupRevision},{open:false,error,setup:1});
});

test('an unconfirmed earlier sign-in is reported after the restart',async()=>{
  const box=harness();
  await box.run(new AbortController().signal,true);
  assert.equal(box.state.message,'Signed in. Eliza Cloud did not confirm revoking the sign-in this phone used before.');
});

test('a failed restart after setup recovers once, keeps setup and rethrows for the caller to start it again',async()=>{
  const box=harness({connect:async()=>{throw Error('Local agent failed to start.');}});
  await assert.rejects(box.run(new AbortController().signal,false),/failed to start/);
  assert.equal(box.state.kind,'recovering');
  assert.equal(box.state.setupRevision,1,'a failed start never reopens setup over a walkthrough in progress');
  assert.equal(box.state.signIn,null);
});

test('a key Cloud refused right after issuing it is removed and never opens setup',async()=>{
  const admission={binding:'unbound',notice:{open:true,error:'refused'}};
  const box=harness({admission,refusedAccount:true});
  await box.run(new AbortController().signal,false);
  const connect=box.events.find(event=>event.connect);
  // The agent restarts without Cloud AI first, as before; the sign-in step is left at once.
  assert.equal(connect.connect,admission);assert.equal(connect.during.signIn,null);assert.notEqual(connect.during.residentStarting,true);assert.equal(connect.during.message,'');
  assert.equal(box.events.indexOf('clear key')>box.events.indexOf(connect),true);
  assert.equal(box.state.setupRevision,0);
  assert.deepEqual({open:box.state.open,error:box.state.error},{open:true,error:'Eliza Cloud refused this sign-in. Your agent keeps running; sign in again to turn AI on.'});
});

test('a cancelled admission leaves the sign-in step and the agent to the caller restart (P-43)',async()=>{
  const controller=new AbortController();controller.abort(new DOMException('Cancelled','AbortError'));
  const box=harness({admitted:false});
  // The signal is checked before anything is retired: nothing changes.
  await assert.rejects(box.run(controller.signal,false),/Cancelled/);
  assert.ok(!box.events.includes('retire'));
  const later=harness({admitted:new DOMException('Cancelled','AbortError')});
  await assert.rejects(later.run(new AbortController().signal,false),/Cancelled/);
  assert.equal(later.state.kind,'recovering');assert.equal(later.state.signIn,null);assert.notEqual(later.state.message,'Checking your code…');
  assert.ok(!later.events.some(event=>event.connect));
  assert.ok(!updates(later).some(patch=>patch.residentStarting===true));
});

test('a resident start ends with its operation in one update, so setup behind it never blinks',async()=>{
  const work=stripTypeScriptTypes(between(ui,'async function work(','/** Start (or restart) the resident.'),{mode:'transform'});
  for(const fail of [false,true]){
    const seen=[],state={busy:false,open:false,residentStarting:false,error:'',message:''};
    const box={state,AbortController,active:null,cloud:{},testMocksEnabled:false,
      update:patch=>{Object.assign(state,patch);seen.push({busy:state.busy,starting:state.residentStarting});},
      residentRecoveryReason:()=>null,errorMessage:error=>error.message,expired:()=>false,residentCloudFlow:()=>true,runQueuedResidentRebind:()=>{},runQueuedSignInReturn:()=>{}};
    vm.createContext(box);vm.runInContext('var operation=null,residentStartInBackground=false,signInReadinessOwner=null;\n'+work+';globalThis.run=work;',box);
    await box.run('Starting your agent…',async()=>{box.update({residentStarting:true});await new Promise(resolve=>setTimeout(resolve,5));if(fail)throw Error('Local agent failed to start.');},true);
    const started=seen.findIndex(row=>row.starting);
    assert.ok(started>=0);
    assert.ok(seen.slice(started).every(row=>row.starting||!row.busy),JSON.stringify(seen));
    assert.deepEqual(seen.at(-1),{busy:false,starting:false});
  }
});

test('access setup is not held behind a background resident start, only behind a foreground step',()=>{
  const main=readFileSync(new URL('../apps/app/src/main.tsx',import.meta.url),'utf8');
  const expression=/<StartupPermissions active=\{([^}]*)\} \/>/.exec(main)?.[1];
  assert.ok(expression,'StartupPermissions gate');
  const active=new Function('connection','return '+expression);
  const signedIn={cloudAccount:{userId:'owner'},signIn:null};
  assert.equal(active({...signedIn,busy:true,residentStarting:true}),true,'the agent starting behind setup');
  assert.equal(active({...signedIn,busy:false}),true);
  assert.equal(active({...signedIn,busy:true,residentStarting:false}),false,'a foreground step such as checking a code');
  assert.equal(active({...signedIn,signIn:{step:'code'},busy:false}),false);
  assert.equal(active({cloudAccount:null,signIn:null,busy:false}),false);
});

test('Settings says the agent and its AI are starting instead of "Not available"',()=>{
  const settings=readFileSync(new URL('../apps/app/src/prototype/settings-adapter.ts',import.meta.url),'utf8');
  const line=/const agentRows=\[(info\('Agent'.*?\)),(info\('AI'.*?\))\];/.exec(settings);
  assert.ok(line,'agent connection rows');
  const rows=connection=>new Function('connection','serviceName','info','return ['+line[1]+','+line[2]+']')(connection,'Eliza Cloud',(label,value)=>value);
  assert.deepEqual(rows({session:null,kind:'starting',cloudAccount:{userId:'owner'},residentInference:null}),['Starting…','Starting…']);
  assert.deepEqual(rows({session:{},kind:'resident',cloudAccount:{userId:'owner'},residentInference:'cloud'}),['Running on this device','Eliza Cloud']);
  assert.deepEqual(rows({session:{},kind:'resident',cloudAccount:{userId:'owner'},residentInference:'unavailable'}),['Running on this device','Not available']);
  assert.deepEqual(rows({session:null,kind:'recovering',cloudAccount:{userId:'owner'},residentInference:null}),['Not running','Not available']);
  assert.deepEqual(rows({session:null,kind:'starting',cloudAccount:{userId:'owner'},residentInference:null,residentRecoveryReason:'startup-refused'}),['Needs attention','Not available']);
  assert.deepEqual(rows({session:null,kind:'starting',cloudAccount:null,residentInference:null}),['Starting…','Sign in required']);
});

test('the agent panel shows a calm starting state while a signed-in agent starts',()=>{
  // The agent panel shows a calm starting state, not "AI is off" or plan and billing copy, while it starts.
  const panel=between(ui,'const residentAiStarting=','</section>\n    {!planPanel&&snapshot.replyNotice');
  assert.match(panel,/residentAiStarting\?'Waiting for your agent to start\.'/);
  assert.match(panel,/\{residentAiStarting\?accountCreatedNotice:snapshot\.cloudAccount/);
  assert.match(panel,/\{residentAiStarting\?null:snapshot\.cloudAccount&&!residentSignInRejected \? <>/);
  // A start that failed (the binding was cleared at sign-in) never says the agent still runs.
  assert.match(panel,/:!snapshot\.session&&snapshot\.kind==='recovering'\?'AI is unavailable while your agent is not running\.':'AI connection is not confirmed\. Your agent still runs on this device\.'/);
});
