import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {residentJavaStageFixture} from './fixtures/resident-java-source-stage.mjs';
import {checkResidentJavaSourceStage} from '../specs/quint/refinement/services/resident-java-source-stage.mjs';

test('a committed rewrite-anchor refusal preserves the exact previous Java tree and receipt', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'alpha-resident-java-stage-'));
  try {
    const fixture = residentJavaStageFixture(directory);
    fixture.select(1);
    const initial = fixture.run();
    assert.equal(initial.status, 0, initial.stderr);
    const previous = fixture.snapshot();
    fixture.select(3);
    const rejected = fixture.run();
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(rejected.stderr, /ResidentHostSourceError: Review changed runtime notification presentation/);
    assert.deepEqual(fixture.snapshot(), previous, 'The previous source pair remains byte-exact');
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

test('the Android Java source staging entry point refines the reviewed publication pair', {timeout: 60000}, async () => {
  const receipt = await checkResidentJavaSourceStage([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.checkpoints, 49);
});
