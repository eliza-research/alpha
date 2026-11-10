import {admitSpeech} from './host-speech-admission.ts';
import {refuseRetiredSpeechNames, speechMode} from './speech-env.ts';
/** Explicit installed, reviewed host assets (upstream names); readiness belongs to the native worker. */
export function agentAsrEnvironment(env: any=process.env) {
 refuseRetiredSpeechNames(env);
 const mode=speechMode(env,'ELIZA_ASR_ENABLED');
 if(mode==='off')return {};
 if(!env.ELIZA_ASR_MODEL_DIR && mode==='auto')return {};
 return admitSpeech('asr',env);
}
