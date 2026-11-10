/** Development-only host ASR. No network calls; audio is removed in finally. */
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve, join} from 'node:path';
import {admitSpeech} from './host-speech-admission.ts';
import { tmpdir } from 'node:os';
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const ffmpeg = process.env.ALPHA_FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';
const ffprobe = process.env.ALPHA_FFPROBE_BIN || '/opt/homebrew/bin/ffprobe';
interface AsrEngine {
 service: {
  readonly initialized: boolean;
  initialize(): Promise<unknown>;
  stop(): void;
  transcribe(id: string, samples: Buffer, sampleRate: number, signal: AbortSignal): Promise<unknown>;
 };
 readAudio(audio: Buffer): {samples: Buffer; sampleRate: number};
}
async function loadSharedAsr(): Promise<AsrEngine> {
 if(process.env.ELIZA_ASR_ENABLED==='0')throw Error('Development speech disabled');
 if(!process.versions.bun)throw Error('Shared development speech requires Bun');
 admitSpeech('asr');
 const {sourceDirectory,verifySource}=await import('./local-agent-source.ts');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const source=process.env.ALPHA_ELIZA_SOURCE || sourceDirectory(root);
 const lock=JSON.parse(readFileSync(join(root,'upstream.lock.json'),'utf8'));
 verifySource(source,lock.commit);
 const shared=await import(pathToFileURL(join(source,'packages/app/src/api/standalone-asr-service.ts')).href);
 return {service:new shared.StandaloneAsrService(),readAudio:shared.readMonoPcm16Wav};
}
/** Injectable only for behavior tests; production always loads the admitted shared service. */
export function createLocalAsr(load = loadSharedAsr) {
 let loaded: AsrEngine|undefined;
 let loading: Promise<AsrEngine>|undefined;
 let closed=false;
 async function engine() {
  if (closed) throw Error('Local ASR stopped');
  if (loaded) return loaded;
  loading ??= load().then(value => {
   if (closed) {
    value.service.stop();
    throw Error('Local ASR stopped');
   }
   loaded = value;
   return value;
  }).finally(() => { loading = undefined; });
  return loading;
 }
 return {
  async available(){try{const {service}=await engine();await service.initialize();return !closed&&service.initialized;}catch{return false;}},
  async transcribeWav(audio: Buffer, signal?: AbortSignal){
   signal?.throwIfAborted();const {service,readAudio}=await engine();signal?.throwIfAborted();
   const {samples,sampleRate}=readAudio(audio);
   const text=await service.transcribe(randomUUID(),samples,sampleRate,signal || new AbortController().signal);
   signal?.throwIfAborted();if(closed)throw Error('Local ASR stopped');
   if(typeof text!=='string'||!text.trim()||text.length>16000)throw Error('No usable speech was recognized');
   return {text:text.trim(),language:'en',engine:'local-inference',local:true,durationSeconds:samples.length/(2*sampleRate)};
  },
  stop(){closed=true;loaded?.service.stop();}
 };
}
const localAsr=createLocalAsr();
export const stopLocalAsr=()=>localAsr.stop();
export async function localAsrAvailable(){return localAsr.available();}
function run(executable: string, args: string[], signal: AbortSignal | undefined, timeout=20000) {
 return new Promise<string>((resolve,reject)=>{
  if(signal?.aborted) { reject(new Error('cancelled')); return; }
  const child=spawn(executable,args,{stdio:['ignore','pipe','pipe']});
  let stdout='',size=0,settled=false;
  const finish=(error?: Error)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(stdout);};
  const abort=()=>{child.kill('SIGKILL');};
  const timer=setTimeout(abort,timeout);
  signal?.addEventListener('abort',abort,{once:true});
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>262144)abort();else stdout+=chunk.toString();});
  child.stderr.resume(); // diagnostics may contain transcript/path data; never log them
  child.on('error',()=>finish(new Error('ASR executable unavailable')));
  child.on('close',code=>finish(code===0&&!signal?.aborted?undefined:new Error(signal?.aborted?'cancelled':'ASR process failed or timed out')));
 });
}
export async function transcribeLocal(audio: Buffer, mimeType: string, signal?: AbortSignal) {
 if(!Buffer.isBuffer(audio)||audio.length===0||audio.length>MAX_AUDIO_BYTES)throw new Error('Invalid audio size');
 if(!['audio/wav','audio/x-wav','audio/mp4','audio/m4a','audio/aac','audio/webm'].includes(mimeType))throw new Error('Unsupported audio type');
 signal?.throwIfAborted();
 if(mimeType==='audio/wav'||mimeType==='audio/x-wav')return localAsr.transcribeWav(audio,signal);
 await Promise.all([ffmpeg,ffprobe].map(p=>access(p,constants.X_OK)));
 const directory=await mkdtemp(join(tmpdir(),'alphaphone-audio-'));
 try {
  const input=join(directory,'input.audio'),wav=join(directory,'audio.wav');
  await writeFile(input,audio,{mode:0o600});
  const metadata: {format?: {duration?: string}; streams?: {codec_type?: string}[]} = JSON.parse(await run(ffprobe,['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type','-of','json',input],signal));
  const duration=Number(metadata.format?.duration);
  if(!Number.isFinite(duration)||duration<=0||duration>60||!metadata.streams?.some(stream=>stream.codec_type==='audio'))throw new Error('Audio must contain at most 60 seconds of speech');
  await run(ffmpeg,['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',input,'-map','0:a:0','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-t','60',wav],signal);
  const decoded=await readFile(wav);
  return await localAsr.transcribeWav(decoded,signal);
 } finally { await rm(directory,{recursive:true,force:true}); }
}
