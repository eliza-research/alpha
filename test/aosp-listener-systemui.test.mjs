import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareListenerSystemui, verifyListenerSystemui} from '../scripts/aosp-listener-systemui.ts';

test('Alpha SystemUI CLI applies the reviewed copy fix and preserves existing destinations', t => {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-systemui-cli-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const source=path.join(temporary,'source');
  fs.cpSync('vendor/eliza/packages/os/test/fixtures/sense-systemui',path.join(source,'frameworks/base'),{recursive:true});
  for(const bundle of ['chip','assist']){
    const output=path.join(temporary,bundle);
    const args=['scripts/aosp-listener-systemui.ts','--source',source,'--output',output,...(bundle==='ops'?[]:['--'+bundle])];
    const result=JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'}));
    assert.equal(result.state,'after');
    assert.equal(result.systemUiCompiled,false);
    assert.equal(result.imageBuilt,false);
    assert.equal(verifyListenerSystemui(output,'after',bundle).files.length,bundle==='ops'?2:bundle==='chip'?9:1);
    const receipt=fs.readFileSync(path.join(output,'derived-source.json'));
    assert.throws(()=>prepareListenerSystemui(source,output,bundle),/Output must not exist/);
    assert.deepEqual(fs.readFileSync(path.join(output,'derived-source.json')),receipt);
  }
});
