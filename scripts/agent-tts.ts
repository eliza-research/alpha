import {admitSpeech} from './host-speech-admission.ts';
import {refuseRetiredSpeechNames, speechMode} from './speech-env.ts';
/** Explicit installed, reviewed host assets (upstream names); readiness belongs to the native worker. */
export function agentTtsEnvironment(env: any=process.env) {
 refuseRetiredSpeechNames(env);
 const mode=speechMode(env,'ELIZA_PARADEE_ENABLED');
 if(mode==='off')return {};
 if(!env.ELIZA_PARADEE_MODEL_DIR && mode==='auto')return {};
 return admitSpeech('tts',env);
}
