/** Replays QuietVoiceRetry model traces against the voice surface's `quietVoiceRetry`, evaluated
 * from apps/app/src/prototype/voice-adapter.ts.
 *
 * The function lives in the adapter's closure. The replay supplies that closure's variables (the
 * retry count and timer, the conversation state, the generation and chat destination) and applies
 * the surrounding adapter statements the model's other actions stand for: opening resets the
 * count and begins a conversation, reply speech resets the count, a failure the function does not
 * take is shown as an error, Retry resets the count and begins again, and cleanup clears the wait.
 *
 * Controlled ports: the wait timer, the chat's currency, the connection's inference mode and the
 * limit facts of a Cloud speech refusal (`cloudVoiceServiceLimit`). This compatibility branch
 * has already found local speech unavailable for the current chat. The real localVoiceFallback
 * helper checks that fact; network-to-device routing is covered by its owning tests. `opens` is not observed. */
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/QuietVoiceRetry.qnt', module: 'QuietVoiceRetry'};
export const scenarios = ['transientRefusalListensAgainTest', 'thirdRefusalEndsVoiceTest', 'longWaitEndsVoiceTest', 'otherFailureIsShownTest',
  'ownKeyRefusalIsShownTest', 'staleChatEndsVoiceAfterWaitTest', 'speechResetsTheCountTest', 'closeClearsTheWaitTest'];
export const witnesses = ['SecondWaitWitness', 'ThirdRefusalEndsVoiceWitness', 'LongWaitEndsVoiceWitness', 'StaleChatEndsVoiceWitness', 'CountResetBySpeechWitness'];

const flush = async () => { for (let turn = 0; turn < 2; turn++) await new Promise(resolve => setImmediate(resolve)); };

export function compile() {
  const source = readFileSync(`${repositoryRoot}/apps/app/src/prototype/voice-adapter.ts`, 'utf8');
  const start = source.indexOf('  function localVoiceFallback('), end = source.indexOf('  async function beginConversation(){', start);
  if (start < 0 || end <= start) throw Error('missing source anchor quietVoiceRetry');
  return transformSync(`let quietRetries=0,quietRetry,conversationState={phase:'idle'},error='',generation=0,chatDestination;
    let conversationNetwork=true,conversationLocal,conversationLocalMissing,mediaUnconfirmed;
    const noteNetworkSpeechFailure=()=>{throw Error('A known-unavailable local route must not admit a new fallback');};
    const stopClock=()=>{},refresh=()=>{};
    function chatCurrent(){return ports.current();}
    function cleanup(){++generation;if(quietRetry)clearTimeout(quietRetry);quietRetry=undefined;chatDestination=undefined;conversationState={phase:'idle'};}
    function cancelChat(){ports.paused();cleanup();}
    async function beginConversation(){ports.begun();conversationState={phase:'starting'};}
    ${source.slice(start, end)}
    return {
      open(){chatDestination={};conversationLocalMissing=chatDestination;quietRetries=0;void beginConversation();},
      phase(value){conversationState={phase:value};if(value==='speaking')quietRetries=0;},
      failed(failure){if(quietVoiceRetry(failure,chatDestination,generation))return;conversationState={phase:'error',error:failure};ports.shown();},
      recover(){quietRetries=0;void beginConversation();},
      close(){cleanup();},
      state(){return {voice:!!chatDestination,phase:conversationState.phase,retries:quietRetries,timer:quietRetry!==undefined};}};`, {loader: 'ts', format: 'cjs'}).code;
}

export function project(state) {
  const {opens, ...observed} = state;
  return observed;
}

export function createDriver(code) {
  let current = true, direct = false, fromTimer = false;
  const counts = {starts: 0, quietStarts: 0, waits: 0, pauses: 0, shownErrors: 0}, timers = [];
  const ports = {current: () => current, paused() { counts.pauses++; }, shown() { counts.shownErrors++; },
    begun() { counts.starts++; if (fromTimer) counts.quietStarts++; }};
  const adapter = new Function('ports', 'connectionController', 'cloudVoiceServiceLimit', 'setTimeout', 'clearTimeout', code)(ports,
    {getSnapshot: () => ({residentInference: direct ? 'direct' : 'cloud'})}, failure => failure.limit ?? null,
    (run, delay) => { const timer = {run, delay, live: true}; timers.push(timer); counts.waits++; return timer; },
    timer => { if (timer) timer.live = false; });
  let refusals = 0;
  return {
    chooseProvider(value) { direct = value; },
    async open() { adapter.open(); await flush(); },
    listening() { adapter.phase('listening'); },
    speaking() { adapter.phase('speaking'); },
    async failure(transient, long) {
      // A warm-up (503) and a rate limit (429) are the two transient refusals; they alternate here.
      const failure = !transient ? {code: 'voice-http-401'}
        : long ? {code: 'voice-http-429', limit: {kind: 'rate-limited', retryAfterMs: 31000}}
          : refusals++ % 2 ? {code: 'voice-http-429', limit: {kind: 'rate-limited', retryAfterMs: 4000}} : {code: 'voice-http-503'};
      adapter.failed(failure); await flush();
    },
    async waitElapsed() {
      const timer = timers.findLast(item => item.live); timer.live = false;
      fromTimer = true; try { timer.run(); } finally { fromTimer = false; }
      await flush();
    },
    currencyLost() { current = false; }, currencyBack() { current = true; },
    async recover() { adapter.recover(); await flush(); },
    close() { adapter.close(); },
    observe() { return {...adapter.state(), current, direct, ...counts}; },
  };
}

export async function runQuietVoiceRetryReplay({random = 80, steps = 40} = {}) {
  const code = compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(code), {project});
}
