import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, qset} from '../check-traces.mjs';
import {root} from './java.mjs';

/** Discover the full executable graph, then hash it before evaluating the bundle. */
export async function captureRendererImplementation(additionalSources = []) {
  const options = {
    absWorkingDir: root,
    stdin: {contents: `
      export {VoiceAssistantSession, splitSpokenSentences, ASSISTANT_TIMING_DEFAULTS} from './apps/app/src/runtime/voice-assistant.ts';
    `, resolveDir: root, sourcefile: 'quint-native-implementation.ts'},
    bundle: true, write: false, platform: 'node', format: 'esm', metafile: true,
  };
  const discovery = await build(options);
  const sources = Object.keys(discovery.metafile.inputs).map(path => resolve(root, path)).filter(existsSync)
    .concat(fileURLToPath(import.meta.url), additionalSources,
      resolve(root, 'upstream.lock.json'), resolve(root, '.eliza/client-features/.source.json'));
  const driverHashes = captureInputs(sources);
  const compiled = await build(options);
  const implementation = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64') + '#' + crypto.randomUUID());
  return {implementation, sources, driverHashes};
}

const action = (name, ...args) => ({name, args});
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {});
  return {promise, resolve, reject};
}

function voiceHarness({VoiceAssistantSession, splitSpokenSentences}) {
  let now = 0;
  let current = true;
  let handlers;
  let heard = '';
  const timers = new Map();
  let timerId = 0;
  const requests = [];
  const playbacks = [];
  const clock = {
    now: () => now,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, {callback, at: now + delay}); return id; },
    clearTimer(id) { timers.delete(id); },
    async advance(delta) {
      const end = now + delta;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await flush();
      }
      now = end; await flush();
    },
  };
  const session = new VoiceAssistantSession({
    conversationId: 'refinement',
    assertCurrent() { if (!current) throw new DOMException('retired', 'AbortError'); },
    async listen(value) { handlers = value; return {fullDuplex: true, async close() {}, cancel() {}}; },
    send(input) {
      const pending = deferred(); requests.push({input, pending});
      input.signal.addEventListener('abort', () => pending.reject(input.signal.reason), {once: true});
      return pending.promise;
    },
    speak(input) {
      const pending = deferred(); playbacks.push({input, pending}); input.onStarted();
      input.signal.addEventListener('abort', () => pending.reject(input.signal.reason), {once: true});
      return pending.promise;
    },
    onHeard(value) { heard = value.heard; },
  }, {clock});
  const observe = () => ({
    's.phase': session.getSnapshot().phase === 'awaiting-user-input' ? 'awaiting-review' : session.getSnapshot().phase,
    's.capture': Boolean(session.capture),
    's.muted': session.muted,
  });
  return {session, clock, requests, playbacks, observe,
    get handlers() { return handlers; },
    retire() { current = false; session.recheck(); },
    heard() { return session.response?.played ?? splitSpokenSentences(heard).length; },
    answer(index = 0) {
      const {input, pending} = requests[index];
      pending.resolve({requestId: input.turnId, conversationId: 'refinement', userMessageId: 'user', assistantMessageId: 'reply',
        complete: true, text: 'This is the first complete sentence. This is the second complete sentence.'});
    },
  };
}

export async function voiceTraces(implementation) {
  const traces = [];
  for (const mode of ['complete', 'stop-pending', 'retire-pending', 'mute-pending', 'stop-speaking']) {
    const host = voiceHarness(implementation);
    const trace = {name: `voice-${mode}`, expect: host.observe(), steps: []};
    const step = (descriptor, expect = host.observe()) => trace.steps.push({label: descriptor.name, action: descriptor, expect});
    await host.session.start(); step(action('start', false, true));
    host.handlers.onSpeechStart(0); step(action('speechStarts'));
    host.handlers.onSpeechEnd(0); host.handlers.onSegment('Please describe the weather.'); await flush();
    step(action('segment', 0, true), {...host.observe(), 's.text': Boolean(host.session.getSnapshot().pendingText)});
    await host.clock.advance(implementation.ASSISTANT_TIMING_DEFAULTS.longGapMs); step(action('submit', true), {...host.observe(), 's.sent': qset(host.requests.map((_, index) => index + 1))});
    if (mode === 'stop-pending' || mode === 'retire-pending') {
      if (mode === 'retire-pending') { host.retire(); await flush(); } else await host.session.stop();
      step(action('stop'));
      host.answer(); await flush(); step(action('reply', 0, 1, false));
    } else {
      if (mode === 'mute-pending') { await host.session.setMuted(true); step(action('mute')); }
      host.answer(); await flush(); step(action('reply', 0, 1, false));
      host.playbacks[0].pending.resolve(); await flush();
      step(action('sentenceFinished', 0, 1), {...host.observe(), 's.heard': host.heard()});
      if (mode === 'stop-speaking') {
        await host.session.stop(); step(action('stop'), {...host.observe(), 's.heard': host.heard()});
      } else {
        host.playbacks[1].pending.resolve(); await flush();
        trace.steps.push({label: 'last sentence and reply completion', action: [action('sentenceFinished', 0, 1), action('playbackFinished')],
          expect: {...host.observe(), 's.heard': host.heard()}});
        await host.session.stop(); step(action('stop'));
      }
    }
    traces.push(trace);
  }
  return traces;
}
