import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {materializeNativePatches,verifyNativePatchReceipt} from '../scripts/prepare-patched-native.mjs';
import {sha} from '../scripts/upstream-native-source.mjs';
const module='plugins/plugin-native-test/android',target=module+'/src/main/java/Test.java';
function fixture(run,sourceModule=module,sourceTarget=sourceModule+'/src/main/java/Test.java'){const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-patch-test-'));try{const before=Buffer.from('old\n'),after=Buffer.from('new\n'),patch=`--- a/${sourceTarget}\n+++ b/${sourceTarget}\n@@ -1 +1 @@\n-old\n+new\n`,patchRoot=path.join(root,'patches'),temporary=path.join(root,'stage');fs.mkdirSync(patchRoot);fs.mkdirSync(temporary);fs.writeFileSync(path.join(patchRoot,'test.patch'),patch);const manifest={schema:1,baseCommit:'pin',patches:[{module:sourceModule,file:'test.patch',sha256:sha(patch),targets:[{path:sourceTarget,beforeSha256:sha(before),afterSha256:sha(after)}]}]};const source={pin:'pin',read:()=>new Map([[sourceTarget,{bytes:before,mode:'100644',sha256:sha(before)}]])};run({root,manifest,source,patchRoot,temporary});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('admission materializes only authenticated declared source',()=>fixture(args=>{const result=materializeNativePatches(args);assert.equal(result.files[target],sha('new\n'));assert.equal(fs.readFileSync(path.join(args.temporary,target),'utf8'),'new\n');}));
for(const [name,mutate,error] of [
 ['wrong pin',a=>a.manifest.baseCommit='other',/pin/],
 ['patch drift',a=>fs.appendFileSync(path.join(a.patchRoot,'test.patch'),'x'),/digest/],
 ['wrong source',a=>a.manifest.patches[0].targets[0].beforeSha256='0'.repeat(64),/source/],
 ['wrong output',a=>a.manifest.patches[0].targets[0].afterSha256='0'.repeat(64),/output/],
 ['unsafe patch path',a=>a.manifest.patches[0].file='../test.patch',/descriptor/],
 ['undeclared patch target',a=>{const p=a.manifest.patches[0];const text=fs.readFileSync(path.join(a.patchRoot,p.file),'utf8').replaceAll(target,module+'/src/main/java/Other.java');fs.writeFileSync(path.join(a.patchRoot,p.file),text);p.sha256=sha(text);},/headers/],
 ['symlink patch',a=>{fs.renameSync(path.join(a.patchRoot,'test.patch'),path.join(a.root,'real.patch'));fs.symlinkSync(path.join(a.root,'real.patch'),path.join(a.patchRoot,'test.patch'));},/Nonregular/]
])test(`admission rejects ${name}`,()=>fixture(a=>{mutate(a);assert.throws(()=>materializeNativePatches(a),error);}));

test('APK receipt rejects missing, old and mismatched source bindings',()=>{
 const expected={root:'/not-packaged',baseCommit:'pin',manifestSha256:'new',files:{Java:'patched'}};
 const valid=JSON.stringify({baseCommit:'pin',manifestSha256:'new',files:{Java:'patched'}});
 assert.deepEqual(verifyNativePatchReceipt(valid,expected).files,{Java:'patched'});
 assert.throws(()=>verifyNativePatchReceipt('',expected),/Missing/);
 assert.throws(()=>verifyNativePatchReceipt('{}',expected),/mismatch/);
 assert.throws(()=>verifyNativePatchReceipt(valid.replace('patched','original'),expected),/mismatch/);
 assert.throws(()=>verifyNativePatchReceipt(valid.replace('new','old'),expected),/mismatch/);
});

for(const extension of ['kt','xml'])test(`admission ${extension==='kt'?'accepts Kotlin':'rejects non-code'} targets`,()=>fixture(args=>{
 const renamed=target.replace(/java$/,'')+extension,patch=args.manifest.patches[0];
 const bytes=fs.readFileSync(path.join(args.patchRoot,patch.file),'utf8').replaceAll(target,renamed);fs.writeFileSync(path.join(args.patchRoot,patch.file),bytes);patch.sha256=sha(bytes);patch.targets[0].path=renamed;
 const read=args.source.read;args.source.read=()=>new Map([[renamed,read().get(target)]]);
 if(extension==='kt'){const output=materializeNativePatches(args);assert.equal(output.files[renamed],sha('new\n'));}
 else assert.throws(()=>materializeNativePatches(args),/target\/source mismatch/);
}));

test('plugin patch admission refuses resident service modules now owned by upstream',()=>fixture(args=>{
 args.manifest.patches[0].module='packages/app/platforms/android/app';
 assert.throws(()=>materializeNativePatches(args),/Invalid native patch module/);
}));

const authModule='packages/auth/android';
for(const authTarget of [authModule+'/src/main/java/CloudSignInPlugin.java',authModule+'/build.gradle'])test(`shared auth admission authenticates ${authTarget}`,()=>fixture(args=>{
 const descriptor=authModule+'/settings.gradle',unchanged=Buffer.from('unchanged descriptor\n'),read=args.source.read;
 args.source.read=prefix=>{assert.equal(prefix,authModule);return new Map([...read(),[descriptor,{bytes:unchanged,mode:'100644',sha256:sha(unchanged)}]]);};
 const output=materializeNativePatches(args);
 assert.deepEqual(output.modules,[authModule]);
 assert.equal(output.files[authTarget],sha('new\n'));
 assert.equal(fs.readFileSync(path.join(args.temporary,authTarget),'utf8'),'new\n');
 assert.equal(output.files[descriptor],sha(unchanged));
 assert.deepEqual(fs.readFileSync(path.join(args.temporary,descriptor)),unchanged);
},authModule,authTarget));

for(const invalidModule of ['packages/auth','packages/auth/android-extra','packages/auth/android/src','packages/auth/android/../other','packages/other/android','/packages/auth/android','packages\\auth\\android'])test(`shared auth admission rejects module ${invalidModule}`,()=>fixture(args=>{
 args.manifest.patches[0].module=invalidModule;
 args.source.read=()=>{assert.fail('an unadmitted module must not be read');};
 assert.throws(()=>materializeNativePatches(args),/Invalid native patch module/);
},authModule));

for(const [sourceModule,invalidTarget] of [
 [module,module+'/build.gradle'],
 [authModule,authModule+'/settings.gradle'],
 [authModule,authModule+'/build.gradle.kts'],
 [authModule,authModule+'/src/main/java/../build.gradle'],
 [authModule,authModule+'/../android/build.gradle'],
 [authModule,'packages/other/android/build.gradle'],
])test(`shared auth descriptor exception rejects ${invalidTarget}`,()=>fixture(args=>{
 assert.throws(()=>materializeNativePatches(args),/target\/source mismatch/);
},sourceModule,invalidTarget));

test('shared auth descriptor patch still rejects unauthenticated output',()=>fixture(args=>{
 args.manifest.patches[0].targets[0].afterSha256='0'.repeat(64);
 assert.throws(()=>materializeNativePatches(args),/output differs/);
},authModule,authModule+'/build.gradle'));

const speechModule='plugins/plugin-local-inference/native/android';
const speechTarget=speechModule+'/speech-bridge/src/main/java/ai/eliza/voice/SharedRelay.java';
function speechAddition(run){fixture(args=>{
 const base=speechModule+'/src/main/java/ai/eliza/voice/Existing.java',body='package ai.eliza.voice; class SharedRelay {}\n';
 const original=Buffer.from('package ai.eliza.voice; class Existing {}\n');
 args.source.read=()=>new Map([[base,{bytes:original,mode:'100644',sha256:sha(original)}]]);
 const patch=`--- /dev/null\n+++ b/${speechTarget}\n@@ -0,0 +1 @@\n+${body}`;
 fs.writeFileSync(path.join(args.patchRoot,'test.patch'),patch);
 args.manifest.patches=[{module:speechModule,file:'test.patch',sha256:sha(patch),targets:[{path:speechTarget,beforeSha256:null,afterSha256:sha(body)}]}];
 run(args,body);
},speechModule);}
test('shared speech additions are hash-bound and retain exact source/mode inventory',()=>speechAddition((args,body)=>{
 const result=materializeNativePatches(args);
 assert.equal(result.files[speechTarget],sha(body));assert.equal(result.modes[speechTarget],'100644');
 assert.equal(fs.readFileSync(path.join(args.temporary,speechTarget),'utf8'),body);
}));
for(const scenario of ['existing','namespace','module','output'])test(`shared speech addition rejects ${scenario}`,()=>speechAddition((args,body)=>{
 const patch=args.manifest.patches[0];
 if(scenario==='existing'){const read=args.source.read;args.source.read=()=>new Map([...read(),[speechTarget,{bytes:Buffer.from(body),mode:'100644',sha256:sha(body)}]]);}
 if(scenario==='namespace')patch.targets[0].path=speechTarget.replace('/ai/eliza/voice/','/unreviewed/');
 if(scenario==='module')patch.module=module;
 if(scenario==='output')patch.targets[0].afterSha256='0'.repeat(64);
 assert.throws(()=>materializeNativePatches(args),/mismatch|output differs/);
}));
