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
 assert.match(template,/<sc-if value="\{\{externalVoiceInvocation\}\}"><button aria-label="Talk to/);
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
 const {stopSenseListenerForChatOnly}=await import('../vendor/eliza/plugins/plugin-native-system/src/sense.ts');
 const cases=[
  [{available:true,state:'OFF',listening:false,microphoneOpen:false},true],
  [{available:false,reason:'not-installed'},true],
  [{available:false,reason:'not-installed',microphoneOpen:true},false],
  [{available:true,state:'LISTENING',listening:true,microphoneOpen:true},false],
  [{available:false},false],
  [new Error('unavailable'),false],
 ];
 for(const [result,expected] of cases){
  let stops=0;
  const context=vm.createContext({Capacitor:{isNativePlatform:()=>true},externalVoiceInvocationEnabled:false,nativeListener:()=>true,stopSenseListenerForChatOnly,listener:{turnOff:async()=>{stops++;if(result instanceof Error)throw result;return result;}},wakeStopUnconfirmed:false,Promise,Error,setTimeout,clearTimeout});
  const stop=vm.runInContext(code+'\nstopWakeListenerForChatOnly;',context);
  const confirmed=await stop();
  assert.equal(stops,1,'startup uses the canonical native stop');
  assert.equal(confirmed,expected);
  assert.equal(context.wakeStopUnconfirmed,!expected);
 }
 for(const native of [true,false]){
  let stops=0;
  const context=vm.createContext({Capacitor:{isNativePlatform:()=>native},externalVoiceInvocationEnabled:false,nativeListener:()=>false,stopSenseListenerForChatOnly,listener:{turnOff:async()=>{stops++;throw Error('must not call missing bridge');}},wakeStopUnconfirmed:false,Promise,Error,setTimeout,clearTimeout});
  const stop=vm.runInContext(code+'\nstopWakeListenerForChatOnly;',context);
  assert.equal(await stop(),!native,'missing Android bridge cannot confirm the companion stopped');
  assert.equal(context.wakeStopUnconfirmed,native);
  assert.equal(stops,0);
 }
 assert.match(read('apps/app/src/main.tsx'),/if \(isAndroid && !externalVoiceInvocationEnabled\) void stopWakeListenerForChatOnly\(\)/);
 assert.match(read('apps/app/src/prototype/settings-adapter.ts'),/wakeListeningStopUnconfirmed\(\)/);
});

test('no enabled component opens the dormant assistant entries',()=>{
 const sources={},java='android/app/src/main/java/ai/elizaresearch/alphaphone/';
 for(const entry of readdirSync(new URL('../'+java,import.meta.url)))if(entry.endsWith('.java'))sources[entry.slice(0,-5)]=read(java+entry);
 const dormant=['AlphaAssistActivity','AlphaPowerVoiceActivity'];
 for(const flavor of ['launcher','standalone']){
  const merged={};
  for(const manifest of ['main',flavor])for(const [,attrs] of read(`android/app/src/${manifest}/AndroidManifest.xml`).matchAll(/<(?:activity|activity-alias|service|receiver|provider)\s([^>]*)>/g)){
   const name=attrs.match(/android:name="\.?([^"]+)"/)[1].replace(/^ai\.elizaresearch\.alphaphone\./,'');
   merged[name]={...merged[name],...Object.fromEntries([...attrs.matchAll(/([\w:]+)="([^"]*)"/g)].map(([,key,value])=>[key,value]))};
  }
  const openers=Object.keys(merged).filter(name=>!dormant.includes(name)&&dormant.some(target=>sources[name]?.includes(target)));
  assert.ok(openers.includes('AlphaQuickSettingsTile'),'the tile still targets the assistant entry');
  for(const name of openers)assert.equal(merged[name]['android:enabled'],'false',`${flavor}: ${name} opens a dormant assistant entry (P-78)`);
 }
});
