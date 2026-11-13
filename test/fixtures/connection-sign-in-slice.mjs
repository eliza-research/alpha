// The sign-in part of the connection controller, sliced from connection-ui.tsx and run outside the
// renderer: the step slot (work), the readiness probe and its late answer, beginSignIn, Back
// (cancelSignIn, cancel, close), Google, the emailed code and its verification, saving own keys,
// the predicates that decide which sign-in entry is shown, and the body of the automatic entry's
// effect. Cloud, the native sign-in port, the key store and the agent are held ports.
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';

const ui = readFileSync(new URL('../../apps/app/src/runtime/connection-ui.tsx', import.meta.url), 'utf8');
const between = (start, end) => { const from = ui.indexOf(start), to = ui.indexOf(end, from + start.length); assert.ok(from >= 0 && to > from, start); return ui.slice(from, to); };
const plain = text => text.replaceAll(/^export /gm, '');
const code = stripTypeScriptTypes([
  between('let signInReadinessOwner: AbortSignal | null = null;', '/**\n * The verified optional sign-in methods'),
  between('async function inAppSignInMethods(', '/** A failed or cancelled step leaves'),
  between('function signInFailed(environment', '/** A verified interactive sign-in finishes'),
  between('class CodeExpiredError', '\n'),
  between('function ownProviderSelected(', 'function residentEnvironment()'),
  between('async function work(message: string', '/** Only an explicitly failed native start'),
  between('async function ensureResident() {', '/** Retires the running agent and restarts'),
  plain(between('export function productionCloudSignInRequired(', '/** Explicit account/plan')),
  plain(between('export function explicitSignedOutCloudEntry(', 'export function connectionChooserVisible(')),
  `const connectionController={subscribe(){return()=>{};},async refreshProviderStatus(){return null;},
${between('  close() {', '  async initialize() {')}
${between('  async configureLocal(apiKey:string', '  async selectCloudProvider(){')}
${between('  async beginSignIn(environment: CloudEnvironment', '  /**\n   * A retained native Google outcome')}};`,
  // The automatic entry: what the chooser derives on every render, then the body of its effect.
  `const automaticSignInProbe={current:false};let signInPageLatch=false;
   function renderSignInEntry(){const snapshot=state,useState=()=>[signInPageLatch,value=>{signInPageLatch=value;}];
${between('  const productionSignInRequired=productionCloudSignInRequired(snapshot);', '  const automaticSignInProbe = useRef(false);')}
     return {productionSignInRequired,explicitSignInEntry,signInPage,signInEntryRequired};}
   function automaticEntryEffect(){const snapshot=state,{signInEntryRequired}=renderSignInEntry();
${between('    if (!signInEntryRequired) { automaticSignInProbe.current = false; return; }', '  }, [signInEntryRequired, snapshot.busy')}}`,
  `Object.assign(globalThis,{work,automaticEntryEffect,renderSignInEntry,productionCloudSignInRequired,explicitSignedOutCloudEntry,signInEntryPage,
     readinessOwned:()=>!!operation&&signInReadinessOwner===operation.signal,readinessOwner:()=>signInReadinessOwner,
     offered:()=>({google:inAppGoogle,phone:inAppPhone,email:inAppEmail}),automaticLatch:()=>automaticSignInProbe.current});`,
].join('\n'), {mode: 'strip'});

const waiter = new AsyncLocalStorage();
class CloudSignInError extends Error { constructor(code) { super(code); this.code = code; } }

/**
 * A fresh controller. `platform`: 'android' requires sign-in while signed out; 'first-run' is the
 * browser resident preview's first run; 'browser' has no automatic entry. The ten-millisecond waits
 * of a call started inside `asWaiter('save', …)` are held until `tick('save')`; every other one runs
 * on its own.
 */
