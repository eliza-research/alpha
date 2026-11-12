import {serviceInputs} from './source-inputs.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {inboxDriverSources, rebuildInboxDriver} from './inbox-coordinator-ports.mjs';
import {createProviderDraftFixture} from './inbox-provider-draft-ports.mjs';
import {action, step} from './inbox-coordinator.mjs';

const content = value => !value ? 0 : value === 'edited' ? 2 : 1;
const ref = value => value ? Number(value.providerDigest[0]) : 0;
const parts = value => qset((value?.forwardAttachments?.partIds || []).map(Number));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
async function until(ready, label) {
  const deadline = Date.now() + 10000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, label);
    await new Promise(done => setTimeout(done, 0));
  }
}
function rows(fixture, grant = 1) {
  const user = fixture.controller.getSnapshot().cloudAccount?.userId;
  const values = [...fixture.slots.values()];
  const owned = value => value?.owner && JSON.parse(value.owner)[1] === user && JSON.parse(value.owner)[3] === `grant-${grant}`;
  const saved = values.find(value => value?.id && owned(value));
  const retainedRecord = values.find(value => value?.binding && value.text && JSON.parse(JSON.parse(value.binding)[2])[1] === user && JSON.parse(JSON.parse(value.binding)[2])[3] === `grant-${grant}`);
  const retained = retainedRecord ? fixture.modules.readInboxUnsaved(retainedRecord.text, JSON.parse(retainedRecord.binding)[2]).draft : null;
  const operation = values.find(value => value?.requestId && value.grantId === `grant-${grant}` && JSON.parse(value.owner)[1] === user);
  return {saved, retained, operation};
}
function observe(fixture, coordinator, grant = 1) {
  const {saved, retained, operation} = rows(fixture, grant);
  const proposal = coordinator.drafts.email()?.proposal;
  const remote = fixture.providerState.draft;
  const view = coordinator.provider.render().provider;
  return {
    phase: operation?.phase || 'empty', kind: operation?.proposal.kind || 'none', requests: fixture.state.dispatches,
    canConfirm: view.canConfirm && !view.busy,
    'copy.body': content(proposal?.bodyText), 'copy.parts': parts(proposal),
    'copy.saved': content(saved?.body), 'copy.savedRef': ref(saved?.provider),
    'copy.retained': content(retained?.body), 'copy.retainedRef': ref(retained?.provider),
    's.remoteRef': ref(remote), 's.remoteBody': content(remote?.bodyText), 's.remoteBytes': remote?.forwardBytes || 0,
    ...(operation ? {'proposal.ref': ref(operation.proposal.expectedDigest ? {providerDigest: operation.proposal.expectedDigest} : null)} : {}),
  };
}
async function setup(name, traces) {
  const fixture = await createProviderDraftFixture(), coordinator = fixture.createPair();
  const trace = {name, init: action('init'), expect: observe(fixture, coordinator), steps: []};
  traces.push(trace);
  await coordinator.bind();
  step(trace, 'bind selected Gmail account', action('bind', 1), observe(fixture, coordinator));
  return {fixture, coordinator, trace};
}
async function compose(fixture, coordinator, trace, forward = false) {
  if (forward) {
    await coordinator.drafts.newEmail({id: 'message-1', threadId: 'thread-1', subject: 'Subject', from: 'Sender', fromEmail: 'sender@example.test', to: [], snippet: '', receivedAt: '', unread: false},
      'forward', 'source', {forward: {messageId: 'message-1', historyId: 'history-1', parts: [1, 2].map(part => ({partId: String(part), name: `source-${part}.txt`, mimeType: 'text/plain', size: 1}))}});
    coordinator.drafts.render().c.onTo({target: {value: 'recipient@example.test'}});
    coordinator.drafts.render().c.addRaw();
  } else {
    assert.equal(coordinator.drafts.begin(undefined, undefined, '', {to: ['recipient@example.test'], subject: 'Subject', body: 'original'}), true);
  }
  await fixture.settle();
  step(trace, 'compose local draft with explicit source parts', action('newDraft', forward), observe(fixture, coordinator));
}
async function review(fixture, coordinator, trace, accepted = true) {
  coordinator.drafts.render().c.saveProvider();
  await fixture.settle();
  step(trace, 'request the separately persisted exact provider review', [action('prepare'), action('reviewed', accepted)], observe(fixture, coordinator));
}
async function confirm(fixture, coordinator, trace, lost = false) {
  fixture.advance();
  fixture.state.outcome = lost ? 'lost' : 'succeeded';
  coordinator.provider.render().provider.confirm();
  await fixture.settle();
  step(trace, lost ? 'provider completes but its reply is lost' : 'confirm exactly one prepared provider request', [
    action('reserve'), action('persisted'), action('dispatched'), action('effect'), lost ? action('lostReply') : action('reply', 'succeeded'),
  ], observe(fixture, coordinator));
}
async function create(fixture, coordinator, trace, forward = false) {
  await compose(fixture, coordinator, trace, forward);
  await review(fixture, coordinator, trace);
  await confirm(fixture, coordinator, trace);
}
async function adopt(fixture, coordinator, trace) {
  fixture.advance();
  coordinator.provider.render().provider.editDraft();
  await fixture.settle();
  step(trace, 'recheck provider digest then save the local reference before retiring its receipt', [
    action('beginRead'), action('readReply', 1, 0, true), action('adopted', true, true), action('retired', true, true),
  ], observe(fixture, coordinator));
}

