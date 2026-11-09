import {fileURLToPath} from 'node:url';
import {captureInputs,checkTraces} from '../check-traces.mjs';
import {directory,javaTraceCampaign} from './java.mjs';
import {currentNativeSource,nativePatchInputs} from './current-sources.mjs';
import {recognizerPlatformSources} from './recognizer-retirement.mjs';
export const onDeviceRecognizerScenarios=['incremental','early-result','no-speech','active-language-error','duplicate-language-error','cancelled-language-error','cancel-before-callback-delivery','other-error','timeout','finish-empty','cancel-pending','cancel-before-open','cancel-after-result','backlog-boundary','cancel-stalled'];
export async function checkOnDeviceRecognizer(extraSources=[]){
 const modelPath='specs/quint/native/NativeOnDeviceRecognizer.qnt';
 const compiled=['OnDeviceRecognizer','RecognizerAvailability','RecognizerUnavailable','NativeAsr','VoiceNative'].map(currentNativeSource).concat(recognizerPlatformSources);
 const sources=[modelPath,...compiled,...nativePatchInputs,directory+'/OnDeviceRecognizerTraces.java',directory+'/recognizer-retirement.mjs',directory+'/Trace.java',directory+'/java.mjs',directory+'/current-sources.mjs',fileURLToPath(import.meta.url),...extraSources];
 const driverHashes=captureInputs(sources);
 const traces=javaTraceCampaign('OnDeviceRecognizerTraces.java',compiled,onDeviceRecognizerScenarios.map(name=>[name]),'ai.eliza.voice.OnDeviceRecognizerTraces');
 return checkTraces({model:'NativeOnDeviceRecognizer',modelPath,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
  'The actual recognizer, cache and worker execute with a controlled Android recognizer and pipe. Each session runs in a fresh JVM with a previously observed installed language.',
  'Macro checkpoints include settled platform closure. Exact backlog at the 64-second limit, retirement with an active stalled writer, and first-answer ownership are observed. Transcript values project to synthetic heard/empty classes.',
  'Android Binder ordering, installed recognition, platform pipe guarantees and arbitrary feed/finish interleavings remain external obligations.'
 ]});
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkOnDeviceRecognizer(),null,2));