export function signInController({platform = 'browser', commitBoundary = false} = {}) {
  let held = null, readinessTimer = null, residentStarts = 0, storedKey = 0, adoptedKey = 0, attempts = 0, probes = 0;
  const polls = [];
  const client = {environment: 'production', googleCancellationSupported: commitBoundary,
    cancelGoogleSignIn: async () => port.committed,
    signInWithGoogle: signal => port.hold('google', signal),
    startEmailSignIn: (address, signal) => port.hold(port.resending ? 'resend' : 'send', signal),
    verifyEmailSignIn: (attempt, digits, signal) => port.hold('verify', signal),
    verifyMfaSignIn: (attempt, digits, signal) => port.hold('verify', signal)};
  const port = {committed: false, resending: false, client, CloudSignInError,
    /** One held call: the step that owns the slot waits on it, and a cancelled one unwinds. */
    hold(kind, signal) {
      assert.equal(held, null, 'one step holds the slot');
      return new Promise((resolve, reject) => {
        held = {kind, resolve, reject};
        signal?.addEventListener('abort', () => { if (held?.reject === reject) held = null; reject(signal.reason); }, {once: true});
      });
    },
    get held() { return held?.kind ?? 'none'; },
    /** Lets go of the held call without answering it; the caller may answer it later. */
    detach() { const call = held; held = null; return call; },
    get probes() { return probes; },
    release(value) { const {resolve} = held; held = null; resolve(value); },
    fail(error) { const {reject} = held; held = null; reject(error); },
    get residentStarts() { return residentStarts; },
    get storedKey() { return storedKey; }, set storedKey(value) { storedKey = value; },
    get adoptedKey() { return adoptedKey; }, get attempts() { return attempts; },
    nextAttempt: () => ++attempts,
    /** The readiness wait ends before the host answered: the chooser is shown without it. */
    readinessTimesOut() { const timer = readinessTimer; assert.ok(timer, 'a readiness check is waiting'); readinessTimer = null; timer(); },
    asWaiter: (name, action) => waiter.run(name, action),
    tick(name) { const index = polls.findIndex(poll => poll.name === name); if (index < 0) return false; polls.splice(index, 1)[0].run(); return true; },
    waiting: name => polls.some(poll => poll.name === name),
  };
  const box = {AbortController, AbortSignal, DOMException, Error, Promise, Object, Date, Math, JSON, CloudSignInError, clearTimeout() { readinessTimer = null; },
    setTimeout(run, delay) {
      if (delay === 6000) { readinessTimer = run; return 1; }
      const name = waiter.getStore();
      if (delay === 10 && name === 'save') { polls.push({name, run}); return 2; }
      return setTimeout(run, 0);
    },
    SIGN_IN_READINESS_WAIT_MS: 6000, signInReadiness: value => value,
    operation: null, sending: null, epoch: 1, active: null, planRecheck: null, providerStatusGeneration: 0, googleSignInGeneration: 0, googleSignInPrior: null,
    residentStartInBackground: false, residentStartFailure: 'The agent could not start.', testMocksEnabled: false, residentAlwaysPresent: true,
    isAndroid: platform === 'android', browserCloudResidentEnabled: platform === 'first-run', cloudSignInPhone: null,
    state: {open: false, purpose: 'agent', signIn: null, message: '', error: '', errorKind: null, busy: false, startupResolved: false, automaticRestore: false, cloudAccount: null,
      residentSavedCredential: false, residentStarting: false, residentRecoveryReason: null, residentPlanNotice: null, providerStatus: null},
    update(patch) { Object.assign(box.state, patch); },
    cloud: {environment: 'production', cancelLogin() {}}, makeCloud: () => box.cloud, signInClient: () => client,
    cloudSignIn: {status: () => { probes++; return port.hold('probe'); }},
    cloudCredentialStore: {read: async () => storedKey ? {credentialId: `key-${storedKey}`} : null},
    residentCloudFlow: () => true, residentEnvironment: () => 'production', cloudEnvironmentAllowed: () => true, cloudServiceName: () => 'Cloud',
    crypto: {randomUUID: () => 'selection'}, signInFailureMessage: value => value, validSignInEmail: () => true, normalizeSignInCode: value => value,
    // The message names what failed: the driver's own tag, the expired code, or a plain failure.
    errorMessage: error => error?.tag ?? (error?.constructor?.name === 'CodeExpiredError' ? 'spent' : error?.name === 'AbortError' ? 'cancelled' : 'failed'),
    errorKindOf: () => null, residentRecoveryReason: () => null, expired: () => false, retire() { box.epoch++; }, detachService() {},
    runQueuedResidentRebind() {}, runQueuedSignInReturn() {}, scheduleResidentAutoRetry() {}, clearPersonalSetup() {}, showPostSignInSetup() {}, connectionToast() {},
    async startResident() { residentStarts++; },
    queueResidentRebind() { residentStarts++; },
    // A finished sign-in adopts the stored key and leaves the sign-in screen.
    async signedIn() { adoptedKey = storedKey; box.update({signIn: null, open: false}); },
    OWN_KEY_BUSY: 'busy', OWN_KEY_CHECKING: 'Checking key…', OWN_KEYS_NOT_SET_UP: 'not-set-up', LOCAL_PROVIDER_MODEL: 'model',
    configureLocalProvider: (key, model, voice, signal) => port.hold('own-keys', signal),
    localProviderStatus: async () => ({selected: true, provider: 'cerebras', revision: 'saved', keys: {}}),
    async restartAfterProviderChange() {},
  };
  vm.createContext(box);
  vm.runInContext(code, box);
  // The controller is a lexical binding of the sliced script, not a property of its global.
  return {box, port, controller: vm.runInContext('connectionController', box)};
}
