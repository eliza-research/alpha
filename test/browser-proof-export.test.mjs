import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const exporter=fileURLToPath(new URL('../scripts/ci/export-browser-proof.mjs',import.meta.url));
function fixture(t){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'alpha-export-test-')));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0'};
 const git=(cwd,...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd,env,encoding:'utf8'}).trim();
 const write=(path,value)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),value);};
 const vendor=join(root,'vendor/eliza');mkdirSync(vendor,{recursive:true});
 git(vendor,'init','-q','--object-format=sha1');git(vendor,'commit','-qm','fixture','--allow-empty');
 const sdk=git(vendor,'rev-parse','HEAD');
 git(root,'init','-q','--object-format=sha1');
 write('upstream.lock.json',JSON.stringify({commit:sdk}));
 write('.eliza/client-features/.source.json','{}');
 write('test-results/browser-proof-renderer/build-flags.json',JSON.stringify({testMocks:false,runtimeProfile:'cloud'}));
 write('test-results/browser-proof-renderer/index.html','<!doctype html><title>Fixture</title>');
 git(root,'add','upstream.lock.json');git(root,'update-index','--add','--cacheinfo',`160000,${sdk},vendor/eliza`);git(root,'commit','-qm','fixture');
 return {root,sdk,write,run:(mode='renderer')=>spawnSync(process.execPath,[exporter,mode],{cwd:root,env,encoding:'utf8'})};
}
test('export byte total matches actual payload and provenance despite validation rereads',t=>{
 const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);
 const output=join(f.root,'test-results/browser-proof/renderer');
 const identity=JSON.parse(readFileSync(join(output,'identity.json'),'utf8'));
 const actual=Object.keys(identity.files).reduce((sum,path)=>sum+statSync(join(output,path)).size,0);
 assert.equal(identity.totalBytes,actual);
 assert.ok(identity.readBytes>identity.totalBytes,'validation rereads have a separate budget');
});
test('renderer rejects a symlinked ancestor',t=>{
 const f=fixture(t);renameSync(join(f.root,'test-results'),join(f.root,'saved-results'));symlinkSync(join(f.root,'saved-results'),join(f.root,'test-results'),'dir');
 const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Symlinked path/);
});
test('renderer rejects unexpected private files',t=>{
 const f=fixture(t);f.write('test-results/browser-proof-renderer/.env','fixture only');
 const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected payload/);
});

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const compilerInput='compiler/node_modules/@smthrs/db/src/adapter/RunRow.ts';
function workerFixture(t,extra={}){
 const f=fixture(t),prefix=`artifacts/mobile-workflow-worker-${f.sdk}`;
 const stamp=JSON.stringify({base:f.sdk}),lock='fixture lock';
 f.write(`artifacts/local-agent-resident-${f.sdk}/.alpha-runtime-source.json`,stamp);
 f.write(`artifacts/local-agent-resident-${f.sdk}/bun.lock`,lock);
 const payload={
  'node_modules/smthrs/package.json':'{}','node_modules/zod/package.json':'{}',
  'node_modules/effect/package.json':'{}','node_modules/@smthrs/engine/package.json':'{}',
  'dependencies.json':'[]',[compilerInput]:'export interface RunRow { id: string }',...extra,
 };
 const files={};
 for(const [path,bytes] of Object.entries(payload)){f.write(`${prefix}/${path}`,bytes);files[path]=sha256(bytes);}
 f.write(`${prefix}/manifest.json`,JSON.stringify({version:1,sourceStampSha256:sha256(stamp),lockSha256:sha256(lock),files}));
 return {...f,prefix,payload};
}
test('worker exports a manifest-bound compiler TypeScript input from the real failed path',t=>{
 const f=workerFixture(t),result=f.run('worker');assert.equal(result.status,0,result.stderr);
 const output=join(f.root,'test-results/browser-proof/worker');
 const path='payload/'+compilerInput,bytes=readFileSync(join(output,path));
 assert.equal(bytes.toString(),f.payload[compilerInput]);
 const identity=JSON.parse(readFileSync(join(output,'identity.json'),'utf8'));
 assert.equal(identity.files[path],sha256(bytes));
 assert.equal(identity.totalBytes,Object.keys(identity.files).reduce((sum,p)=>sum+statSync(join(output,p)).size,0));
});
test('worker does not allow raw TypeScript outside the compiler subtree',t=>{
 const f=workerFixture(t,{'node_modules/example/src/private.ts':'export {}'}),result=f.run('worker');
 assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected payload: node_modules\/example\/src\/private\.ts/);
});
test('worker compiler allowance still rejects private credential files',t=>{
 const f=workerFixture(t,{'compiler/node_modules/example/credentials.json':'{}'}),result=f.run('worker');
 assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected payload:/);
});
test('worker compiler input must be listed in the verified producer manifest',t=>{
 const f=workerFixture(t);f.write(`${f.prefix}/compiler/node_modules/example/extra.ts`,'export {}');
 const result=f.run('worker');assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected worker file/);
});

