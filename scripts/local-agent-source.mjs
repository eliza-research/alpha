import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFilesClone} from './copy-file-clone.mjs';
import {verifyCommittedWorkspace} from '../vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs';
const present=file=>{try{fs.lstatSync(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
export const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function admittedCommit(root) {
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'upstream.lock.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(manifest.commit))throw Error('Exact admitted runtime commit required for default artifact selection');
 return manifest.commit;
}
// Stable defaults derive from the admitted commit; old physical trees are never relabeled.
export function workerArtifactDirectory(root, env=process.env) {
 const supplied=env.ALPHA_WORKFLOW_WORKER_OUTPUT;
 const directory=supplied?path.resolve(root,supplied):path.join(root,'artifacts',`mobile-workflow-worker-${admittedCommit(root)}`);
 const output=sourceDirectory(root,{ALPHA_LOCAL_AGENT_SOURCE_DIR:directory});
 assertWorkerOutputSeparation(sourceDirectory(root,env),output);
 return output;
}
// Reject before importing/invoking any producer, including historical admitted roots.
export function assertWorkerOutputSeparation(source,output) {
 const relative=path.relative(source,output);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('Worker output must not be inside active prepared source');
 for(let current=output;;current=path.dirname(current)){
  if(present(path.join(current,'.alpha-runtime-source.json')))throw Error('Worker output must not be inside a prepared source tree');
  if(current===path.dirname(current))break;
 }
}
// Turborepo maintains a managed block in the repository-root AGENTS.md whenever it
// detects an AI coding agent, which would modify the immutable prepared checkout.
// Its documented opt-out (`"agentGuidance": false`) lives in the upstream turbo.json,
// which this product never edits, so children in the prepared source run without
// the variables turbo 2.11 detects (each one verified to trigger the update).
export const TURBO_AGENT_DETECTION_ENV=Object.freeze(['AI_AGENT','AUGMENT_AGENT','CLAUDECODE','CLAUDE_CODE','CODEX_SANDBOX','CURSOR_AGENT','CURSOR_TRACE_ID','GEMINI_CLI','OPENCODE','OPENCODE_CLIENT','REPL_ID']);
export function preparedSourceEnv(env=process.env, extra={}) {
 const result={...env,...extra};
 for(const name of TURBO_AGENT_DETECTION_ENV)delete result[name];
 return result;
}
export function sourceDirectory(root, env=process.env) {
 const supplied=env.ALPHA_LOCAL_AGENT_SOURCE_DIR;
 if(supplied&&!path.isAbsolute(supplied))throw Error('ALPHA_LOCAL_AGENT_SOURCE_DIR must be absolute');
 const directory=supplied||path.join(root,'artifacts',`local-agent-resident-${admittedCommit(root)}`);
 const relative=path.relative(path.join(root,'artifacts'),directory);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Prepared runtime must be a child of product artifacts');
 for(let current=directory;current!==path.dirname(current);current=path.dirname(current)){
  let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(stat?.isSymbolicLink())throw Error('Prepared runtime path must not contain symlinks');
 }
 return directory;
}
export function verifySource(directory, commit) {
 return verifyCommittedWorkspace(directory, commit, {
  generatedFiles: ['.alpha-runtime-source.json', '.alpha-stage-runtime.ts'],
  generatedDirectories: ['packages/agent/dist-mobile'],
 });
}


/** Cost: one tracked-tree scan and one bounded read of each cache file; one
 * directory/bounded-argv APFS clone batch, or FICLONE per file elsewhere.
 * Cache outputs and Git metadata are never copied. Destination admission stays
 * with verifySource, including a second check against concurrent source changes.
 */
export function seedCommittedCache(cache, destination, commit) {
 if(!cache||!fs.existsSync(cache)||!fs.statSync(cache).isDirectory())return false;
 cache=fs.realpathSync(cache);destination=path.resolve(destination);
 const git=args=>execFileSync('git',['-C',cache,...args],{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
 try {
  if(fs.realpathSync(git(['rev-parse','--show-toplevel']))!==cache||git(['rev-parse','HEAD'])!==commit)return false;
 }catch{return false;} // Not a matching local checkout: retain ordinary Git fetch/checkout.
 // Sparse working trees do not contain every committed file. Fetched Git objects
 // remain authoritative; ordinary checkout materializes the complete destination.
 try{if(git(['config','--bool','--get','core.sparseCheckout'])==='true')return false;}
 catch(error){if(error.status!==1)throw error;} // An unset option means a full cache.
 if(git(['status','--porcelain','--untracked-files=no']))throw Error('Tracked runtime cache changes must be preserved and reviewed');
 const entries=git(['ls-tree','-r','-z',commit]).split('\0').filter(Boolean);
 const buffer=Buffer.allocUnsafe(1024*1024),regular=[];
 let files=0,bytes=0;
 for(const entry of entries){
  const split=entry.indexOf('\t'),[mode,type,oid]=entry.slice(0,split).split(' '),name=entry.slice(split+1);
  if(split<0||path.isAbsolute(name)||name.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'))throw Error('Unsafe committed runtime path');
  const source=path.join(cache,name),target=path.join(destination,name);
  for(let current=path.dirname(target);current!==destination;current=path.dirname(current))if(present(current)){const dir=fs.lstatSync(current);if(dir.isSymbolicLink()||!dir.isDirectory())throw Error('Unsafe runtime destination parent');}
  if(type==='commit'&&mode==='160000'){
   // Ordinary checkout creates an empty uninitialized-submodule directory.
   // Never copy that submodule's working files or Git metadata from the cache.
   fs.mkdirSync(path.dirname(target),{recursive:true});fs.mkdirSync(target);continue;
  }
  if(type!=='blob'||!['100644','100755','120000'].includes(mode))throw Error('Unsupported committed runtime file');
  for(let current=path.dirname(source);current!==cache;current=path.dirname(current))if(fs.lstatSync(current).isSymbolicLink())throw Error('Linked runtime cache parent');
  const stat=fs.lstatSync(source);
  let link;
  const hash=createHash('sha1');
  if(mode==='120000'){
   if(!stat.isSymbolicLink())throw Error(`Runtime cache source drift: ${name}`);
   link=fs.readlinkSync(source);const value=Buffer.from(link);hash.update(Buffer.from(`blob ${value.length}\0`));hash.update(value);
  }else{
   if(!stat.isFile()||stat.isSymbolicLink()||Boolean(stat.mode&0o100)!==(mode==='100755'))throw Error(`Runtime cache source drift: ${name}`);
   hash.update(Buffer.from(`blob ${stat.size}\0`));
   const file=fs.openSync(source,'r');
   try{let length;while((length=fs.readSync(file,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,length));}finally{fs.closeSync(file);}
  }
  if(hash.digest('hex')!==oid)throw Error(`Runtime cache source drift: ${name}`);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(mode==='120000')fs.symlinkSync(link,target);
  else regular.push({source,destination:target,mode:parseInt(mode,8)&0o777});
  files++;bytes+=stat.size;
 }
 copyFilesClone(regular,{exclusive:true});
 for(const file of regular)fs.chmodSync(file.destination,file.mode);
 if(git(['rev-parse','HEAD'])!==commit||git(['status','--porcelain','--untracked-files=no']))throw Error('Runtime cache changed while preparing source');
 console.log(`Seeded ${files} committed files (${bytes} bytes) with copy-on-write attempts`);
 return true;
}
