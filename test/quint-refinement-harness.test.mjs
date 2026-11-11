import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {captureInputs, checkTraces, literal, qmap, qset, verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

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
    const manifestPath = Object.keys(driverHashes).find(path => path.endsWith('/application/manifest.json'));
    const modelPath = Object.keys(driverHashes).find(path => path.endsWith('/DevelopmentHost.qnt'));
    assert.ok(manifestPath && modelPath, 'Model selection and definitions are captured before source execution');
    const changedModel = {...driverHashes, [modelPath]: 'changed-before-checking'};
    await assert.rejects(checkTraces({model: 'DevelopmentHost', sources, driverHashes: changedModel,
      scope: 'bounded-component', assumptions: ['Model snapshot mutation canary.'], out: join(directory, 'changed-model.json'),
      traces: [{name: 'empty-runtime', expect: {'s.active': qset([])}, steps: []}]}),
      /changed during observation generation/);
    const changedManifest = {...driverHashes, [manifestPath]: 'changed-before-checking'};
    await assert.rejects(checkTraces({model: 'DevelopmentHost', sources, driverHashes: changedManifest,
      scope: 'bounded-component', assumptions: ['Safety selector mutation canary.'], out: join(directory, 'changed-manifest.json'),
      traces: [{name: 'empty-runtime', expect: {'s.active': qset([])}, steps: []}]}),
      /changed during observation generation/);
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

test('checker exit preserves the tool failure separately from a model mismatch', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'alpha-refinement-checker-exit-'));
  const preload = join(directory, 'exit.mjs');
  const output = join(directory, 'result.json');
  const prior = process.env.BUN_OPTIONS;
  try {
    writeFileSync(preload, 'process.exit(27);\n');
    // Bun reads BUN_OPTIONS (not NODE_OPTIONS); its preload flag takes a path.
    process.env.BUN_OPTIONS = `--preload=${preload}`;
    await assert.rejects(checkTraces({model: 'DevelopmentHost', sources: [fileURLToPath(import.meta.url)],
      scope: 'bounded-component', out: output,
      traces: [{name: 'tool-exit', expect: {'s.active': qset([])}}]}), /Quint checker failed.*exit 27/);
    const [result] = JSON.parse(readFileSync(output)).results;
    assert.equal(result.kind, 'tool-failure');
    assert.equal(result.exitCode, 27);
    assert.equal(result.signal, null);
  } finally {
    if (prior === undefined) delete process.env.BUN_OPTIONS;
    else process.env.BUN_OPTIONS = prior;
    rmSync(directory, {recursive: true, force: true});
  }
});

test('canonical temporary inputs survive fixture cleanup while live source remains authoritative', async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'alpha-refinement-generated-')));
  const generated = join(directory, 'GeneratedFixture.java');
  const stable = join(directory, 'StableFixtureInput.java');
  const testSource = fileURLToPath(import.meta.url);
  const bytes = '// Generated synthetic fixture '+randomUUID()+'\n';
  const sources = [testSource, generated, stable];
  let snapshot;
  try {
    writeFileSync(generated, bytes);
    // Use identical bytes so missing stable input cannot benefit from an existing snapshot.
    writeFileSync(stable, bytes);
    const driverHashes = captureInputs(sources);
    const options = {model: 'DevelopmentHost', sources, driverHashes, scope: 'bounded-component',
      assumptions: ['Synthetic generated-input integrity canary.'], out: join(directory, 'result.json'),
      traces: [{name: 'empty-runtime', expect: {'s.active': qset([])}, steps: []}]};
    await assert.rejects(checkTraces({...options, generatedSources: [testSource]}),
      /explicit driver-bound temporary file/);
    await assert.rejects(checkTraces({...options, driverHashes: undefined, generatedSources: [generated]}),
      /explicit driver-bound temporary file/);

    const linkedDirectory = join(directory, 'linked-repository-tests');
    symlinkSync(dirname(testSource), linkedDirectory, 'dir');
    const escaped = join(linkedDirectory, 'quint-refinement-harness.test.mjs');
    await assert.rejects(checkTraces({...options, sources: [...sources, escaped],
      driverHashes: captureInputs([...sources, escaped]), generatedSources: [escaped]}),
      /explicit driver-bound temporary file/, 'a temporary directory alias cannot admit repository source as generated');

    const receipt = await checkTraces({...options, generatedSources: [generated]});
    assert.deepEqual(receipt.generatedSourceSnapshots, {[generated]: driverHashes[generated]});
    snapshot = fileURLToPath(new URL('../test-results/quint-refinement/input-snapshots/'+driverHashes[generated], import.meta.url));
    assert.equal(readFileSync(snapshot, 'utf8'), bytes);
    assert.equal(verifyRefinementReceiptInputs(receipt), true);

    rmSync(generated);
    assert.equal(verifyRefinementReceiptInputs(receipt), true);
    assert.equal(verifyRefinementReceiptInputs({...receipt, generatedSourceSnapshots: undefined}), false);
    writeFileSync(generated, 'live generated bytes drifted');
    assert.equal(verifyRefinementReceiptInputs(receipt), false);
    await assert.rejects(checkTraces({...options, generatedSources: [generated]}),
      /changed during observation generation/);
    rmSync(generated);
    writeFileSync(stable, 'stable bytes drifted');
    assert.equal(verifyRefinementReceiptInputs(receipt), false);
    rmSync(stable);
    assert.equal(verifyRefinementReceiptInputs(receipt), false);
    writeFileSync(stable, bytes);

    writeFileSync(snapshot, 'snapshot bytes drifted');
    assert.equal(verifyRefinementReceiptInputs(receipt), false);
    rmSync(snapshot);
    assert.equal(verifyRefinementReceiptInputs(receipt), false);
  } finally {
    if (snapshot) rmSync(snapshot, {force: true});
    rmSync(directory, {recursive: true, force: true});
  }
});

