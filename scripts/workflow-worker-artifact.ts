import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,lstatSync,readdirSync,mkdirSync,copyFileSync,writeFileSync,renameSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
const identityFields = ['sourceStampSha256', 'lockSha256'] as const;
type WorkerIdentity = Record<(typeof identityFields)[number], string>;
interface WorkerManifest extends WorkerIdentity {
 version: 1;
 files: Record<string, unknown>;
}
export const workerHash=(bytes: NodeJS.ArrayBufferView)=>createHash('sha256').update(bytes).digest('hex');
export function verifyWorkerArtifact(directory: string, expected: Partial<WorkerIdentity> = {}) {
 const root=resolve(directory);
 for(let path=root;;path=dirname(path)){if(lstatSync(path).isSymbolicLink())throw Error('Worker artifact path contains a symlink');if(dirname(path)===path)break;}
 // An artifact from the retired patch builder must not be reused as upstream source.
 const overlayRecord=`${root}.patch-overlay.json`;
 if(existsSync(overlayRecord)){
  const stat=lstatSync(overlayRecord);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('Invalid worker source record');
  if(JSON.parse(readFileSync(overlayRecord,'utf8')).overlay!==null)throw Error('Patched worker artifact is not upstream source; rebuild into a fresh directory');
 }
 const manifestStat=lstatSync(join(root,'manifest.json'));
 if(!manifestStat.isFile()||manifestStat.isSymbolicLink()||manifestStat.size>1024*1024)throw Error('Invalid worker manifest file');
 const manifestBytes=readFileSync(join(root,'manifest.json'));
 const manifest: WorkerManifest = JSON.parse(manifestBytes.toString('utf8'));
 if(manifest.version!==1||!manifest.files||Array.isArray(manifest.files)||typeof manifest.files!=='object')throw Error('Invalid worker manifest');
 for(const key of identityFields){
  if(!/^[a-f0-9]{64}$/.test(manifest[key])||(expected[key]&&manifest[key]!==expected[key]))throw Error(`Worker ${key} mismatch`);
 }
 const entries=Object.entries(manifest.files);
 if(!entries.length||entries.length>4095)throw Error('Worker file count out of bounds');
 const seen=new Set();let total=manifestBytes.length;
 function visit(dir: string){for(const name of readdirSync(dir)){
  const file=join(dir,name),stat=lstatSync(file);if(stat.isSymbolicLink())throw Error('Worker artifact contains a symlink');
  if(stat.isDirectory()){visit(file);continue;}if(!stat.isFile())throw Error('Worker artifact contains a special file');
  const path=relative(root,file);if(path==='manifest.json')continue;
  if(!Object.hasOwn(manifest.files,path))throw Error('Unexpected worker file');seen.add(path);
 }}visit(root);
 const files: [string, string][] = [];
 for(const [path,hash] of entries){
  if(!/^[A-Za-z0-9@_.+/-]+$/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..')||path==='manifest.json'||!seen.has(path))throw Error('Invalid or missing worker file');
  total+=lstatSync(join(root,path)).size;if(total>64*1024*1024)throw Error('Worker artifact exceeds 64 MiB');
  const bytes=readFileSync(join(root,path));
  if(typeof hash !== 'string'||!/^[a-f0-9]{64}$/.test(hash)||workerHash(bytes)!==hash)throw Error('Worker file hash mismatch');
  files.push([path, hash]);
 }
 for(const required of ['node_modules/smthrs/package.json','node_modules/zod/package.json','node_modules/effect/package.json','node_modules/@smthrs/engine/package.json','dependencies.json'])if(!seen.has(required))throw Error('Worker dependency missing');
 const manifestHash = workerHash(manifestBytes);
 files.push(['manifest.json', manifestHash]);
 return {manifest,files,manifestHash,bytes:total};
}
export function stageWorkerArtifact(source: string, destination: string, expected: Partial<WorkerIdentity> = {}) {
 const verified=verifyWorkerArtifact(source,expected),target=resolve(destination),parent=dirname(target);
 for(let path=target;;path=dirname(path)){
  let stat;try{stat=lstatSync(path);}catch(error){if(!(error instanceof Error && 'code' in error && error.code==='ENOENT'))throw error;}
  if(stat?.isSymbolicLink())throw Error('Worker staging path contains a symlink');if(dirname(path)===path)break;
 }
 mkdirSync(parent,{recursive:true});
 const temporary=join(parent,`.workflow-worker-${randomUUID()}`),backup=temporary+'.previous';
 mkdirSync(temporary);let moved=false;
 try {
  for(const [path] of verified.files){mkdirSync(dirname(join(temporary,path)),{recursive:true});copyFileSync(join(source,path),join(temporary,path));}
  // Recheck copied bytes before generating the native extractor's bounded index.
  verifyWorkerArtifact(temporary,expected);
  if(workerHash(readFileSync(join(temporary,'manifest.json')))!==verified.manifestHash)throw Error('Worker manifest changed during staging');
  const index=verified.files.map(([path,hash])=>`${hash}\t${path}\n`).join('');
  if(Buffer.byteLength(index)>1024*1024)throw Error('Worker extraction index exceeds 1 MiB');
  writeFileSync(join(temporary,'files.sha256'),index);
  if(existsSync(target)){renameSync(target,backup);moved=true;}
  try{renameSync(temporary,target);}catch(error){if(moved)renameSync(backup,target);throw error;}
  if(moved)rmSync(backup,{recursive:true,maxRetries:3,retryDelay:100});
  return {files:verified.files.length,bytes:verified.bytes,indexSha256:workerHash(Buffer.from(index))};
 }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
