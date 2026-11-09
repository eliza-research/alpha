import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {sharedRecordingPlatform} from './shared-recording-platform.mjs';
export const speechWarmupScenarios=['deadline','near-deadline','late-open','open-fail','play-fail','close-write','zero','negative','write-fail','abort-fail','release-fail'];
export async function checkSpeechWarmup(extraSources=[]){
 const platform=sharedRecordingPlatform();
 const compiled=['SpeechOutputWarmup','StreamingSpeechPlayback','SpeechPcmQueue','VoiceLatencyTrials','SpeechAudioFocusPolicy'].map(currentNativeSource).concat(platform.paths.find(path=>path.endsWith('/AudioTrackSpeechOutput.java')));
 const modelPath='specs/quint/native/NativeSpeechWarmup.qnt';
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/shared-recording-platform.mjs',directory+'/note-bridge-platform.mjs',directory+'/note-recording-platform.mjs',directory+'/SpeechWarmupTraces.java',directory+'/current-sources.mjs',directory+'/Trace.java',directory+'/java.mjs',fileURLToPath(import.meta.url),...extraSources];
 try{
 const driverHashes=captureInputs(sources);
 const traces=javaTraces('SpeechWarmupTraces.java',compiled,speechWarmupScenarios,'ai.eliza.voice.SpeechWarmupTraces');
 return await checkTraces({model:'NativeSpeechWarmup',modelPath,sources,driverHashes,generatedSources:compiled.filter(path=>platform.paths.includes(path)),traces,scope:'bounded-component',assumptions:[
  'Actual SpeechOutputWarmup executes on its real writer thread. Factory open, play, write, abort and release are primitive outputs or controlled faults.',
  'One warm-up instance with an exact 15 second deadline. A blocked write and factory open are held separately. Repeated short successful writes are bounded in the model; an additional source scenario checks another write just before expiry.',
  'Release observation records a release attempt. AudioTrack completion, bridge foreground/admission, reply playback and installed audibility remain separate obligations.'
 ]});
 }finally{platform.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkSpeechWarmup(),null,2));
