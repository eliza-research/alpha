import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {app,directory,javaTraces} from './java.mjs';
import {noteRecordingPlatform} from './note-recording-platform.mjs';

export const noteServiceScenarios=['old-owner','old-start','old-toggle','blank-open','discard-blank','discard-exact','current-stop','recreated','pause-resume','notification-stop','paused-notification-stop','old-notification-stop','blank-notification-stop','foreground-refused','fallback-old-owner','fallback-blank','fallback-current','fallback-pending','same-id-stop','same-id-fallback','same-id-stopped-fallback'];
export async function checkNoteRecordingService(extraSources=[]) {
 const platform=noteRecordingPlatform(),state=mkdtempSync(join(tmpdir(),'quint-note-service-state-'));
 const compiled=[app+'AlphaNoteRecorder.java',app+'AlphaNoteRecordingService.java',directory+'/NoteRecordingPorts.java',
  'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/JSObject.java'];
 const sources=[...compiled,...platform.paths,directory+'/NoteRecordingServiceTraces.java',directory+'/note-recording-platform.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try {
  const driverHashes=captureInputs(sources);
  const traces=javaTraces('NoteRecordingServiceTraces.java',[...compiled,...platform.paths],[state,'campaign',...noteServiceScenarios]);
  return await checkTraces({model:'NativeNoteRecordingService',sources,driverHashes,generatedSources:platform.paths,traces,scope:'bounded-orchestration',assumptions:[
   'Actual AlphaNoteRecorder and AlphaNoteRecordingService run with real temporary journal files and the real Capacitor JSObject null semantics.',
   'Android service commands and notifications are controlled primitive ports. MediaRecorder produces synthetic bytes; no microphone, audio codec or device notification is used.',
   'The service PendingIntent port keys component, action and API29 identifier, excluding extras; UPDATE_CURRENT replaces extras even for immutable tokens. Installed Binder identity and notification delivery remain external.',
   'Two recording-ID equality classes and serialized Android main-thread service callbacks bound ownership. Device process death and OS foreground eligibility remain platform obligations.'
  ]});
 } finally {platform.close();rmSync(state,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkNoteRecordingService(),null,2));
