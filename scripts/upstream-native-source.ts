import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const sha = (bytes: string | NodeJS.ArrayBufferView) => createHash('sha256').update(bytes).digest('hex');
export interface UpstreamBlob {
 bytes: Buffer;
 mode: '100644' | '100755';
 sha256: string;
}

// A batch is bounded by the same 64 MiB subprocess limit as individual reads.
// Decode framing as ASCII only; blob payloads remain byte-exact, including NULs.
export function parseNativeBlobBatch(output: unknown, oids: readonly string[]) {
 if(!Buffer.isBuffer(output)||output.length>64*1024*1024)throw Error('Invalid native blob batch');
 const result: Buffer[]=[];let offset=0;
 for(const oid of oids){
  if(!/^[a-f0-9]{40}$/.test(oid))throw Error('Invalid native blob identity');
  const newline=output.indexOf(10,offset);
  if(newline<0||newline-offset>100)throw Error('Invalid native blob header');
  const headerBytes=output.subarray(offset,newline);
  if(headerBytes.some(byte=>byte>127))throw Error('Invalid native blob header encoding');
  const header=headerBytes.toString('ascii');
  const match=header.match(/^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/);
  if(!match||match[1]!==oid)throw Error('Unexpected native blob identity or type');
  const size=Number(match[2]);offset=newline+1;
  if(!Number.isSafeInteger(size)||size>64*1024*1024||size>output.length-offset-1||output[offset+size]!==10)throw Error('Invalid native blob size or terminator');
  result.push(output.subarray(offset,offset+size));offset+=size+1;
 }
 if(offset!==output.length)throw Error('Unexpected native blob trailing bytes');
 return result;
}
export function upstreamNativeSource(root: string) {
 const pin=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8')).commit;
 if(typeof pin !== 'string' || !/^[a-f0-9]{40}$/.test(pin))throw Error('Invalid upstream commit');
 const directory=path.join(root,'vendor/eliza');
 const git=(args: string[])=>execFileSync('git',['-C',directory,...args],{maxBuffer:64*1024*1024});
 if(git(['rev-parse','HEAD']).toString().trim()!==pin)throw Error('Unexpected upstream source pin');
 if(git(['status','--porcelain','--untracked-files=normal']).toString().trim())throw Error('Upstream source checkout is dirty');
 const under=(name: string,prefix: string)=>name===prefix||name.startsWith(prefix.replace(/\/$/,'')+'/');
 /** Read several source paths with one tree listing and one blob batch; the result follows the order of
  * `prefixes`. Every path is held to the same checks as a single `read`. */
 function readAll(prefixes: readonly string[], {allowMissing = false} = {}): Map<string, UpstreamBlob>[] {
  for(const prefix of prefixes)if(!prefix||prefix.startsWith('/')||prefix.split('/').includes('..'))throw Error('Invalid upstream source path');
  if(!prefixes.length)return [];
  const entries=git(['ls-tree','-r','-z',pin,'--',...prefixes]).toString().split('\0').filter(Boolean);
  const inventory=entries.map(entry=>{
   const match=entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
   if(!match)throw Error('Nonregular upstream source');
   return match;
  });
  const groups=prefixes.map(prefix=>{
   const group=inventory.filter(match=>under(match[3],prefix));
   if(!group.length&&!allowMissing)throw Error(`Missing upstream source: ${prefix}`);
   return group;
  });
  if(inventory.some(match=>!prefixes.some(prefix=>under(match[3],prefix))))throw Error('Unexpected upstream source inventory');
  const oids=inventory.map(match=>match[2]);
  const blobs=oids.length?parseNativeBlobBatch(execFileSync('git',['-C',directory,'cat-file','--batch'],{input:oids.join('\n')+'\n',maxBuffer:64*1024*1024}),oids):[];
  const files=new Map<string, UpstreamBlob>();
  for(const [index,match] of inventory.entries()){
   const name = match[3];
   const mode = match[1] === '100755' ? '100755' : '100644';
   const filename=path.join(directory,name);
   for(let current=filename;current!==directory;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('Symlink in upstream source path');
   const stat=fs.lstatSync(filename),bytes=blobs[index];
   if(!stat.isFile()||Boolean(stat.mode&0o100)!==(mode==='100755')||!fs.readFileSync(filename).equals(bytes))throw Error(`Upstream source drift: ${name}`);
   files.set(name,{bytes,mode,sha256:sha(bytes)});
  }
  return groups.map(group=>new Map(group.map(match=>[match[3],files.get(match[3])!])));
 }
 const read=(prefix: string, options: {allowMissing?: boolean} = {}): Map<string, UpstreamBlob>=>readAll([prefix],options)[0];
 return {pin,directory,read,readAll};
}