export async function runInboxProviderDraftsRefinement(extraSources = []) {
  const discovered = await inboxDriverSources();
  const sources = [...discovered, ...extraSources, fileURLToPath(import.meta.url),
    'specs/quint/refinement/services/inbox-provider-draft-ports.mjs',
    'specs/quint/refinement/services/inbox-coordinator-ports.mjs', 'specs/quint/refinement/services/inbox-coordinator.mjs', 'bun.lock'];
  const inputs = serviceInputs(sources);
  const driverHashes = captureInputs(inputs);
  rebuildInboxDriver(discovered);
  const traces = [];
  for (const forward of [false, true]) {
    const {fixture, coordinator, trace} = await setup(forward ? 'forward-create-replace-delete' : 'plain-create-replace-delete', traces);
    await create(fixture, coordinator, trace, forward);
    await adopt(fixture, coordinator, trace);
    if (forward) {
      assert.equal(coordinator.drafts.render().c.atts.length, 2);
      coordinator.drafts.render().c.atts[1].rm();
      await fixture.settle();
      step(trace, 'remove only one reviewed original part', action('removePart', 2), observe(fixture, coordinator));
    } else {
      coordinator.drafts.render().c.onBody({target: {value: 'edited'}});
      await fixture.settle();
      step(trace, 'retain edits using a canonical provider reference', action('edit'), observe(fixture, coordinator));
      assert.deepEqual(Object.keys(rows(fixture).retained.provider).sort(), ['draftId', 'providerDigest']);
    }
    await review(fixture, coordinator, trace);
    await confirm(fixture, coordinator, trace);
    fixture.advance();
    coordinator.provider.render().provider.deleteDraft();
    await fixture.settle();
    step(trace, 'retire replacement receipt and separately review permanent provider deletion', [
      action('beginDelete'), action('retired', true, true), action('prepare'), action('reviewed', true),
    ], observe(fixture, coordinator));
    await confirm(fixture, coordinator, trace);
    assert.equal(fixture.providerState.draft, null);
    assert.ok(rows(fixture).saved, 'provider deletion preserves the saved local copy');
    assert.equal(fixture.state.dispatches, 3);
    coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('changed-provider-digest-refuses-adoption', traces);
    await create(fixture, coordinator, trace);
    fixture.providerState.draft.providerDigest = '2'.repeat(64);
    fixture.providerState.revision = 2;
    fixture.providerState.draft.bodyText = 'edited';
    step(trace, 'provider draft changes outside Alpha', action('remoteEdit'), observe(fixture, coordinator));
    fixture.advance();coordinator.provider.render().provider.editDraft();await fixture.settle();
    step(trace, 'mismatching fresh provider digest leaves local draft and receipt intact', [action('beginRead'), action('readReply', 1, 0, true)], observe(fixture, coordinator));
    assert.equal(rows(fixture).saved, undefined);
    coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('forward-capability-withdrawn-after-review', traces);
    await compose(fixture, coordinator, trace, true);await review(fixture, coordinator, trace);
    fixture.capability(1, {forwardAttachments: false});await coordinator.provider.bind('grant-1');
    step(trace, 'fresh capability read withdraws source-forward support', action('capabilities', true, false), observe(fixture, coordinator));
    coordinator.provider.render().provider.confirm();await fixture.settle();
    step(trace, 'saved forward review cannot bypass current capability', {...action('reserve'), reject: true}, observe(fixture, coordinator));
    assert.equal(fixture.state.dispatches, 0);coordinator.dispose();
  }
  for (const timing of ['before', 'after']) {
    const {fixture, coordinator, trace} = await setup(`local-adoption-save-${timing}`, traces);
    await create(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    const hook = async event => {if (event.value?.provider && event.key.startsWith('inbox-drafts:v1:[')) {entered = true;await gate.promise;throw Error('Controlled local adoption failure');}};
    fixture.gates(timing === 'before' ? {store: hook} : {storeResult: hook});
    fixture.advance();coordinator.provider.render().provider.editDraft();
    await until(() => entered, 'local adoption save held');
    if (timing === 'before') step(trace, 'provider digest matched before local persistence', [action('beginRead'), action('readReply', 1, 0, true)], observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'failed local acknowledgement preserves provider receipt', [
      ...(timing === 'after' ? [action('beginRead'), action('readReply', 1, 0, true)] : []), action('adopted', timing === 'after', false),
    ], observe(fixture, coordinator));
    assert.ok(rows(fixture).operation);coordinator.dispose();
  }
  for (const timing of ['before', 'after']) {
    const {fixture, coordinator, trace} = await setup(`adoption-receipt-retirement-${timing}`, traces);
    await create(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    const hook = async event => {if (event.value === null && event.key.startsWith('inbox-operation:')) {entered = true;await gate.promise;throw Error('Controlled receipt retirement failure');}};
    fixture.gates(timing === 'before' ? {store: hook} : {storeResult: hook});
    fixture.advance();coordinator.provider.render().provider.editDraft();
    await until(() => entered, 'receipt retirement held');
    if (timing === 'before') step(trace, 'local reference is saved before receipt retirement', [action('beginRead'), action('readReply', 1, 0, true), action('adopted', true, true)], observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'retirement response preserves its actual durable result', [
      ...(timing === 'after' ? [action('beginRead'), action('readReply', 1, 0, true), action('adopted', true, true)] : []), action('retired', timing === 'after', false),
    ], observe(fixture, coordinator));
    if (timing === 'after') step(trace, 'uncertain retirement blocks another request until reload', {...action('prepare'), reject: true}, observe(fixture, coordinator));
    coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('unknown-create-restart-reads-original-receipt', traces);
    await compose(fixture, coordinator, trace);await review(fixture, coordinator, trace);await confirm(fixture, coordinator, trace, true);
    coordinator.dispose();const reopened = fixture.createPair();await reopened.bind();
    step(trace, 'restart retains the unknown request', action('restart'), observe(fixture, reopened));
    reopened.provider.render().provider.check();await fixture.settle();
    step(trace, 'fresh receipt resolves the original request without a second dispatch', action('checkReceipt', true), observe(fixture, reopened));
    assert.equal(fixture.state.dispatches, 1);reopened.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('legacy-reference-retains-new-edits', traces);
    await create(fixture, coordinator, trace);await adopt(fixture, coordinator, trace);
    const saved = rows(fixture).saved;
    const key = [...fixture.slots].find(([, value]) => value === saved)[0];
    fixture.slots.set(key, {...saved, provider: {...saved.provider, messageId: 'legacy-readback-field'}});
    step(trace, 'pre-fix saved reference contains a readback-only field', null, observe(fixture, coordinator));
    coordinator.dispose();const reopened = fixture.createPair();await reopened.bind();
    step(trace, 'reload preserves saved provider identity', action('restart'), observe(fixture, reopened));
    reopened.drafts.chips((label, pick) => ({label, pick})).find(row => row.label === 'Restore local draft').pick();
    step(trace, 'restore legacy saved draft', action('restoreSaved'), observe(fixture, reopened));
    reopened.drafts.render().c.onBody({target: {value: 'edited'}});await fixture.settle();
    step(trace, 'new retained edits canonicalize the old reference without losing identity', action('edit'), observe(fixture, reopened));
    assert.deepEqual(Object.keys(rows(fixture).retained.provider).sort(), ['draftId', 'providerDigest']);reopened.dispose();
  }
  for (const ownerKind of ['grant', 'cloud']) {
    const {fixture, coordinator, trace} = await setup(`owner-changes-during-provider-read-${ownerKind}`, traces);
    await create(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.read = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.editDraft();
    await until(() => entered, 'provider reference read held');
    step(trace, 'provider reference read captures its original account', action('beginRead'), observe(fixture, coordinator));
    const grant = ownerKind === 'grant' ? 2 : 1;
    if (ownerKind === 'cloud') fixture.switchOwner(2);
    await Promise.all([coordinator.provider.bind(`grant-${grant}`), coordinator.drafts.bind(`grant-${grant}`, 'Replacement')]);
    step(trace, 'replacement owner binds before the old read returns', action('bind', 2), observe(fixture, coordinator, grant));
    gate.resolve();await fixture.settle();
    step(trace, 'late metadata cannot create a local provider reference for the replacement owner', action('readReply', 1, 0, true), observe(fixture, coordinator, grant));
    assert.equal(rows(fixture, grant).saved, undefined);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('forward-parts-edited-during-provider-read', traces);
    await create(fixture, coordinator, trace, true);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.read = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.editDraft();await until(() => entered, 'held provider read');
    step(trace, 'provider read begins for the exact forwarded draft', action('beginRead'), observe(fixture, coordinator));
    coordinator.drafts.render().c.atts[1].rm();
    step(trace, 'person removes one original while provider metadata is pending', action('removePart', 2), observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'late provider read preserves changed forward parts and its old receipt', action('readReply', 1, 0, true), observe(fixture, coordinator));
    assert.equal(coordinator.drafts.render().c.atts.length, 1);assert.equal(rows(fixture).saved, undefined);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('forward-support-lost-during-provider-read', traces);
    await create(fixture, coordinator, trace, true);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.read = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.editDraft();await until(() => entered, 'held provider read');
    step(trace, 'begin local reference restoration', action('beginRead'), observe(fixture, coordinator));
    fixture.capability(1, {forwardAttachments: false});await coordinator.provider.bind('grant-1');
    step(trace, 'current account loses forward support', action('capabilities', true, false), observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'local restoration retains references without dispatching them', [action('readReply', 1, 0, true), action('adopted', true, true), action('retired', true, true)], observe(fixture, coordinator));
    coordinator.drafts.render().c.saveProvider();await fixture.settle();
    step(trace, 'restored parts need current provider support before another review', {...action('prepare'), reject: true}, observe(fixture, coordinator));
    assert.equal(fixture.state.dispatches, 1);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('restored-forward-source-history-changed', traces);
    await create(fixture, coordinator, trace, true);await adopt(fixture, coordinator, trace);
    fixture.providerState.sourceHistory = 'history-2';fixture.providerState.sourceBytes = 2;
    step(trace, 'original message history changes after local reference restoration', action('sourceEdit'), observe(fixture, coordinator));
    await review(fixture, coordinator, trace, false);
    assert.equal(fixture.state.dispatches, 1);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('forward-metadata-fixed-before-review-reply', traces);
    await compose(fixture, coordinator, trace, true);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.prepare = async () => {entered = true;await gate.promise;};
    coordinator.drafts.render().c.saveProvider();await until(() => entered, 'prepared source metadata held');
    step(trace, 'provider captures original source bytes while creating the review', action('prepare'), observe(fixture, coordinator));
    fixture.providerState.sourceHistory = 'history-2';fixture.providerState.sourceBytes = 2;
    step(trace, 'later source mutation cannot replace the prepared byte snapshot', action('sourceEdit'), observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'review returns its original byte hash', action('reviewed', true), observe(fixture, coordinator));
    await confirm(fixture, coordinator, trace);
    assert.equal(fixture.providerState.draft.forwardBytes, 1);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('provider-edits-after-metadata-read', traces);
    await create(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.read = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.editDraft();await until(() => entered, 'provider metadata captured');
    step(trace, 'provider reference is captured before its callback', action('beginRead'), observe(fixture, coordinator));
    fixture.providerState.draft.providerDigest = '2'.repeat(64);fixture.providerState.draft.bodyText = 'edited';fixture.providerState.revision = 2;
    step(trace, 'provider changes after the read snapshot', action('remoteEdit'), observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'the captured matching reference is restored locally', [action('readReply', 1, 0, true), action('adopted', true, true), action('retired', true, true)], observe(fixture, coordinator));
    await review(fixture, coordinator, trace, false);
    assert.equal(fixture.state.dispatches, 1);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('non-atomic-replacement-after-review', traces);
    await create(fixture, coordinator, trace);await adopt(fixture, coordinator, trace);await review(fixture, coordinator, trace);
    fixture.providerState.draft.providerDigest = '2'.repeat(64);fixture.providerState.draft.bodyText = 'edited';fixture.providerState.revision = 2;
    step(trace, 'provider changes after a replacement was reviewed', action('remoteEdit'), observe(fixture, coordinator));
    await confirm(fixture, coordinator, trace);
    assert.equal(fixture.providerState.draft.bodyText, 'original');coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('old-owner-provider-outcome-remains-unknown', traces);
    await compose(fixture, coordinator, trace);await review(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.dispatch = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.confirm();await until(() => entered, 'provider request in flight');
    step(trace, 'original account dispatches its durable request', [action('reserve'), action('persisted'), action('dispatched')], observe(fixture, coordinator));
    await Promise.all([coordinator.provider.bind('grant-2'), coordinator.drafts.bind('grant-2', 'Replacement')]);
    step(trace, 'new account replaces the active binding', action('bind', 2), observe(fixture, coordinator, 2));
    gate.resolve();await fixture.settle();
    step(trace, 'provider may finish but old callback cannot publish success for new owner', [action('effect'), action('lostReply')], observe(fixture, coordinator, 2));
    assert.equal(rows(fixture).operation.phase, 'dispatching');coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('local-adoption-commit-after-owner-change', traces);
    await create(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    fixture.gates({store: async event => {if (event.value?.provider && event.key.startsWith('inbox-drafts:v1:[')) {entered = true;await gate.promise;}}});
    fixture.advance();coordinator.provider.render().provider.editDraft();await until(() => entered, 'local adoption save held');
    step(trace, 'matching reference starts a local save', [action('beginRead'), action('readReply', 1, 0, true)], observe(fixture, coordinator));
    await Promise.all([coordinator.provider.bind('grant-2'), coordinator.drafts.bind('grant-2', 'Replacement')]);
    step(trace, 'new account replaces the binding before local save completes', action('bind', 2), observe(fixture, coordinator, 2));
    gate.resolve();await fixture.settle();
    step(trace, 'old local write stays with its original owner and preserves its receipt', action('adopted', true, false), {
      ...observe(fixture, coordinator, 2), 'firstCopy.savedRef': ref(rows(fixture).saved?.provider),
    });
    assert.ok(rows(fixture).operation);assert.equal(rows(fixture, 2).saved, undefined);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('retained-forward-restart-discloses-omitted-originals', traces);
    await create(fixture, coordinator, trace, true);await adopt(fixture, coordinator, trace);
    coordinator.drafts.render().c.onBody({target: {value: 'edited'}});await fixture.settle();
    step(trace, 'retain forward text with canonical provider reference', action('edit'), observe(fixture, coordinator));
    coordinator.dispose();const reopened = fixture.createPair();await reopened.bind();
    step(trace, 'restart keeps saved originals separate from retained edits', action('restart'), observe(fixture, reopened));
    reopened.drafts.chips((label, pick) => ({label, pick})).find(row => row.label === 'Resume unsaved email').pick();
    step(trace, 'resuming retained text deliberately omits source parts', action('restoreRetained'), observe(fixture, reopened));
    assert.match(reopened.drafts.render().c.status, /without any original attachments/);reopened.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('provider-review-wrong-forward-part-rejected', traces);
    await compose(fixture, coordinator, trace, true);
    fixture.providerState.reviewTransform = review => ({...review, forwardedAttachments: review.forwardedAttachments.map(row => ({...row, partId: '9'}))});
    await review(fixture, coordinator, trace, false);
    assert.equal(fixture.state.dispatches, 0);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('unknown-create-requires-retained-choice-before-adoption', traces);
    await compose(fixture, coordinator, trace);await review(fixture, coordinator, trace);await confirm(fixture, coordinator, trace, true);
    coordinator.dispose();const reopened = fixture.createPair();await reopened.bind();
    step(trace, 'restart keeps the durable unsaved source copy', action('restart'), observe(fixture, reopened));
    reopened.provider.render().provider.check();await fixture.settle();
    step(trace, 'receipt resolves the same provider draft', action('checkReceipt', true), observe(fixture, reopened));
    fixture.advance();reopened.provider.render().provider.editDraft();await fixture.settle();
    step(trace, 'retained unsaved text must be resumed before provider adoption', [action('beginRead'), action('readReply', 1, 1, true)], observe(fixture, reopened));
    assert.equal(rows(fixture).saved, undefined);
    reopened.drafts.chips((label, pick) => ({label, pick})).find(row => row.label === 'Resume unsaved email').pick();
    step(trace, 'explicitly resume the retained source email', action('restoreRetained'), observe(fixture, reopened));
    fixture.advance();reopened.provider.render().provider.editDraft();await fixture.settle();
    step(trace, 'matching resumed email permits local adoption', [action('beginRead'), action('readReply', 1, 1, true), action('adopted', true, true), action('retired', true, true)], observe(fixture, reopened));
    reopened.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('native-attachment-bytes-change-during-provider-read', traces);
    await compose(fixture, coordinator, trace);
    const fileA = {name: 'a.txt', mimeType: 'text/plain', dataBase64: 'YQ=='};
    assert.equal(coordinator.drafts.attachReviewed(fileA, coordinator.drafts.suggestionTarget().token), true);
    await fixture.settle();step(trace, 'reviewed local attachment is added without changing modeled text', null, observe(fixture, coordinator));
    await review(fixture, coordinator, trace);await confirm(fixture, coordinator, trace);
    const gate = deferred();let entered = false;
    fixture.providerState.gates.read = async () => {entered = true;await gate.promise;};
    fixture.advance();coordinator.provider.render().provider.editDraft();await until(() => entered, 'held metadata read');
    step(trace, 'begin provider reference read for the attached email', action('beginRead'), observe(fixture, coordinator));
    coordinator.drafts.render().c.atts[0].rm();
    const fileB = {name: 'a.txt', mimeType: 'text/plain', dataBase64: 'Yg=='};
    assert.equal(coordinator.drafts.attachReviewed(fileB, coordinator.drafts.suggestionTarget().token), true);
    step(trace, 'same filename now holds different selected bytes', null, observe(fixture, coordinator));
    gate.resolve();await fixture.settle();
    step(trace, 'changed attachment bytes reject provider adoption', action('readReply', 1, 0, false), observe(fixture, coordinator));
    assert.equal(coordinator.drafts.email().proposal.attachments[0].dataBase64, 'Yg==');
    assert.equal(rows(fixture).saved, undefined);coordinator.dispose();
  }
  {
    const {fixture, coordinator, trace} = await setup('restored-reference-grant-withdrawal-and-regrant', traces);
    await create(fixture, coordinator, trace);await adopt(fixture, coordinator, trace);
    fixture.capability(1, {providerDrafts: false});await coordinator.provider.bind('grant-1');
    step(trace, 'provider draft capability is withdrawn', action('capabilities', false, true), observe(fixture, coordinator));
    coordinator.drafts.render().c.saveProvider();await fixture.settle();
    step(trace, 'saved local reference cannot authorize a new review', {...action('prepare'), reject: true}, observe(fixture, coordinator));
    fixture.capability(1, {providerDrafts: true});await coordinator.provider.bind('grant-1');
    step(trace, 'fresh capability restoration keeps the local reference', action('capabilities', true, true), observe(fixture, coordinator));
    await review(fixture, coordinator, trace);await confirm(fixture, coordinator, trace);coordinator.dispose();
  }
  const receipt = await checkTraces({model: 'InboxProviderDrafts', sources: inputs, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual provider controls, composer, durable InboxOperation and unsaved-draft controllers execute with controlled Gmail and atomic storage ports.',
    'One Cloud/Gmail owner has three separately reviewed one-shot requests. A second owner supplies stale-callback rejection scenarios. The original InboxDelivery and InboxCoordinator APIs are retained.',
    'Provider metadata and byte snapshots follow the pinned inbox-provider contract. Replacement is explicitly non-atomic after review, and external Gmail acceptance is not established.',
  ]});
  return {receipts: [receipt], obligations: [{model: 'InboxProviderDrafts', obligation: 'installed provider and broader lifecycle qualification', reason: 'The source runs against controlled external ports, finite content/identity classes and three requests. Arbitrary repeated replacements and installed provider behavior remain outside this campaign.'}]};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {receipts} = await runInboxProviderDraftsRefinement();
  console.log(JSON.stringify({traces: receipts[0].traces, checkpoints: receipts[0].checkpoints}));
}
