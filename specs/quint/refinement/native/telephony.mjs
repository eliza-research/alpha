// Phone, Messages, Contacts, voicemail and Home-card models against the renderer code they describe.
// The real TypeScript modules run with controlled inputs; after each model transition the state the
// code reports is compared with the model's. Only the observed fields are claimed.
import {build} from 'esbuild';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';

const here = fileURLToPath(import.meta.url);
const model = name => `specs/quint/native/${name}.qnt`;
async function capture(entries, modelName, extraSources) {
  const root = resolve('.');
  const options = {absWorkingDir: root, stdin: {contents: entries.map(([name, path]) => `export * as ${name} from './${path}';`).join('\n'), resolveDir: root, sourcefile: 'quint-telephony.ts'},
    bundle: true, write: false, platform: 'node', format: 'esm', metafile: true};
  const discovered = await build(options);
  const sources = [...Object.keys(discovered.metafile.inputs).filter(path => existsSync(resolve(path))), model(modelName), 'upstream.lock.json', here, ...extraSources];
  const driverHashes = captureInputs(sources);
  const compiled = await build(options);
  const implementation = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  return {implementation, sources, driverHashes};
}
/** Builds one trace: `step(actions, observation)` records a checkpoint after the named model transitions. */
function trace(name, initial) {
  const steps = [];
  return {step(action, expect) { steps.push({action, expect}); return this; }, done: () => ({name, expect: initial, steps})};
}
const act = (name, ...args) => ({name, args});
const refused = (name, ...args) => ({name, args, reject: true});
const must = (condition, message) => { if (!condition) throw Error('Source disagrees with the model: ' + message); };

// ---- MessageThreads ↔ apps/app/src/runtime/message-draft.ts ---------------------------------------

export async function checkTelephonyMessageThreads(extraSources = []) {
  const {implementation: {D}, sources, driverHashes} = await capture([['D', 'apps/app/src/runtime/message-draft.ts']], 'MessageThreads', extraSources);
  const number = id => id === null ? -1 : Number(id.slice(1));
  const seen = state => ({'s.draft': state.draft, 's.suggest': state.suggest, 's.draftBase': state.draft === 'agent' ? number(state.base) : -1, 's.declined': number(state.declined)});
  /** One thread driven through the draft module; `latest` is the newest inbound message while unanswered. */
  function thread(name) {
    let state = D.emptyDraft(), inbound = 0, answered = 0;
    const latest = () => inbound > answered ? `m${inbound}` : null;
    const t = trace(name, seen(state)), on = (action, change) => { if (change) state = change(state); t.step(action, seen(state)); return api; };
    const api = {
      ready: () => on(act('becomeReady')),
      open: () => on(act('openThread')),
      receive: () => { inbound++; return on(act('receive'), s => D.threadChanged(s, latest())); },
      request: () => { must(D.canSuggest(state, latest(), true), 'a suggestion is due'); return on(act('requestSuggestion'), s => D.suggestionRequested(s, latest(), true)); },
      noRequest: () => { must(!D.canSuggest(state, latest(), true), 'no suggestion is due'); must(D.suggestionRequested(state, latest(), true) === state, 'a refused request changes nothing'); return on(refused('requestSuggestion')); },
      reply: (ticket, ok) => on(act('suggestionReply', ticket, ok), s => D.suggestionReplied(s, `m${ticket}`, latest(), true, ok ? 'Yes, see you at 7' : null)),
      type: () => on(act('typeText'), s => D.typed(s, 'On my way')),
      dismiss: () => on(act('dismissSuggestion'), s => D.suggestionDismissed(s)),
      asked: () => on(act('placeAskedDraft'), s => D.askedDraftPlaced(s, 'Ten minutes away', true)),
      noAsked: () => { must(D.askedDraftPlaced(state, 'Ten minutes away', true) === state, 'a refused asked draft changes nothing'); return on(refused('placeAskedDraft')); },
      tap: () => on(act('tapSend')),
      confirm: result => { if (result === 'sent') answered = inbound; return on(act('confirmReview', result), s => D.reviewFinished(s, result)); },
      lose: () => on(act('loseReady'), s => D.readinessLost(s)),
      done: () => t.done(),
    };
    return api;
  }
  const traces = [
    thread('a suggestion is sent after the owner tap').ready().receive().request().reply(1, true).tap().confirm('sent').done(),
    thread('a newer message retires an untouched suggestion').ready().receive().request().reply(1, true).receive().done(),
    thread('a reply that arrives after a newer message is dropped').ready().receive().request().receive().reply(1, true).done(),
    thread('typing wins over a running suggestion').ready().receive().request().open().type().reply(1, true).done(),
    thread('a dismissed suggestion is not offered again until a newer message').ready().receive().request().reply(1, true).dismiss().noRequest().receive().request().reply(2, true).done(),
    thread('a failed suggestion is not retried for the same message').ready().receive().request().reply(1, false).noRequest().receive().request().done(),
    thread('a failed send keeps the owner draft').ready().open().type().tap().confirm('failed').done(),
    thread('an unknown send keeps the owner draft').ready().open().type().tap().confirm('unknown').done(),
    thread('losing readiness stops a running suggestion').ready().receive().request().lose().done(),
    thread('an edited suggestion becomes the owner draft and is not suggested again').ready().receive().request().reply(1, true).open().type().done(),
    thread('an asked draft is sent only after the owner tap and survives a newer message').ready().open().asked().receive().tap().confirm('sent').done(),
    thread('an asked draft never replaces the owner text').ready().open().type().noAsked().done(),
    thread('an asked draft replaces a suggestion, which is then not offered again').ready().receive().request().reply(1, true).open().asked().dismiss().noRequest().done(),
    thread('typing over an asked draft makes it the owner draft').ready().open().asked().type().done(),
    thread('a dismissal is remembered past a send').ready().receive().request().reply(1, true).dismiss().open().type().tap().confirm('sent').done(),
  ];
  return checkTraces({model: 'MessageThreads', modelPath: model('MessageThreads'), sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual message-draft.ts transitions run with controlled thread events. Draft owner, suggestion state, the answered message and the dismissed message are observed.',
    'Inbound and answered counts, the open thread, read state, the native review and the send counters are driver inputs here; the SMS adapter and the native reviewed send own them.',
    'The reply text is one fixed string; the model abstracts text to two identities.',
  ]});
}

