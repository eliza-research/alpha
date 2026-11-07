// patches/eliza/camera-capture-latency.patch, checked on the patched source: Video mode pre-binds the
// VideoCapture a recording with the same options would build (so record start does not rebind), and a
// mode change that leaves no bound use case rejects PREVIEW_STOPPED and emits an error event.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const ready=fs.existsSync(path.join(root,'vendor/eliza/plugins/plugin-native-camera'));
test('Video mode binds the recording options; a released preview is reported',{skip:!ready&&'vendor/eliza not checked out'},async()=>{
 const {preparePatchedNative}=await import('../scripts/prepare-patched-native.mjs');
 const prepared=preparePatchedNative({root});
 const kt=fs.readFileSync(path.join(prepared.root,'plugins/plugin-native-camera/android/src/main/java/ai/eliza/plugins/camera/CameraPlugin.kt'),'utf8');
 const fn=name=>{const a=kt.indexOf(name);assert.ok(a>=0,name);return kt.slice(a,kt.indexOf('\n    }\n',a));};
 const bind=fn('private fun bindUseCases(');
 assert.match(bind,/boundVideoConfig != modeVideoConfig/,'Video mode rebinds when the wanted recording options differ');
 assert.match(bind,/val config = modeVideoConfig/);
 const mode=fn('fun setCaptureMode(');
 assert.match(mode,/recordingQuality\(call\)/,'setCaptureMode reads the recording quality');
 assert.match(mode,/"PREVIEW_STOPPED"/);assert.match(mode,/notifyListeners\("error"/);
 const record=fn('private fun startRecordingInternal(');
 assert.match(record,/quality = recordingQuality\(call\)/,'Recording and Video mode map quality the same way');
 const js=fs.readFileSync(path.join(root,'apps/app/src/prototype/camera-adapter.ts'),'utf8');
 assert.match(js,/recording:\(\)=>RECORDING/);assert.match(js,/setCaptureMode\(\{mode:wanted,quality:RECORDING\.quality\}\)/);
});
