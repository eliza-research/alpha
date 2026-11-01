import test from 'node:test';
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
 return {root,write,run:()=>spawnSync(process.execPath,[exporter,'renderer'],{cwd:root,env,encoding:'utf8'})};
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
