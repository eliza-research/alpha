// Input admission of the resident digest restart check. The check itself needs the prepared
// upstream source with dependencies (about 6 GB) and is not part of `bun run test`.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const run=source=>spawnSync(process.execPath,['scripts/test-local-digest-restart.ts'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,ALPHA_ELIZA_SOURCE:source},encoding:'utf8',timeout:scaledTimeout(60000)});
const commit=JSON.parse(fs.readFileSync('upstream.lock.json','utf8')).commit;

test('digest restart check stops before any process work and names the exact preparation when its input is missing',()=>{
 const empty=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-digest-input-'));
 try{
  fs.writeFileSync(path.join(empty,'package.json'),'{}');
  for(const [source,reason] of [['relative/source',/ALPHA_ELIZA_SOURCE must be an absolute path/],[path.join(empty,'absent'),/no prepared runtime source at /],[empty,/has no installed dependencies/]]){
   const result=run(source);
   assert.equal(result.status,2,result.stderr);
   assert.equal(result.stdout,'');
   assert.match(result.stderr,reason);
   assert.ok(result.stderr.includes('ALPHA_RUNTIME_GIT_CACHE="$PWD/vendor/eliza" bun run agent:prepare'),'names the preparation command');
   assert.ok(result.stderr.includes(`artifacts/local-agent-resident-${commit}`),'names the directory preparation creates for the current pin');
   assert.ok(!/\n\s+at /.test(result.stderr),'an instruction, not a stack trace');
  }
 }finally{fs.rmSync(empty,{recursive:true,force:true});}
});

