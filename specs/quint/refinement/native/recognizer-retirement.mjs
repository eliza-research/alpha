import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {javaTraceCampaign} from './java.mjs';
import {currentNativeSource} from './current-sources.mjs';
const fixtures='vendor/eliza/packages/app/scripts/paradee-voice/speech-pipeline';
const platform=fixtures+'/android-api';
export const recognizerPlatformSources=[fixtures+'/OnDeviceRecognizerSessionTest.java',...readdirSync(platform,{recursive:true}).filter(name=>name.endsWith('.java')).map(name=>platform+'/'+name)];
export function probeRecognizerRetirement(){
 const sources=['OnDeviceRecognizer','RecognizerAvailability','RecognizerUnavailable','NativeAsr','VoiceNative'].map(currentNativeSource);
 return javaTraceCampaign('RecognizerRetirementProbe.java',[...sources,...recognizerPlatformSources],[['answered'],['cancelled'],['active']],'ai.eliza.voice.RecognizerRetirementProbe');
}
if(process.argv[1]===fileURLToPath(import.meta.url))console.log(JSON.stringify(probeRecognizerRetirement(),null,2));
