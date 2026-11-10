import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {expectedMobileUuidTransforms, mobileBuildInputs, mobileBuildReceipt, verifyMobileBuildReceipt,
  MOBILE_BUILD_INPUTS, MOBILE_BUILD_RECEIPT, MOBILE_UUID_POLICY} from '../../../../scripts/mobile-uuid-adapter.ts';
import {CORE_STATE_MANIFEST, coreStateBuildPlugin, coreStateReceipt, PLUGIN_CONNECTOR_TARGET} from '../../../../scripts/core-state-patch.ts';
import {actualPolicy, hash, mobileUuidFixture} from '../../../../test/fixtures/mobile-uuid-build.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {parseBuildPolicy} from '../../../../scripts/build-policy-source.ts';

const repository = path.resolve(import.meta.dirname, '../../../..');
const adapter = MOBILE_BUILD_INPUTS[0], otherAdapter = MOBILE_BUILD_INPUTS.at(-1);
const zeroHash = '0'.repeat(64);
const action = (name, ...args) => ({name, args});
const idle = {operation: 'none', result: 'none'};
const absent = {shape: 'missing', fingerprint: {producer: 0, adapter: 0, stamp: 0, bundle: 0},
  uuid: 'exact', core: 'exact', tamper: 'none'};
const fingerprint = bytes => bytes === null ? null : hash(bytes);

function installedTransforms(f) {
  const invoke = (plugin, files) => plugin.setup({onLoad({filter}, callback) {
    for (const file of files) {
      assert.ok(filter.test(file), 'Actual interception covers '+file);
      callback({path: file});
    }
  }});
  const uuid = expectedMobileUuidTransforms(mobileBuildInputs(f.root, f.source));
  assert.equal(uuid.length, 1);
  const core = coreStateBuildPlugin(f.root, f.source);
  invoke(core.plugin, [...core.files.keys()].map(name => path.join(f.source, name)));
  assert.ok(core.transforms.some(item => item.path === PLUGIN_CONNECTOR_TARGET));
  return {uuid, core: core.transforms};
}

function refusal(error, files) {
  if (error instanceof SyntaxError) return 'receipt-json';
  if (error.code === 'ENOENT') {
    if (error.path === files.receipt) return 'missing-receipt';
    if (error.path === files.bundle) return 'bundle';
    if (error.path === files.otherAdapter) return 'adapter';
  }
  const results = [
    [/Unreviewed mobile UUID build policy/, 'policy'],
    [/source differs from reviewed pin/, 'stamp'],
    [/producer changed/, 'producer'],
    [/dependency lock changed/, 'lock'],
    [/Reviewed UUID package input changed/, 'package'],
    [/unexpected modules/, 'inventory'],
    [/input must be regular/, 'regular'],
    [/transform exactly the reviewed barrel/, 'uuid-transform'],
    [/core source observation|selected core source observation|Core source catalog/i, 'core-transform'],
    [/receipt differs from reviewed producer or bundle/, 'stale'],
  ];
  const kind = results.find(([pattern]) => pattern.test(error.message))?.[1];
  if (!kind) throw error;
  return kind;
}

function withVersions(before, suffix) {
  return [before, Buffer.concat([before, Buffer.from(suffix)])];
}

