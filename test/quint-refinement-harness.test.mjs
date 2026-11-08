import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureInputs, checkTraces, literal, qmap, qset} from '../specs/quint/refinement/check-traces.mjs';

test('refinement literals preserve collection identity and reject unsupported values', () => {
  assert.equal(literal(qset([1, 2])), 'Set(1, 2)');
  assert.equal(literal(qmap([[1, 'value']])), 'Map((1, "value"))');
  assert.equal(literal({phase: 'idle', n: 0}), '{ phase: "idle", n: 0 }');
  assert.throws(() => literal(undefined));
  assert.throws(() => literal(Number.NaN));
  assert.throws(() => literal('line\ntext'), /equality classes/);
  assert.throws(() => literal('a"b'), /equality classes/);
});

test('collection observations are evaluated with the actual Quint value constructors', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-refinement-collections-'));
  try {
    const sources = ['test/quint-refinement-harness.test.mjs'];
    const driverHashes = captureInputs(sources);
    const result = await checkTraces({model: 'DevelopmentHost', driverHashes,
      sources, scope: 'bounded-component',
      assumptions: ['Synthetic serializer canary.'], out: join(directory, 'result.json'),
      traces: [{name: 'empty-runtime', init: {name: 'init'},
        expect: {'s.active': qset([]), 's.requestOwners': qmap([[1, 0], [2, 0]])}, steps: []}]});
    assert.equal(result.passed, true);
    assert.equal(result.driverInputsBound, true);
    const changedHashes = {...driverHashes};
    changedHashes[Object.keys(changedHashes)[0]] = 'changed-input';
    await assert.rejects(checkTraces({model: 'DevelopmentHost', sources, driverHashes: changedHashes,
      scope: 'bounded-component', assumptions: ['Source hash mutation canary.'], out: join(directory, 'changed.json'),
      traces: [{name: 'empty-runtime', expect: {'s.active': qset([])}, steps: []}]}),
      /changed during observation generation/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('Quint checks every source checkpoint and rejects a divergent observation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-refinement-harness-'));
  const options = {model: 'VadSegmentation', sources: ['test/quint-refinement-harness.test.mjs'],
    scope: 'bounded-component', assumptions: ['Synthetic canary checks the harness, not a product implementation.']};
  const trace = {name: 'two-window-canary', init: {name: 'init'}, expect: {'s.speaking': false}, steps: [
    {action: {name: 'accept', args: [500]}, expect: {'s.speaking': false, 's.above': 1}},
    {action: null, expect: {'s.speaking': false}},
    {action: {name: 'accept', args: [500]}, expect: {'s.speaking': true, 's.edge': 'SPEECH_START'}},
    {action: {name: 'accept', args: [777], reject: true}, expect: {'s.speaking': true}},
  ]};
  try {
    const result = await checkTraces({...options, traces: [trace], out: join(directory, 'pass.json')});
    assert.equal(result.passed, true);
    assert.equal(result.checkpoints, 5);
    assert.equal(result.traceInputs[0].steps.length, 4);
    const changed = structuredClone(trace);
    changed.steps[0].expect['s.speaking'] = true;
    await assert.rejects(checkTraces({...options, traces: [changed], out: join(directory, 'fail.json')}), /trace mismatch/);
    const failed = JSON.parse(readFileSync(join(directory, 'fail.json')));
    assert.equal(failed.passed, false);
    assert.equal(failed.inputsUnchanged, true);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('matching observations still fail when the model safety invariant is false', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-refinement-invariant-'));
  try {
    await assert.rejects(checkTraces({model: 'ApplicationComposition',
      sources: ['test/quint-refinement-harness.test.mjs'], scope: 'bounded-component',
      assumptions: ['Synthetic unsafe-state canary exercises the checker.'], out: join(directory, 'result.json'),
      traces: [{name: 'matching-unsafe-observation', init: {name: 'uncoordinatedIdentityChangeDetectedTest'},
        expect: {'state.identity.owner': 2}, steps: []}]}), /trace mismatch/);
    const receipt = JSON.parse(readFileSync(join(directory, 'result.json')));
    assert.equal(receipt.invariant, 'safety');
    assert.equal(receipt.passed, false);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
