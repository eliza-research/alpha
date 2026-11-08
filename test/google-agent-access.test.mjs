// The owner's Gmail changes / Calendar edits switches refuse agent writes in the shared Google host
// before any Cloud request; reads keep working and nothing is disconnected. Synthetic transports only.
import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
if(!process.versions.bun&&!process.execArgv.includes('tsx')){const child=spawnSync(process.execPath,['--conditions=eliza-source','--import','tsx',process.argv[1]],{stdio:'inherit',timeout:60000});if(child.error)throw child.error;process.exit(child.status??1);}
const {createManagedGoogleAgentHost}=await import('../backend/managed-google-agent-host.ts');
const credential={credentialReference:'private-reference',credentialId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',organizationId:'33333333-3333-4333-8333-333333333333'};
const send={to:['owner@example.invalid'],subject:'Synthetic',bodyText:'Synthetic body'};
function host(access){
 const calls=[];
 const request=async input=>{calls.push(new URL(input.url).pathname);throw Error('Synthetic transport stops here');};
 return {calls,host:createManagedGoogleAgentHost({agentCredential:async()=>credential,agentRead:request,agentGmailOperation:request,agentCalendarOperation:request},access)};
}
test('switches off refuse every agent write before any Cloud request',async()=>{
 const {calls,host:off}=host(()=>({gmailChanges:false,calendarEdits:false}));
 await assert.rejects(off.prepareSend({...send,requestId:'44444444-4444-4444-8444-444444444444'}),/Gmail changes are turned off in Settings › Google accounts/);
 await assert.rejects(off.dispatchSend({...send,id:'alpha-gmail-send:x',reviewDigest:'a'.repeat(64)}),/Gmail changes are turned off/);
 await assert.rejects(off.mailbox({kind:'archive',messageId:'alpha-gmail:x',requestId:'44444444-4444-4444-8444-444444444444'}),/Gmail changes are turned off/);
 await assert.rejects(off.calendarWrite({operation:'write-capabilities'}),/Calendar edits are turned off in Settings › Google accounts/);
 assert.deepEqual(calls,[],'A refused write never reaches Cloud or Google');
 await assert.rejects(off.list({limit:5}),/Synthetic transport stops here/);
 assert.deepEqual(calls,['/api/v1/user'],'Reads still go to Cloud while changes are off');
});
// The phone's entry never relies on a default: test/native-google-agent-host-access.test.mjs.
test('switches are independent',async()=>{
 const gmailOnly=host(()=>({gmailChanges:true,calendarEdits:false}));
 await assert.rejects(gmailOnly.host.prepareSend({...send,requestId:'44444444-4444-4444-8444-444444444444'}),/Synthetic transport stops here/);
 await assert.rejects(gmailOnly.host.calendarWrite({operation:'write-capabilities'}),/Calendar edits are turned off/);
 assert.deepEqual(gmailOnly.calls,['/api/v1/user'],'Only the allowed Gmail change reached Cloud');
});
async function renderer({native=false,browserLocalAgentEnabled=!native}={}){
 const {transformSync}=await import('esbuild');const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 const state={cached:undefined,initialized:0,posts:[],saves:[],saveFails:false};
 const modules={'../browser/device-preferences':{cachedDevicePreferences:()=>state.cached,initializeDevicePreferences:()=>{state.initialized++;},editDevicePreferences:async edit=>{edit(state.cached);}},'@capacitor/core':{Capacitor:{isNativePlatform:()=>native}},'./local-agent':{browserLocalAgentEnabled,saveNativeGoogleAgentAccess:async access=>{if(state.saveFails)throw Error('Google access could not be saved.');state.saves.push(JSON.parse(JSON.stringify(access)));}}};
 const module={exports:{}};
 vm.runInContext(transformSync(readFileSync('apps/app/src/runtime/google-agent-access.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,vm.createContext({module,exports:module.exports,require:name=>modules[name]??(()=>{throw Error('Unexpected import '+name);})(),fetch:async(path,init)=>{state.posts.push([path,JSON.parse(init.body)]);return {};}}));
 return {access:module.exports,state};
}
test('the renderer never publishes the default over a saved off before settings load',async()=>{
 const {access,state}=await renderer();const posts=state.posts;
 await access.publishGoogleAgentAccess();
 assert.equal(state.initialized,1,'Publishing starts the saved settings load');
 assert.deepEqual(posts,[],'Nothing is published while the saved switches are unknown');
 state.cached={agentGmailChanges:false,agentCalendarEdits:true};
 await access.publishGoogleAgentAccess();
 assert.deepEqual(posts,[['/__alpha-agent-google-access',{gmailChanges:false,calendarEdits:true}]],'The saved off reaches the host once loaded');
 await access.setGoogleAgentAccess({gmailChanges:true});
 assert.deepEqual(posts.at(-1)[1],{gmailChanges:true,calendarEdits:true});
});
test('on the phone the saved switches reach the native Google host, and a failed save fails the toggle',async()=>{
 const {access,state}=await renderer({native:true});
 await access.publishGoogleAgentAccess();
 assert.deepEqual(state.saves,[],'Nothing is saved while the saved switches are unknown');
 state.cached={agentGmailChanges:true,agentCalendarEdits:false};
 await access.publishGoogleAgentAccess();
 assert.deepEqual(state.saves,[{gmailChanges:true,calendarEdits:false}]);
 await access.setGoogleAgentAccess({calendarEdits:true});
 assert.deepEqual(state.saves.at(-1),{gmailChanges:true,calendarEdits:true});
 state.saveFails=true;
 await assert.rejects(access.setGoogleAgentAccess({gmailChanges:false}),/could not be saved/,'Settings reports the switch as not saved');
 assert.deepEqual({gmailChanges:state.cached.agentGmailChanges,calendarEdits:state.cached.agentCalendarEdits},state.saves.at(-1),'Settings goes back to what the host still enforces');
 assert.deepEqual(state.posts,[],'The phone never uses the development host route');
});