function fixture(f, alternate) {
  const sdk = name => path.join(f.source, name);
  const atRoot = name => path.join(f.root, name);
  const target = alternate ? atRoot('alternate-agent') : path.dirname(f.bundle);
  const files = {
    bundle: path.join(target, 'agent-bundle.js'), receipt: path.join(target, MOBILE_BUILD_RECEIPT),
    policy: atRoot(MOBILE_UUID_POLICY), producer: sdk(actualPolicy.builder.path),
    adapter: atRoot(adapter), otherAdapter: atRoot(otherAdapter), stamp: sdk('.alpha-runtime-source.json'),
    lock: sdk('bun.lock'), package: sdk(actualPolicy.package.root+'/dist-node/v4.js'),
    inventory: sdk(actualPolicy.package.root+'/dist-node/unreviewed.js'), coreCatalog: atRoot(CORE_STATE_MANIFEST),
  };
  if (alternate) {
    fs.mkdirSync(target);
    fs.copyFileSync(f.bundle, files.bundle);
  }
  const transforms = installedTransforms(f);
  const connector = transforms.core.find(item => item.path === PLUGIN_CONNECTOR_TARGET);
  const uuidShapes = {exact: transforms.uuid, missing: [], duplicate: [...transforms.uuid, ...transforms.uuid],
    wrong: [{...transforms.uuid[0], bridgeSha256: zeroHash}]};
  const coreShapes = {exact: transforms.core,
    'missing-connector': transforms.core.filter(item => item !== connector),
    'duplicate-connector': [...transforms.core, connector],
    'wrong-connector': transforms.core.map(item => item === connector ? {...item, outputSha256: zeroHash} : item)};
  const stamp = JSON.parse(fs.readFileSync(files.stamp, 'utf8'));
  const versions = {
    producer: withVersions(fs.readFileSync(files.producer), '\n// fixture reviewed producer revision\n'),
    adapter: withVersions(fs.readFileSync(files.adapter), '\n// fixture adapter revision\n'),
    stamp: [fs.readFileSync(files.stamp), Buffer.from(JSON.stringify({...stamp, patches: ['fixture-revision']}))],
    bundle: [null, fs.readFileSync(files.bundle), Buffer.from('fixture replacement bundle')],
  };
  const policyBytes = fs.readFileSync(files.policy);
  const policySource = value => 'export default '+JSON.stringify(value)+';\n';
  const revisedPolicy = parseBuildPolicy(policyBytes);
  revisedPolicy.builder.sha256 = hash(versions.producer[1]);
  const policyVersions = [policyBytes, Buffer.from(policySource(revisedPolicy))];
  const labels = Object.fromEntries(Object.entries(versions).map(([name, entries]) =>
    [name, entries.map(fingerprint)]));
  const readPolicy = () => parseBuildPolicy(fs.readFileSync(files.policy));
  const read = file => fs.existsSync(file) ? fs.readFileSync(file) : null;
  const writeReceipt = value => fs.writeFileSync(files.receipt, JSON.stringify(value));
  const versionOf = (name, digest) => {
    const version = labels[name].indexOf(digest);
    assert.notEqual(version, -1, 'Unscripted '+name+' fingerprint');
    return version;
  };
  const sortedCore = values => [...values].sort((a,b) => a.path.localeCompare(b.path));
  const classify = (value, shapes, normal = x => x) => {
    const shape = Object.entries(shapes).find(([, sample]) => isDeepStrictEqual(normal(sample), normal(value)));
    assert.ok(shape, 'Unscripted fixture transform shape');
    return shape[0];
  };
  const projectReceipt = value => {
    if (value === null) return absent;
    const producer = versionOf('producer', value.builder.sha256);
    assert.equal(value.policySha256, hash(policyVersions[producer]), 'Candidate binds the exact reviewed policy bytes');
    const tamper = Object.hasOwn(value, 'fixtureExtra') ? 'extra'
      : value.coreState.inputHashes['scripts/core-state-patch.ts'] === zeroHash ? 'core-input'
        : value.smoke.uuidSemantics === false ? 'smoke' : 'none';
    return {shape: 'object', fingerprint: {
      producer,
      adapter: versionOf('adapter', value.adapterFiles[adapter]),
      stamp: versionOf('stamp', value.sourceStampSha256),
      bundle: versionOf('bundle', value.bundleSha256),
    }, uuid: classify(value.transforms, uuidShapes), core: classify(value.coreState.transforms, coreShapes, sortedCore), tamper};
  };
  const storedReceipt = () => {
    const bytes = read(files.receipt);
    if (bytes === null) return absent;
    let value;
    try {value = JSON.parse(bytes);}
    catch (error) {if (error instanceof SyntaxError) return {...absent, shape: 'malformed'}; throw error;}
    return projectReceipt(value);
  };
  let fault = 'none', undoFault, uuid = 'exact', core = 'exact', candidate = null, outcome = idle;
  function observe() {
    const stampBytes = fs.readFileSync(files.stamp);
    const observedStamp = JSON.parse(stampBytes.toString());
    return {
      's.files': {
        producer: versionOf('producer', readPolicy().builder.sha256),
        adapter: versionOf('adapter', hash(fs.readFileSync(files.adapter))),
        stamp: observedStamp.base === stamp.base ? versionOf('stamp', hash(stampBytes)) : Number(observedStamp.patches.length > 0),
        bundle: versionOf('bundle', fingerprint(read(files.bundle))),
      },
      's.fault': fault, 's.uuid': uuid, 's.core': core,
      's.candidate': projectReceipt(candidate), 's.stored': storedReceipt(), 's.outcome': outcome,
    };
  }
  function gate(operation, work, expected) {
    let result, value;
    try {value = work(); result = 'accepted';}
    catch (error) {result = refusal(error, files);}
    assert.equal(result, expected, operation+' result');
    outcome = {operation, result};
    return value;
  }
  function replace(file, content) {
    const before = read(file);
    if (content === null) fs.unlinkSync(file);
    else fs.writeFileSync(file, content);
    return () => {
      if (before === null) fs.rmSync(file, {force: true});
      else fs.writeFileSync(file, before);
    };
  }
  const faults = {
    policy: () => replace(files.policy, policySource({...readPolicy(), schema: 2})),
    stamp: () => replace(files.stamp, JSON.stringify({...JSON.parse(fs.readFileSync(files.stamp)), base: 'f'.repeat(40)})),
    producer: () => replace(files.producer, versions.producer[1]),
    lock: () => replace(files.lock, 'fixture unreviewed lock'),
    package: () => replace(files.package, 'fixture changed UUID algorithm'),
    inventory: () => replace(files.inventory, 'fixture additional UUID module'),
    regular() {
      const before = fs.readFileSync(files.package), peer = atRoot('private-uuid-algorithm.js');
      fs.writeFileSync(peer, before);
      fs.unlinkSync(files.package);
      fs.symlinkSync(peer, files.package);
      return () => {fs.unlinkSync(files.package); fs.writeFileSync(files.package, before);};
    },
    adapter: () => replace(files.otherAdapter, null),
    'core-auth': () => replace(files.coreCatalog, policySource({schema: 1, baseCommit: actualPolicy.baseCommit, files: {}})),
  };
  return {
    observe,
    setFault(name) {
      undoFault?.();
      undoFault = name === 'none' ? undefined : faults[name]();
      fault = name;
      outcome = idle;
    },
    setRevision(name, version) {
      const bytes = versions[name][version];
      if (bytes === null) fs.rmSync(files[name], {force: true});
      else fs.writeFileSync(files[name], bytes);
      if (name === 'producer') fs.writeFileSync(files.policy, policyVersions[version]);
      outcome = idle;
    },
    setUuid(shape) {uuid = shape; outcome = idle;},
    setCore(shape) {core = shape; outcome = idle;},
    checkInputs(expected) {
      const admitted = gate('inputs', () => mobileBuildInputs(f.root, f.source), expected);
      if (!admitted) return;
      assert.equal(admitted.identity.sourcePin, actualPolicy.baseCommit);
      assert.equal(admitted.identity.lockSha256, actualPolicy.lockSha256);
      assert.deepEqual(admitted.identity.uuid.files, actualPolicy.package.files);
      assert.equal(admitted.identity.sourceStampSha256, hash(fs.readFileSync(files.stamp)));
      assert.equal(admitted.identity.adapterFiles[adapter], hash(fs.readFileSync(files.adapter)));
    },
    buildReceipt(expected) {
      candidate = gate('build', () => mobileBuildReceipt(f.root, f.source, files.bundle,
        uuidShapes[uuid], coreShapes[core]), expected) ?? null;
    },
    publishReceipt() {assert.ok(candidate); writeReceipt(candidate); outcome = idle;},
    damageStored(shape) {
      if (shape === 'missing') fs.rmSync(files.receipt, {force: true});
      else fs.writeFileSync(files.receipt, '{fixture incomplete');
      outcome = idle;
    },
    tamperStored(kind, value) {
      const receipt = JSON.parse(fs.readFileSync(files.receipt, 'utf8'));
      if (kind === 'uuid') receipt.transforms = uuidShapes[value];
      else if (kind === 'core') receipt.coreState.transforms = coreShapes[value];
      else if (value === 'smoke') receipt.smoke.uuidSemantics = false;
      else if (value === 'core-input') receipt.coreState.inputHashes['scripts/core-state-patch.ts'] = zeroHash;
      else if (value === 'extra') receipt.fixtureExtra = true;
      else assert.fail('Unscripted receipt mutation');
      writeReceipt(receipt);
      outcome = idle;
    },
    verify(expected) {
      const value = gate('verify', () => alternate ? verifyMobileBuildReceipt(f.root, f.source, target)
        : verifyMobileBuildReceipt(f.root, f.source), expected);
      if (value) assert.deepEqual(value, JSON.parse(fs.readFileSync(files.receipt, 'utf8')));
    },
  };
}

