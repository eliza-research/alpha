import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensurePreparedWorkflowWorker} from '../scripts/prepared-workflow-worker.ts';
import {checkPreparedWorkflowWorker, waitForPreparedWorkerProducer} from '../specs/quint/refinement/services/prepared-workflow-worker.mjs';

test('prepared worker reuse and interrupted builds refine exact provenance admission', {timeout: 120000}, async () => {
  const receipt = await checkPreparedWorkflowWorker([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.observedFields.length, 10);
});

test('worker replay reports preparation rejection before the producer can enter', {timeout: 5000}, async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'alpha-worker-entry-refusal-')));
  const source = join(directory, 'artifacts/source');
  const output = join(directory, 'artifacts/worker');
  fs.mkdirSync(source, {recursive: true});
  try {
    await assert.rejects(waitForPreparedWorkerProducer(new Promise(() => {}),
      ensurePreparedWorkflowWorker(directory, source, output)), error => {
      assert.match(error.message, /preparation failed before the producer entered/);
      assert.match(error.cause.message, /lacks the generic workflow artifact producer/);
      return true;
    });
    assert.equal(fs.existsSync(output), false);
  } finally {fs.rmSync(directory, {recursive: true, force: true});}
});
