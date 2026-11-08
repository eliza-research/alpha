import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
const source=fs.readFileSync('apps/app/src/runtime/hosted-digest-ui.tsx','utf8');
const expression=/pendingSlot:\s*([^\n]+),/.exec(source)?.[1];
const nativeScope='hosted-digests:v1:'+'a'.repeat(64);
function pending(android){assert(expression,'pending slot must have one explicit binding');return new Function('isAndroid','slot','return '+expression)(android,nativeScope);}
test('Android renderer pending key is admitted without accessing the native delivery journal',()=>{
 const slot=pending(true);assert.equal(slot,'renderer-'+nativeScope+':pending');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-digest-slot-'));
 try{fs.copyFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/RendererCredentialSlots.java',path.join(dir,'RendererCredentialSlots.java'));fs.writeFileSync(path.join(dir,'Check.java'),`package ai.elizaresearch.alphaphone;class Check{public static void main(String[]a){RendererCredentialSlots.requireAllowed(a[0]);boolean denied=false;try{RendererCredentialSlots.requireAllowed(a[1]);}catch(SecurityException e){denied=true;}if(!denied)throw new AssertionError();}}`);const bin=n=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',n):n;execFileSync(bin('javac'),['--release','11','-d',dir,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java',path.join(dir,'RendererCredentialSlots.java'),path.join(dir,'Check.java')]);execFileSync(bin('java'),['-cp',dir,'ai.elizaresearch.alphaphone.Check',slot,nativeScope+':pending']);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('browser pending key remains unchanged and every pending operation uses its bound key',()=>{
 assert.equal(pending(false),nativeScope+':pending');
 assert.match(source,/b\.storage\.read<Pending>\(b\.pendingSlot\)/);
 assert.match(source,/b\.storage\.write\(b\.pendingSlot, value\)/);
 assert.equal((source.match(/b\.storage\.remove\(b\.pendingSlot\)/g)||[]).length,2);
 assert.doesNotMatch(source,/b\.slot\s*\+\s*":pending"/);
});
test('renderer pending operations leave existing browser and native records intact',()=>{
 const storage=new Map([[nativeScope+':pending','existing native record'],[nativeScope,'native history'],['renderer-'+nativeScope,'renderer history']]);
 storage.set(pending(true),'new renderer draft');storage.delete(pending(true));
 assert.equal(storage.get(nativeScope+':pending'),'existing native record');assert.equal(storage.get(nativeScope),'native history');assert.equal(storage.get('renderer-'+nativeScope),'renderer history');
});