function scenario(name, run, {alternate = false} = {}) {
  const scratch = mobileUuidFixture({reviewed: true});
  try {
    const f = fixture(scratch, alternate);
    const trace = {name, expect: f.observe(), steps: []};
    function point(label, name, ...args) {
      f[name](...args);
      const call = ['checkInputs', 'buildReceipt', 'verify'].includes(name) ? action(name) : action(name, ...args);
      trace.steps.push({label, action: call, expect: f.observe()});
    }
    const issue = () => {
      point('current inputs and exact transforms create a candidate', 'buildReceipt', 'accepted');
      point('caller writes the candidate to the selected receipt slot', 'publishReceipt');
    };
    const verify = (label, expected = 'accepted') => point(label, 'verify', expected);
    run(point, issue, verify);
    return trace;
  } finally {scratch.cleanup();}
}

function rejectedInputs(name, faults) {
  return scenario(name, (point, issue, verify) => {
    issue();
    for (const fault of faults) {
      point('alter '+fault+' input inside private scratch', 'setFault', fault);
      const receiptError = fault === 'core-auth' ? 'core-transform' : fault;
      point('actual input gate reports '+fault, 'checkInputs', fault === 'core-auth' ? 'accepted' : fault);
      point('issue refuses the changed '+fault, 'buildReceipt', receiptError);
      verify('existing receipt does not admit changed '+fault, receiptError);
      point('restore the reviewed '+fault+' bytes', 'setFault', 'none');
      verify('original receipt matches after restoring '+fault);
    }
  });
}

