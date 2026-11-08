import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Leave space below Darwin ARG_MAX for the environment and argument pointers.
export const CLONE_ARGUMENT_BYTES=64*1024;
export const cloneArgumentBytes=args=>args.reduce((sum,arg)=>sum+Buffer.byteLength(arg)+16,0);

/** Plans the native clone calls without touching the filesystem. Off Darwin
 * every file is one batch; on Darwin renamed files clone one at a time and
 * same-name files share a directory call whose argv stays under the bound.
 */
export function planCloneBatches(files,platform,{exclusive=false}={}) {
 if(platform!=='darwin')return [{files}];
 const batches=[],directories=new Map();
 for(const file of files){
  if(path.basename(file.source)!==path.basename(file.destination)){batches.push({files:[file],target:file.destination});continue;}
  const directory=path.dirname(file.destination);
  if(!directories.has(directory))directories.set(directory,[]);
  directories.get(directory).push(file);
 }
 for(const [directory,entries] of directories){
  const overhead=cloneArgumentBytes(['/bin/cp','-c',...(exclusive?['-n']:[]),directory]);
  let batch=[],bytes=overhead;
  for(const file of entries){
   const size=cloneArgumentBytes([file.source]);
   if(batch.length&&bytes+size>CLONE_ARGUMENT_BYTES){batches.push({files:batch,target:directory,directory:true});batch=[];bytes=overhead;}
   batch.push(file);bytes+=size;
  }
  if(batch.length)batches.push({files:batch,target:directory,directory:true});
 }
 return batches;
}

/** Same-name files share one directory/bounded-argv native clone attempt.
 * Renamed APKs keep the single-file path. Normal copy is the portable fallback;
 * no hard links or shared file identities are introduced.
 */
export function copyFilesClone(files,{exclusive=false}={}) {
 const flags=exclusive?fs.constants.COPYFILE_EXCL:0;
 if(exclusive)for(const file of files){try{fs.lstatSync(file.destination);throw Object.assign(Error('Clone destination already exists'),{code:'EEXIST'});}catch(error){if(error.code!=='ENOENT')throw error;}}
 function cloneBatch(batch,target){
  if(process.platform==='darwin'){
   try{execFileSync('/bin/cp',['-c',...(exclusive?['-n']:[]),...batch.map(file=>file.source),target],{stdio:'inherit'});return;}
   catch(error){
    // Partial exclusive batches remain evidence; never overwrite their files.
    if(exclusive&&batch.some(file=>fs.existsSync(file.destination)))throw error;
   }
  }
  for(const file of batch)fs.copyFileSync(file.source,file.destination,flags|(process.platform==='darwin'?0:fs.constants.COPYFILE_FICLONE));
 }
 const batches=planCloneBatches(files,process.platform,{exclusive});
 for(const batch of batches)if(batch.directory&&!fs.statSync(batch.target).isDirectory())throw Error('Clone target must be a directory');
 for(const batch of batches)cloneBatch(batch.files,batch.target);
}
