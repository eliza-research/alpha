import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
const states=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/runtime/voice-states.ts','utf8'),{mode:'transform'})).toString('base64'));

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
