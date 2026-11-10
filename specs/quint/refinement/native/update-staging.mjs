import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {jsonJar} from '../../../../test/fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {app, directory, javaTraceCampaign, root} from './java.mjs';
import {exactUpdateMembers} from './update-barrier.mjs';

const model = 'NativeUpdateStaging';
const settings = 'apps/app/src/prototype/settings-adapter.ts';
const plugin = app + 'AlphaDevicePlugin.java';
const transport = 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/ConnectionTransport.java';
const journal = 'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/updater/RuntimeUpdatePause.java';
const fixtureRoot = 'test/fixtures/app-update-jvm';
const fixtureSources = readdirSync(join(root, fixtureRoot), {recursive: true})
  .filter(file => file.endsWith('.java') && !file.endsWith('/ConnectionTransport.java'))
  .map(file => join(fixtureRoot, file)).sort();
const modes = ['permission-only', 'busy-peer-and-exact-staged-copy', 'owner-destroy-during-download',
  'owner-destroy-during-archive-read', 'same-size-corrupt-body', 'wrong-archive-version', 'wrong-archive-package',
  'wrong-archive-flavor', 'wrong-archive-signer', 'abandon-refused',
  'stale-cache-sweep', 'cache-delete-refused', 'boot-inclusive-boundary-and-process', 'boot-precedence',
  'boot-permission-and-later-admission', 'boot-manual-cold', 'boot-download-failure-and-warm-process'];
const sha = value => createHash('sha256').update(value).digest('hex');
const signer = sha(Buffer.of(7));
const installed = {versionCode: 7, launcher: true, signerSha256: signer};
const offered = {schema: 'alpha-update/v1', variant: 'launcher', signerSha256: signer, versionCode: 8,
  versionName: 'Synthetic update', apkUrl: 'https://updates.test/alpha-8.apk', sha256: sha(Buffer.of(1, 2, 3, 4)), sizeBytes: 4};
const replacement = {...offered, versionCode: 9, apkUrl: 'https://updates.test/alpha-9.apk'};
const secondFeed = {schema: 'alpha-update/index-v1', releases: [{...offered, variant: 'standalone'}, replacement]};
const offerJson = JSON.stringify(offered);
const nativeInputs = {
  offer1: [200, offerJson],
  offer2: [200, JSON.stringify(secondFeed)],
  withdrawn: [404, ''],
  malformed: [200, '{bad json'],
  invalid: [200, JSON.stringify({...offered, variant: 'standalone'})],
  transport: [503, ''],
  exactLimit: [200, offerJson.padEnd(65536)],
  oversized: [200, offerJson.padEnd(65537)],
};
const minuteMs = 60 * 1000;
const initialNative = {'s.owner':0, 's.target':0, 's.phase':'idle', 's.file':'absent', 's.bytes':0, 's.session':'none',
  's.stagedBytes':0, 's.connected':false, 's.fetches':0, 's.created':0, 's.abandoned':0, 's.outcome':'none'};

function settingsProgram() {
  const source = readFileSync(join(root, settings), 'utf8');
  // Both slices end at the comment opening the next unrelated declaration; a missing marker fails here.
  const between = (start, end) => {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `settings source markers: ${start} .. ${end}`);
    return source.slice(from, to);
  };
  const review = between('export const UPDATE_SCHEMA', "/** The Privacy page's voice fact");
  const cache = between('const UPDATE_KEY', '/** Keep the reference settings components');
  assert.ok(review.includes('function parseUpdateManifest(') && cache.includes('device.checkForUpdate()'));
  return new vm.Script(stripTypeScriptTypes((review + cache).replace(/^export /gm, '') + `
globalThis.inspect = () => ({cache: savedUpdate(), checking: !!updateCheck});
globalThis.review = parseUpdateManifest;
globalThis.due = updateCheckDue;
globalThis.check = checkForUpdate;`, {mode: 'strip'}));
}

