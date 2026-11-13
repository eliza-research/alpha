/** Evaluate only the authenticated prepared portable source closure in closed VM ports. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {buildSync} from 'esbuild';
export function loadPreparedBatchVoice(box){
 const pin=JSON.parse(fs.readFileSync('upstream.lock.json','utf8')).commit;
 const root=path.resolve('.eliza/client-features'),source=JSON.parse(fs.readFileSync(path.join(root,'.source.json'),'utf8'));
 if(source.baseCommit!==pin)throw Error('Run the normal client feature producer for the current pin.');
 const paths=JSON.parse(fs.readFileSync('tsconfig.json','utf8')).compilerOptions.paths,names=['@elizaos/core/speech','@elizaos/voice/turn','@elizaos/ui/voice/batch-conversation'];
 const alias=Object.fromEntries(names.map(name=>{const value=paths[name];if(!Array.isArray(value)||value.length!==1)throw Error('Missing exact public voice alias: '+name);return [name,path.resolve(value[0])];}));
 const bundle=buildSync({stdin:{contents:names.map(name=>`export * from '${name}';`).join('\n')+"\nexport * from './packages/ui/src/voice/tts-playback-activity.ts';\nexport * from './packages/ui/src/voice/voice-activity.ts';",resolveDir:root,loader:'ts'},alias,bundle:true,write:false,format:'iife',globalName:'__alphaPreparedVoice',platform:'browser',target:'es2022',metafile:true,logLevel:'silent'});
 const inputs=Object.keys(bundle.metafile.inputs).filter(file=>file!=='<stdin>');
 for(const input of inputs){const relative=path.relative(root,path.resolve(input));if(relative.startsWith('..')||path.isAbsolute(relative)||source.files[relative]!==createHash('sha256').update(fs.readFileSync(input)).digest('hex'))throw Error('Prepared public voice source was not authenticated: '+input);}
 vm.runInNewContext(bundle.outputFiles[0].text,box,{filename:'prepared-public-voice.js'});Object.assign(box,box.__alphaPreparedVoice);
 return {inputs:inputs.map(file=>path.relative(root,path.resolve(file))),exports:Object.keys(box.__alphaPreparedVoice)};
}
export function voiceFakeClock(){let now=0,next=0;const timers=new Map();const clock={Date:class extends Date{static now(){return now;}},performance:{now:()=>now},setTimeout(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay});return id;},clearTimeout(id){timers.delete(id);},setInterval(fn,delay){const id=++next;timers.set(id,{fn,at:now+delay,interval:delay});return id;},clearInterval(id){timers.delete(id);},async flush(){for(let count=0;count<30;count++)await Promise.resolve();},async advance(ms){const end=now+ms;for(;;){await clock.flush();const pending=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!pending)break;const [id,timer]=pending;now=timer.at;if(timer.interval)timer.at+=timer.interval;else timers.delete(id);timer.fn();}now=end;await clock.flush();},pending:()=>timers.size};return clock;}