// ---- Voicemail ↔ apps/app/src/runtime/voicemail-state.ts ------------------------------------------

export async function checkTelephonyVoicemail(extraSources = []) {
  const {implementation: {V}, sources, driverHashes} = await capture([['V', 'apps/app/src/runtime/voicemail-state.ts']], 'Voicemail', extraSources);
  const engine = {device: 'local', cloud: 'cloud', carrier: 'carrier'};
  const seen = state => ({'s.item': state.id === null ? 'absent' : 'present', 's.audio': state.audio, 's.transcript': state.transcript, 's.playback': state.playback,
    's.heard': state.heard, 's.confirmDelete': state.confirmDelete, 's.engine': state.engine ? engine[state.engine] : 'none'});
  /** One open voicemail. The model's `arrive` is the owner opening a message; its generation is the driver's count. */
  function voicemail(name) {
    let state = V.closedVoicemail(), generation = 0, ready = false, inCall = false, mode = 'local', local = true;
    const tickets = new Map();
    const t = trace(name, seen(state)), on = (action, change) => { if (change) state = change(state); t.step(action, seen(state)); return api; };
    const api = {
      ready: () => { ready = true; return on(act('becomeReady')); },
      carrier: () => on(act('carrierStatus', 'ready')),
      arrive: () => { generation++; const next = on(act('arrive'), s => V.opened(s, `vm${generation}`, false, null)); tickets.set(generation, state.ticket); return next; },
      fetch: () => on(act('fetchAudio'), s => V.audioRequested(s, ready)),
      audio: (ticket, ok) => on(act('audioReply', ticket, ok), s => V.audioReplied(s, tickets.get(ticket), ok)),
      cloud: () => { mode = 'cloud'; return on(act('setStt', 'cloud')); },
      noLocal: () => { local = false; return on(act('localSttChanges', false)); },
      transcribe: () => on(act('transcribe'), s => V.transcriptRequested(s, ready, mode, local)),
      transcript: (ticket, ok) => on(act('transcriptReply', ticket, ok), s => V.transcriptReplied(s, tickets.get(ticket), ok ? 'Call me back.' : null)),
      play: () => on(act('play'), s => V.played(s, ready, inCall)),
      noPlay: () => { must(V.played(state, ready, inCall) === state, 'nothing plays now'); return on(refused('play')); },
      pause: () => on(act('pausePlayback'), s => V.paused(s)),
      ends: () => on(act('playbackEnds'), s => V.ended(s)),
      callStarts: () => { inCall = true; return on(act('callStarts'), s => V.callStarted(s)); },
      callEnds: () => { inCall = false; return on(act('callEnds')); },
      lose: () => { ready = false; return on(act('loseReady'), s => V.readinessLost(s)); },
      ask: () => on(act('askDelete'), s => V.deleteAsked(s, ready)),
      keep: () => on(act('cancelDelete'), s => V.deleteCancelled(s)),
      confirm: ok => on(act('confirmDeleteNow', ok), s => V.deleteFinished(s, ok)),
      removed: () => on(act('remoteDelete'), s => V.closed(s)),
      done: () => t.done(),
    };
    return api;
  }
  const open = name => voicemail(name).ready().carrier().arrive();
  const loaded = name => open(name).fetch().audio(1, true);
  const traces = [
    loaded('transcribed on the device').transcribe().transcript(1, true).done(),
    loaded('an unavailable recognizer is not replaced by the cloud').noLocal().transcribe().done(),
    open('the cloud setting transcribes in the cloud').cloud().fetch().audio(1, true).transcribe().transcript(1, true).done(),
    loaded('a transcript for a replaced voicemail is dropped').transcribe().arrive().transcript(1, true).done(),
    open('audio for a removed voicemail is dropped').fetch().removed().audio(1, true).done(),
    loaded('playing marks it heard; pause, resume and the end').play().pause().play().ends().done(),
    loaded('a call pauses playback and nothing plays during it').play().callStarts().noPlay().callEnds().play().done(),
    open('failed audio can be fetched again').fetch().audio(1, false).fetch().audio(1, true).done(),
    loaded('a delete asks first').ask().keep().ask().confirm(false).ask().confirm(true).done(),
    loaded('losing readiness stops playback and closes the confirmation').play().ask().lose().done(),
    loaded('a failed transcript can be requested again').transcribe().transcript(1, false).transcribe().transcript(1, true).done(),
  ];
  return checkTraces({model: 'Voicemail', modelPath: model('Voicemail'), sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual voicemail-state.ts transitions run with controlled replies. The model item is the voicemail the owner has open: `arrive` is opening one and `remoteDelete` is it closing or leaving the list.',
    'Readiness, the call state, the speech setting and recognizer availability are driver inputs. The code supports the cloud setting; the shipped transcriber always passes the on-device mode.',
    'Carrier state, provider sync, audio decoding, playback and the recognizer itself are outside this projection.',
  ]});
}

