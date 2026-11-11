import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'telephony-attention-'));
const output=await build({entryPoints:[resolve('apps/app/src/prototype/telephony-attention.ts')],bundle:true,format:'esm',platform:'node',write:false,external:['@capacitor/core'],plugins:[{name:'closed-native-ports',setup(b){b.onResolve({filter:/^(\.\.\/runtime\/aosp-image|\.\/native-adapter|\.\/mvp-features|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.includes('aosp-image')?'export const aospImage=false;':a.path.includes('native-adapter')?'export function watchReturnToApp(){return ()=>{};}':a.path.includes('mvp-features')?'export function isMvpView(){return true;}':'export function registerPlugin(){return {};}',loader:'js'}));}}]});
writeFileSync(join(dir,'attention.mjs'),output.outputFiles[0].text);process.on('exit',()=>rmSync(dir,{recursive:true,force:true}));
const {installTelephonyAttention}=await import(pathToFileURL(join(dir,'attention.mjs')));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
for(const retire of ['leave','hide','unmount'])test(`Home status response admits no private reads after ${retire}`,async()=>{
 const calls=[];let release;const held=new Promise(resolve=>release=resolve);
 const handlers=new Map();globalThis.document={hidden:false,addEventListener:(name,handler)=>handlers.set(name,handler),removeEventListener:name=>handlers.delete(name)};
 const client=new Proxy({},{get:(_,method)=>async()=>{calls.push(method);if(method==='status'){await held;return {permissions:{sms:'granted',callLog:'granted',contacts:'granted'}};}return [];}});
 class Shell{view='home';S(){return {view:this.view};}setState(){}renderVals(){return {};}openView(){}}
 installTelephonyAttention(Shell,client);const owner=new Shell();owner.componentDidMount();
 if(retire==='leave'){owner.view='notes';owner.componentDidUpdate();}
 if(retire==='hide'){document.hidden=true;handlers.get('visibilitychange')();}
 if(retire==='unmount')owner.componentWillUnmount();
 release();await tick();assert.deepEqual(calls,['status']);
 if(retire!=='unmount')owner.componentWillUnmount();
});
