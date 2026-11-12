import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {directory, javaTraces} from '../specs/quint/refinement/native/java.mjs';
import {keyboardDictationCloudPorts} from '../specs/quint/refinement/native/keyboard-dictation-cloud-ports.mjs';
import {jsonJar} from './fixtures/jvm-tools.mjs';

const model='KeyboardDictationCloud';
const modelPath='specs/quint/native/KeyboardDictationCloud.qnt';
const app='android/app/src/main/java/ai/alphacompute/alphaphone/';
async function checkKeyboardDictationCloud(extraSources=[]) {
  const temporary=mkdtempSync(join(tmpdir(),'quint-keyboard-cloud-'));
  try {
    const generatedSources=Object.entries(keyboardDictationCloudPorts).map(([name,body])=>{
      const path=join(temporary,name);
      mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);return path;
    });
    const compiled=['KeyboardDictationCloud.java','KeyboardDictationPolicy.java','CloudSpeechPolicy.java','CloudDeployment.java'].map(name=>app+name);
    const sources=[modelPath,...compiled,...generatedSources,
      ...['KeyboardDictationCloudTraces.java','Trace.java','java.mjs','keyboard-dictation-cloud-ports.mjs'].map(name=>join(directory,name)),
      fileURLToPath(import.meta.url),'test/fixtures/jvm-tools.mjs',...(jsonJar?[jsonJar]:[]),...extraSources];
    const driverHashes=captureInputs(sources);
    const traces=javaTraces('KeyboardDictationCloudTraces.java',[...compiled,...generatedSources]);
    return await checkTraces({model,modelPath,sources,generatedSources,driverHashes,traces,scope:'bounded-orchestration',
      assumptions:[
        'The unchanged Alpha native dictation adapter and route policy execute on the JVM. Closed credential, authority, PCM and HTTPS ports supply synthetic inputs. No real credentials or provider request are used.',
        'One dictation per instance, representative Direct and Cloud route choices, one environment change before a request or during its response, and success, HTTP failure, malformed text and wrong Cloud provider header.',
        'The Direct Cartesia port implements only the guard-callback contract. Shared provider transport, actual recording decode, mutable Android credential slots and installed keyboard insertion remain separate obligations.',
      ]});
  } finally {rmSync(temporary,{recursive:true,force:true});}
}

test('native dictation routes, stale replies and audio cleanup refine the selected-route model', {timeout:180000}, async()=>{
  const receipt=await checkKeyboardDictationCloud([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,31);
  assert.equal(receipt.observedFields.length,14);
});
