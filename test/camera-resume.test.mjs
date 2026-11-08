import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
// The dependency-free resume decision is the shared camera host rule (plugin-native-camera host-ports),
// evaluated without the renderer; the adapter must resume only through it.
const source=readFileSync('apps/app/src/prototype/camera-adapter.ts','utf8');
const {restartAfterResume}=await import('../.eliza/client-features/plugins/plugin-native-camera/src/host-ports.ts');
const stopped=()=>({denied:'camera',phase:'error',disposed:false});

test('a resume after "Don\'t allow" does not ask for the camera again',async()=>{
 // Found on an API 36 emulator: closing Android's permission dialog resumed the app, the preview
 // restarted and Android showed the dialog a second time straight after the denial.
 let reads=0;
 for(const camera of ['denied','prompt','prompt-with-rationale',undefined])assert.equal(await restartAfterResume(stopped,async()=>{reads++;return {camera};}),false,String(camera));
 assert.equal(reads,4,'the state is read, never requested');
 assert.equal(await restartAfterResume(stopped,async()=>{throw Error('bridge closed');}),false);
});
test('a grant made in Android settings restarts the preview on return',async()=>{
 assert.equal(await restartAfterResume(stopped,async()=>({camera:'granted'})),true);
});
test('nothing restarts unless the preview stopped on a camera denial, and a state that changed while reading wins',async()=>{
 let reads=0;const granted=async()=>{reads++;return {camera:'granted'};};
 for(const state of [{phase:'error',disposed:false},{denied:'microphone',phase:'error',disposed:false},{denied:'camera',phase:'ready',disposed:false},{denied:'camera',phase:'starting',disposed:false},{denied:'camera',phase:'error',disposed:true}])
  assert.equal(await restartAfterResume(()=>state,granted),false,JSON.stringify(state));
 assert.equal(reads,0,'no permission read when there is nothing to restart');
 let current=stopped();
 assert.equal(await restartAfterResume(()=>current,async()=>{current={denied:'camera',phase:'starting',disposed:false};return {camera:'granted'};}),false,'a retry that started meanwhile is not restarted twice');
});
test('the adapter resumes only through that decision',()=>{
 assert.match(source,/import \{cameraAccessDenied,restartAfterResume,type CameraAccessKind as AccessKind\} from '\.\.\/\.\.\/\.\.\/\.\.\/\.eliza\/client-features\/plugins\/plugin-native-camera\/src\/host-ports\.ts';/);
 assert.doesNotMatch(source,/async function restartAfterResume\(/,'no second copy of the shared rule');
 assert.match(source,/const resumed=\(\)=>\{void restartAfterResume\(\(\)=>\(\{denied:session\.denied,phase:session\.phase,disposed\}\),\(\)=>cameraAccess\.checkPermissions\(\)\)\.then\(restart=>\{if\(restart\)\{session\.rearm\(\);schedule\(\);\}\}\);\};/);
 assert.doesNotMatch(source,/const resumed=\(\)=>\{if\(denied==='camera'/);
});
test('the camera lifecycle is the shared session, not an adapter copy',()=>{
 assert.match(source,/import \{createCameraSession\} from '\.\.\/\.\.\/\.\.\/\.\.\/\.eliza\/client-features\/plugins\/plugin-native-camera\/src\/session\.ts';/);
 assert.match(source,/const session=createCameraSession\(\{/);
 // No second preview epoch, phase, capture lock or recording state in the adapter.
 for(const copy of [/let phase\b/,/let epoch\b/,/\bcapturing ?= ?true/,/\brecordingStarting ?= ?true/,/let stopping\b/,/let finalizing\b/])assert.doesNotMatch(source,copy,String(copy));
 // Captures and recordings go through the session's exclusive capture and single-flight finalization.
 assert.match(source,/await session\.exclusive\(async token=>\{/);
 assert.match(source,/const finishVideo=\(\)=>session\.finishRecording\(\);/);
 assert.match(source,/recordingSaved:adoptVideo,/);
});
