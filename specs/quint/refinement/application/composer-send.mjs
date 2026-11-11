/** Replays ComposerSend model traces against the chat shell's send.
 *
 * Product code, evaluated from source: `p.send`, `p.agentSay`, the dispatch helpers
 * (`dispatched`, `trackDispatch`, `transportSettled`, `releaseComposerSend`) and the connection
 * subscription that clears the chat on a session change (apps/app/src/prototype/agent-adapter.ts);
 * the real AlphaClient (apps/app/src/runtime/alpha-client.ts); and the shared durable draft
 * controller the composer is bound to.
 *
 * Controlled ports: the connection (session, connect step), the transport under AlphaClient, the
 * draft store, the settle timer and the voice stop that a typed message waits for.
 *
 * `changes` (a bound on typing) is not observed. `posted` and `transport` are the environment's own
 * state and are reported by the driver. */
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {tsImport} from 'tsx/esm/api';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {systemNoticeKind, systemNoticeDisplayText, collapseSystemNotices} from '../../../../apps/app/src/runtime/action-message-presentation.ts';
import {modelTraces, replayTraces, repositoryRoot} from '../assistant-model-traces.mjs';

export const model = {path: 'specs/quint/application/ComposerSend.qnt', module: 'ComposerSend'};
export const scenarios = ['argumentSendReachesTransportTest', 'refusedArgumentKeepsComposerTest', 'staleFinallyKeepsTypingTest',
  'refusedSendRestoresTextTest', 'cancelWaitsForTransportTest', 'unsettledCancelStaysSentTest', 'heldComposerSendBlocksNextSendTest', 'refusedAfterSessionChangeLeavesComposerTest', 'staleComposerSendKeepsDraftTest'];
export const witnesses = ['OverlappingSendWitness', 'RestoredWitness', 'UnconfirmedAfterTimeoutWitness', 'ArgumentSendWitness'];

const flush = async () => { for (let turn = 0; turn < 6; turn++) await new Promise(resolve => setImmediate(resolve)); };
const gate = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => {}); return {promise, resolve, reject}; };
const ROOM = 'a954925f-5698-4639-b1ea-6d1bb760a142';

export async function compile() {
  const adapter = readFileSync(`${repositoryRoot}/apps/app/src/prototype/agent-adapter.ts`, 'utf8');
  const between = (start, end) => { const a = adapter.indexOf(start), b = adapter.indexOf(end, a); if (a < 0 || b <= a) throw Error(`missing source anchor ${start}`); return adapter.slice(a, b); };
  const ts = source => stripTypeScriptTypes(source, {mode: 'strip'});
  const helpers = between('function createdFromSlot(', 'function selectedCloudName(');
  const plan = between('function planActionCard(', '/** Context notices'), notices = between('function replyNotices(', '/** Decline one pending proposal');
  const send = between('  p.send = async function', '  p.agentSay = function'), say = between('  p.agentSay = function', '  p.reply = function');
  const subscription = between('this.connectionUnsubscribe = connectionController.subscribe(() => {', '    // Canonical is the default;');
  const code = ts(`${helpers}\n${plan}\n${notices}\nfunction methods(){const p={};\n${send}\n${say}\nreturn p;}\nglobalThis.methods=methods();`);
  const controller = stripTypeScriptTypes(readFileSync(`${repositoryRoot}/.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts`, 'utf8'), {mode: 'strip'});
  const {DurableDraftController} = await import('data:text/javascript;base64,' + Buffer.from(controller).toString('base64'));
  const {AlphaClient, AlphaClientError} = await tsImport('../../../../apps/app/src/runtime/alpha-client.ts', import.meta.url);
  return {code, subscription: stripTypeScriptTypes(subscription, {mode: 'transform'}), DurableDraftController, AlphaClient, AlphaClientError};
}