function renderer(program, name, responses) {
  let now = 0, stored = null, writable = true, count = 0, settle, pending, context;
  const setUp = () => {
    context = vm.createContext({
      Date: {now: () => now * minuteMs}, URL,
      Capacitor: {isNativePlatform: () => true},
      localStorage: {
        getItem(key) {assert.equal(key, 'alpha.app-update.v1'); return stored;},
        setItem(key, value) {
          assert.equal(key, 'alpha.app-update.v1');
          if (!writable) throw Error('Controlled cache storage failure');
          stored = value;
        },
      },
      device: {checkForUpdate() {
        count++;
        return new Promise((resolve, reject) => {settle = {resolve, reject};});
      }},
    });
    program.runInContext(context);
  };
  setUp();
  const manifestClass = manifest => {
    if (manifest == null) return 0;
    const receipt = context.review(manifest, installed);
    if (!receipt) return -1;
    assert.ok([8, 9].includes(receipt.versionCode));
    return receipt.versionCode - 7;
  };
  const minute = checkedAt => Number.isFinite(checkedAt) ? checkedAt / minuteMs : -1;
  function observe() {
    const {cache, checking} = context.inspect();
    const durable = JSON.parse(stored ?? 'null');
    const cached = manifestClass(cache.manifest);
    return {'s.clock':now, 's.checkedAt':minute(cache.checkedAt), 's.cached':cached,
      's.storedAt':minute(durable?.checkedAt), 's.stored':manifestClass(durable?.manifest),
      's.checking':checking, validOffer:Math.max(0,cached), checkDue:context.due(cache.checkedAt,now * minuteMs)};
  }
  const trace = {name, init:{name:'init'}, expect:{...initialNative,...observe()}, steps:[]};
  function point(label, action, ...args) {
    trace.steps.push({label, action:action ? {name:action,args} : null, expect:{...initialNative,...observe()}});
  }
  return {
    trace, observe,
    clockAt(value) {now=value; point('renderer check clock advanced or rolled back','clockAt',value);},
    request(force = false) {
      const before = count;
      pending = context.check(force);
      assert.ok(pending);
      assert.equal(count,before+1);
      point('actual Settings check awaits native readback','requestCheck',force);
    },
    duplicate() {
      const before = count;
      assert.equal(context.check(true),pending);
      assert.equal(count,before);
      point('another forced check joins the same source promise',null);
    },
    fresh() {
      const before = count;
      assert.equal(context.check(false),undefined);
      assert.equal(count,before);
      point('fresh cached check suppresses the automatic readback',null);
    },
    async answer(answer, saved = true, nativeMode = answer) {
      const source = responses[nativeMode];
      assert.ok(source);
      writable=saved;
      if (source.resolved) settle.resolve(source.manifest == null ? {} : {manifest:source.manifest});
      else settle.reject(Error('Controlled native check refusal'));
      await pending;
      point('actual native reply updates the Settings cache according to its outcome','answerCheck',answer,saved);
    },
    reopen() {setUp();point('fresh Settings closure reopens the stored offer','reopenSettings');},
    receipt() {
      const result = context.review(context.inspect().cache.manifest,installed);
      assert.ok(result);
      return {...result, signer};
    },
  };
}

