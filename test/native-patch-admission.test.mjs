import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {materializeNativePatches,verifyNativePatchReceipt,preparePatchedNative} from '../scripts/prepare-patched-native.ts';
import {sha} from '../scripts/upstream-native-source.ts';
const module='plugins/plugin-native-test/android',target=module+'/src/main/java/Test.java';
function fixture(run,sourceModule=module,sourceTarget=sourceModule+'/src/main/java/Test.java'){const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-patch-test-'));try{const bytes=Buffer.from('reviewed\n'),temporary=path.join(root,'stage');fs.mkdirSync(temporary);const manifest={schema:1,baseCommit:'pin',modules:[sourceModule]};const source={pin:'pin',read:()=>new Map([[sourceTarget,{bytes,mode:'100644',sha256:sha(bytes)}]])};run({root,manifest,source,temporary});}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('admission materializes only authenticated declared source',()=>fixture(args=>{const result=materializeNativePatches(args);assert.deepEqual(result.files,{[target]:sha('reviewed\n')});assert.equal(fs.readFileSync(path.join(args.temporary,target),'utf8'),'reviewed\n');}));
test('production native staging refuses a reintroduced patch catalog before writing a cache',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-retired-'));
 try{
  fs.mkdirSync(path.join(root,'vendor'));fs.symlinkSync(fs.realpathSync('vendor/eliza'),path.join(root,'vendor/eliza'),'dir');
  fs.copyFileSync('upstream.lock.json',path.join(root,'upstream.lock.json'));fs.mkdirSync(path.join(root,'android'));
  const catalog=JSON.parse(fs.readFileSync('android/upstream-native-sources.json'));
  assert.deepEqual(catalog.patches,[]);
  catalog.patches=[{module:'plugins/plugin-native-notifications/android',file:'retired.patch'}];
  fs.writeFileSync(path.join(root,'android/upstream-native-sources.json'),JSON.stringify(catalog));
  assert.throws(()=>preparePatchedNative({root}),/without product patches/);
  assert.equal(fs.existsSync(path.join(root,'.eliza')),false,'refused production patches cannot create or replace staging');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('admission accepts an owner-only executable staged under umask 027',()=>fixture(args=>{
 const read=args.source.read;args.source.read=()=>new Map([...read()].map(([name,file])=>[name,{...file,mode:'100755'}]));
 const previous=process.umask(0o027);
 try{assert.equal(materializeNativePatches(args).modes[target],'100755');assert.equal(fs.statSync(path.join(args.temporary,target)).mode&0o777,0o750);}finally{process.umask(previous);}
}));
test('admission rejects wrong pin',()=>fixture(args=>{args.manifest.baseCommit='other';assert.throws(()=>materializeNativePatches(args),/pin/);}));

test('APK receipt rejects missing, old and mismatched source bindings',()=>{
 const expected={root:'/not-packaged',baseCommit:'pin',manifestSha256:'new',files:{Java:'patched'}};
 const valid=JSON.stringify({baseCommit:'pin',manifestSha256:'new',files:{Java:'patched'}});
 assert.deepEqual(verifyNativePatchReceipt(valid,expected).files,{Java:'patched'});
 assert.throws(()=>verifyNativePatchReceipt('',expected),/Missing/);
 assert.throws(()=>verifyNativePatchReceipt('{}',expected),/mismatch/);
 assert.throws(()=>verifyNativePatchReceipt(valid.replace('patched','original'),expected),/mismatch/);
 assert.throws(()=>verifyNativePatchReceipt(valid.replace('new','old'),expected),/mismatch/);
});

const nativeOnlyModule='plugins/plugin-native-secure-store/android-nativeonly';
const authModule='packages/auth/android';
for(const admitted of [nativeOnlyModule,authModule,'packages/app/platforms/android/app/src/main/elizavoice-jni'])
 test(`${admitted} is staged byte-exact with source hashes`,()=>fixture(args=>{
  args.source.read=(read=>prefix=>{assert.equal(prefix,admitted);return read();})(args.source.read);
  const result=materializeNativePatches(args),name=admitted+'/src/main/java/Test.java';
  assert.deepEqual(result.modules,[admitted]);
  assert.equal(result.files[name],sha('reviewed\n'));
  assert.equal(fs.readFileSync(path.join(args.temporary,name),'utf8'),'reviewed\n');
 },admitted));
for(const invalidModule of ['packages/app/platforms/android/app',nativeOnlyModule+'-other',nativeOnlyModule+'/../android',
 'packages/auth','packages/auth/android-extra','packages/auth/android/src','packages/auth/android/../other','packages/other/android','/packages/auth/android','packages\\auth\\android'])
 test(`admission rejects module ${invalidModule}`,()=>fixture(args=>{
  args.source.read=()=>assert.fail('an unadmitted module must not be read');
  assert.throws(()=>materializeNativePatches(args),/Invalid native patch module/);
 },invalidModule));
