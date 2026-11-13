import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {residentBootMessage, residentLivenessCheck} from '../../../../apps/app/src/runtime/resident-recovery.ts';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {deferred, tick} from '../../legacy/core/source-support.mjs';

const model = 'ResidentLiveness';
const controller = 'apps/app/src/runtime/connection-ui.tsx';
const sources = [fileURLToPath(import.meta.url), controller, 'apps/app/src/runtime/resident-recovery.ts',
  'apps/app/src/runtime/local-agent.ts', 'specs/quint/legacy/core/source-support.mjs'];

function fixture(code, name) {
  let clock = 0, last = -2, reads = 0, starts = 0, queued = 0;
  let read, start;
  const state = {error: ''};
  const context = vm.createContext({
    epoch: 1, active: {kind: 'resident'}, operation: null, state,
    residentBootMessage,
    residentLivenessCheck: load => residentLivenessCheck(load, () => clock * 5000),
    localAgentBootStatus() {
      assert.equal(read, undefined);
      read = {epoch: context.epoch, port: deferred()};
      last = clock;
      reads++;
      return read.port.promise;
    },
    retire() {context.epoch++; context.active = null;},
    update: patch => Object.assign(state, patch),
    ensureResident() {
      assert.equal(start, undefined);
      start = {epoch: context.epoch, port: deferred()};
      starts++;
      return start.port.promise;
    },
    queueResidentRebind() {queued++;},
  });
  code.runInContext(context);
  const observe = () => ({
    'state.epoch': context.epoch,
    'state.active': context.active?.kind === 'resident',
    'state.busy': context.operation !== null,
    'state.clock': clock,
    'state.last': last,
    'state.reading': read?.epoch ?? 0,
    'state.reads': reads,
    'state.starting': start?.epoch ?? 0,
    'state.starts': starts,
    'state.queued': queued,
    'state.notice': [residentBootMessage('fatal'), residentBootMessage('')].includes(state.error),
  });
  const trace = {name, init: {name: 'init'}, expect: observe(), steps: []};
  function checkpoint(label, name, ...args) {
    trace.steps.push({label, action: {name, args}, expect: observe()});
  }
  return {
    trace,
    tick() {
      clock++;
      checkpoint('five seconds elapse in the actual rate limiter', 'tick');
    },
    busy(value) {
      context.operation = value ? {} : null;
      checkpoint('connection operation ownership changes', 'setBusy', value);
    },
    async check(epoch = context.epoch) {
      context.checkResidentAlive(epoch);
      await tick();
      checkpoint('actual channel failure enters or skips native status', 'checkStatus', epoch);
    },
    replace(active) {
      context.epoch++;
      context.active = active ? {kind: 'resident'} : null;
      state.error = '';
      checkpoint('the surrounding connection switches epoch', 'replaceOwner', active);
    },
    async reply(value) {
      assert.ok(read);
      const pending = read;
      if (value === 'unavailable') pending.port.reject(Error('Fixture native status unavailable'));
      else pending.port.resolve({state: value, ...(value === 'dead' ? {reason: 'fatal'} : {})});
      await tick();
      read = undefined;
      checkpoint('actual native reply retires only its current lost owner', 'statusReply',
        ['dead', 'restarting', 'booting'].includes(value));
    },
    async finish(connected, refused = false) {
      assert.ok(start);
      const pending = start;
      if (context.epoch === pending.epoch) {
        if (connected) context.active = {kind: 'resident'};
        if (refused) state.residentRecoveryReason = 'runtime-identity-unavailable';
      }
      pending.port.resolve();
      await tick();
      start = undefined;
      checkpoint('restart port finishes and stale copy stays fenced', 'restartReply', connected, refused);
    },
  };
}

export async function checkResidentLiveness(extraSources = []) {
  const inputs = [...sources, ...extraSources], driverHashes = captureInputs(inputs);
  const source = readFileSync(controller, 'utf8');
  const begin = source.indexOf('let residentRestartEpoch');
  const end = source.indexOf('/** Test mocks only (the mock-mode exit', begin);
  assert.ok(begin >= 0 && end > begin);
  const code = new vm.Script(transformSync(source.slice(begin, end), {loader: 'ts'}).code);
  const traces = [];
  async function scenario(name, drive) {
    const f = fixture(code, name);
    await drive(f);
    traces.push(f.trace);
  }
  await scenario('duplicate-and-rate-limited-native-checks', async f => {
    await f.check(); await f.check(); await f.reply('listening');
    f.tick(); await f.check(); f.tick(); await f.check(); await f.reply('stopped');
  });
  await scenario('lost-connection-retires-and-restart-failure-uses-plain-copy', async f => {
    await f.check(0); await f.check(); await f.reply('dead'); await f.finish(false);
  });
  await scenario('stale-native-read-cannot-restart-successor', async f => {
    await f.check(); f.replace(true); await f.reply('dead'); f.tick(); f.tick();
    await f.check(); await f.reply('listening');
  });
  await scenario('busy-owner-defers-rebind', async f => {
    f.busy(true); await f.check(); await f.reply('restarting');
  });
  await scenario('retired-restart-result-cannot-publish-copy', async f => {
    await f.check(); await f.reply('booting'); f.replace(false); await f.finish(false);
  });
  await scenario('typed-refusal-owns-recovery-copy', async f => {
    await f.check(); await f.reply('dead'); await f.finish(false, true);
  });
  await scenario('native-status-error-does-not-restart', async f => {
    await f.check(); await f.reply('unavailable');
  });
  const receipt = await checkTraces({model, traces, sources: inputs, driverHashes, scope: 'bounded-orchestration',
    assumptions: [
      'Actual connection liveness and retirement functions execute with the actual rate limiter.',
      'Native status, connection retirement, and restart are controlled ports. Time moves in five-second ticks. The driver observes current epoch, promise owners, starts, queued rebinds and exposed copy.',
      'At most one status check and one controlled restart are pending. Actual native process lifetime, queued rebind execution and restart admission remain separate.',
    ]});
  return {receipt, obligations: [
    {model, obligation: 'Compose queued recovery with installed native lifecycle',
      reason: 'This campaign checks notification and ownership under controlled ports. It leaves installed status, stop, and start behavior to Android evidence.'},
  ]};
}
