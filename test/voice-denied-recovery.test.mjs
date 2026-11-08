import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const states=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(readFileSync('apps/app/src/runtime/voice-states.ts','utf8'),{mode:'transform'})).toString('base64'));
const adapter=readFileSync('apps/app/src/prototype/voice-adapter.ts','utf8'),template=readFileSync('apps/app/src/prototype/template.html','utf8');

test('the control the denied-microphone message names exists on the phone',()=>{
 // Found on an API 36 emulator: the recorder said "Choose Open app settings" and offered no such control.
 const denied=states.voiceFailure({code:'permission-denied'},{transcribing:false,browser:false});
 assert.equal(denied.kind,'denied');assert.ok(denied.message.includes(`Choose ${states.DENIED_SETTINGS_LABEL}`));
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:true}),true);
 // The browser message names the browser's site settings, so no app-settings control is offered there.
 assert.doesNotMatch(states.voiceFailure({name:'NotAllowedError'},{transcribing:false,browser:true}).message,/Open app settings/);
 assert.equal(states.deniedSettingsChoice({failure:'denied',stage:'ready',busy:false,native:false}),false);
 for(const other of [{failure:'',stage:'ready',busy:false,native:true},{failure:'no-speech',stage:'recorded',busy:false,native:true},{failure:'denied',stage:'recording',busy:false,native:true},{failure:'denied',stage:'ready',busy:true,native:true}])
  assert.equal(states.deniedSettingsChoice(other),false,JSON.stringify(other));
});
test('the recorder renders that control and it only opens Android settings for the app',()=>{
 assert.match(adapter,/const settingsChoice = deniedSettingsChoice\(\{ failure, stage, busy, native: Capacitor\.isNativePlatform\(\) \}\);/);
 assert.match(adapter,/routeChoice: settingsChoice \|\| /);
 assert.match(adapter,/routeLabel: settingsChoice \? DENIED_SETTINGS_LABEL : /);
 assert.match(adapter,/changeRoute: \(\) => \{ if \(!owned\(\)\|\|stage !== 'ready' \|\| busy\) return; if \(settingsChoice\) \{ openSettings\(\); return; \}/);
 assert.match(adapter,/const openSettings = \(\) => \{ void appSettings\.openSettings\(\{ page: 'privacy' \}\)/);
 // The old Notes clip recorder that rendered this slot is gone; Notes records with the Notes recorder.
 assert.doesNotMatch(template,/notes\.rec\.routeChoice/);
});