function rejectedTransforms(name, kind, shapes) {
  return scenario(name, (point, issue, verify) => {
    issue();
    for (const shape of shapes) {
      const error = kind+'-transform';
      const set = kind === 'uuid' ? 'setUuid' : 'setCore';
      point('supply '+shape+' transform metadata', set, shape);
      point('actual issue requires the exact '+kind+' transforms', 'buildReceipt', error);
      verify('failed issue leaves the already written exact receipt usable');
      point('write '+shape+' into a copy of the stored receipt', 'tamperStored', kind, shape);
      verify('verification checks stored '+kind+' transform claims', error);
      point('restore exact build transform metadata', set, 'exact');
      issue();
      verify('a new exact receipt is admitted');
    }
  });
}

export async function checkMobileBundleAdmission(extraSources = []) {
  const core = coreStateReceipt(repository);
  const sources = [
    fileURLToPath(import.meta.url), 'test/fixtures/mobile-uuid-build.mjs', 'test/fixtures/core-state-root.mjs',
    'upstream.lock.json', 'package-lock.json', MOBILE_UUID_POLICY, ...MOBILE_BUILD_INPUTS,
    'vendor/eliza/bun.lock', 'vendor/eliza/'+actualPolicy.builder.path,
    ...Object.keys(actualPolicy.package.files).map(name => 'node_modules/uuid/'+name),
    ...Object.keys(core.inputHashes), ...Object.keys(core.files).map(name => 'vendor/eliza/'+name),
    'scripts/local-agent-source.ts', 'scripts/copy-file-clone.ts',
    'vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs',
    'vendor/eliza/packages/app/scripts/lib/committed-source.mjs', ...extraSources,
  ];
  const driverHashes = captureInputs(sources);
  for (const [name, digest] of Object.entries(core.inputHashes)) assert.equal(driverHashes[path.resolve(repository,name)], digest);
  const traces = [
    scenario('a candidate must reach the receipt slot before readback', (point, _issue, verify) => {
      point('exact pinned SDK, policy and UUID bytes are admitted', 'checkInputs', 'accepted');
      verify('missing receipt refuses admission', 'missing-receipt');
      point('actual helper creates a candidate with both smoke fields', 'buildReceipt', 'accepted');
      verify('a candidate alone leaves the receipt slot empty', 'missing-receipt');
      point('caller writes the exact candidate', 'publishReceipt');
      verify('exact written receipt is admitted');
    }),
    scenario('producer mismatch and coherent policy refresh are separate gates', (point, issue, verify) => {
      issue();
      point('producer bytes change under the old policy', 'setFault', 'producer');
      point('old policy refuses the changed producer', 'checkInputs', 'producer');
      verify('verification refuses the unreviewed producer before comparing receipt', 'producer');
      point('restore reviewed producer bytes', 'setFault', 'none');
      point('synthetic review authorizes a different producer digest', 'setRevision', 'producer', 1);
      point('the coherent producer and policy pass input admission', 'checkInputs', 'accepted');
      verify('old producer receipt is stale under the coherent review', 'stale');
      issue();
      verify('new receipt binds the newly reviewed producer');
    }),
    scenario('adapter drift can stale a candidate before it is published', (point, issue, verify) => {
      point('issue candidate from the current producer wrapper bytes', 'buildReceipt', 'accepted');
      point('producer wrapper bytes change without changing the SDK pin', 'setRevision', 'adapter', 1);
      point('write the previously captured candidate', 'publishReceipt');
      verify('current adapter digest differs from stored candidate', 'stale');
      issue();
      verify('fresh receipt binds the new adapter bytes');
    }),
    scenario('a different valid source stamp stales an existing receipt', (point, issue, verify) => {
      issue();
      point('valid source stamp changes under the same source pin', 'setRevision', 'stamp', 1);
      point('same-pin source still admits exact reviewed inputs', 'checkInputs', 'accepted');
      verify('byte identity of the old stamp is stale', 'stale');
      issue();
      verify('new receipt binds the exact current source stamp');
    }),
    scenario('bundle absence or drift refuses a previously issued receipt', (point, issue, verify) => {
      issue();
      point('selected synthetic bundle disappears', 'setRevision', 'bundle', 0);
      point('input gate is independent of bundle existence', 'checkInputs', 'accepted');
      point('issuance reads and requires the selected bundle bytes', 'buildReceipt', 'bundle');
      verify('readback also requires the selected bundle file', 'bundle');
      point('a different bundle reaches the selected output path', 'setRevision', 'bundle', 2);
      verify('old bundle hash is stale', 'stale');
      issue();
      verify('fresh receipt binds the replacement bytes');
    }),
    rejectedInputs('policy, source stamp, SDK lock and UUID byte rejection', ['policy', 'stamp', 'lock', 'package']),
    rejectedInputs('inventory, regular files, adapter and core authentication rejection',
      ['inventory', 'regular', 'adapter', 'core-auth']),
    rejectedTransforms('UUID bridge transform cardinality and digest rejection', 'uuid', ['missing', 'duplicate', 'wrong']),
    rejectedTransforms('connector transform is mandatory, unique and bound to exact bytes', 'core',
      ['missing-connector', 'duplicate-connector', 'wrong-connector']),
    scenario('receipt schema and recorded smoke/provenance readback', (point, issue, verify) => {
      point('receipt slot contains incomplete JSON', 'damageStored', 'malformed');
      verify('malformed JSON refuses admission', 'receipt-json');
      issue();
      for (const kind of ['smoke', 'core-input', 'extra']) {
        point('tamper with '+kind+' in written receipt', 'tamperStored', 'binding', kind);
        verify('strict recomputation rejects '+kind, 'stale');
        point('rewrite from the untampered candidate', 'publishReceipt');
        verify('current receipt is accepted again');
      }
      point('written receipt is removed', 'damageStored', 'missing');
      verify('removal fails closed', 'missing-receipt');
    }),
    scenario('alternate consumer directory validates its selected bytes', (point, issue, verify) => {
      issue();
      verify('explicit alternate directory receipt matches its bundle');
      point('only the selected alternate bundle bytes change', 'setRevision', 'bundle', 2);
      verify('readback uses the alternate rather than source output', 'stale');
      issue();
      verify('fresh alternate receipt is admitted');
    }, {alternate: true}),
  ];
  return checkTraces({model: 'MobileBundleAdmission', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: [
      'Actual mobileBuildInputs, mobileBuildReceipt, verifyMobileBuildReceipt and UUID observation records and the core input observer execute in private scratch. The initial SDK lock, pinned producer, authored adapters, policy and all 23 UUID files are byte-exact.',
      'The source stamp and bundle are synthetic. Faults change only owned fixture bytes. A second producer digest represents a coherent synthetic policy revision.',
      'Fingerprints are equality classes of file digests. The observed candidate and stored receipt are distinct. Exact receipt admission verifies smoke claim fields. Mobile producer and smoke execution require separate evidence.',
      'One selected directory and one input fault at a time. The alternate directory is a direct verifier input; actual staged copying, interruption and installed runtime execution remain separate.',
    ]});
}
