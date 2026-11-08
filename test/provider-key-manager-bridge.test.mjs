import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {runProviderConfiguration} from '../apps/app/src/runtime/abort-signal.ts';

const source=readFileSync('apps/app/src/runtime/local-agent.ts','utf8');
const parser=source.slice(source.indexOf('function parseProviderStatus('),source.indexOf('/** The native bridge verifies'));
const manager=source.slice(source.indexOf('function managedProviderStatus('),source.indexOf('/** Retires the stored binding;'));
const code=transformSync((parser+manager).replaceAll('export async function','async function'),{loader:'ts',format:'esm'}).code;
const make=new Function('native','localProviderStatus','browserCloudResidentEnabled','browserProviderCall','runProviderConfiguration',
 `const Capacitor={isNativePlatform:()=>!browserCloudResidentEnabled};const record=v=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid response');return v;};${code};return {parseProviderStatus,selectLocalProvider,editLocalProviderKeys,removeLocalProviderKey,revealLocalProviderKey};`);
const status=(extra={})=>({provider:'cerebras',configured:true,selected:true,voiceConfigured:true,mode:'own',revision:'one:1',keys:{text:{configured:true},voice:{configured:true}},persistence:'native-secure-store',...extra});
function fixture(before=status(),answer=status({revision:'two:2'}),browser=false){
 const calls=[];
 const native={prepareProviderConfiguration:async()=>{calls.push(['prepare']);return {requestId:'lease'};},cancelProviderConfiguration:async value=>{calls.push(['cancel',value]);}};
 for(const method of ['selectProvider','editProviderKeys','removeProviderKey','revealProviderKey'])native[method]=async input=>{calls.push([method,input]);return answer;};
 const api=make(native,async()=>before,browser,async(op,input)=>{calls.push([op,input]);return answer;},runProviderConfiguration);
 return {api,calls,native};
}
test('legacy status stays readable but cannot claim saved-key management or receive an edit',async()=>{
 const f=fixture({provider:'cerebras',configured:true});
 assert.equal(f.api.parseProviderStatus({provider:'cerebras',configured:true}).keys,undefined);
 await assert.rejects(f.api.editLocalProviderKeys({textKey:'synthetic-text-key',expectedRevision:'old'}),/updated app/);
 assert.deepEqual(f.calls,[]);
});
test('Text-only edit omits Voice and selects no route; empty fields never remove keys',async()=>{
 const f=fixture();await f.api.editLocalProviderKeys({textKey:'synthetic-text-key',expectedRevision:'one:1'});
 assert.deepEqual(f.calls,[['prepare'],['editProviderKeys',{textKey:'synthetic-text-key',expectedRevision:'one:1',requestId:'lease'}]]);
 await assert.rejects(f.api.editLocalProviderKeys({textKey:'',expectedRevision:'one:1'}),/valid key/);
 await assert.rejects(f.api.editLocalProviderKeys({voiceKey:null,expectedRevision:'one:1'}),/valid key/);
 assert.equal(f.calls.length,2);
});
test('Remove Text keeps Own and Voice; selecting Cloud confirms retained saved keys',async()=>{
 const f=fixture(status(),status({configured:false,keys:{text:{configured:false},voice:{configured:true}}}));
 const result=await f.api.removeLocalProviderKey({key:'text',expectedRevision:'one:1'});
 assert.equal(result.mode,'own');assert.equal(result.keys.voice.configured,true);
 assert.deepEqual(f.calls[1],['removeProviderKey',{key:'text',expectedRevision:'one:1',requestId:'lease'}]);
 const cloud=fixture(status(),status({mode:'cloud',provider:'elizacloud'}));
 assert.equal((await cloud.api.selectLocalProvider({mode:'cloud',expectedRevision:'one:1'})).mode,'cloud');
 const lost=fixture(status(),status({mode:'cloud',provider:'elizacloud',keys:{text:{configured:false},voice:{configured:true}}}));
 await assert.rejects(lost.api.selectLocalProvider({mode:'cloud',expectedRevision:'one:1'}),/retained keys/);
});
test('old owner revision refuses remove and reveal before reserving a native lease',async()=>{
 const f=fixture();for(const action of ['removeLocalProviderKey','revealLocalProviderKey'])await assert.rejects(f.api[action]({key:'voice',expectedRevision:'old:0'}),/Provider changed/);
 assert.deepEqual(f.calls,[]);
});
test('native reveal returns only protected-surface acknowledgement; browser reveal is explicit RAM-only',async()=>{
 const input={key:'voice',expectedRevision:'one:1'},shown={key:'voice',revision:'one:1',shown:true,hidesAfterMs:30000};
 const f=fixture(status(),shown);assert.deepEqual(await f.api.revealLocalProviderKey(input),shown);
 const raw=fixture(status(),{...shown,value:'synthetic-voice-key'});await assert.rejects(raw.api.revealLocalProviderKey(input),/Secure provider reveal/);
 const browser=fixture(status({persistence:'host-session'}),{key:'voice',revision:'one:1',value:'synthetic-voice-key'},true);
 assert.equal((await browser.api.revealLocalProviderKey(input)).value,'synthetic-voice-key');assert.deepEqual(browser.calls,[['residentProviderReveal',input]]);
});
test('cancellation before native lease resolution never sends keys; malformed rich status is refused',async()=>{
 const f=fixture();let resolve;f.native.prepareProviderConfiguration=()=>new Promise(done=>{resolve=done;});
 const controller=new AbortController(),pending=f.api.editLocalProviderKeys({voiceKey:'synthetic-voice-key',expectedRevision:'one:1'},controller.signal);
 await new Promise(done=>setImmediate(done));controller.abort();resolve({requestId:'late-lease'});
 await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(f.calls,[['cancel',{requestId:'late-lease'}]]);
 const bad=fixture(status({keys:{text:{configured:true},voice:null}}));await assert.rejects(bad.api.selectLocalProvider({mode:'cloud',expectedRevision:'one:1'}));assert.deepEqual(bad.calls,[]);
});
