import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {auditWebBundle,DENYLIST} from '../scripts/audit-production-bundle.mjs';

const script=path.resolve('scripts/audit-production-bundle.mjs');
function bundle(files,flags={testMocks:false}){
  const dir=mkdtempSync(path.join(tmpdir(),'alpha-bundle-audit-'));
  const all={'index.html':'<!doctype html><title>Alpha Phone</title>','assets/index.js':'console.log("Notes")',...files};
  if(flags!==null)all['build-flags.json']=JSON.stringify(flags);
  for(const [name,content] of Object.entries(all)){mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),content);}
  return dir;
}
const cli=(dir,...args)=>spawnSync(process.execPath,[script,dir,...args],{encoding:'utf8'});

test('a clean production bundle passes through the API and CLI',()=>{
  const dir=bundle({});
  try{
    assert.deepEqual(auditWebBundle(dir,{testMocks:false}).findings,[]);
    assert.equal(auditWebBundle(dir,{testMocks:false}).ok,true);
    assert.match(execFileSync(process.execPath,[script,dir],{encoding:'utf8'}),/^PASS /);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// Independent examples pin exclusions that would disappear from a test derived solely from DENYLIST.
const requiredMarkers = [
  'demo-only-password', 'Development password provider', 'Add development provider',
  'Proton Pass · development', '10.0.2.2:47850', '127.0.0.1:47850',
];

test('each forbidden marker fails a production bundle',()=>{
  for(const entry of new Set([...DENYLIST, ...requiredMarkers])){
    const dir=bundle({'assets/chunk.js':`const label=${JSON.stringify(entry)};`});
    try{
      const result=auditWebBundle(dir,{testMocks:false});
      assert.equal(result.ok,false,entry);
      assert.deepEqual(result.findings,[{file:'assets/chunk.js',rule:entry}]);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
  const dir=bundle({'assets/index.css':'.mock-mode-banner{color:blue}'});
  try{const run=cli(dir);assert.equal(run.status,1);assert.match(run.stderr,/DENY assets\/index\.css: mock-mode-banner/);}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('fixture images and source maps fail a production bundle',()=>{
  const dir=bundle({'img/person.jpg':'x','assets/index.js.map':'{}'});
  try{
    const rules=auditWebBundle(dir,{testMocks:false}).findings.map(finding=>finding.rule).sort();
    assert.deepEqual(rules,['fixture image directory img/','source map']);
    assert.equal(cli(dir).status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the denylist is skipped only for a bundle that records and is expected to carry test mocks',()=>{
  const dir=bundle({'assets/index.js':'"Enter mock mode"','img/a.jpg':'x'},{testMocks:true});
  try{
    assert.equal(auditWebBundle(dir,{testMocks:true}).ok,true);
    assert.equal(cli(dir,'--expect-test-mocks').status,0);
    // A test-mocks bundle presented as production is rejected.
    const production=auditWebBundle(dir,{testMocks:false});
    assert.equal(production.ok,false);
    assert.match(production.errors.join('\n'),/records testMocks:true, expected false/);
    assert.equal(cli(dir).status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
  const off=bundle({'assets/index.js':'"Enter mock mode"'});
  try{
    // Claiming test mocks cannot skip the denylist of a production-recorded bundle.
    const result=auditWebBundle(off,{testMocks:true});
    assert.equal(result.ok,false);
    assert.equal(result.findings.length,1);
    assert.equal(cli(off,'--expect-test-mocks').status,1);
  }finally{rmSync(off,{recursive:true,force:true});}
});

test('a bundle without a build-flags record or directory fails',()=>{
  const dir=bundle({},null);
  try{assert.equal(auditWebBundle(dir).ok,false);assert.equal(cli(dir).status,1);}
  finally{rmSync(dir,{recursive:true,force:true});}
  assert.equal(auditWebBundle(path.join(tmpdir(),'alpha-missing-bundle-'+process.pid)).ok,false);
  assert.equal(cli('a','b').status,2);
  assert.equal(spawnSync(process.execPath,[script,'.','--unknown'],{encoding:'utf8'}).status,2);
});