const definitionPartitionTrace={name:'definition-partition-canary',init:{name:'init'},expect:{'s.speaking':false},steps:[
 {action:{name:'accept',args:[500]},expect:{'s.speaking':false,'s.above':1}},
 {action:{name:'accept',args:[500]},expect:{'s.speaking':true,'s.edge':'SPEECH_START'}},
 {action:{name:'accept',args:[777],reject:true},expect:{'s.speaking':true}},
]};
const partitionBodyDefinitions=text=>{const header=text.indexOf('\n',text.indexOf('\n')+1)+1;return text.slice(header,text.lastIndexOf('\n}\n')).split(/\n(?=  run trace[0-9]+Reject[0-9]+Test)/);};
const partitionDefinitionHash=value=>createHash('sha256').update(value).digest('hex');
test('definition partitions preserve the original positive and rejection programs and execute both',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alpha-definition-partition-')),log=join(directory,'programs.jsonl'),preload=join(directory,'capture.mjs'),prior=process.env.NODE_OPTIONS;
 writeFileSync(preload,`import fs from 'node:fs';const p=process.argv.find(v=>v.endsWith('.qnt'));if(p)fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(fs.readFileSync(p,'utf8'))+'\\n');\n`);
 const sources=[fileURLToPath(import.meta.url),preload],options={model:'VadSegmentation',sources,driverHashes:captureInputs(sources),scope:'bounded-component',assumptions:['Synthetic checker partition guard, not product refinement.'],traces:[definitionPartitionTrace]};
 try{
  process.env.NODE_OPTIONS=`--import=${pathToFileURL(preload).href}`;
  const baseline=await checkTraces({...options,out:join(directory,'default.json')});
  const original=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(original.length,1);const definitions=partitionBodyDefinitions(original[0]);assert.equal(definitions.length,2);assert.equal(baseline.results[0].definitionPartitions,undefined);
  writeFileSync(log,'');
  const partitioned=await checkTraces({...options,definitionBatchSize:1,out:join(directory,'partitioned.json')});
  const programs=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);assert.equal(programs.length,2);assert.deepEqual(programs.flatMap(partitionBodyDefinitions),definitions);
  assert.equal(partitioned.passed,true);assert.equal(partitioned.traces,1);assert.equal(partitioned.checkpoints,4);assert.equal(partitioned.results[0].generatedCases,2);assert.equal(partitioned.results[0].checked,2);assert.deepEqual(partitioned.results[0].definitionPartitions.flatMap(x=>x.definitionHashes),definitions.map(partitionDefinitionHash));assert.ok(partitioned.results[0].definitionPartitions.every(x=>x.kind==='passed'&&x.checked===1));
  const invalid=structuredClone(definitionPartitionTrace);invalid.steps[2].action.args=[500];
  await assert.rejects(checkTraces({...options,traces:[invalid],definitionBatchSize:1,out:join(directory,'enabled-rejection.json')}),/trace mismatch|Quint checker failed/);
  const failed=JSON.parse(readFileSync(join(directory,'enabled-rejection.json')));assert.equal(failed.passed,false);assert.equal(failed.results[0].definitionPartitions[0].kind,'passed');assert.notEqual(failed.results[0].definitionPartitions[1].kind,'passed');
 }finally{if(prior===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=prior;rmSync(directory,{recursive:true,force:true});}
});
test('a checker that omits the rejection definition cannot make a partitioned trace pass',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'alpha-definition-missing-')),preload=join(directory,'omit.mjs'),prior=process.env.NODE_OPTIONS;
 writeFileSync(preload,`import fs from 'node:fs';const p=process.argv.find(v=>v.endsWith('.qnt'));if(p&&fs.readFileSync(p,'utf8').includes('run trace0Reject0Test')){console.log('0 passing');process.exit(0);}\n`);
 const sources=[fileURLToPath(import.meta.url),preload],options={model:'VadSegmentation',sources,driverHashes:captureInputs(sources),scope:'bounded-component',assumptions:['Synthetic missing-check guard; negative child simulates an incomplete checker.'],traces:[definitionPartitionTrace],definitionBatchSize:1,out:join(directory,'missing.json')};
 try{
  await assert.rejects(checkTraces({...options,definitionBatchSize:0}),/Invalid definition batch size/);
  process.env.NODE_OPTIONS=`--import=${pathToFileURL(preload).href}`;
  await assert.rejects(checkTraces(options),/Quint checker failed.*checked 1 of 2/s);
  const failed=JSON.parse(readFileSync(options.out));assert.equal(failed.passed,false);assert.equal(failed.inputsUnchanged,true);assert.equal(failed.driverInputsBound,true);assert.equal(failed.results[0].kind,'tool-failure');assert.equal(failed.results[0].checked,1);assert.equal(failed.results[0].generatedCases,2);assert.equal(failed.results[0].definitionPartitions[0].kind,'passed');assert.equal(failed.results[0].definitionPartitions[1].checked,0);
 }finally{if(prior===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=prior;rmSync(directory,{recursive:true,force:true});}
});
