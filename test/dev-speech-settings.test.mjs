import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {developmentSpeechEnvironment} from '../scripts/dev-speech-settings.ts';
function profile(t,raw){const directory=mkdtempSync(join(tmpdir(),'alpha-dev-speech-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));if(raw!==undefined)writeFileSync(join(directory,'local-speech.json'),typeof raw==='string'?raw:JSON.stringify(raw),{mode:0o600});return directory;}
test('a profile without saved speech settings retains the supplied environment',t=>{
 const env={PATH:'/usr/bin',ELIZA_PARADEE_ENABLED:'0'};assert.deepEqual(developmentSpeechEnvironment(profile(t),env),env);
});
test('saved speech paths survive an ordinary restart without shell overrides',t=>{
 const saved={ELIZA_ASR_ENABLED:'1',ELIZA_PARADEE_ENABLED:'1',ELIZA_INFERENCE_LIBRARY_SHA256:'a'.repeat(64),ELIZA_ASR_MODEL_DIR:'/models/asr',ELIZA_INFERENCE_LIBRARY:'/tools/libinference.dylib',ELIZA_PARADEE_MODEL_DIR:'/models/paradee'};
 const directory=profile(t,saved);assert.deepEqual(developmentSpeechEnvironment(directory,{PATH:'/usr/bin'}),{...saved,PATH:'/usr/bin'});assert.deepEqual(developmentSpeechEnvironment(directory,{}),saved);
});
test('a saved file with an earlier Alpha-only key is refused with its upstream ELIZA_* replacement',t=>{
 const renamed={ALPHA_LOCAL_TTS:'ELIZA_PARADEE_ENABLED',ALPHA_TTS_MODEL_DIR:'ELIZA_PARADEE_MODEL_DIR',ALPHA_TTS_LIBRARY:'ELIZA_INFERENCE_LIBRARY',ALPHA_LOCAL_ASR:'ELIZA_ASR_ENABLED',ALPHA_ASR_MODEL_DIR:'ELIZA_ASR_MODEL_DIR'};
 for(const [old,replacement] of Object.entries(renamed)){
  assert.throws(()=>developmentSpeechEnvironment(profile(t,{[old]:'/models/x'}),{}),new RegExp(`${old} is not supported; rename it to the upstream ${replacement}`));
  // The upstream key alongside it does not make the earlier one acceptable.
  assert.throws(()=>developmentSpeechEnvironment(profile(t,{[old]:'/models/x',[replacement]:'/models/y'}),{}),new RegExp(replacement));
 }
 for(const name of ['ALPHA_WHISPER_BIN','ALPHA_WHISPER_BACKEND','ALPHA_ASR_MODEL','ELIZA_KOKORO_MODEL_DIR','ELIZA_KOKORO_ENABLED'])assert.throws(()=>developmentSpeechEnvironment(profile(t,{[name]:'/x'}),{}),new RegExp(`${name} is retired; configure ELIZA_INFERENCE_LIBRARY`));
});
test('explicit environment choices including voice off override saved defaults without mutation',t=>{
 const directory=profile(t,{ELIZA_PARADEE_ENABLED:'1',ELIZA_INFERENCE_LIBRARY:'/saved/library'}),env={ELIZA_PARADEE_ENABLED:'0',ELIZA_INFERENCE_LIBRARY:'/override/library'};
 assert.deepEqual(developmentSpeechEnvironment(directory,env),env);assert.equal(developmentSpeechEnvironment(directory,{}).ELIZA_PARADEE_ENABLED,'1');
});
for(const raw of ['{broken',null,[],{ELIZA_PARADEE_ENABLED:'silent'},{ALPHA_LOCAL_TTS:'required'},{ALPHA_ASR_MODEL_DIR:'/models/asr'},{ELIZA_INFERENCE_LIBRARY:'relative/library'},{ELIZA_PARADEE_MODEL_DIR:'/path\0bad'},{CEREBRAS_API_KEY:'synthetic-do-not-echo'},{NODE_OPTIONS:'--inspect'}])test(`invalid saved speech settings fail closed: ${JSON.stringify(raw)}`,t=>{
 assert.throws(()=>developmentSpeechEnvironment(profile(t,raw),{}),error=>!error.message.includes('synthetic-do-not-echo'));
});
test('saved settings reject shared access and symlinks instead of reading an alternate file',t=>{
 const directory=profile(t,{ELIZA_PARADEE_ENABLED:'1'}),file=join(directory,'local-speech.json');chmodSync(file,0o644);assert.throws(()=>developmentSpeechEnvironment(directory,{}),/owner-only/);
 rmSync(file);const target=join(directory,'target.json');writeFileSync(target,'{}',{mode:0o600});symlinkSync(target,file);assert.throws(()=>developmentSpeechEnvironment(directory,{}));
});
test('oversized saved settings are rejected before parsing',t=>{
 assert.throws(()=>developmentSpeechEnvironment(profile(t,' '.repeat(16385)),{}),/too large/);
});
