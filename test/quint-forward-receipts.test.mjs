import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureReplayInputs, observedReplay, recordComparedObservation} from '../specs/quint/refinement/observed-replay.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

async function contract(run, check) {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-replay-receipt-contract-'));
  try {
    const out = join(directory, 'receipt.json');
    const execute = () => observedReplay({model: 'NativeStreamBridge', prefix: 'testProjection',
      projection: 'Receipt-helper contract test; not a product/source correspondence claim.',
      assumptions: ['Disposable controlled observations test the receipt guard only.'],
      extraSources: [fileURLToPath(import.meta.url)], out, run: () => run(directory)});
    await check(execute, out);
  } finally {rmSync(directory, {recursive: true, force: true});}
}

test('summary counters alone cannot mint a source-replay receipt', async () => {
  await contract(() => ({traces: 1, checkpoints: 1}), async execute => {
    await assert.rejects(execute(), /must record actual source comparisons/);
  });
});

test('a mismatched source observation cannot be certified by a passing summary', async () => {
  await contract(() => {
    recordComparedObservation({trace: 0, step: 0, actual: {value: 1}, expected: {value: 2}});
    return {traces: 1, checkpoints: 1};
  }, async execute => {await assert.rejects(execute(), /Recorded source observation/);});
});

test('generated input drift refuses the receipt after an otherwise matching observation', async () => {
  await contract(directory => {
    const input = join(directory, 'port.json');writeFileSync(input, '{"value":1}');captureReplayInputs([input]);
    const actual = JSON.parse(readFileSync(input, 'utf8'));
    recordComparedObservation({trace: 0, step: 0, actual, expected: {value: 1}});
    writeFileSync(input, '{"value":2}');return {traces: 1, checkpoints: 1};
  }, async execute => {await assert.rejects(execute(), /Replay input changed or disappeared/);});
});

test('removed generated inputs retain their exact pre-use bytes and actual comparison count', async () => {
  await contract(directory => {
    const input = join(directory, 'port.json');writeFileSync(input, '{"value":1}');captureReplayInputs([input]);
    recordComparedObservation({trace: 0, step: 0, actual: JSON.parse(readFileSync(input, 'utf8')), expected: {value: 1}});
    unlinkSync(input);return {traces: 1, checkpoints: 1};
  }, async (execute, out) => {
    const receipt = await execute();
    assert.equal(receipt.passed, true);assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.checkpoints, 1);assert.deepEqual(receipt.traceInputs[0].expect, {'testProjection.value': 1});
    assert.ok(Object.keys(receipt.generatedSourceSnapshots).some(path => path.endsWith('/port.json')));
    assert.equal(verifyRefinementReceiptInputs(JSON.parse(readFileSync(out, 'utf8'))), true);
  });
});

test('summary counts must match the observations actually recorded', async () => {
  await contract(() => {
    recordComparedObservation({trace: 0, step: 0, actual: {value: 1}, expected: {value: 1}});
    return {traces: 1, checkpoints: 2};
  }, async execute => {await assert.rejects(execute());});
});
