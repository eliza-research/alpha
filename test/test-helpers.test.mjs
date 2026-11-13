import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runChildSuite} from './fixtures/child-suite.mjs';

test('runChildSuite clears the parent test context and reports child output on failure',()=>{
 const root=mkdtempSync(join(tmpdir(),'child-suite-'));
 try {
  mkdirSync(join(root,'scripts'));
  writeFileSync(join(root,'scripts/pass.mjs'),"console.log(process.env.NODE_TEST_CONTEXT??'no context');");
  writeFileSync(join(root,'scripts/fail.mjs'),"console.log('child stdout line');console.error('child stderr line');process.exit(3);");
  assert.equal(runChildSuite('pass.mjs',{cwd:root}).trim(),'no context');
  assert.throws(()=>runChildSuite('fail.mjs',{cwd:root}),error=>/fail\.mjs failed \(status 3/.test(error.message)&&/child stdout line/.test(error.message)&&/child stderr line/.test(error.message));
 } finally { rmSync(root,{recursive:true,force:true}); }
});
