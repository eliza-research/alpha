import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
test('delayed provider results cannot cross a lifecycle or permission boundary',()=>{
 const root=resolve(import.meta.dirname,'..'),dir=mkdtempSync(join(tmpdir(),'alpha-native-epoch-'));
 const java=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 try{
  execFileSync(java('javac'),['--release','11','-d',dir,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/NativeReadEpoch.java'),join(root,'test/fixtures/NativeReadEpochTest.java')],{timeout:60000});
  assert.match(execFileSync(java('java'),['-cp',dir,'ai.elizaresearch.alphaphone.NativeReadEpochTest'],{encoding:'utf8',timeout:15000}),/PASS native read publication fences/);
  // The catalog's own ticket checks live in the shared native media module and are tested there.
  // AlphaPhotos and AlphaPhotoLibrary register the shared Photos plugins, which publish under the ticket.
  const media=join(root,'vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media');
  const photos=readFileSync(join(media,'PhotosPlugin.java'),'utf8');
  assert.match(photos,/permitted\.publish\(call, value, ticket\)/);
  const facade=readFileSync(join(media,'DeviceLibraryPlugin.java'),'utf8');
  assert.equal((facade.match(/catalog\.publish\(call,/g)||[]).length,3);
  assert.match(readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotosPlugin.java'),'utf8'),/extends PhotosPlugin \{/);
  assert.match(readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaPhotoLibraryPlugin.java'),'utf8'),/extends DeviceLibraryPlugin \{/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
