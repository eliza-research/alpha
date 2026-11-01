import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {androidDependencyFingerprint} from '../scripts/generate-licenses.mjs';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';

const descriptor = 'packages/auth/android/build.gradle';
const original = "plugins { id 'com.android.library' }\ndependencies {\n implementation 'androidx.credentials:credentials:1.6.0'\n}\n";
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const write = (root, file, value) => { const target=path.join(root,file); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,value); };

function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-dependency-fingerprint-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 write(root,'android/consumer-host.json',JSON.stringify({schema:1,residentHost:{},profile:{schema:1,dependencies:[],modules:[{name:'eliza-cloud-auth',source:{root:'patchedNative',path:'packages/auth/android'}}]}}));
 write(root,'vendor/eliza/packages/app/scripts/mobile/android/consumer-host/toolchain.json',JSON.stringify({androidGradlePlugin:'8.7.2',kotlin:'2.1.0',versions:{}}));
 write(root,'vendor/eliza/packages/app/scripts/mobile/android/consumer-host/app.gradle',"dependencies { implementation project(':eliza-cloud-auth') }\n");
 write(root,`vendor/eliza/${descriptor}`,original);
 const git=args=>execFileSync('git',['-C',path.join(root,'vendor/eliza'),...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture']);
 const pin=git(['rev-parse','HEAD']);
 write(root,'upstream.lock.json',JSON.stringify({commit:pin}));
 return {root,pin};
}

function patchAuth({root,pin},after) {
 const beforeLines=original.slice(0,-1).split('\n'),afterLines=after.slice(0,-1).split('\n');
 const patch=`--- a/${descriptor}\n+++ b/${descriptor}\n@@ -1,${beforeLines.length} +1,${afterLines.length} @@\n${beforeLines.map(line=>'-'+line).join('\n')}\n${afterLines.map(line=>'+'+line).join('\n')}\n`;
 write(root,'patches/eliza/auth.patch',patch);
 write(root,'patches/eliza/native-manifest.json',JSON.stringify({schema:1,baseCommit:pin,patches:[{module:'packages/auth/android',file:'auth.patch',sha256:sha(patch),targets:[{path:descriptor,beforeSha256:sha(original),afterSha256:sha(after)}]}]}));
}

test('Android dependency fingerprint uses the authenticated auth descriptor under a stable source label',t=>{
 const source=fixture(t),canonical=fixture(t);
 const before=androidDependencyFingerprint(source.root);
 // Existing fixture roots without a patch manifest retain the canonical fingerprint.
 assert.equal(androidDependencyFingerprint(canonical.root),before);
 write(source.root,'patches/eliza/native-manifest.json',JSON.stringify({schema:1,baseCommit:source.pin,patches:[]}));
 assert.equal(androidDependencyFingerprint(source.root),before);

 const after=original+"dependencies {\n implementation 'androidx.browser:browser:1.9.0'\n}\n";
 patchAuth(source,after);
 const staged=preparePatchedNative({root:source.root});
 assert.equal(fs.readFileSync(path.join(staged.root,descriptor),'utf8'),after);
 const patched=androidDependencyFingerprint(source.root);
 assert.notEqual(patched,before,'a changed packaged declaration invalidates the recorded classpath');
 // A canonical fixture containing those exact staged bytes yields the same hash: no cache path leaks into provenance.
 write(canonical.root,`vendor/eliza/${descriptor}`,fs.readFileSync(path.join(staged.root,descriptor)));
 assert.equal(androidDependencyFingerprint(canonical.root),patched);
 assert.equal(fs.readFileSync(path.join(source.root,'vendor/eliza',descriptor),'utf8'),original,'the pinned checkout is unchanged');

 patchAuth(source,original+"dependencies {\n implementation 'androidx.browser:browser:1.8.0'\n}\n");
 assert.notEqual(androidDependencyFingerprint(source.root),patched,'later dependency changes invalidate the snapshot again');
});

test('Android dependency fingerprint rejects unauthenticated auth descriptor changes',t=>{
 const source=fixture(t);
 patchAuth(source,original+"dependencies {\n implementation 'androidx.browser:browser:1.9.0'\n}\n");
 fs.appendFileSync(path.join(source.root,'patches/eliza/auth.patch'),'unreviewed\n');
 assert.throws(()=>androidDependencyFingerprint(source.root),/Native patch digest mismatch/);
});