// ---- TelephonyAttention ↔ apps/app/src/prototype/telephony-presenters.ts --------------------------

export async function checkTelephonyAttention(extraSources = []) {
  const {implementation: {P}, sources, driverHashes} = await capture([['P', 'apps/app/src/prototype/telephony-presenters.ts']], 'TelephonyAttention', extraSources);
  const now = 1_700_000_000_000;
  function home(name) {
    let image = false, loaded = false, texts = 0, missed = 0, voicemail = 0, opened = 'home';
    // Off the image no telephony client exists, so nothing is read; a failed read leaves every source null.
    const read = () => {
      const have = image && loaded, names = new Map();
      return {names, threads: have ? Array.from({length: texts}, (_, i) => ({id: `t${i}`, date: now - i * 1000, snippet: 'hello', unread: true, addresses: [`+1555555010${i}`]})) : null,
        calls: have ? Array.from({length: missed}, (_, i) => ({number: `+1555555020${i}`, cachedName: null, date: now - i * 1000, type: 'missed', isNew: true})) : null,
        voicemail: have ? Array.from({length: voicemail}, (_, i) => ({number: `+1555555030${i}`, cachedName: null, date: now - i * 1000, durationSeconds: 20, isNew: true})) : null};
    };
    const cards = () => P.presentTelephonyAttention(read(), now);
    const seen = () => { const shown = cards(); return {messagesCard: !!shown.messages, phoneCard: !!shown.phone, 's.opened': opened}; };
    const t = trace(name, seen()), on = action => { t.step(action, seen()); return api; };
    const api = {
      image: () => { image = true; return on(act('admitImage')); },
      sources: ok => { loaded = ok; return on(act('sourcesLoad', ok)); },
      text: () => { texts++; return on(act('textArrives')); },
      missed: () => { missed++; return on(act('callMissed')); },
      voicemail: () => { voicemail++; return on(act('voicemailArrives')); },
      // The card's target comes from the presenter; reading the opened item is the view's own effect.
      openMessages: () => { const shown = cards(); must(!!shown.messages, 'the Messages card is shown'); if (shown.messagesThread) { opened = 'thread'; texts = 0; } else opened = 'threads'; return on(act('openMessages')); },
      readThread: () => { texts--; return on(act('readThread')); },
      openPhone: () => { const shown = cards(); must(!!shown.phone, 'the Phone card is shown'); opened = shown.phoneTab; if (opened === 'recents') missed = 0; return on(act('openPhone')); },
      hear: () => { voicemail--; return on(act('hearVoicemail')); },
      home: () => { opened = 'home'; return on(act('goHome')); },
      elsewhere: kind => { if (kind === 'texts') texts = 0; else if (kind === 'missed') missed = 0; else voicemail = 0; return on(act('clearedElsewhere', kind)); },
      done: () => t.done(),
    };
    return api;
  }
  const live = name => home(name).image().sources(true);
  const traces = [
    live('one unread thread opens that thread and clears the card').text().openMessages().home().done(),
    live('several unread threads open the list; the card stays until they are read').text().text().openMessages().readThread().home().openMessages().home().done(),
    live('missed calls lead to Recents, then the card leads to Voicemail').missed().voicemail().openPhone().home().openPhone().hear().home().done(),
    live('a failed read hides both cards').text().missed().sources(false).sources(true).done(),
    live('items read elsewhere clear the cards').text().missed().voicemail().elsewhere('texts').elsewhere('missed').elsewhere('voicemail').done(),
    home('a standalone install shows no card').sources(true).done(),
    live('a text that arrives while Messages is open shows on return').text().openMessages().text().home().done(),
  ];
  return checkTraces({model: 'TelephonyAttention', modelPath: model('TelephonyAttention'), sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual card presenter decides whether each card is shown and where it leads, from rows the driver builds for the model counts.',
    'Image admission, the bounded foreground reads and marking items read are driver inputs: the adapter, the telephony profile and the opened views own them.',
    'Row text, ordering and the two-row limit are presentation, covered by unit tests.',
  ]});
}