// The canonical compiler copies program.getSourceFiles(), not just .d.ts files.
const compilerSourceFiles={
 'compiler/node_modules/@types/ws/index.d.mts':'export interface WebSocket {}',
 'compiler/node_modules/@types/example/index.d.cts':'export interface CommonJS {}',
 'compiler/node_modules/example/source.mts':'export const value = 1;',
 'compiler/node_modules/example/source.cts':'export const value = 1;',
 'compiler/node_modules/example/component.tsx':'export const value = <div />;',
 'compiler/types/example/component.jsx':'export const value = <div />;',
};
test('worker exports the complete compiler source extension family from its verified inventory',t=>{
 const f=workerFixture(t,compilerSourceFiles),result=f.run('worker');assert.equal(result.status,0,result.stderr);
 const output=join(f.root,'test-results/browser-proof/worker');
 const identity=JSON.parse(readFileSync(join(output,'identity.json'),'utf8'));
 for(const [path,source] of Object.entries(compilerSourceFiles)){
  const bytes=readFileSync(join(output,'payload',path));assert.equal(bytes.toString(),source);
  assert.equal(identity.files['payload/'+path],sha256(bytes));
 }
});
for(const suffix of ['d.mts','d.cts','tsx','jsx']){
 test(`worker keeps ${suffix} compiler-only`,t=>{
  const path=`node_modules/example/source.${suffix}`;
  const f=workerFixture(t,{[path]:'export {}'}),result=f.run('worker');
  assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected payload:/);
 });
}
test('worker module declaration must still be in the verified manifest',t=>{
 const f=workerFixture(t);f.write(`${f.prefix}/compiler/node_modules/@types/ws/unlisted.d.mts`,'export {}');
 const result=f.run('worker');assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected worker file/);
});

test('verified compiler cookie and credential declarations are source, not private data',t=>{
 const declarations={
  'compiler/node_modules/effect/dist/unstable/http/Cookies.d.ts':'export interface Cookies {}',
  'compiler/node_modules/undici-types/cookies.d.ts':'export interface Cookie {}',
  'compiler/node_modules/example/Credentials.d.mts':'export interface Credentials {}',
  'compiler/types/example/Session.d.cts':'export interface Session {}',
 };
 const f=workerFixture(t,declarations),result=f.run('worker');assert.equal(result.status,0,result.stderr);
 const output=join(f.root,'test-results/browser-proof/worker');
 const identity=JSON.parse(readFileSync(join(output,'identity.json'),'utf8'));
 for(const [path,source] of Object.entries(declarations))assert.equal(identity.files['payload/'+path],sha256(source));
});
test('all rejected cookie, credential and profile data paths are reported without contents',t=>{
 const data={
  'compiler/node_modules/example/cookies.json':'PRIVATE COOKIE DATA',
  'compiler/node_modules/example/credentials.json':'PRIVATE CREDENTIAL DATA',
  'compiler/node_modules/example/profiles/Account.d.ts':'PRIVATE PROFILE DATA',
  'compiler/node_modules/example/.env.d.ts':'PRIVATE ENV DATA',
 };
 const f=workerFixture(t,data),result=f.run('worker');assert.notEqual(result.status,0);
 const bytes=readFileSync(join(f.root,'test-results/resident-ci-browser-proof-rejections-worker.json'),'utf8');
 const report=JSON.parse(bytes);
 assert.deepEqual(report.rejected.map(x=>x.path).sort(),Object.keys(data).sort());
 assert.equal(report.rejectedCount,4);assert.doesNotMatch(bytes,/PRIVATE .* DATA/);
 for(const entry of report.rejected)assert.match(entry.pathSha256,/^[0-9a-f]{64}$/);
});
test('an unverified cookie declaration still fails the worker manifest check',t=>{
 const f=workerFixture(t);f.write(`${f.prefix}/compiler/node_modules/effect/Cookies.d.ts`,'export interface Cookies {}');
 const result=f.run('worker');assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected worker file/);
});

test('renderer retains all nine pinned PDF asset notices with exact identity hashes',t=>{
 const notices=[
  'cmaps/LICENSE','standard_fonts/LICENSE_FOXIT','standard_fonts/LICENSE_LIBERATION',
  'wasm/LICENSE_JBIG2','wasm/LICENSE_OPENJPEG','wasm/LICENSE_PDFJS_JBIG2',
  'wasm/LICENSE_PDFJS_OPENJPEG','wasm/LICENSE_PDFJS_QCMS','wasm/LICENSE_QCMS',
 ];
 const f=fixture(t);
 for(const path of notices)f.write('test-results/browser-proof-renderer/pdfjs-assets/'+path,'Fixture notice '+path);
 const result=f.run();assert.equal(result.status,0,result.stderr);
 const output=join(f.root,'test-results/browser-proof/renderer');
 const identity=JSON.parse(readFileSync(join(output,'identity.json'),'utf8'));
 for(const path of notices){
  const payload='payload/pdfjs-assets/'+path,expected='Fixture notice '+path;
  assert.equal(readFileSync(join(output,payload),'utf8'),expected);
  assert.equal(identity.files[payload],sha256(expected));
 }
});
for(const path of ['pdfjs-assets/wasm/LICENSE_UNREVIEWED','pdfjs-assets/elsewhere/LICENSE_QCMS','pdfjs-assets/wasm/credentials.json','pdfjs-assets/wasm/.env','pdfjs-assets/wasm/secret.key']){
 test('renderer still refuses unreviewed or sensitive PDF payload: '+path,t=>{
  const f=fixture(t);f.write('test-results/browser-proof-renderer/'+path,'PRIVATE FIXTURE CONTENT');
  const result=f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected payload:/);
  assert.equal(readFileSync(join(f.root,'test-results/resident-ci-browser-proof-rejections-renderer.json'),'utf8').includes('PRIVATE FIXTURE CONTENT'),false);
 });
}
