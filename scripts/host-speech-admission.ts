import {constants, openSync, closeSync, fstatSync, readSync, existsSync, readdirSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {createHash} from 'node:crypto';
import speechAssets from './host-speech-assets.json' with {type: 'json'};
import {refuseRetiredSpeechNames, speechMode} from './speech-env.ts';

export {speechAssets};

const settings = {
 asr: {enabled: 'ELIZA_ASR_ENABLED', directory: 'ELIZA_ASR_MODEL_DIR'},
 tts: {enabled: 'ELIZA_PARADEE_ENABLED', directory: 'ELIZA_PARADEE_MODEL_DIR'},
} as const;
type SpeechKind = keyof typeof settings;

export function verifiedFile(file: string | undefined, digest: string | undefined, maximum: number, exact = false) {
 if (!file || !isAbsolute(file) || !/^[a-f0-9]{64}$/.test(digest ?? '')) throw Error('Explicit absolute speech asset and reviewed SHA-256 required');
 const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 try {
  const before=fstatSync(fd); if(!before.isFile() || !before.size || before.size>maximum || (exact && before.size!==maximum)) throw Error('Invalid speech asset size or type');
  const hash=createHash('sha256'), buffer=Buffer.alloc(1024*1024); let total=0;
  while(total<before.size){const n=readSync(fd,buffer,0,Math.min(buffer.length,before.size-total),total);if(!n)throw Error('Speech asset changed');hash.update(buffer.subarray(0,n));total+=n;}
  const after=fstatSync(fd);if(after.size!==before.size || after.mtimeMs!==before.mtimeMs || hash.digest('hex')!==digest)throw Error('Speech asset checksum mismatch');
 } finally {closeSync(fd);}
}

function modelsIn(directory: string, label: 'ASR' | 'VAD'): string[] {
 const models: string[] = [];
 for (const entry of readdirSync(directory, {withFileTypes: true})) {
  const file = join(directory, entry.name);
  if (entry.isDirectory()) models.push(...modelsIn(file, label));
  else if (!entry.isFile()) throw Error(`Unsupported ${label} asset`);
  else if (entry.name.endsWith('.gguf')) models.push(file);
 }
 return models;
}

export function admitSpeech(kind: SpeechKind, env = process.env): NodeJS.ProcessEnv {
 const library = env.ELIZA_INFERENCE_LIBRARY;
 const digest = env.ELIZA_INFERENCE_LIBRARY_SHA256;
 const {enabled, directory} = settings[kind];
 const root = env[directory];
 if (!root || !isAbsolute(root)) throw Error(`Explicit absolute ${directory} required`);
 verifiedFile(library, digest, 256*1024*1024);
 const pins = [...speechAssets[kind], ...(kind === 'tts' && existsSync(join(root, 'espeak-ng-data')) ? speechAssets.espeak : [])];
 for (const pin of pins) verifiedFile(join(root, pin.path), pin.sha256, pin.bytes, true);
 if (kind === 'asr') {
  const vad = modelsIn(join(root, 'vad'), 'VAD');
  if (vad.length !== 1 || vad[0] !== join(root, 'vad/silero-vad-v5.gguf')) throw Error('Ambiguous VAD assets');
  // The library would load any other GGUF it finds here.
  const asr = modelsIn(join(root, 'asr'), 'ASR');
  const expected = speechAssets.asr.filter(pin => pin.path.startsWith('asr/')).map(pin => join(root, pin.path));
  if (asr.length !== expected.length || asr.some(file => !expected.includes(file))) throw Error('Ambiguous ASR assets');
 }
 return {ELIZA_INFERENCE_LIBRARY:library,ELIZA_INFERENCE_LIBRARY_SHA256:digest,[directory]:root,[enabled]:'1',...(kind==='asr'?{ELIZA_ASR_BACKEND:'ggml'}:{})};
}

/** Admit requested host assets. Readiness belongs to the native worker. */
export function speechEnvironment(kind: SpeechKind, env = process.env): NodeJS.ProcessEnv {
 refuseRetiredSpeechNames(env);
 const {enabled, directory} = settings[kind];
 const mode = speechMode(env, enabled);
 if (mode === 'off' || (mode === 'auto' && !env[directory])) return {};
 return admitSpeech(kind, env);
}
