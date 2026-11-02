#!/usr/bin/env node
/** Prepare one immutable upstream commit without consumer source overlays. */
import fs from 'node:fs';
import path from 'node:path';
import {digest, preparedSourceEnv, sourceDirectory, verifySource, seedCommittedCache} from './local-agent-source.mjs';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const directory=sourceDirectory(root);
const lock=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8'));
const stamp={lockSha256:digest(path.join(root,'upstream.lock.json')),preparerSha256:digest(path.join(root,'scripts/prepare-local-agent.mjs')),guardSha256:digest(path.join(root,'scripts/local-agent-source.mjs')),copySha256:digest(path.join(root,'scripts/copy-file-clone.mjs')),base:lock.commit,patches:[]};
// Agent-detection variables are removed so turbo cannot rewrite the checkout's AGENTS.md.
const run=(command,args,cwd=directory,extra={})=>execFileSync(command,args,{cwd,stdio:'inherit',env:preparedSourceEnv(process.env,{ELIZA_SKIP_FUSED_INFERENCE_SETUP:'1',...extra})});
const stampFile=path.join(directory,'.alpha-runtime-source.json');
const requalifyAt=process.argv.indexOf('--requalify-from');
const requalifyFrom=requalifyAt<0?null:process.argv[requalifyAt+1];
const preserveAt=process.argv.indexOf('--preserve-stamp');
const preservedStamp=preserveAt<0?null:process.argv[preserveAt+1];
if(requalifyAt>=0&&(!/^[a-f0-9]{64}$/.test(requalifyFrom||'')||!process.env.ALPHA_LOCAL_AGENT_SOURCE_DIR||!process.argv.includes('--source-only')||!path.isAbsolute(preservedStamp||'')||!path.relative(directory,preservedStamp).startsWith('..'+path.sep)))throw Error('Requalification requires an exact prior stamp SHA-256, explicit source directory, --source-only and an external --preserve-stamp path');
if(requalifyAt>=0&&!fs.existsSync(directory))throw Error('Requalification requires an existing prepared source');
if(requalifyAt>=0){
 if(path.resolve(preservedStamp)!==preservedStamp)throw Error('Preserved stamp path must be canonical');
 const parent=path.dirname(preservedStamp);
 for(let current=parent;;current=path.dirname(current)){
  const stat=fs.lstatSync(current);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Preserved stamp parent must contain no symlinks');
  if(current===path.dirname(current))break;
 }
 const relative=path.relative(directory,fs.realpathSync(parent));
 if(relative!== '..'&&!relative.startsWith('..'+path.sep))throw Error('Preserved stamp must be outside the prepared source');
}
if(fs.existsSync(directory)){
 if(!fs.existsSync(stampFile)||fs.readFileSync(stampFile,'utf8')!==JSON.stringify(stamp,null,2)+'\n'){
  if(!requalifyFrom||!fs.existsSync(stampFile)||!fs.lstatSync(stampFile).isFile()||digest(stampFile)!==requalifyFrom)throw Error('Prepared runtime differs or preparation was interrupted. Preserve it and choose a fresh artifacts/local-agent-source directory.');
  verifySource(directory,lock.commit);
  const lockFile=stampFile+'.requalify-lock';
  const lockFd=fs.openSync(lockFile,'wx',0o600);
  try{
   const prior=fs.readFileSync(stampFile);
   if(digest(stampFile)!==requalifyFrom)throw Error('Prior runtime stamp changed during requalification');
   const backupFd=fs.openSync(preservedStamp,'wx',0o600);
   try{fs.writeFileSync(backupFd,prior);fs.fsyncSync(backupFd);}finally{fs.closeSync(backupFd);}
   const backupParent=fs.openSync(path.dirname(preservedStamp),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
   try{fs.fsyncSync(backupParent);}finally{fs.closeSync(backupParent);}
   const nextStamp=stampFile+'.requalify';
   const nextFd=fs.openSync(nextStamp,'wx',0o600);
   try{fs.writeFileSync(nextFd,JSON.stringify(stamp,null,2)+'\n');fs.fsyncSync(nextFd);}finally{fs.closeSync(nextFd);}
   fs.renameSync(nextStamp,stampFile);
  }finally{
   fs.closeSync(lockFd);fs.unlinkSync(lockFile);
   const stampParent=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
   try{fs.fsyncSync(stampParent);}finally{fs.closeSync(stampParent);}
  }
 }
} else {
 fs.mkdirSync(directory,{recursive:true});
 run('git',['init','--quiet']);
 run('git',['fetch','--depth=1',process.env.ALPHA_RUNTIME_GIT_CACHE||lock.url,lock.commit]);
 if(seedCommittedCache(process.env.ALPHA_RUNTIME_GIT_CACHE,directory,lock.commit)){
  // Populate independent metadata without rewriting the authenticated cloned files.
  run('git',['update-ref','--no-deref','HEAD',lock.commit]);
  run('git',['read-tree','HEAD']);
 }else run('git',['checkout','--detach','FETCH_HEAD']);
 verifySource(directory,lock.commit);
 fs.writeFileSync(stampFile,JSON.stringify(stamp,null,2)+'\n');
}
verifySource(directory,lock.commit);
const scriptRunner=process.env.npm_execpath;
const bun=process.env.ALPHA_BUN||(scriptRunner&&/^bun(?:\.exe)?$/.test(path.basename(scriptRunner))?scriptRunner:'bun');
// Postinstall/turbo spawn `bun` by name: keep them on the selected toolchain too.
// A bare command must retain PATH lookup, never add dirname('bun') == '.'.
const installEnv=path.isAbsolute(bun)?{PATH:[path.dirname(bun),process.env.PATH].filter(Boolean).join(path.delimiter)}:{};
if(!process.argv.includes('--source-only'))run(bun,['install','--frozen-lockfile'],directory,installEnv);
verifySource(directory,lock.commit);
console.log(`Prepared local runtime: ${directory}`);
