// Production bundle audit (scripts/audit-production-bundle.ts) on fixture bundles. The flag-off
// web-dist audit runs separately as npm run audit:bundle. LOOP-E, J04: the simulated password
// provider and the Maps emulator gateway are denylisted in case their flags stop folding away.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {auditWebBundle,DENYLIST} from '../scripts/audit-production-bundle.ts';

const script=path.resolve('scripts/audit-production-bundle.ts');
function bundle(files,flags={testMocks:false}){
  const dir=mkdtempSync(path.join(tmpdir(),'alpha-bundle-audit-'));
  const all={'index.html':'<!doctype html><title>Alpha Phone</title>','assets/index.js':'console.log("Notes")',...files};
  if(flags!==null)all['build-flags.json']=JSON.stringify(flags);
  for(const [name,content] of Object.entries(all)){mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});writeFileSync(path.join(dir,name),content);}
  return dir;
}
const cli=(dir,...args)=>spawnSync(process.execPath,[script,dir,...args],{encoding:'utf8'});
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const MARKERS=['demo-only-password','Development password provider','Add development provider','Proton Pass · development','10.0.2.2:47850','127.0.0.1:47850'];
const SIMULATION_MARKERS=['Kitchen Speaker','4000 1234 5678 9017','Card scanned','Simulated payment','Memory wiped','Logs saved to Downloads','Up to date','This page is a visual prototype','Pixel 11 Pro','Powered by elizaOS ·','data-alpha-development-lock-screen','Booked · ','Agent booking'];

// The loop over DENYLIST below cannot see an entry being removed; this can.
test('the denylist names the development password provider and the emulator Maps gateway',()=>{
  for(const marker of MARKERS)assert.ok(DENYLIST.includes(marker),marker);
});

test('fixture-only effects and development controls stay denied when their views are hidden',()=>{
  for(const marker of SIMULATION_MARKERS)assert.ok(DENYLIST.includes(marker),marker);
  const dir=bundle({'assets/index.js':`if (hidden) { const fixtures=${JSON.stringify(SIMULATION_MARKERS)}; }`});
  try{
    const result=auditWebBundle(dir,{testMocks:false});
    assert.equal(result.ok,false);
    assert.deepEqual(result.findings.map(finding=>finding.rule),SIMULATION_MARKERS);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a clean production bundle passes through the API and CLI',()=>{
  const dir=bundle({});
  try{
    assert.deepEqual(auditWebBundle(dir,{testMocks:false}).findings,[]);
    assert.equal(auditWebBundle(dir,{testMocks:false}).ok,true);
    assert.match(execFileSync(process.execPath,[script,dir],{encoding:'utf8'}),/^PASS /);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('every denylist entry fails a production bundle',()=>{
  for(const entry of DENYLIST){
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

test('a leaked provider dialog and gateway fail through the CLI; a recorded test-mocks bundle stays exempt',()=>{
  // The shape the simulated provider and regional provider take when their flags stop folding away.
  const leaked="heading.textContent='Add development provider';button('Proton Pass · development');"+
    "result.textContent='Password: demo-only-password';const g={nativeGateway:'http://10.0.2.2:47850'};";
  const dir=bundle({'assets/index.js':leaked});
  const mocks=bundle({'assets/index.js':leaked},{testMocks:true});
  const clean=bundle({'assets/index.js':"const g={nativeGateway:''};const label='Choose password provider';"});
  try{
    const run=cli(dir);
    assert.equal(run.status,1);
    for(const marker of ['Add development provider','Proton Pass · development','demo-only-password','10.0.2.2:47850'])
      assert.match(run.stderr,new RegExp(`DENY assets/index\\.js: ${escape(marker)}`));
    assert.equal(auditWebBundle(mocks,{testMocks:true}).ok,true);
    const pass=cli(clean);
    assert.equal(pass.status,0,pass.stderr);
    assert.match(pass.stdout,/^PASS /);
  }finally{for(const d of [dir,mocks,clean])rmSync(d,{recursive:true,force:true});}
});

test('owner-provided key labels are allowed while the legacy developer provider dialog stays excluded',()=>{
  const product=bundle({'assets/index.js':'const labels=["Cerebras API key","Cartesia API key (optional)","Save and use own keys"];'});
  const legacy='A new key takes effect after the agent restarts.';
  const leaked=bundle({'assets/index.js':JSON.stringify(legacy)});
  try{
    assert.equal(auditWebBundle(product).ok,true);
    const result=auditWebBundle(leaked);
    assert.equal(result.ok,false);
    assert.deepEqual(result.findings,[{file:'assets/index.js',rule:legacy}]);
  }finally{for(const d of [product,leaked])rmSync(d,{recursive:true,force:true});}
});
