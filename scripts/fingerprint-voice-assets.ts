#!/usr/bin/env node
/** Read-only hashes of explicitly configured local voice assets and discoverable dylib closure. macOS only. */
import {admitSpeech} from './host-speech-admission.ts';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
if(process.platform!=='darwin')throw Error('Mach-O closure needs macOS otool; this script runs only on macOS');
const input=path.resolve(process.argv[2]||'test-results/combined-agent/voice-assets.json'),output=path.resolve(process.argv[3]||'test-results/combined-agent/voice-asset-closure.json');
if(fs.existsSync(output))throw Error('Preserve prior closure; choose a new output path');
const raw=fs.readFileSync(input),config=JSON.parse((raw).toString('utf8')),hash=(bytes: any)=>crypto.createHash('sha256').update(bytes).digest('hex'),entries: any[]=[],seen=new Set(),unresolved: any[]=[],system=new Set();
async function file(name: any,kind: any){const resolved=fs.realpathSync(name),stat=fs.statSync(resolved);if(!stat.isFile()||stat.size>2*1024**3)throw Error('Asset is not a bounded regular file');if(seen.has(resolved))return;seen.add(resolved);if(seen.size>512)throw Error('Asset closure bound');const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(resolved))digest.update(chunk);entries.push({path:resolved,bytes:stat.size,sha256:digest.digest('hex'),kind});}
async function tree(dir: any){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a: any,b: any)=>a.name.localeCompare(b.name))){const name=path.join(dir,entry.name);if(entry.isDirectory())await tree(name);else if(entry.isFile())await file(name,'speech-asset');else throw Error('Unexpected symlink or special file in model assets');}}
admitSpeech('tts',config);admitSpeech('asr',config);
const roots=[config.ELIZA_INFERENCE_LIBRARY];
await tree(config.ELIZA_PARADEE_MODEL_DIR);await tree(config.ELIZA_ASR_MODEL_DIR);
const binaries=new Set(),queue=roots.map((value: any)=>({name:fs.realpathSync(value),executable:path.dirname(fs.realpathSync(value))}));
while(queue.length){const {name,executable}=queue.shift()!;if(binaries.has(name))continue;binaries.add(name);await file(name,roots.some((root: any)=>fs.realpathSync(root)===name)?'native-entry':'linked-dylib');
 const listing=execFileSync('/usr/bin/otool',['-L',name],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024}),loads=execFileSync('/usr/bin/otool',['-l',name],{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});
 const expand=(value: any)=>value.replace('@loader_path',path.dirname(name)).replace('@executable_path',executable);
 const rpaths=[...loads.matchAll(/cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset/g)].map((match: any)=>expand(match[1]));
 for(const line of listing.split('\n').slice(1)){const dep=line.trim().split(' (compatibility')[0];if(!dep)continue;if(dep.startsWith('/usr/lib/')||dep.startsWith('/System/Library/')){system.add(dep);continue;}
  const candidates=dep.startsWith('@rpath/')?rpaths.map((root: any)=>path.join(root,dep.slice(7))):[expand(dep)];
  // Homebrew dylibs commonly inherit an executable's sibling lib search path.
  if(dep.startsWith('@rpath/'))candidates.push(path.join(executable,'../lib',dep.slice(7)),path.join(path.dirname(name),dep.slice(7)));
  const resolved=candidates.find((candidate: any)=>path.isAbsolute(candidate)&&fs.existsSync(candidate));if(!resolved){unresolved.push({from:name,dependency:dep});continue;}queue.push({name:fs.realpathSync(resolved),executable});
 }
}
entries.sort((a: any,b: any)=>a.path.localeCompare(b.path));
const record={recordedAt:new Date().toISOString(),scope:'Configured model directory and native entry files plus discoverable non-system Mach-O dependencies; OS shared-cache libraries named but not hashed; runtime dlopen beyond these entries is not discovered',inputSha256:hash(raw),entryCount:entries.length,bytes:entries.reduce((sum: any,entry: any)=>sum+entry.bytes,0),closureSha256:hash(JSON.stringify(entries)),entries,systemDependencies:[...system].sort(),unresolved};fs.writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({output,entryCount:record.entryCount,bytes:record.bytes,closureSha256:record.closureSha256,unresolved:unresolved.length}));
