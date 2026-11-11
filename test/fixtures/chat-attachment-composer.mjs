import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {stripTypeScriptTypes} from '../support/strip-types.mjs';
import {copyVoiceScrollHooks,shellVoiceScrollSource} from '../support/shell-voice-scroll.mjs';

const adapter = new URL('../../apps/app/src/prototype/agent-adapter.ts', import.meta.url);
export const chatAttachmentComposerSources = [import.meta.url, adapter,
  new URL('../support/strip-types.mjs', import.meta.url),new URL('../support/shell-voice-scroll.mjs', import.meta.url),shellVoiceScrollSource].map(fileURLToPath);
const tick = () => new Promise(resolve => setImmediate(resolve));
const prompt = 'Summarize this for me';
const title = 'Synthetic Notes transcript';

function between(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Actual composer source anchor ${start}`);
  return source.slice(from, to);
}

export function chatAttachmentComposerFixture() {
  const source = readFileSync(adapter, 'utf8');
  const code = stripTypeScriptTypes([
    between(source, 'class NotDispatched extends Error', '\n'),
    between(source, 'function createdFromSlot(', 'function selectedCloudName('),
    'const p = {};', between(source, '  p.send = async function', '  p.agentSay = function'),
    'function installSubscription(){' + between(source, '    this.connectionUnsubscribe = connectionController.subscribe', '    // Canonical is the default;') + '}',
    'function attachTranscript(){const api={};' + between(source, '    api.composeTranscriptQuestion=', '    api.composeContentQuestion=') +
      'api.composeTranscriptQuestion("synthetic-note", "Synthetic Notes transcript");}',
    'function renderAttachments(){const out={};' + between(source, '    const photo=this.cameraAttachment;', '    out.messageComposeContext=') + 'return out;}',
    'globalThis.actual={send:p.send,installSubscription,attachTranscript,renderAttachments};',
  ].join('\n'), {mode: 'strip'});

  const stored = new Map(), recorded = new Map(), toasts = [], connections = [];
  let owner = 1, conversation = 1, generation = 0, request = 0, listener;
  const scope = () => owner * 10 + conversation;
  const sessionFor = value => ({sessionId: `session-${value}`, origin: 'https://alpha.invalid',
    ownerId: `owner-${value}`, agentId: 'agent'});
  const historyFor = (session, room, messages = []) => ({sessionId: session.sessionId,
    conversationId: `conversation-${room}`, automatic: false, messages});
  let session = sessionFor(owner), history = historyFor(session, conversation);
  const key = () => JSON.stringify([session.origin, session.ownerId, session.agentId, history.conversationId]);
  const snapshot = () => ({session, history, busy: false, open: false, startupResolved: true});
  let held, lastHeld = {owner: 0, conversation: 0, generation: 0}, task;
  let holdStorage = false, storageGate, attemptedWrites = 0, sendCalls = 0, acceptNext = false;
  const forbidden = () => assert.fail('Unexpected operation in the closed composer campaign');
  const shell = {
    live: true, connectionSession: session.sessionId, restoredHistory: history,
    notesSelection: {id: 'synthetic-note', revision: 'fixture-v1'},
    state: {view: 'notes', screen: 'home', draft: '', msgs: [], typing: false, chat: 'sheet', shade: false},
    S() {return this.state;},
    vget() {return {};},
    setState(update, callback) {
      const patch = typeof update === 'function' ? update(this.state) : update;
      if (patch) this.state = {...this.state, ...patch};
      callback?.();
    },
    toast(value) {toasts.push(value);},
    draftBindingTask: Promise.resolve(),
    composerDraft: {
      binding: key(),
      get holding() {return !!held && held.key === this.binding;},
      async hold(text, current) {
        assert.equal(current(), true);
        assert.equal(this.binding, key());
        held = {key: this.binding, text};
        lastHeld = {owner, conversation, generation};
      },
      release() {
        const saved = held;
        held = undefined;
        if (saved?.key === this.binding) shell.setState({draft: saved.text});
      },
      retire() {this.binding = undefined;},
      async commit() {assert.ok(held); held = undefined;},
    },
    connectAgent() {return new Promise((resolve, reject) => connections.push({resolve, reject}));},
  };
  copyVoiceScrollHooks(shell);
  shell.refreshDraftBinding = () => {shell.composerDraft.binding = key();};
  const ports = {
    Error, queueMicrotask, document: {hidden: false, querySelector: () => null},
    crypto: {randomUUID: () => `request-${++request}`},
    browserDocuments: {
      async edit(name, update) {
        attemptedWrites++;
        const next = await update(stored.get(name) ?? null);
        if (holdStorage) {
          holdStorage = false;
          await new Promise((resolve, reject) => {storageGate = {resolve, reject};});
        }
        stored.set(name, {raw: next.raw});
        return next.result;
      },
      async read(name) {return stored.get(name) ?? null;},
    },
    connectionController: {getSnapshot: snapshot, subscribe(callback) {listener = callback; return () => {};},
      captureViewNavigation: () => ({}), getSelectedConversationId: () => history.conversationId},
    alphaClient: {
      getState: () => ({context: {revision: 1, view: 'notes'}}), disconnect() {},
      async send(text, _stream, _reply, _navigate, {requestId}) {
        assert.equal(acceptNext, true, 'Only the explicit closed success schedule reaches the recording port');
        acceptNext = false;
        sendCalls++;
        const id = `recorded-${scope()}`;
        recorded.set(scope(), {id, clientMessageId: requestId, from: 'user', text});
        return {ignored: true, userMessageId: id, messageBinding: {session, conversationId: history.conversationId}};
      },
    },
    context() {}, sourceOf: () => undefined, cancelMessageContext() {}, clearMapsSelection() {},
    syncStoppedReplyNotice() {}, syncCanonicalNotes() {}, collapseSystemNotices: rows => rows,
    mergeConversationDelivery: rows => rows, settleFirstSendSlot: forbidden,
    NO_AGENT_SEND: 'No agent', RESIDENT_STARTING_NOTICE: 'Starting', RESIDENT_RECOVERING_NOTICE: 'Recovering',
    privateLocalPreviewEnabled: false, AlphaClientError: class AlphaClientError extends Error {},
    localTurnStatus: new EventTarget(), planActionCard: () => undefined,
  };
  runInNewContext(code, ports, {filename: fileURLToPath(adapter)});
  const {actual} = ports;
  actual.installSubscription.call(shell);

  function switchBinding(change) {
    if (change === 'owner') {owner = owner === 1 ? 2 : 1; session = sessionFor(owner);}
    else conversation = conversation === 1 ? 2 : 1;
    history = historyFor(session, conversation);
    generation++;
    shell.notesSelection = {id: 'synthetic-note', revision: `fixture-v${generation + 1}`};
    listener();
  }

  return {
    attach() {
      actual.attachTranscript.call(shell);
      assert.equal(shell.state.draft, prompt);
    },
    remove() {actual.renderAttachments.call(shell).removeTranscript();},
    async start() {task = actual.send.call(shell); task.catch(() => {}); await tick();},
    async refuse() {
      assert.equal(connections.length, 1, 'One closed connection attempt was admitted');
      connections.shift().reject(Error('Synthetic pre-dispatch refusal'));
      await task;
    },
    async accept() {
      assert.equal(connections.length, 1, 'One closed connection attempt was admitted');
      acceptNext = true;
      connections.shift().resolve();
      await task;
      assert.equal(acceptNext, false, 'The actual send reached the closed recording port');
    },
    switchOwner() {switchBinding('owner');},
    switchConversation() {switchBinding('conversation');},
    holdStorage() {holdStorage = true;},
    async completeStorage(accepted = true) {
      const pending = storageGate;
      assert.ok(pending, 'The actual write reached the held port');
      storageGate = undefined;
      if (accepted) pending.resolve();
      else pending.reject(Error('Synthetic local storage refusal'));
      await tick();
    },
    async finish() {await task; await tick();},
    async reload() {
      const row = recorded.get(scope());
      history = historyFor(session, conversation, row ? [row] : []);
      generation++;
      listener();
      await tick();
    },
    inspect() {return {draftText: shell.state.draft, connectCalls: connections.length, attemptedWrites, sendCalls,
      draftSelection: shell.transcriptAttachment?.selection, toasts: [...toasts],
      records: [...stored.values()].map(record => JSON.parse(record.raw))};},
    observe() {
      const attached = actual.renderAttachments.call(shell).attachedTranscript;
      assert.ok(!attached || attached === title);
      const saved = [...stored.keys()].map(name => {
        const [namespace, origin, subject, agent, room] = JSON.parse(name);
        assert.equal(namespace, 'chat-attachment-v1');
        assert.equal(origin, 'https://alpha.invalid');
        assert.equal(agent, 'agent');
        return Number(subject.slice('owner-'.length)) * 10 + Number(room.slice('conversation-'.length));
      });
      return {owner, conversation, generation, draft: !!attached, pending: shell.state.typing,
        preparing: !!storageGate, sent: shell.state.msgs.some(row => row.from === 'user' && !history.messages.some(known => known.id === row.id)),
        heldOwner: lastHeld.owner, heldConversation: lastHeld.conversation, heldGeneration: lastHeld.generation,
        saved, recorded: [...recorded.keys()], visible: shell.state.msgs.some(row => row.transcriptAttachment?.title === title), view: shell.state.view};
    },
  };
}
