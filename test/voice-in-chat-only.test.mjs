import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('holding the side key never opens the microphone while the chat mic still works',()=>{
 const policy=read('apps/app/src/runtime/voice-entry-policy.ts');
 assert.match(policy,/externalVoiceInvocationEnabled = false/);
 const source=read('apps/app/src/prototype/model.js');
 const down=source.match(/pDown: (function \(e\) \{[^\n]+\}),\n\s+pUp:/)?.[1];
 const chat=source.match(/startVoice: (function \(\) \{ self\.startVoice\(\); \})/)?.[1];
 assert.ok(down&&chat,'exercise actual side-key and chat callbacks');
 let microphones=0,next=0;
 const timers=new Map();
 const self={pLong:false,pT:undefined,startVoice(){microphones++;}};
 const context={self,externalVoiceInvocationEnabled:false,setTimeout(fn,delay){const id=++next;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}};
 const press=vm.runInNewContext('('+down+')',context);
 press({stopPropagation(){}});
 for(const {fn} of [...timers.values()].filter(timer=>timer.delay<=2000))fn();
 assert.equal(microphones,0,'holding beyond the old 550ms threshold must not start voice');
 vm.runInNewContext('('+chat+')',context)();
 assert.equal(microphones,1,'the in-chat microphone remains callable');
 const template=read('apps/app/src/prototype/template.html');
 assert.doesNotMatch(template,/hold to talk/);
 // The lock-screen talk button now lives in the development-only system surfaces, which flag-off
 // bundles drop; the product template has none, and every remaining one stays behind the gate.
 assert.doesNotMatch(template,/aria-label="Talk to/);
 const surfaces=read('apps/app/src/prototype/development-system-surfaces.html')+read('apps/app/src/prototype/development-rail.html');
 const talk=[...surfaces.matchAll(/aria-label="Talk to/g)],gated=[...surfaces.matchAll(/<sc-if value="\{\{externalVoiceInvocation\}\}"><button aria-label="Talk to/g)];
 assert.ok(gated.length>0&&gated.length===talk.length,'every talk button stays behind the external voice gate');
 assert.match(read('apps/app/src/prototype/template-source.ts'),/'<!-- alpha-development-system-surfaces -->', testMocksEnabled \? developmentSystemSurfaces : ''/);
 assert.match(read('apps/app/src/main.tsx'),/if \(externalVoiceInvocationEnabled && isAndroid && assistantSurface\) installListenerInvocation/);
 assert.match(read('apps/app/src/runtime/always-on-listener.ts'),/if\(!externalVoiceInvocationEnabled \|\| !nativeListener\(\)\)return/);
 for(const name of ['AlphaAssistActivity','AlphaPowerVoiceActivity'])assert.match(read('android/app/src/main/AndroidManifest.xml'),new RegExp('<activity android:name="\\.'+name+'" android:enabled="false" android:exported="false"'));
});


test('in-chat-only startup requests the canonical native listener stop and reports uncertainty',async()=>{
 const source=read('apps/app/src/runtime/always-on-listener.ts');
 const start=source.indexOf('export async function stopWakeListenerForChatOnly()');
 const end=source.indexOf('\n}\n',start)+2;
 assert.ok(start>=0&&end>start);
 const code=stripTypeScriptTypes(source.slice(start,end).replace('export ',''));
 for(const result of [{available:true,state:'OFF',listening:false,microphoneOpen:false},{available:true,state:'LISTENING',listening:true,microphoneOpen:true},{available:false},new Error('unavailable')]){
  let stops=0;
  const context=vm.createContext({Capacitor:{isNativePlatform:()=>true},externalVoiceInvocationEnabled:false,nativeListener:()=>true,parseListenerStatus:value=>value,listener:{turnOff:async()=>{stops++;if(result instanceof Error)throw result;return result;}},wakeStopUnconfirmed:false,Promise,Error,setTimeout,clearTimeout});
  const stop=vm.runInContext(code+'\nstopWakeListenerForChatOnly;',context);
  const confirmed=await stop();
  assert.equal(stops,1,'startup must request turnOff, not only hide the controls');
  const expected=!(result instanceof Error)&&result.available===true&&result.state==='OFF';
  assert.equal(confirmed,expected);
  assert.equal(context.wakeStopUnconfirmed,!expected);
 }
 for(const native of [true,false]){
  let stops=0;
  const context=vm.createContext({Capacitor:{isNativePlatform:()=>native},externalVoiceInvocationEnabled:false,nativeListener:()=>false,parseListenerStatus:value=>value,listener:{turnOff:async()=>{stops++;throw Error('must not call missing bridge');}},wakeStopUnconfirmed:false,Promise,Error,setTimeout,clearTimeout});
  const stop=vm.runInContext(code+'\nstopWakeListenerForChatOnly;',context);
  assert.equal(await stop(),!native,'missing Android bridge cannot confirm the companion stopped');
  assert.equal(context.wakeStopUnconfirmed,native);
  assert.equal(stops,0);
 }
 assert.match(read('apps/app/src/main.tsx'),/if \(isAndroid && !externalVoiceInvocationEnabled\) void stopWakeListenerForChatOnly\(\)/);
 assert.match(read('apps/app/src/prototype/settings-adapter.ts'),/wakeListeningStopUnconfirmed\(\)/);
});

test('no enabled component opens the dormant assistant entries',()=>{
 const sources={},java='android/app/src/main/java/ai/alphacompute/alphaphone/';
 for(const entry of readdirSync(new URL('../'+java,import.meta.url)))if(entry.endsWith('.java'))sources[entry.slice(0,-5)]=read(java+entry);
 const dormant=['AlphaAssistActivity','AlphaPowerVoiceActivity'];
 for(const flavor of ['launcher','standalone']){
  const merged={};
  for(const manifest of ['main',flavor])for(const [,attrs] of read(`android/app/src/${manifest}/AndroidManifest.xml`).matchAll(/<(?:activity|activity-alias|service|receiver|provider)\s([^>]*)>/g)){
   const name=attrs.match(/android:name="\.?([^"]+)"/)[1].replace(/^ai\.alphacompute\.alphaphone\./,'');
   merged[name]={...merged[name],...Object.fromEntries([...attrs.matchAll(/([\w:]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]))};
  }
  const openers=Object.keys(merged).filter(name=>!dormant.includes(name)&&dormant.some(target=>sources[name]?.includes(target)));
  assert.ok(openers.includes('AlphaQuickSettingsTile'),'the tile still targets the assistant entry');
  for(const name of openers)assert.equal(merged[name]['android:enabled'],'false',`${flavor}: ${name} opens a dormant assistant entry (P-78)`);
 }
});
