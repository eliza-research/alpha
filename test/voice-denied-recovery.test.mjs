import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';
const states=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/runtime/voice-states.ts','utf8'),{mode:'strip'})).toString('base64'));

test('the control the denied-microphone message names exists on the phone',()=>{
 // Found on an API 36 emulator: the recorder named "Open app settings" and offered no such control.
 const denied=states.voiceFailure({code:'permission-denied'},{transcribing:false,browser:false});
 assert.equal(denied.kind,'denied');assert.ok(denied.message.includes(states.DENIED_SETTINGS_LABEL));
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:true}),true);
 // The browser message names the browser's site settings, so no app-settings control is offered there.
 assert.doesNotMatch(states.voiceFailure({name:'NotAllowedError'},{transcribing:false,browser:true}).message,/Open app settings/);
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:false}),false);
 for(const other of [{failure:'',stage:'ready',busy:false,native:true},{failure:'no-speech',stage:'recorded',busy:false,native:true},{failure:'denied',stage:'recording',busy:false,native:true},{failure:'denied',stage:'ready',busy:true,native:true}])
  assert.equal(states.deniedSettingsChoice(other),false,JSON.stringify(other));
});
test('the chat voice sheet offers app settings after a denied microphone and drops it after a granted retry',async t=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});t.after(()=>f.close());
 f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
 const opened=[];f.driver.openSettings=async input=>{opened.push(input.page);};
 let deny=true;
 f.box.BatchVoiceConversation=class{constructor(options){this.options=options;}async start(){if(deny)throw Object.assign(Error('denied'),{code:'permission-denied'});this.options.onState({phase:'listening'});}async stop(){}recheck(){}};
 await f.shell.startVoice();await f.tick();
 const denied=f.renderChat();
 assert.equal(denied.state,'error');assert.equal(denied.recoveryLabel,states.DENIED_SETTINGS_LABEL);
 assert.match(denied.lines[0].t,/^Microphone access is off\. Open app settings to allow it\./);
 denied.recover();await f.tick();assert.deepEqual(opened,['privacy'],'only Android app settings open');
 // Permission granted in settings: the next Talk listens and the settings action is gone.
 deny=false;f.renderChat().stop();await f.shell.stopVoiceConversation();
 await f.shell.startVoice();await f.tick();
 const granted=f.renderChat();assert.equal(granted.state,'listening');assert.notEqual(granted.recoveryLabel,states.DENIED_SETTINGS_LABEL);
});
