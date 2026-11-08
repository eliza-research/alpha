import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {voiceFailure} from '../apps/app/src/runtime/voice-states.ts';

// The actual start-catch expression and Cloud mapper, without starting voice,
// importing the app, opening credentials or contacting any service.
const adapter=readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const catchBody=adapter.slice(adapter.indexOf('}catch(failure){if(token!==generation||controller.signal.aborted)return;if(quietVoiceRetry(failure,chat,token))return;conversationState='));
const expression=catchBody.slice(catchBody.indexOf('error=')+6,catchBody.indexOf(';refresh();'));
const cloud=readFileSync(new URL('../apps/app/src/runtime/cloud-voice.ts',import.meta.url),'utf8');
const mapperSource=cloud.slice(cloud.indexOf('function voiceLimitMessage('),cloud.indexOf('/** Product registration only;')).replace('export function cloudVoiceFailure','function cloudVoiceFailure');
const makeCloudMapper=own=>new Function('developmentCloudVoiceEnabled','browserCloudResidentEnabled','connectionController','cloudServiceName','cloudVoiceServiceLimit','retryDuration',stripTypeScriptTypes(mapperSource,{mode:'strip'})+';return cloudVoiceFailure;')(false,false,{getCloudEnvironment:()=> 'production',getSnapshot:()=>({residentInference:own?'direct':'cloud'})},()=> 'Cloud',error=>error.code==='voice-http-429'?{kind:'request-limit',retryAfterMs:120000}:null,()=> '2 minutes');
const cloudMapper=makeCloudMapper(false);
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
 assert.equal(message({code:'voice-http-401',message:'secret'}),'Cloud sign-in expired. Sign in again in Settings, then retry voice.');
 assert.equal(message({code:'voice-http-403'}),'Cloud refused voice for this account. Check your account in Settings.');
 assert.match(message({code:'voice-http-429'}),/request limit.*2 minutes/);
 // A chat voice turn keeps no recording: the spoken message is gone and must be said again.
 assert.equal(message({code:'voice-stt-upload'}),'The recording upload could not be confirmed. Check your connection. Your message was not sent. Say it again.');
 assert.equal(message({code:'voice-stt-response'}),'Cloud voice returned no usable transcript. Your message was not sent. Say it again.');
 assert.equal(message({code:'voice-stt-connect'}),'Cloud voice could not use your saved account. Sign in again in Settings. Your message was not sent. Say it again.');
 for(const code of ['voice-stt-connect','voice-stt-upload','voice-stt-response'])assert.doesNotMatch(message({code}),/recording is kept/);
 assert.match(message({code:'permission-denied'}),/Open app settings/);
 assert.match(message({name:'NotAllowedError'},false),/browser’s site settings/);
 assert.match(message({name:'NotFoundError'}),/No usable microphone/);
});

test('own-provider HTTP failures name Cartesia and never request a Cloud plan or expose provider text',()=>{
 for(const code of ['voice-http-401','voice-http-403','voice-http-429','voice-http-503']){
  const text=render({code,message:'PRIVATE_PROVIDER_TEXT'},makeCloudMapper(true),voiceFailure,{isNativePlatform:()=>true},{});
  assert.equal(text,code==='voice-http-503'?'Cartesia isn’t responding. Try again later.':'Cartesia refused voice. Check your key and Cartesia plan.');
  assert.doesNotMatch(text,/Cloud|[0-9]|PRIVATE_PROVIDER_TEXT/);
 }
});
