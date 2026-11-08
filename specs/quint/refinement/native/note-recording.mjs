import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraces} from './java.mjs';
import {noteRecordingPlatform} from './note-recording-platform.mjs';

export const noteRecordingScenarios=['pause','rollover','resume-recovered','rollover-journal-failure','text-journal-failure','join-failure',
  'start-journal-failure','start-open-failure','short-stop','capture-error','stale-callback','next-started','next-journal-failure','wrong-id','corrupt-journal','missing-segment','legacy-binding','text-edit-failure'];
export async function checkNativeNoteRecording(extraSources=[]) {
 const platform=noteRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-state-'));
 const compiled=[app+'AlphaNoteRecorder.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java'];
 const sources=[...compiled,directory+'/NoteRecordingTraces.java',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try {
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('NoteRecordingTraces.java',[...compiled,...platform.paths],[state,'campaign',...noteRecordingScenarios]);
  return await checkTraces({model:'NativeNoteRecording',sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
   'Actual AlphaNoteRecorder public methods and registered MediaRecorder/timer callbacks execute. Durable journal JSON and recording files are real temporary filesystem observations.',
   'Two finished segments, two recording/owner identities and four created MediaRecorder instances bound this campaign. The clock uses exact virtual milliseconds. Codec bytes are synthetic.',
   'Restart reconstructs a fresh actual recorder from journal bytes after clearing process-owned timers and releasing primitive capture resources. Physical power loss and Android media encoders remain platform obligations.',
   'JSObject executes from the real Capacitor source. JSArray is a primitive JSON container port because its generic toList signature conflicts with the host org.json version. Only construction and inherited put are used.'
  ]});
 } finally {platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkNativeNoteRecording(),null,2));