export async function checkNativeUpdateStaging(extraSources = []) {
  const harness = 'UpdateStagingHarness.java';
  const compiled = [app + 'PluginWorkers.java', 'vendor/eliza/' + journal, 'vendor/eliza/' + transport,
    'test/fixtures/UpdateFlowTest.java', ...fixtureSources];
  const sources = [fileURLToPath(import.meta.url), plugin, settings, ...compiled, join(directory,harness),
    join(directory,'Trace.java'), join(directory,'java.mjs'), join(directory,'update-barrier.mjs'),
    'scripts/upstream-native-source.mjs', 'upstream.lock.json', 'test/fixtures/jvm-tools.mjs',
    'test/support/strip-types.mjs', ...(jsonJar ? [jsonJar] : []), ...extraSources];
  const driverHashes = captureInputs(sources);
  const upstream = upstreamNativeSource(root);
  for (const path of [journal,transport])
    assert.equal(driverHashes[join(root,'vendor/eliza',path)],upstream.read(path).get(path).sha256);
  const temporary = mkdtempSync(join(tmpdir(),'quint-update-staging-source-'));
  const traces = [], skipped = [];
  try {
    const members = join(temporary,'AlphaDevicePlugin.java');
    writeFileSync(members,exactUpdateMembers(readFileSync(join(root,plugin),'utf8')));
    const native = Object.entries(nativeInputs);
    const program = settingsProgram();
    const bootstrap = renderer(program,'bootstrap',{offer1:{resolved:true,manifest:offerJson}});
    bootstrap.request();
    await bootstrap.answer('offer1');
    const receipt = bootstrap.receipt();
    assert.deepEqual(Object.fromEntries(['apkUrl','sha256','sizeBytes','versionCode'].map(key => [key,receipt[key]])),
      Object.fromEntries(['apkUrl','sha256','sizeBytes','versionCode'].map(key => [key,offered[key]])));
    const args = [...native.map(([, [code, body]]) => ['manifest',String(code),body]),
      ['deadline'], ...modes.map(mode => [mode,JSON.stringify(receipt)])];
    const results = javaTraceCampaign(harness,[members,...compiled],args);
    const responses = Object.fromEntries(native.map(([key],index) => [key,results[index]]));
    assert.deepEqual(responses.offer1,{resolved:true,manifest:offerJson});
    assert.deepEqual(responses.withdrawn,{resolved:true,manifest:null});
    assert.deepEqual(responses.transport,{resolved:false,manifest:null});
    assert.equal(responses.exactLimit.manifest.length,65536);
    assert.deepEqual(responses.oversized,{resolved:false,manifest:null});
    const deadline = results[native.length];
    assert.deepEqual(deadline,{lateBody:{verified:false,bytes:2},lateEof:{verified:true,bytes:4}});

    const cache = renderer(program,'cached-offer-cadence-withdrawal-and-replacement',responses);
    cache.request();cache.duplicate();await cache.answer('offer1');
    cache.clockAt(14);cache.fresh();
    cache.clockAt(15);cache.request();await cache.answer('transport',false);
    cache.request();await cache.answer('malformed',false);
    cache.request();await cache.answer('transport',false,'oversized');
    cache.request();await cache.answer('offer1',true,'exactLimit');
    cache.clockAt(0);cache.request();await cache.answer('offer2');
    cache.request(true);await cache.answer('withdrawn');
    traces.push(cache.trace);

    const restored = renderer(program,'unsaved-replacement-and-incompatible-offer',responses);
    restored.request();await restored.answer('offer1');
    restored.request(true);await restored.answer('offer2',false);
    restored.reopen();
    restored.request(true);await restored.answer('invalid');
    traces.push(restored.trace);

    for (const [index,result] of results.slice(native.length+1).entries()) {
      if (result.skip) {
        assert.equal(modes[index],'cache-delete-refused');
        skipped.push({mode:modes[index],reason:result.skip});
        continue;
      }
      const nativeTrace=result.trace;
      assert.equal(nativeTrace.name,modes[index]);
      assert.deepEqual(Object.fromEntries(Object.keys(initialNative).map(key => [key,nativeTrace.expect[key]])),initialNative);
      const review=renderer(program,nativeTrace.name,responses);
      review.request();await review.answer('offer1');
      assert.deepEqual(review.receipt(),receipt);
      const reviewState=review.observe();
      review.trace.expect={...review.trace.expect,...nativeTrace.expect};
      review.trace.steps.push(...nativeTrace.steps.map(step => ({...step,expect:{...reviewState,...step.expect}})));
      traces.push(review.trace);
    }
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }

  const receipt = await checkTraces({model,traces,sources,driverHashes,scope:'bounded-orchestration',assumptions:[
    'Actual native manifest transport and exact Settings review/cache functions execute through synthetic responses. The checked Settings tuple is passed to the JVM installer before the first activation event.',
    'Controlled HTTPS, fake archive metadata and an installer sink expose actual cache bytes, digest admission, file custody, precommit copy and cleanup. The fixture refuses each staged update before resident stop or commit.',
    'Direct copyVerified probes test the real deadline behavior: late body bytes are rejected and a late EOF can verify bytes already read. The full install traces use the production deadline.',
    'Cold-boot traces execute the actual capability and installer functions with controlled SDK, consent and Android SystemClock. Uptime samples 0,26681,29999,30000,30001,35000 preserve the inclusive boundary. A shut-down executor proves refused calls resolve before worker admission; real cache/network/session/barrier/stop/commit effects remain absent.',
    'Same-boot process replacement preserves controlled uptime; a new boot resets it. These are explicit fixture observations between attempts, not installed-device reboot validation. A failed actual digest and later warm-process admission retain the existing cleanup contract.',
    ...skipped.map(({mode,reason}) => `Host capability omitted ${mode}: ${reason}.`),
  ]});
  return {receipt,skipped,obligations:[
    {model,obligation:'Installed PackageInstaller, TLS and activity delivery',
      reason:'Synthetic ports exercise the source and real cache bytes. Installed Android archive reading, redirect/TLS policy and system installation remain external.'},
    {model,obligation:'Concurrent checks, queued same-bridge taps and post-activation effects',
      reason:'This campaign covers one exact reviewed tuple per native attempt and cross-bridge exclusion. Same-bridge executor queuing, pre-existing Android sessions and downstream activation/journal behavior have separate source schedules.'},
  ]};
}
