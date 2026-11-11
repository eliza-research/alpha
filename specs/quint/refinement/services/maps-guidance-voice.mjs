/** Replays MapsGuidanceVoice model traces against the guidance voice the Maps screen is given.
 *
 * What runs: the NavigationVoice class of apps/app/src/maps/navigation-voice.ts over the shared
 * speaker it extends. App speech, the connection controller, the build flag and `document` are
 * controlled ports; every speech stays in flight until the trace settles it, and ends with an
 * abort error when its signal is aborted.
 *
 * Observation: the voice's enabled flag, newest and owed instructions and the speaker's held and
 * begun steps are read from the instance, with instructions numbered in the order the code
 * created them and the context epoch noted at creation; `speaking` is the speech the port has in
 * flight whose signal is not aborted; `listening` is whether the voice's resume handler is
 * registered on the document; `starts` is every speech the port was asked for, with the page
 * visibility at that moment; `failures` counts the failure callback. A start counts as resumed
 * when a visibility change or a settling speech caused it, and its `current` is whether the
 * instruction owed before that event still had its context. `speechHidden` is private to one
 * speech call and is not compared. */
import {build} from 'esbuild';
import {modelTraces, replayTraces, repositoryRoot} from './maps-model-traces.mjs';

const model = {path: 'specs/quint/services/MapsGuidanceVoice.qnt', module: 'MapsGuidanceVoice'};
const tick = () => new Promise(resolve => setImmediate(resolve));

async function load() {
  const stubs = {
    '../runtime/local-voice': 'export const createOnDeviceVoice=()=>null;',
    '../runtime/app-speech': 'export const speakAppText=(text,signal)=>globalThis.mapsVoiceProbe.speak(text,signal);',
    '../runtime/connection-ui': 'export const connectionController={getSnapshot:()=>globalThis.mapsVoiceProbe.snapshot(),getCloudClient:()=>globalThis.mapsVoiceProbe.client(),getCloudEnvironment:()=>"fixture"};',
    '../build-flags': 'export const cloudRuntimeEnabled=true;',
  };
  const result = await build({
    absWorkingDir: repositoryRoot, entryPoints: ['apps/app/src/maps/navigation-voice.ts'], bundle: true, write: false,
    format: 'esm', platform: 'neutral', logLevel: 'silent',
    plugins: [{name: 'ports', setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(stubs, args.path) ? {path: args.path, namespace: 'port'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'port'}, args => ({contents: stubs[args.path], loader: 'js'}));
    }}],
  });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

function driver({NavigationVoice}) {
  const previousDocument = globalThis.document;
  const document = globalThis.document = Object.assign(new EventTarget(), {hidden: false, documentElement: {dataset: {connectionMode: 'cloud'}}});
  const handlers = new Set(), add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (name, handler) => { handlers.add(handler); add(name, handler); };
  document.removeEventListener = (name, handler) => { handlers.delete(handler); remove(name, handler); };
  const port = {epoch: 0, sheetOpen: false}, accounts = Array.from({length: 8}, (_, index) => ({ownerId: 'account-' + index}));
  const ids = new WeakMap(), epochs = new Map(), starts = [];
  let minted = 0, failures = 0, speech = null, cause = null, voice;
  const id = instruction => {
    if (!instruction) return 0;
    if (!ids.has(instruction)) { ids.set(instruction, ++minted); epochs.set(minted, port.epoch); }
    return ids.get(instruction);
  };
  globalThis.mapsVoiceProbe = {
    snapshot: () => ({open: port.sheetOpen, session: accounts[port.epoch], residentInference: 'resident', providerStatus: {revision: 1}}),
    client: () => ({sessionId: 'session', credentialId: 'credential'}),
    speak(text, signal) {
      const instruction = id(voice.latest);
      starts.push({instruction, key: Number(text.at(-1)), hidden: document.hidden, resumed: cause.resumes, current: cause.resumes ? cause.wasCurrent : true});
      const call = speech = {instruction, signal};
      return new Promise((resolve, reject) => {
        Object.assign(call, {resolve, reject});
        signal.addEventListener('abort', () => reject(Object.assign(Error('Speech was stopped.'), {name: 'AbortError'})));
      });
    },
  };
  voice = new NavigationVoice(() => { failures++; });
  const key = step => step ? Number(step.key.slice(1)) : 0;
  async function act(resumes, run) {
    const latest = voice.latest;
    cause = {resumes, wasCurrent: !!latest && latest.current()};
    run(); await tick(); id(voice.latest);
  }
  return {
    update: step => act(false, () => voice.update('k' + step, 'Turn ' + step)),
    hide: () => act(true, () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); }),
    show: () => act(true, () => { document.hidden = false; document.dispatchEvent(new Event('visibilitychange')); }),
    speechSettles: outcome => act(true, () => {
      if (!speech || speech.signal.aborted) throw Error('the code has no speech in flight');
      if (outcome === 'done') speech.resolve();
      else speech.reject(outcome === 'failed' ? Error('The speech provider failed.') : Object.assign(Error('The platform cut speech off.'), {name: 'AbortError'}));
      speech = null;
    }),
    pause: () => act(false, () => voice.pause()),
    toggle: () => act(false, () => voice.toggle()),
    contextChanges: () => act(false, () => { port.epoch++; }),
    setSheetOpen: flag => act(false, () => { port.sheetOpen = flag; }),
    observe() {
      const latest = id(voice.latest);
      return {
        enabled: voice.enabled, hidden: document.hidden, epoch: port.epoch, sheetOpen: port.sheetOpen,
        latest: {id: latest, key: key(voice.latest), epoch: latest ? epochs.get(latest) : 0}, minted,
        held: key(voice.current), spoken: voice.spoken ? Number(voice.spoken.slice(1)) : 0,
        speaking: speech && !speech.signal.aborted ? speech.instruction : 0,
        owed: id(voice.owed), listening: handlers.has(voice.resume),
        starts: [...new Set(starts.map(start => JSON.stringify(start)))].sort(), failures,
      };
    },
    close() { globalThis.document = previousDocument; },
  };
}

const project = state => {
  const {speechHidden, ...rest} = state;
  return {...rest, starts: state.starts.map(start => JSON.stringify({instruction: start.instruction, key: start.key, hidden: start.hidden, resumed: start.resumed, current: start.current})).sort()};
};

export async function replayMapsGuidanceVoice({scenarios, witnesses, random = 60, steps = 40}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const loaded = await load();
  return replayTraces(traces, () => driver(loaded), {project});
}
