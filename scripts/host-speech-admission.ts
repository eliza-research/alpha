import {constants, openSync, closeSync, fstatSync, readSync, readFileSync, existsSync, readdirSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {createHash} from 'node:crypto';
export const speechAssets = JSON.parse(readFileSync(new URL('./host-speech-assets.json', import.meta.url), 'utf8'));
export function verifiedFile(file: any, digest: any, maximum: any, exact: any = false) {
 if (!isAbsolute(file || '') || !/^[a-f0-9]{64}$/.test(digest || '')) throw Error('Explicit absolute speech asset and reviewed SHA-256 required');
 const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
 try {
  const before=fstatSync(fd); if(!before.isFile() || !before.size || before.size>maximum || (exact && before.size!==maximum)) throw Error('Invalid speech asset size or type');
  const hash=createHash('sha256'), buffer=Buffer.alloc(1024*1024); let total=0;
  while(total<before.size){const n=readSync(fd,buffer,0,Math.min(buffer.length,before.size-total),total);if(!n)throw Error('Speech asset changed');hash.update(buffer.subarray(0,n));total+=n;}
  const after=fstatSync(fd);if(after.size!==before.size || after.mtimeMs!==before.mtimeMs || hash.digest('hex')!==digest)throw Error('Speech asset checksum mismatch');
 } finally {closeSync(fd);}
}
export function admitSpeech(kind: any, env: any=process.env) {
 const library=env.ELIZA_INFERENCE_LIBRARY, digest=env.ELIZA_INFERENCE_LIBRARY_SHA256;
 const key=kind==='tts'?'ELIZA_PARADEE_MODEL_DIR':'ELIZA_ASR_MODEL_DIR', root=env[key];
 if(!isAbsolute(root||''))throw Error(`Explicit absolute ${key} required`);
 verifiedFile(library,digest,256*1024*1024);
 const pins=[...speechAssets[kind],...(kind==='tts' && existsSync(join(root,'espeak-ng-data'))?speechAssets.espeak:[])];
 for(const pin of pins)verifiedFile(join(root,pin.path),pin.sha256,pin.bytes,true);
 if(kind==='asr'){
  const models: any[]=[]; const walk=(dir: any)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(!entry.isFile())throw Error('Unsupported VAD asset');else if(entry.name.endsWith('.gguf'))models.push(file);}};
  walk(join(root,'vad'));if(models.length!==1 || models[0]!==join(root,'vad/silero-vad-v5.gguf'))throw Error('Ambiguous VAD assets');
  // asr/ holds only the pinned Phonon-2 GGUF; the library would load any other GGUF it finds there.
  const asr: any[]=[];const walkAsr=(dir: any)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walkAsr(file);else if(!entry.isFile())throw Error('Unsupported ASR asset');else if(entry.name.endsWith('.gguf'))asr.push(file);}};
  walkAsr(join(root,'asr'));const expected=speechAssets.asr.filter((pin: any)=>pin.path.startsWith('asr/')).map((pin: any)=>join(root,pin.path));
  if(asr.length!==expected.length||asr.some((file: any)=>!expected.includes(file)))throw Error('Ambiguous ASR assets');
 }
 return {ELIZA_INFERENCE_LIBRARY:library,ELIZA_INFERENCE_LIBRARY_SHA256:digest,[key]:root,[kind==='tts'?'ELIZA_PARADEE_ENABLED':'ELIZA_ASR_ENABLED']:'1',...(kind==='asr'?{ELIZA_ASR_BACKEND:'ggml'}:{})};
}