export async function createDriver({code, subscription, DurableDraftController, AlphaClient, AlphaClientError}) {
  let sessionNumber = 0, changed = () => {};
  const session = () => ({sessionId: `session-${sessionNumber}`, agentId: 'agent-a', ownerId: 'owner-a', origin: 'https://agent.invalid'});
  let snapshot = {session: session(), history: null, busy: false, open: false, startupResolved: true};
  const timers = [], stores = new Map(), attempts = new Map(), decisions = new Map();
  const alphaClient = new AlphaClient();
  class NotDispatched extends Error {}
  const shell = {
    live: true, sendAttempt: null, toasts: [], startupDraft: null, connectionSession: snapshot.session.sessionId,
    state: {msgs: [], draft: '', typing: false, chat: 'sheet', shade: false, view: 'calendar'},
    S() { return this.state; }, toast(text) { this.toasts.push(text); }, cancelVoiceScrollFollow() {},
    setState(update, callback) { const patch = typeof update === 'function' ? update(this.state) : update; if (patch) this.state = {...this.state, ...patch}; callback?.(); },
    connectAgent() { const entry = attempts.get(attempts.size); return entry.connect.promise; },
    draftBindingTask: Promise.resolve(),
  };
  const draftStore = async key => ({
    async read() { return stores.get(key) ?? null; },
    async save(_expected, text, _recovery, marks) { const next = {version: 1, binding: key, revision: randomUUID(), text, ...(marks?.sending ? {sending: true} : {})}; stores.set(key, next); return next; },
  });
  shell.composerDraft = new DurableDraftController(draftStore, () => String(shell.S().draft || ''), (text, expected, current) => new Promise(resolve => {
    if (!shell.live || current && !current()) { resolve(); return; }
    shell.setState(previous => current && !current() || expected !== undefined && String(previous.draft || '') !== expected ? null : {draft: text}, resolve);
  }), () => {}, {notSent: ''});
  shell.refreshDraftBinding = () => { shell.draftBindingAbort = new AbortController(); shell.draftBindingTask = shell.composerDraft.open(`draft-${sessionNumber}`); };
  const holds = [], hold = shell.composerDraft.hold.bind(shell.composerDraft);
  shell.composerDraft.hold = (text, current) => { holds.push(text); return hold(text, current); };
  const connectionController = {
    getSnapshot: () => snapshot, subscribe(callback) { changed = callback; return () => {}; },
    getSelectedConversationId: () => ROOM, getCloudEnvironment: () => undefined, getCloudClient: () => undefined,
    captureViewNavigation: () => ({}), continueRequestedCamera: async () => [],
  };
  const box = {
    systemNoticeKind, systemNoticeDisplayText, collapseSystemNotices,
    console, DOMException, AbortController, crypto: {randomUUID}, queueMicrotask,
    setTimeout(run, delay) { const timer = {run, delay, done: false, attempt: attempts.size}; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.done = true; },
    document: {hidden: false, querySelector: () => null, querySelectorAll: () => []},
    alphaClient, connectionController, context() {}, selectedCloudName: () => 'Eliza Cloud', localTurnStatus: new EventTarget(),
    sourceOf: () => undefined, NotDispatched, AlphaClientError, cloudServiceName: () => 'Eliza Cloud',
    privateLocalPreviewEnabled: false, residentAlwaysPresent: false, pageLeaving: false,
    NO_AGENT_SEND: 'No agent', RESIDENT_STARTING_NOTICE: 'Starting', RESIDENT_RECOVERING_NOTICE: 'Recovering', CAMERA_CONTEXT_NOTICE: 'camera',
    deliverChatNavigation: async () => false, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    retainReadReply() {}, completeReadReply: async () => {}, proposalCard: () => undefined, publishCommittedDeviceChanges() {},
    cameraScanRequested: () => false, cameraFrameQuestionRequested: () => false,
  };
  vm.runInNewContext(code, box);
  // The shell's own decision, recorded as it is made.
  const decide = box.dispatched;
  box.dispatched = (attempt, error) => { const result = decide(attempt, error); decisions.set(attempt, result); return result; };
  Object.assign(shell, box.methods);
  const attach = () => alphaClient.attachVerifiedTransport({
    session: snapshot.session,
    // The adapter's transport binding: every send is tracked for the attempt that owns it.
    send: input => box.trackDispatch(shell, () => { const entry = attempts.get(attempts.size); entry.input = input; entry.transport = 'running'; return entry.wire.promise; }),
    async execute() { throw Error('no action is executed in this replay'); },
  });
  alphaClient.setViewContext({view: 'calendar'});
  attach();
  const ports = {connectionController, alphaClient, cancelMessageContext() {}, clearMapsSelection() {}, syncStoppedReplyNotice() {}, syncCanonicalNotes() {},
    context() {}, restoreAttachments: async messages => messages, collapseSystemNotices, mergeConversationDelivery: messages => messages};
  new Function(...Object.keys(ports), subscription).call(shell, ...Object.values(ports));
  shell.refreshDraftBinding();
  await flush();

  const text = value => value.includes('\n') ? 'both' : value;
  const entryOf = id => attempts.get(id);
  return {
    async typeText(value) { shell.setState({draft: value}); shell.composerDraft.edit(value); await flush(); },
    async send(argument, current) {
      const before = shell.state.msgs.length, held = holds.length;
      if (!current) {
        // The message waits for the voice surface to stop, and the screen changes meanwhile.
        const stop = gate(), view = shell.state.view;
        shell.stopVoiceConversation = () => stop.promise;
        const task = argument ? shell.send('P') : shell.send();
        await flush(); shell.setState({view: 'maps'}); stop.resolve(); await task; await flush();
        shell.setState({view}); delete shell.stopVoiceConversation;
        return;
      }
      const id = attempts.size + 1, entry = {connect: gate(), wire: gate(), transport: 'idle', posted: false, argument, settled: false, session: sessionNumber};
      attempts.set(id, entry);
      entry.task = (argument ? shell.send('P') : shell.send()).finally(() => { entry.settled = true; });
      entry.task.catch(() => {});
      await flush();
      entry.attempt = shell.sendAttempt; entry.bubble = shell.state.msgs[before]; entry.held = holds[held] ?? '';
    },
    async refusedBeforeTransport(id) { entryOf(id).connect.reject(Error('The agent connection is unavailable. Nothing was sent.')); await flush(); },
    async transportCall(id) { entryOf(id).connect.resolve(); await flush(); },
    serverReceives(id) { entryOf(id).posted = true; },
    async transportRefuses(id) { const entry = entryOf(id); entry.transport = 'settled'; entry.wire.reject(Object.assign(Error('refused before the message left'), {notDispatched: true})); await flush(); },
    async transportFails(id) { const entry = entryOf(id); entry.transport = 'settled'; entry.wire.reject(Error('the connection dropped')); await flush(); },
    async streamChunk(id) { entryOf(id).input.onText('Working on it'); await flush(); },
    async reply(id) { const entry = entryOf(id); entry.transport = 'settled'; entry.replied = true; entry.wire.resolve({text: 'Done.'}); await flush(); },
    async cancel() { alphaClient.cancel(); await flush(); },
    async settleTimeout(id) {
      for (const timer of timers.filter(item => item.delay === 5000 && !item.done && item.attempt >= id)) { timer.done = true; timer.run(); }
      await flush();
    },
    async sessionSwitch() {
      sessionNumber++; snapshot = {...snapshot, session: session()};
      changed(); attach(); await flush();
    },
    observe() {
      const view = id => {
        const entry = entryOf(id);
        if (!entry) return {phase: 'none', text: '', held: '', argument: false, session: 0, transportCalled: false, preDispatch: false, streamed: false,
          transport: 'idle', posted: false, outcome: 'none'};
        const phase = entry.settled ? 'done' : entry.transport === 'idle' ? 'connecting' : entry.input.signal.aborted || decisions.has(entry.attempt) || entry.transport === 'settled' ? 'settling' : 'transport';
        return {phase, text: entry.bubble?.text ?? '', held: entry.held, argument: entry.argument, session: entry.session, transportCalled: entry.attempt?.transportCalled === true,
          preDispatch: entry.attempt?.preDispatch === true, streamed: entry.attempt?.streamed === true, transport: entry.transport, posted: entry.posted,
          outcome: !entry.settled ? 'none' : entry.replied && !decisions.has(entry.attempt) ? 'replied' : decisions.get(entry.attempt) ? 'unconfirmed' : 'restored'};
      };
      const owner = [...attempts].find(([, entry]) => entry.attempt && entry.attempt === shell.sendAttempt)?.[0] ?? 0;
      return {draft: text(String(shell.state.draft || '')), typing: shell.state.typing, owner, next: attempts.size + 1, session: sessionNumber,
        attempts: {1: view(1), 2: view(2)},
        bubbles: [...attempts].filter(([, entry]) => entry.bubble && shell.state.msgs.some(message => message.id === entry.bubble.id)).map(([id]) => id).sort()};
    },
    async close() { shell.live = false; for (const entry of attempts.values()) { entry.connect.reject(Error('closed')); entry.wire.reject(Error('closed')); } await flush(); },
  };
}

export function project(state) {
  const {changes, ...observed} = state;
  return observed;
}

export async function runComposerSendReplay({random = 60, steps = 30} = {}) {
  const compiled = await compile(), traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, () => createDriver(compiled), {project});
}
