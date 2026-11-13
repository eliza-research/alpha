// WakeListenerStop against stopWakeListenerForChatOnly, admitImageSense and
// wakeListeningStopUnconfirmed in apps/app/src/runtime/always-on-listener.ts, bundled with the
// prepared shared listener bridge the project maps @elizaos/capacitor-system/sense to, so the
// deadline and the reading of a reply are the shared stop's own.
// Ports: Capacitor's platform and plugin availability, the listener plugin's turnOff call (held
// until the model answers it) and the five-second deadline timer.
import {loadProductModule, modelTraces, replayTraces, settle, witnessTraces} from '../application/notes-files-media-itf.mjs';

const source = 'apps/app/src/runtime/always-on-listener.ts';
const model = {path: 'specs/quint/native/WakeListenerStop.qnt', main: 'WakeListenerStop'};
const witnesses = ['LateStopKeepsWarningWitness', 'ConfirmedStopClearsWarningWitness', 'OverlappingRequestsDisagreeWitness',
  'MissingPortWitness', 'SkippedRequestKeepsWarningWitness'];
const stubs = {
  '@capacitor/core': 'const port=()=>globalThis.alphaListenerPort;'
    + 'export const Capacitor={getPlatform:()=>port().platform(),isNativePlatform:()=>port().platform()==="android",'
    + 'isPluginAvailable:name=>port().available(name)};'
    + 'export const registerPlugin=name=>new Proxy({},{get:(_,method)=>(...input)=>port().call(name,method,...input)});',
};
const replies = {
  off: {available: true, state: 'OFF', label: 'Listening off', consented: true, listening: false, microphoneOpen: false},
  listening: {available: true, state: 'LISTENING', consented: true, listening: true, microphoneOpen: true},
  'microphone-open': {available: true, state: 'OFF', consented: true, listening: false, microphoneOpen: true},
  unavailable: {available: false},
  malformed: {available: true, state: 'ASLEEP'},
};
const actions = ['admission', 'request', 'requestWithoutPort', 'requestWhileAdmitted', 'requestOffAndroid', 'replyArrives',
  'replyFails', 'deadline', 'lateReply'];

export async function replayWakeListenerStop({rewrite, ...options} = {}) {
  const traces = [...modelTraces({...model, ...options}), ...witnessTraces({...model, witnesses})];
  return replayTraces(traces, {
    required: actions,
    reached: {
      'a stop proved only after its deadline': ({s}) => s.lateReplies > 0 && s.latch,
      'a confirmed stop clearing an earlier warning': ({s}) => !s.latch && s.lastVerdict === 'confirmed' && s.portCalls > 1,
      'overlapping requests that disagree': ({s}) => s.latch && Object.values(s.calls).some(call => call.phase === 'answered' && call.confirmed),
      'a request without the listener port': ({s}) => Object.values(s.calls).some(call => call.phase === 'refused'),
      'a skipped request beside a standing warning': ({s}) => s.latch && Object.values(s.calls).some(call => call.phase === 'skipped'),
    },
    // Whether a request ended by an answer, by its deadline or without a stop is not visible to
    // its caller; the caller sees that it settled and what it returned.
    project: ({s}) => ({latch: s.latch, portCalls: s.portCalls,
      calls: Object.fromEntries(Object.entries(s.calls).map(([slot, call]) => [slot,
        {state: call.phase === 'idle' ? 'idle' : call.phase === 'waiting' ? 'waiting' : 'settled', confirmed: call.confirmed}]))}),
    async start() {
      const calls = {0: {state: 'idle', confirmed: false}, 1: {state: 'idle', confirmed: false}}, armed = new Set();
      let available = true, platform = 'android', portCalls = 0, outstanding;
      globalThis.alphaListenerPort = {
        platform: () => platform,
        available: name => name === 'ElizaSense' && available,
        call(name, method) {
          if (name !== 'ElizaSense' || method !== 'turnOff') throw Error(`unexpected native call ${name}.${method}`);
          portCalls++;
          return new Promise((resolve, reject) => Object.assign(outstanding, {resolve, reject}));
        },
      };
      // A fresh module: the latch and the image's admission are module state.
      const product = await loadProductModule(source, {rewrite, stubs});
      const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
      globalThis.clearTimeout = timer => { if (armed.has(timer)) armed.delete(timer);else realClear(timer); };
      const begin = async slot => {
        const call = calls[slot] = outstanding = {state: 'waiting', confirmed: false};
        globalThis.setTimeout = (fire, delay) => {
          if (delay !== 5000) throw Error(`unexpected deadline ${delay}`);
          const timer = {fire};armed.add(timer);call.timer = timer;return timer;
        };
        try {
          product.stopWakeListenerForChatOnly().then(result => {
            if (typeof result !== 'boolean') throw Error('the stop did not report a verdict');
            call.state = 'settled';call.confirmed = result;
          });
        } finally { globalThis.setTimeout = realSet; }
        await settle();
      };
      const settled = async () => {
        await settle();
        if (armed.size !== Object.values(calls).filter(call => call.state === 'waiting').length) throw Error('a settled stop left its deadline armed');
      };
      return {
        actions: {
          admission: ({value}) => product.admitImageSense(value ? {aospImage: true, sense: true} : null),
          request: ({slot}) => begin(slot),
          async requestWithoutPort({slot}) { available = false;try { await begin(slot); } finally { available = true; } },
          requestWhileAdmitted: ({slot}) => begin(slot),
          async requestOffAndroid({slot}) { platform = 'web';try { await begin(slot); } finally { platform = 'android'; } },
          async replyArrives({slot, reply}) { calls[slot].resolve(replies[reply]);await settled(); },
          async replyFails({slot}) { calls[slot].reject(Error('listener unavailable'));await settled(); },
          async deadline({slot}) { calls[slot].timer.fire();await settled(); },
          async lateReply({slot, reply}) { calls[slot].resolve(replies[reply]);await settled(); },
        },
        observe: () => ({latch: product.wakeListeningStopUnconfirmed(), portCalls,
          calls: Object.fromEntries(Object.entries(calls).map(([slot, call]) => [slot, {state: call.state, confirmed: call.confirmed}]))}),
        close() { globalThis.clearTimeout = realClear;delete globalThis.alphaListenerPort; },
      };
    },
  });
}
