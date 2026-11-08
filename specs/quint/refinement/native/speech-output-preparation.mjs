import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraces} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
export const speechOutputPreparationScenarios=['bounded-lead','long-lead','zero-lead','float-classes','empty','exact-negative','quiet-tail','first-report','failed-callback','failed-write','no-callback','combined','production-lead'];
export async function checkSpeechOutputPreparation(extraSources=[]){
 const modelPath='specs/quint/native/NativeSpeechOutputPreparation.qnt';
 const compiled=['SpeechLeadTrim','FirstWriteSpeechOutput','StreamingSpeechPlayback','SpeechPcmQueue','VoiceLatencyTrials','SpeechAudioFocusPolicy'].map(currentNativeSource);
 const binding=['LocalSpeechBridgePlugin','LocalSpeechEngine','VoiceLatencyProbe'].map(currentNativeSource);
 const sources=[modelPath,...compiled,...binding,...nativePatchInputs,directory+'/SpeechOutputPreparationTraces.java',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const [bridge,engine,probe]=binding.map(path=>readFileSync(path,'utf8'));
 const rate=engine.match(/\bSTREAM_RATE=(\d+);/)?.[1];
 const threshold=probe.match(/\bAUDIBLE_LEVEL=(\d+\.\d+)f;/)?.[1];
 const divisor=bridge.match(/new SpeechLeadTrim\(VoiceLatencyProbe\.AUDIBLE_LEVEL,LocalSpeechEngine\.STREAM_RATE\/(\d+)\)/)?.[1];
 if(!rate||!threshold||!divisor)throw Error('Cannot resolve the staged bridge lead-trim inputs');
 const lead=Math.floor(Number(rate)/Number(divisor));
 const traces=javaTraces('SpeechOutputPreparationTraces.java',compiled,[threshold,String(lead),...speechOutputPreparationScenarios],'ai.eliza.voice.SpeechOutputPreparationTraces');
 return checkTraces({model:'NativeSpeechOutputPreparation',modelPath,sources,driverHashes,traces,scope:'bounded-component',assumptions:[
  'Actual staged SpeechLeadTrim and FirstWriteSpeechOutput execute. Synthetic PCM classes use the exact configured absolute threshold and its adjacent Float values, NaN and both infinities.',
  'Bounded chunks and four pre-roll sizes (including the current production 727 samples) preserve exact retained data, array identity, and zeroing. The real wrapper calls the report before its output write, even when the report or write throws.',
  'Physical output timing, arbitrary sample histories, full bridge publication and device audio remain separate obligations.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkSpeechOutputPreparation(),null,2));
