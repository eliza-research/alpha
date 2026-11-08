import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture({holdSynthesis=false}={}){
 const f={played:0,stopped:0,release:undefined,fail:false};
 const native={addListener:async()=>({remove:async()=>{}}),synthesizeLocal:async()=>{if(holdSynthesis)await new Promise(resolve=>f.finishSynthesis=resolve);return {playbackId:'owned',execution:'device'};},play:async()=>{f.played++;},cancel:async()=>{},stopPlayback:async input=>{f.stopped++;if(holdSynthesis&&!input.playbackId)return;await new Promise(resolve=>f.release=resolve);if(f.fail)throw Error('Native stop failed');}};
 const box={AbortController,DOMException,crypto,console,setTimeout,clearTimeout,Capacitor:{isNativePlatform:()=>true,isPluginAvailable:()=>true},registerPlugin:()=>native,planLocalSpeech:text=>[text],nativeVoiceTurnId:()=>undefined,connectionController:{getSnapshot:()=>({}),getCloudClient:()=>null,subscribe:()=>()=>{}},document:{hidden:false,documentElement:{dataset:{}},addEventListener(){},removeEventListener(){}}};
 // local-voice.ts binds the shared owned-request runner (@elizaos/voice/native-speech) projected from the pin.
 {let src=readFileSync('.eliza/client-features/packages/voice/src/native-speech-request.ts','utf8').replace(/^export /gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});vm.runInNewContext('{'+src+';Object.assign(globalThis,{createNativeSpeechRequests});}',box);}
 for(const file of ['local-speech-playback.ts','runtime/local-voice.ts']){let src=readFileSync('apps/app/src/'+file,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');src=stripTypeScriptTypes(src,{mode:'transform'});vm.runInNewContext('{'+src+';Object.assign(globalThis,{'+(file.startsWith('runtime')?'createOnDeviceVoice':'speakLocalText')+'});}',box);}
 return {f,voice:box.createOnDeviceVoice()};
}
for(const fail of [false,true])test(`local conversation cancellation waits for native cleanup, failure=${fail}`,async()=>{
 const {f,voice}=fixture();f.fail=fail;const c=new AbortController();let settled=false;
 const result=voice.speak('Reply',c.signal,()=>{},true).then(()=>null,error=>error).finally(()=>settled=true);
 while(!f.played)await tick();c.abort();while(!f.stopped)await tick();await tick();assert.equal(settled,false,'next capture must not begin while native playback cleanup is pending');f.release();const error=await result;assert.ok(error);if(fail)assert.equal(error.code,'speech-cleanup-unconfirmed');else assert.equal(error.name,'AbortError');
});

for(const fail of [false,true])test(`strict cancellation drains late synthesis handle, failure=${fail}`,async()=>{const {f,voice}=fixture({holdSynthesis:true});f.fail=fail;const c=new AbortController();let settled=false;const result=voice.speak('Reply',c.signal,()=>{},true).then(()=>null,error=>error).finally(()=>settled=true);while(!f.finishSynthesis)await tick();c.abort();await tick();assert.equal(settled,false);assert.equal(f.stopped,1);f.finishSynthesis();while(!f.release)await tick();assert.equal(settled,false,'late native handle must also be stopped before another capture');assert.equal(f.stopped,2);f.release();const error=await result;if(fail)assert.equal(error.code,'speech-cleanup-unconfirmed');else assert.equal(error.name,'AbortError');assert.equal(f.played,0);});