// ---- PhoneCalls and ContactsBook ↔ apps/app/src/runtime/telephony-executor.ts ---------------------

const hold = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return {promise, release}; };
const settled = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const signal = () => new AbortController().signal;

export async function checkTelephonyPhoneCalls(extraSources = []) {
  const {implementation: {X}, sources, driverHashes} = await capture([['X', 'apps/app/src/runtime/telephony-executor.ts']], 'PhoneCalls', extraSources);
  const proposalOf = {placed: 'placed', 'emergency-handoff': 'handed-off', 'not-found': 'unresolved', cancelled: 'declined', failed: 'failed'};
  /**
   * One agent call through the executor. `matches` contacts each have one number; `answer` is the
   * owner's choice on the phone (null dismisses); `place` is what Telecom reports or 'throw'.
   */
  async function run(name, {target, matches = 1, answer = 0, place = 'placed', emergency = false, lockAfterAsk = false}) {
    let placed = 0, locked = false;
    const asked = hold(), answered = hold();
    const ports = {
      current() { if (locked) throw Error('Phone context changed'); }, normalize: value => value,
      ask: async review => { asked.release(review); return answered.promise; },
      searchContacts: async () => Array.from({length: matches}, (_, i) => ({id: String(i + 1), displayName: `Daniel ${i}`, phoneNumbers: [`+1555555010${i}`]})),
      placeCall: async () => { if (place === 'throw') throw Error('telecom'); if (place === 'placed') placed++; return {status: place}; },
    };
    const operation = {type: 'phone_call', target: target === 'number' ? {kind: 'number', number: '+15555550100'} : {kind: 'contact', query: 'Daniel'}};
    const seen = proposal => ({'s.proposal': proposal, 's.agentPlaced': placed, 's.call': placed ? 'dialing' : 'none'});
    const t = trace(name, seen('none')).step(act('becomeReady'), seen('none'));
    const execution = X.executeTelephonyAction(operation, 'op', ports, signal());
    execution.catch(() => {});
    if (target === 'number') {
      const result = await execution;
      must(result.telephonyResult.contact === false, 'a number call reports no contact choice');
      return t.step(emergency ? [act('agentAsk', 'number', true)] : [act('agentAsk', 'number', false), act('approve', place === 'placed')], seen(proposalOf[result.telephonyResult.status])).done();
    }
    if (matches === 0) { const result = await execution; return t.step([act('agentAsk', 'name', false), act('resolved', 0)], seen(proposalOf[result.telephonyResult.status])).done(); }
    // The owner is shown every match before anything is called.
    const review = await Promise.race([asked.promise, execution.then(() => { throw Error('The executor finished without asking the owner'); })]);
    must(review.kind === 'call' && review.options.length === matches, 'every dialable match is offered');
    t.step([act('agentAsk', 'name', false), act('resolved', Math.min(matches, 2))], seen(matches > 1 ? 'choosing' : 'proposed'));
    if (lockAfterAsk) {
      locked = true; answered.release(0);
      await execution.then(() => { throw Error('A locked phone still placed the call'); }, () => {});
      return t.step(act('lock'), {'s.agentPlaced': placed, 's.call': 'none', 's.unlocked': false}).done();
    }
    answered.release(answer); await settled();
    const result = await execution;
    if (answer === null) return t.step(act('declineProposal'), seen(proposalOf[result.telephonyResult.status])).done();
    must(result.telephonyResult.contact === true, 'a contact call reports the contact choice');
    return t.step(matches > 1 ? [act('choose'), act('approve', place === 'placed')] : act('approve', place === 'placed'), seen(proposalOf[result.telephonyResult.status])).done();
  }
  const traces = [
    await run('a number is called as approved', {target: 'number'}),
    await run('a name with one match is confirmed, then called', {target: 'name'}),
    await run('a name with several matches is chosen, then called', {target: 'name', matches: 3, answer: 2}),
    await run('an unknown name calls nothing', {target: 'name', matches: 0}),
    await run('an emergency number is handed to the system dialer', {target: 'number', place: 'emergency-handoff', emergency: true}),
    await run('a dismissed confirmation calls nothing', {target: 'name', answer: null}),
    await run('a dismissed choice calls nothing', {target: 'name', matches: 2, answer: null}),
    await run('a call Telecom refuses is not a call', {target: 'number', place: 'throw'}),
    await run('a confirmed call that fails to start is not a call', {target: 'name', place: 'throw'}),
    await run('locking the phone expires the confirmation', {target: 'name', lockAfterAsk: true}),
  ];
  return checkTraces({model: 'PhoneCalls', modelPath: model('PhoneCalls'), sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual telephony-executor.ts call path runs with controlled contact search, owner answer and Telecom ports. The proposal state is the executor result: placed, emergency-handoff (handed-off), not-found (unresolved), cancelled (declined) and failed.',
    'A multi-action checkpoint is one executor step. The approval that precedes the executor is the shared device-action coordinator and is not exercised here. The owner confirmation of a single match is the model approval.',
    'The call lifecycle after placement (ringing, active, held, missed, controls) is the native call service and is not observed. A locked phone is observed as nothing placed; the executor has no expired state of its own.',
  ]});
}

