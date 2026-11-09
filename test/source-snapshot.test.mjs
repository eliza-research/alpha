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

test('source snapshot binds the native source catalog and its upstream pin',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-source-snapshot-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest='android/upstream-native-sources.json',lock='upstream.lock.json';
 const firstManifest='{"schema":1,"modules":[]}\n',firstLock='{"commit":"initial"}\n';
 write(root,manifest,firstManifest);write(root,lock,firstLock);
 const first=snapshot(root);
 assert.deepEqual(first.files,{[manifest]:sha(firstManifest),[lock]:sha(firstLock)});

 write(root,lock,'{"commit":"updated"}\n');
 const repinned=snapshot(root);
 assert.notEqual(repinned.digest,first.digest);
 assert.equal(repinned.files[manifest],first.files[manifest]);

 write(root,manifest,'{"schema":1,"modules":["packages/auth/android"]}\n');
 const updated=snapshot(root);
 assert.notEqual(updated.digest,repinned.digest);
 assert.equal(updated.files[lock],repinned.files[lock]);
});

test('source snapshot excludes generated native staging and unrelated private state',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-source-snapshot-private-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 write(root,'android/upstream-native-sources.json','{"schema":1,"modules":[]}\n');
 const before=snapshot(root);
 write(root,'.eliza/patched-native/generated/packages/auth/android/build.gradle','generated output\n');
 write(root,'private-state/account.json','private fixture bytes\n');
 assert.deepEqual(snapshot(root),before);
});

test('source snapshot binds the shared client source preparer and managed source receipt',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-client-source-snapshot-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['scripts/prepare-client-features.mjs','.eliza/client-features/.source.json'])write(root,name,'first');
 const before=snapshot(root);
 for(const name of Object.keys(before.files))assert.equal(before.files[name],sha('first'));
 assert.equal(Object.keys(before.files).length,2);
 write(root,'changed helper');
 assert.notEqual(snapshot(root).digest,before.digest);
});
