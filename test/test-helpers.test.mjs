import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {located,normalizedSource} from './fixtures/source-text.mjs';
import {runChildSuite} from './fixtures/child-suite.mjs';

test('located slices between markers and throws when one is missing',()=>{
 assert.equal(located('a START b END c END','START','END'),'START b ');
 assert.throws(()=>located('a b END','START','END'),/start marker not found: START/);
 assert.throws(()=>located('END a START b','START','END'),/end marker not found after START: END/);
});

test('normalizedSource ignores spacing and comments but keeps word boundaries',()=>{
 assert.equal(normalizedSource('if (a) {\n  go( x , y ); // note\n}'),normalizedSource('if(a){go(x,y);}'));
 assert.equal(normalizedSource('private  static\n final /* c */ int n = 1;'),'private static final int n=1;');
 assert.equal(normalizedSource('const url = "https://x";'),'const url="https://x";');
});

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
