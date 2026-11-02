import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,lstatSync,readdirSync,realpathSync,writeFileSync,existsSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {resolve,join,dirname,relative,isAbsolute,basename} from 'node:path';

// Export only known generated output. No profile or environment directories are inputs.
const mode=process.argv[2],root=resolve(process.cwd());
if(!['renderer','worker'].includes(mode))throw Error('Choose renderer or worker');
if(realpathSync(root)!==root)throw Error('Workspace must be canonical');
const hash=b=>createHash('sha256').update(b).digest('hex');
const git=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0'}}).trim();
function checked(path,missing=false){
 const absolute=resolve(path),rel=relative(root,absolute);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('Path escaped workspace');
 let cursor=root;
 for(const part of rel.split('/').filter(Boolean)){
  cursor=join(cursor,part);
  if(!existsSync(cursor)){
   // lstat also detects a dangling symlink, which existsSync would follow.
   try{lstatSync(cursor);throw Error('Dangling output link');}catch(error){if(error.code!=='ENOENT')throw error;}
   if(missing)continue;
   throw Error('Missing input path');
  }
  if(lstatSync(cursor).isSymbolicLink()||realpathSync(cursor)!==cursor)throw Error('Symlinked path');
 }
 return absolute;
}
function directory(path){
 const absolute=checked(path,true);if(absolute===root)return;
 directory(dirname(absolute));
 if(!existsSync(absolute))mkdirSync(absolute);
 if(!lstatSync(checked(absolute)).isDirectory())throw Error('Expected directory');
}
const LIMIT=96*1024*1024,FILE_LIMIT=32*1024*1024;let readBytes=0,exportedBytes=0;
function read(path){
 const fd=openSync(checked(path),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd),remaining=LIMIT-readBytes;
  if(!stat.isFile()||stat.size>remaining||stat.size>FILE_LIMIT)throw Error('Proof file exceeds budget');
  const buffer=Buffer.alloc(stat.size+1);let length=0,n;
  while(length<buffer.length&&(n=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=n;
  if(length!==stat.size||fstatSync(fd).size!==stat.size)throw Error('Input changed while reading');
  readBytes+=length;return buffer.subarray(0,length);
 }finally{closeSync(fd);}
}
const lockBytes=read(join(root,'upstream.lock.json')),sdk=JSON.parse(lockBytes).commit;
checked(join(root,'vendor/eliza'));
if(!/^[a-f0-9]{40}$/.test(sdk)||git('rev-parse','HEAD:vendor/eliza')!==sdk||git('-C','vendor/eliza','rev-parse','HEAD')!==sdk)throw Error('SDK checkout differs from lock');
const source=checked(mode==='renderer'?resolve('test-results/browser-proof-renderer'):resolve(`artifacts/mobile-workflow-worker-${sdk}`));
const output=checked(resolve(`test-results/browser-proof/${mode}`),true);
directory(dirname(output));mkdirSync(output); // Exclusive: never overlay a previous export.
const files={};
const forbidden=/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc(?:\..*)?|\.netrc(?:\..*)?|id_rsa(?:\..*)?|id_ed25519(?:\..*)?)(?:\/|$)|\.(?:pem|key|p12|pfx|db|sqlite\d?|log|node|so(?:\.\d+)*|dylib|dll|exe|a|o)$/i;
const privateDataName=/^(?:credentials?|cookies?|profiles?|sessions?)(?:\..*)?$/i;
let verifiedWorkerPaths=new Set();
const license=name=>/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-][A-Za-z0-9._-]+)?$/i.test(basename(name));
function allowed(path){
 const parts=path.split('/');
 if(!/^[A-Za-z0-9@_.+/-]+$/.test(path)||parts.some(x=>!x||x==='.'||x==='..')||forbidden.test(path))return false;
 // Declaration names describe types, not stored cookie/credential data. Only an
 // exact manifest-verified compiler declaration may use one of those basenames.
 const declaration=mode==='worker'&&verifiedWorkerPaths.has(path)&&/^compiler\/(?:node_modules|types)\//.test(path)&&/\.d\.(?:ts|mts|cts)$/.test(path);
 if(parts.slice(0,-1).some(part=>privateDataName.test(part)))return false;
 if(privateDataName.test(parts.at(-1))&&!declaration)return false;
 if(mode==='worker')return ['manifest.json','dependencies.json','google-host.mjs'].includes(path)
  ||(/^lib\/[^/]+\.js$/.test(path))
  ||(/^(?:node_modules|compiler)\//.test(path)&&(/\.(?:js|mjs|cjs|json|d\.ts)$/.test(path)||license(path)))
  // The compiler copies TypeScript's resolved SourceFiles: TS/TSX, module TS
  // (including .d.mts/.d.cts), and JSX; JS/MJS/CJS/JSON are allowed above.
  // This is compiler-only and still bound to the exact verified worker inventory.
  ||(/^compiler\/(?:node_modules|types)\/.+\.(?:ts|tsx|mts|cts|jsx)$/.test(path))
  ||(/^licenses\/[a-f0-9]+\//.test(path)&&license(path));
 return ['index.html','delegation-return.html','build-flags.json','logo.svg','logo-mark.svg','denton-300.woff2'].includes(path)
  ||(/^(?:assets|icons|fonts|licenses)\//.test(path)&&/\.(?:js|mjs|css|json|txt|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|otf|wasm)$/.test(path))
  ||(/^pdfjs-assets\/(?:cmaps|standard_fonts|wasm)\/[^/]+\.(?:bcmap|pfb|ttf|wasm|js|json)$/.test(path))
  ||path==='pdfjs-assets/LICENSE'
  // Exact notices emitted by browser-pdf-assets.ts from pinned pdfjs-dist 6.3.289.
  ||['pdfjs-assets/cmaps/LICENSE',
    'pdfjs-assets/standard_fonts/LICENSE_FOXIT','pdfjs-assets/standard_fonts/LICENSE_LIBERATION',
    'pdfjs-assets/wasm/LICENSE_JBIG2','pdfjs-assets/wasm/LICENSE_OPENJPEG',
    'pdfjs-assets/wasm/LICENSE_PDFJS_JBIG2','pdfjs-assets/wasm/LICENSE_PDFJS_OPENJPEG',
    'pdfjs-assets/wasm/LICENSE_PDFJS_QCMS','pdfjs-assets/wasm/LICENSE_QCMS'].includes(path)
  ||/^ocr\/(?:worker\.min\.js|tesseract-core-(?:lstm|simd-lstm|relaxedsimd-lstm)\.wasm\.js|eng\.traineddata\.gz|(?:tesseract|core|pdf-lib|tessdata)-LICENSE\.txt)$/.test(path);
}
function exportBytes(path,bytes){
 if(bytes.length>LIMIT-exportedBytes)throw Error('Export exceeds 96 MiB');
 const destination=checked(join(output,path),true);directory(dirname(destination));
 writeFileSync(destination,bytes,{flag:'wx'});files[path]=hash(bytes);exportedBytes+=bytes.length;
}
let worker;
if(mode==='renderer'){
 const flags=JSON.parse(read(join(source,'build-flags.json')));
 if(flags.testMocks!==false||flags.runtimeProfile!=='cloud')throw Error('Expected flag-off Cloud renderer');
}else{
 const {verifyWorkerArtifact}=await import('../workflow-worker-artifact.mjs');
 const prepared=checked(resolve(`artifacts/local-agent-resident-${sdk}`));
 const stamp=read(join(prepared,'.alpha-runtime-source.json')),sdkLock=read(join(prepared,'bun.lock'));
 worker=verifyWorkerArtifact(source,{sourceStampSha256:hash(stamp),lockSha256:hash(sdkLock)});
 verifiedWorkerPaths=new Set(worker.files.map(([path])=>path));
 exportBytes('provenance/runtime-source.json',stamp);
}
const inventory=[],rejected=[];const MAX_FILES=4096;
function rejection(path,reason){rejected.push({path:path.slice(0,240),pathSha256:hash(Buffer.from(path)),truncated:path.length>240,reason});}
function reportRejections(){
 const report=checked(resolve(`test-results/resident-ci-browser-proof-rejections-${mode}.json`),true);directory(dirname(report));
 const bytes=JSON.stringify({schema:1,mode,rejectedCount:rejected.length,inspectedFiles:inventory.length,maxFiles:MAX_FILES,rejected},null,2)+'\n';
 if(Buffer.byteLength(bytes)>2*1024*1024)throw Error('Rejection report exceeds 2 MiB');
 writeFileSync(report,bytes,{flag:'wx'});
 throw Error(`Unexpected payload: ${rejected[0].path}; ${rejected.length} rejected path(s); complete bounded report: ${relative(root,report)}`);
}
function walk(dir){
 for(const name of readdirSync(checked(dir)).sort()){
  const path=checked(join(dir,name)),stat=lstatSync(path);
  if(stat.isDirectory())walk(path);
  else{
   const rel=relative(source,path);
   if(inventory.length>=MAX_FILES){rejection(rel,'inventory-limit');reportRejections();}
   inventory.push(rel);
   if(!stat.isFile())rejection(rel,'not-regular-file');
   else if(!allowed(rel))rejection(rel,'payload-policy');
  }
 }
}
walk(source);
if(rejected.length)reportRejections();
if(worker){
 const expected=worker.files.map(([path])=>path).sort();
 if(JSON.stringify([...inventory].sort())!==JSON.stringify(expected))throw Error('Worker inventory differs from verified manifest');
}
for(const path of inventory){
 const bytes=read(join(source,path));
 if(worker&&hash(bytes)!==new Map(worker.files).get(path))throw Error('Worker changed after verification');
 exportBytes('payload/'+path,bytes);
}
exportBytes('provenance/upstream.lock.json',lockBytes);
exportBytes('provenance/client-source.json',read(resolve('.eliza/client-features/.source.json')));
const identity={schema:1,kind:mode,alphaCommit:git('rev-parse','HEAD'),alphaTree:git('rev-parse','HEAD^{tree}'),sdkCommit:sdk,sdkTree:git('-C','vendor/eliza','rev-parse','HEAD^{tree}'),lockSha256:hash(lockBytes),runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,node:process.version,platform:process.platform,arch:process.arch,files,totalBytes:exportedBytes,readBytes,limits:{authenticatedPromptProof:false,localApiBridgeIncluded:false,nativeQualification:false}};
writeFileSync(checked(join(output,'identity.json'),true),JSON.stringify(identity,null,2)+'\n',{flag:'wx'});
