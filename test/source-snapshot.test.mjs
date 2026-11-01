import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const script=path.resolve(import.meta.dirname,'../scripts/source-snapshot.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(root,name,bytes)=>{const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);};
const snapshot=root=>JSON.parse(execFileSync(process.execPath,[script],{cwd:root,encoding:'utf8'}));

test('source snapshot binds authored native patch manifests and patch bytes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-patch-snapshot-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest='patches/eliza/native-manifest.json',patch='patches/eliza/google-browser-sign-in.patch';
 const firstManifest='{"schema":1,"patches":[]}\n',firstPatch='--- a/source\n+++ b/source\n';
 write(root,manifest,firstManifest);write(root,patch,firstPatch);
 const first=snapshot(root);
 assert.deepEqual(first.files,{[patch]:sha(firstPatch),[manifest]:sha(firstManifest)});

 const nextPatch=firstPatch+'@@ -1 +1 @@\n-before\n+after\n';
 write(root,patch,nextPatch);
 const changedPatch=snapshot(root);
 assert.notEqual(changedPatch.digest,first.digest);
 assert.equal(changedPatch.files[patch],sha(nextPatch));
 assert.equal(changedPatch.files[manifest],first.files[manifest]);

 write(root,manifest,'{"schema":1,"patches":[{"file":"google-browser-sign-in.patch"}]}\n');
 const changedManifest=snapshot(root);
 assert.notEqual(changedManifest.digest,changedPatch.digest);
 assert.notEqual(changedManifest.files[manifest],changedPatch.files[manifest]);
 assert.equal(changedManifest.files[patch],changedPatch.files[patch]);
});

test('source snapshot excludes generated patch staging and unrelated private state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-patch-snapshot-private-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 write(root,'patches/eliza/native-manifest.json','{"schema":1,"patches":[]}\n');
 const before=snapshot(root);
 write(root,'.eliza/patched-native/generated/packages/auth/android/build.gradle','generated output\n');
 write(root,'private-state/account.json','private fixture bytes\n');
 assert.deepEqual(snapshot(root),before);
});
