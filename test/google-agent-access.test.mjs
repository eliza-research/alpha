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
test('switches are independent and default on',async()=>{
 const gmailOnly=host(()=>({gmailChanges:true,calendarEdits:false}));
 await assert.rejects(gmailOnly.host.prepareSend({...send,requestId:'44444444-4444-4444-8444-444444444444'}),/Synthetic transport stops here/);
 await assert.rejects(gmailOnly.host.calendarWrite({operation:'write-capabilities'}),/Calendar edits are turned off/);
 const defaults=host(undefined);
 await assert.rejects(defaults.host.mailbox({kind:'archive',messageId:'alpha-gmail:x',requestId:'44444444-4444-4444-8444-444444444444'}),/Synthetic transport stops here/);
 assert.deepEqual(defaults.calls,['/api/v1/user'],'With no owner switch source the host keeps its existing behavior');
});
test('the renderer never publishes the default over a saved off before settings load',async()=>{
 const {transformSync}=await import('esbuild');const {readFileSync}=await import('node:fs');const vm=await import('node:vm');
 let cached,initialized=0;const posts=[];
 const modules={'../browser/device-preferences':{cachedDevicePreferences:()=>cached,initializeDevicePreferences:()=>{initialized++;},editDevicePreferences:async edit=>{edit(cached);}},'./local-agent':{browserLocalAgentEnabled:true}};
 const module={exports:{}};
 vm.runInContext(transformSync(readFileSync('apps/app/src/runtime/google-agent-access.ts','utf8'),{loader:'ts',format:'cjs',target:'es2022'}).code,vm.createContext({module,exports:module.exports,require:name=>modules[name]??(()=>{throw Error('Unexpected import '+name);})(),fetch:async(path,init)=>{posts.push([path,JSON.parse(init.body)]);return {};}}));
 const access=module.exports;
 await access.publishGoogleAgentAccess();
 assert.equal(initialized,1,'Publishing starts the saved settings load');
 assert.deepEqual(posts,[],'Nothing is published while the saved switches are unknown');
 cached={agentGmailChanges:false,agentCalendarEdits:true};
 await access.publishGoogleAgentAccess();
 assert.deepEqual(posts,[['/__alpha-agent-google-access',{gmailChanges:false,calendarEdits:true}]],'The saved off reaches the host once loaded');
 await access.setGoogleAgentAccess({gmailChanges:true});
 assert.deepEqual(posts.at(-1)[1],{gmailChanges:true,calendarEdits:true});
});
