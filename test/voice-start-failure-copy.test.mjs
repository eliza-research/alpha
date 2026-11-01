import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {voiceFailure} from '../apps/app/src/runtime/voice-states.ts';

// The actual start-catch expression and Cloud mapper, without starting voice,
// importing the app, opening credentials or contacting any service.
const adapter=readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const catchBody=adapter.slice(adapter.indexOf('}catch(failure){if(token!==generation||controller.signal.aborted)return;conversationState='));
const expression=catchBody.slice(catchBody.indexOf('error=')+6,catchBody.indexOf(';refresh();'));
const cloud=readFileSync(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8');
const mapperSource=cloud.slice(cloud.indexOf('function voiceLimitMessage('),cloud.indexOf('export type VoiceClip')).replace('export function cloudVoiceFailure','function cloudVoiceFailure');
const cloudMapper=new Function('developmentCloudVoiceEnabled','browserCloudResidentEnabled','connectionController','cloudServiceName','cloudVoiceServiceLimit','retryDuration',stripTypeScriptTypes(mapperSource,{mode:'transform'})+';return cloudVoiceFailure;')(false,false,{getCloudEnvironment:()=> 'production'},()=> 'Cloud',error=>error.code==='voice-http-429'?{kind:'request-limit',retryAfterMs:120000}:null,()=> '2 minutes');
const render=new Function('failure','cloudVoiceFailure','voiceFailure','Capacitor','classified','return ('+expression+');');
const message=(failure,native=true)=>render(failure,cloudMapper,voiceFailure,{isNativePlatform:()=>native},voiceFailure(failure,{transcribing:false,browser:!native}));

test('unknown startup failures never render raw technical or private details',()=>{
 for(const failure of [new Error('Native transcription close was not confirmed: /private/token=secret'),new TypeError('Cannot read property connection at /Users/private'),{message:'https://secret.example?credential=private',code:'unmapped-private-code'},'private raw rejection']){
  assert.equal(message(failure),'Voice could not start. Try again, or use the keyboard.');
 }
 for(const code of ['local-agent-required','local-agent-starting','recognition-failed','no-speech'])assert.equal(message({code}),'Voice could not start. Try again, or use the keyboard.','startup must not claim a recording exists');
 assert.match(catchBody,/if\(token!==generation\|\|controller\.signal\.aborted\)return;/,'stale or cancelled starts still do not publish an error');
});
test('known auth, provider, rate-limit and microphone recovery stays actionable',()=>{
 assert.match(message({code:'voice-http-401',message:'secret'}),/Sign in to Cloud again in Settings/);
 assert.match(message({code:'voice-http-403'}),/Sign in to Cloud again in Settings/);
 assert.match(message({code:'voice-http-429'}),/request limit.*2 minutes/);
 assert.match(message({code:'voice-stt-upload'}),/recording is kept.*Check your connection/);
 assert.match(message({code:'voice-stt-response'}),/no usable transcript/);
 assert.match(message({code:'permission-denied'}),/Open app settings/);
 assert.match(message({name:'NotAllowedError'},false),/browser’s site settings/);
 assert.match(message({name:'NotFoundError'}),/No usable microphone/);
});
