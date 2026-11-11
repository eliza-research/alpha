/** Replays MapsShareChoice model traces against the chat adapter's share-choice buttons.
 *
 * What runs: installMapsChatAdapter from apps/app/src/prototype/maps-adapter.ts, taken by its text
 * anchor, over the real mapsChatText parser. The shell (messages, composer flags, send, toast),
 * the connection controller and `document` are controlled ports.
 *
 * Observation: the ports' flags; the buttons the last render drew, with the context of that
 * render; whether a fresh render would draw buttons now (this stands for the adapter's private
 * answered set, which the model's `open` reads); sends the shell received, each with the context
 * it arrived in and the buttons that caused it; sends still pending; deliveries; the last tap's
 * effect and the last notice. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../services/maps-model-traces.mjs';

const model = {path: 'specs/quint/application/MapsShareChoice.qnt', module: 'MapsShareChoice'};
const adapterPath = 'apps/app/src/prototype/maps-adapter.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const none = {message: 0, session: 0, conversation: 0, revision: 0};
const NOTICES = new Map([['Chat draft open', 'draft'], ['Editing message', 'editing'], ['The chat refused the answer.', 'failed'], ['Not sent', 'failed']]);

async function load() {
  const parser = await build({absWorkingDir: repositoryRoot, entryPoints: ['apps/app/src/runtime/action-message-presentation.ts'], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent'});
  const {mapsChatText} = await import('data:text/javascript;base64,' + Buffer.from(parser.outputFiles[0].text).toString('base64'));
  const source = readFileSync(join(repositoryRoot, adapterPath), 'utf8'), start = source.indexOf('export function installMapsChatAdapter(');
  assert.ok(start > 0 && source.indexOf('export function', start + 1) < 0, 'the chat adapter is the last export of the Maps adapter');
  const script = new vm.Script(stripTypeScriptTypes('type Bag=Record<string,any>;\n' + source.slice(start).replace('export function', 'function') + '\nglobalThis.install=installMapsChatAdapter;', {mode: 'transform'}));
  return {mapsChatText, script};
}

function driver({mapsChatText, script}) {
  const port = {hidden: false, sheetOpen: false, busy: false, session: 1, conversation: 1};
  const accounts = [null, {ownerId: 'first'}, {ownerId: 'second'}];
  const context = vm.createContext({mapsChatText, document: {get hidden() { return port.hidden; }},
    connectionController: {getSnapshot: () => ({open: port.sheetOpen, busy: port.busy, session: accounts[port.session]}), getSelectedConversationId: () => 'conversation-' + port.conversation}});
  script.runInContext(context);
  const sends = [], pending = new Map(), delivered = {1: 0, 2: 0, 3: 0, 4: 0};
  let revision = 0, question = false, offer = none, choose = null, lastTap = 'none', notice = 'none';
  const text = (id, asks) => asks
    ? `Share the location? (${id}.${revision})\n[CHOICE:maps-share id=maps-share-m${id}]\nYes ${id}=Share location\nNo ${id}=Don't share\n[/CHOICE]`
    : `A reply without a question (${id}.${revision})`;
  class Shell {
    live = true;
    st = {msgs: [], draft: '', typing: false, recording: false};
    messageEditTarget = null;
    S() { return this.st; }
    renderVals() { return {msgs: this.st.msgs.map(message => ({...message, isAgent: message.from === 'agent', isUser: message.from === 'user', displayText: message.text, hasCalendarText: true, messageActionsLabel: 'Message actions: ' + message.text}))}; }
    setState(patch) { Object.assign(this.st, patch); }
    toast(message) { assert.ok(NOTICES.has(message), message); notice = NOTICES.get(message); }
    send(value) {
      const message = Number(/^Yes (\d)$/.exec(value)?.[1]);
      assert.ok(message, `the answer sent is the button's exact value: ${value}`);
      assert.ok(!pending.has(message), 'one send per question at a time');
      sends.push({message: shell.st.msgs.length, session: port.session, conversation: port.conversation, revision, offer,
        quiet: shell.live && !port.hidden && !port.sheetOpen && !port.busy && !shell.st.typing && !shell.st.recording && !shell.st.draft && !shell.messageEditTarget});
      assert.equal(message, offer.message, 'the answer names the question its button was drawn for');
      return new Promise((resolve, reject) => pending.set(message, {resolve, reject}));
    }
  }
  context.install(Shell);
  const shell = new Shell();
  const newest = () => shell.st.msgs.at(-1);
  const add = (from, asks) => { revision = 0; question = asks; const id = shell.st.msgs.length + 1; shell.st.msgs.push({id: 'm' + id, from, text: from === 'agent' ? text(id, asks) : 'A user message'}); };
  const drawn = () => { const view = shell.renderVals().msgs.at(-1); return view?.hasMapsChoice ? view : null; };
  return {
    agentReply(asks) { add('agent', asks); },
    userMessage() { add('user', false); },
    replaceText(asks) { revision++; question = asks; const id = shell.st.msgs.length; shell.st.msgs[id - 1] = {...newest(), text: text(id, asks)}; },
    render() {
      const view = drawn();
      choose = view ? view.mapsChoices[0].choose : null;
      if (view) assert.deepEqual(view.mapsChoices.map(item => item.label), ['Share location', "Don't share"]);
      offer = view ? {message: shell.st.msgs.length, session: port.session, conversation: port.conversation, revision} : none;
    },
    async tap() {
      assert.ok(choose, 'a tap needs drawn buttons');
      const before = sends.length, said = notice;
      notice = null; choose(); await tick();
      lastTap = sends.length > before ? 'sent' : notice ?? 'ignored';
      notice ??= said;
    },
    async sendSettles(message, ok) {
      const send = pending.get(message);
      assert.ok(send, `the shell has no pending send for question ${message}`);
      pending.delete(message);
      if (ok) { delivered[message]++; send.resolve(); } else send.reject(Error('The chat refused the answer.'));
      await tick();
    },
    setHidden(flag) { port.hidden = flag; },
    setSheetOpen(flag) { port.sheetOpen = flag; },
    setBusy(flag) { port.busy = flag; },
    setTyping(flag) { shell.st.typing = flag; },
    setRecording(flag) { shell.st.recording = flag; },
    setDraft(flag) { shell.st.draft = flag ? 'Words the user typed' : ''; },
    setEditing(flag) { shell.messageEditTarget = flag ? {messageId: 'm1'} : null; },
    changeSession(target) { port.session = target; },
    changeConversation(target) { port.conversation = target; },
    unmount() { shell.live = false; },
    observe() {
      return {
        live: shell.live, hidden: port.hidden, sheetOpen: port.sheetOpen, busy: port.busy, typing: shell.st.typing,
        recording: shell.st.recording, draft: !!shell.st.draft, editing: !!shell.messageEditTarget,
        session: port.session, conversation: port.conversation,
        newest: shell.st.msgs.length, fromAgent: newest()?.from === 'agent', question, revision,
        offer, open: !!drawn(), inflight: [...pending.keys()].sort(), sends: [...new Set(sends.map(send => JSON.stringify(send)))].sort(),
        delivered: {...delivered}, lastTap, notice,
      };
    },
  };
}

const offerOf = value => ({message: value.message, session: value.session, conversation: value.conversation, revision: value.revision});
const project = state => {
  const {answered, ...rest} = state;
  return {...rest, offer: offerOf(state.offer),
    open: state.newest !== 0 && state.fromAgent && state.question && !answered.includes(state.newest) && state.session !== 0,
    sends: state.sends.map(send => JSON.stringify({message: send.message, session: send.session, conversation: send.conversation, revision: send.revision, offer: offerOf(send.offer), quiet: send.quiet})).sort()};
};

export async function replayMapsShareChoice({scenarios, witnesses, random = 60, steps = 40}) {
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  const loaded = await load();
  return replayTraces(traces, () => driver(loaded), {project});
}
