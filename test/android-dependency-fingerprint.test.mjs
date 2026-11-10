import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git as fixtureGit} from './fixtures/git-fixture.mjs';
import {androidDependencyFingerprint,parseGradleTree} from '../scripts/generate-licenses.ts';
import {preparePatchedNative} from '../scripts/prepare-patched-native.ts';

const descriptor = 'packages/auth/android/build.gradle';
const original = "plugins { id 'com.android.library' }\ndependencies {\n implementation 'androidx.credentials:credentials:1.6.0'\n}\n";
const write = (root, file, value) => { const target=path.join(root,file); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,value); };

function fixture(t, auth = original) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-dependency-fingerprint-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 write(root,'android/consumer-host.json',JSON.stringify({schema:1,residentHost:{},profile:{schema:1,dependencies:[],modules:[{name:'eliza-cloud-auth',source:{root:'patchedNative',path:'packages/auth/android'}}]}}));
 write(root,'vendor/eliza/packages/app/scripts/mobile/android/consumer-host/toolchain.json',JSON.stringify({androidGradlePlugin:'8.7.2',kotlin:'2.1.0',versions:{}}));
 write(root,'vendor/eliza/packages/app/scripts/mobile/android/consumer-host/app.gradle',"dependencies { implementation project(':eliza-cloud-auth') }\n");
 write(root,`vendor/eliza/${descriptor}`,auth);
 const git=args=>fixtureGit(path.join(root,'vendor/eliza'),...args);
 git(['init','-q']);git(['add','.']);git(['commit','-qm','fixture']);
 const pin=git(['rev-parse','HEAD']);
 write(root,'upstream.lock.json',JSON.stringify({commit:pin}));
 write(root,'android/upstream-native-sources.json',JSON.stringify({schema:1,modules:['packages/auth/android'],patches:[]}));
 return {root,pin};
}

test('Android dependency fingerprint includes pinned auth declarations under a stable source label',t=>{
 const before=androidDependencyFingerprint(fixture(t).root);
 const declaration=version=>original+"dependencies {\n implementation 'androidx.browser:browser:"+version+"'\n}\n";
 const source=fixture(t,declaration('1.9.0'));
 const staged=preparePatchedNative({root:source.root});
 assert.equal(fs.readFileSync(path.join(staged.root,descriptor),'utf8'),declaration('1.9.0'));
 const updated=androidDependencyFingerprint(source.root);
 assert.notEqual(updated,before,'a changed packaged declaration invalidates the recorded classpath');
 assert.equal(updated,androidDependencyFingerprint(fixture(t,declaration('1.9.0')).root),'checkout and staging paths do not affect provenance');
 assert.notEqual(updated,androidDependencyFingerprint(fixture(t,declaration('1.8.0')).root),'later dependency changes invalidate the snapshot again');
});

test('Android dependency fingerprint includes transitive credential custody but excludes fixture modules',t=>{
 const {root}=fixture(t);
 const host=JSON.parse(fs.readFileSync(path.join(root,'android/consumer-host.json'),'utf8'));
 const nativeOnly='plugins/plugin-native-secure-store/android-nativeonly';
 host.profile.modules.push(
  {name:'elizaos-capacitor-secure-store-nativeonly',source:{root:'patchedNative',path:nativeOnly},appDependency:false},
  {name:'test-fixture',source:{root:'consumer',path:'android/test-fixture'},appDependency:false},
 );
 write(root,'android/consumer-host.json',JSON.stringify(host));
 write(root,`vendor/eliza/${nativeOnly}/build.gradle`,"implementation 'androidx.core:core:1.16.0'\n");
 const before=androidDependencyFingerprint(root);
 write(root,'android/test-fixture/build.gradle',"implementation 'example:fixture:1.0.0'\n");
 assert.equal(androidDependencyFingerprint(root),before);
 write(root,`vendor/eliza/${nativeOnly}/build.gradle`,"implementation 'androidx.core:core:1.17.0'\n");
 assert.notEqual(androidDependencyFingerprint(root),before);
});

test('Android classpath capture rejects an unresolved Gradle row alongside resolved dependencies',()=>{
 const resolved='+--- androidx.core:core:1.16.0 -> 1.17.0\n';
 assert.deepEqual(parseGradleTree(resolved),['androidx.core:core:1.17.0']);
 assert.throws(()=>parseGradleTree(resolved+'\\--- example:missing:1.0 FAILED\n'),/Unresolved Android runtime dependency/);
});