export async function checkTelephonyContactsBook(extraSources = []) {
  const {implementation: {X}, sources, driverHashes} = await capture([['X', 'apps/app/src/runtime/telephony-executor.ts']], 'ContactsBook', extraSources);
  const version = 'a'.repeat(64);
  const record = () => ({id: '1', version, displayName: 'Priya Nair', phoneNumbers: [{number: '+14155550132', type: 'mobile'}], emailAddresses: []});
  // `stale` and `not-found` both mean the contact that was shown is no longer the contact on the phone.
  const proposalOf = {saved: 'applied', deleted: 'applied', stale: 'stale', 'not-found': 'stale', cancelled: 'declined', failed: 'failed'};
  /** One agent contact change. `during` is what happens to the contact while the confirmation is open. */
  async function run(name, {kind, answer = 0, write = 'ok', during = null}) {
    let writes = 0, exists = true;
    const asked = hold(), answered = hold();
    const outcome = ok => during === 'change' ? 'stale' : during === 'delete' ? 'not-found' : write === 'fail' ? 'failed' : ok;
    const ports = {
      current() {}, normalize: value => value, ask: async review => { asked.release(review); return answered.promise; },
      searchContacts: async () => [{id: '1', displayName: 'Priya Nair', phoneNumbers: ['+14155550132']}], getContact: async () => record(),
      saveContact: async (_draft, target) => { const status = outcome('saved'); must(kind === 'create' ? target === undefined : target?.version === version, 'a save names the version that was shown'); if (status === 'saved') writes++; return {status}; },
      removeContact: async (_id, shown) => { const status = outcome('deleted'); must(shown === version, 'a delete names the version that was shown'); if (status === 'deleted') { writes++; exists = false; } return {status}; },
    };
    const operation = kind === 'create' ? {type: 'contact_create', contact: {displayName: 'Grace Hopper', phoneNumbers: ['+12025550101'], emailAddresses: []}}
      : kind === 'edit' ? {type: 'contact_update', query: 'Priya', set: {phoneNumbers: ['+16285550148']}} : {type: 'contact_delete', query: 'Priya'};
    const seen = proposal => ({'s.proposal': proposal, 's.agentWrites': writes, 's.exists': exists});
    const t = trace(name, seen('none')).step([act('admitImage'), act('grant')], seen('none'));
    const execution = X.executeTelephonyAction(operation, 'op', ports, signal());
    if (kind === 'create') {
      // The approval the owner gave in the assistant showed every field; the executor writes without a second sheet.
      const result = await execution;
      return t.step([act('propose', 'create'), act('approve', write === 'ok')], seen(proposalOf[result.telephonyResult.status])).done();
    }
    const review = await asked.promise;
    must(review.kind === (kind === 'edit' ? 'contact-save' : 'contact-delete'), 'the owner is shown the change before it is written');
    t.step(act('propose', kind), seen('proposed'));
    if (during === 'change') t.step(act('externalChange'), {'s.proposal': 'stale', 's.agentWrites': writes});
    if (during === 'delete') { exists = false; t.step(act('externalDelete'), seen('stale')); }
    answered.release(answer); await settled();
    const result = await execution;
    const final = seen(proposalOf[result.telephonyResult.status]);
    if (during) { must(final['s.proposal'] === 'stale' && writes === 0, 'a contact that changed is not written'); return t.step(act('repeat'), final).done(); }
    return t.step(answer === null ? act('decline') : act('approve', write === 'ok'), final).done();
  }
  const traces = [
    await run('an agent edit is written after confirmation', {kind: 'edit'}),
    await run('an agent delete is written after confirmation', {kind: 'delete'}),
    await run('a new contact is written as approved', {kind: 'create'}),
    await run('a dismissed change writes nothing', {kind: 'edit', answer: null}),
    await run('a dismissed delete writes nothing', {kind: 'delete', answer: null}),
    await run('an edit of a contact that changed is stale', {kind: 'edit', during: 'change'}),
    await run('a delete of a contact that was removed is stale', {kind: 'delete', during: 'delete'}),
    await run('a save the phone refuses is not applied', {kind: 'edit', write: 'fail'}),
    await run('a new contact the phone refuses is not applied', {kind: 'create', write: 'fail'}),
  ];
  return checkTraces({model: 'ContactsBook', modelPath: model('ContactsBook'), sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual telephony-executor.ts contact path runs with controlled lookup, owner answer and address-book ports. The proposal state is the executor result; stale and not-found both map to the model stale state.',
    'A change made elsewhere while the confirmation is open is represented by the write port answering stale or not-found, as the native version check does. The native check itself is ContactsEditor in the shared plugin, with its own JVM tests.',
    'The owner editor, list reads, access loss and delete confirmation of the Contacts view are exercised by test/contacts-adapter.test.mjs, not by these traces.',
  ]});
}

if (process.argv[1] === here) {
  for (const check of [checkTelephonyMessageThreads, checkTelephonyVoicemail, checkTelephonyAttention, checkTelephonyPhoneCalls, checkTelephonyContactsBook]) {
    const receipt = await check();
    console.log(JSON.stringify({model: receipt.model, traces: receipt.traces, checkpoints: receipt.checkpoints, observedFields: receipt.observedFields, passed: receipt.passed, driverInputsBound: receipt.driverInputsBound}));
  }
}
