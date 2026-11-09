import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
import {chatAttachmentComposerFixture, chatAttachmentComposerSources} from '../../../../test/fixtures/chat-attachment-composer.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
import {join} from 'node:path';

const action = (name, ...args) => ({name, args});
const observation = ({saved, recorded, ...state}) => ({
  ...Object.fromEntries(Object.entries(state).map(([key, value]) => [`s.${key}`, value])),
  's.saved': qset(new Set(saved)), 's.recorded': qset(recorded),
});

async function composerTraces() {
  const traces = [];
  async function scenario(name, drive) {
    const f = chatAttachmentComposerFixture();
    const trace = {name, expect: observation(f.observe()), steps: []};
    async function advance(label, actions, transition) {
      await transition();
      trace.steps.push({label, action: actions, expect: observation(f.observe())});
    }
    await advance('Actual Notes action shows the transcript chip', action('attach'), f.attach);
    await advance('The composer holds the exact attachment save', action('prepareSend'), async () => {f.holdStorage(); await f.start();});
    assert.equal(f.inspect().connectCalls, 0);
    await drive(f, advance);
    traces.push(trace);
  }
  const complete = (f, advance) => advance('The actual local save settles', action('settleStorage', true), f.completeStorage);
  const change = (f, advance, kind) => advance(`The real subscription retires the old ${kind.toLowerCase()}`,
    action(`switch${kind}`), f[`switch${kind}`]);
  const reload = (f, advance) => advance('Manual history reload restores only a matching recorded row', action('reload'), f.reload);
  await scenario('closed pre-dispatch refusal returns the exact transcript to the draft', async (f, advance) => {
    await complete(f, advance);
    await advance('A definite refusal removes the bubble and releases the chip', action('refusedBeforeDispatch'), f.refuse);
    assert.equal(f.inspect().draftText, 'Summarize this for me');
    await reload(f, advance);
    assert.equal(f.inspect().sendCalls, 0);
  });
  await scenario('local attachment storage refusal leaves the existing draft', async (f, advance) => {
    await advance('The original local write fails without an optimistic bubble', action('settleStorage', false), () => f.completeStorage(false));
    await f.finish();
    assert.deepEqual(f.inspect().toasts, ['Attachment could not be saved. Try again.']);
    assert.equal(f.inspect().connectCalls, 0);
  });
  for (const kind of ['Owner', 'Conversation']) {
    await scenario(`a held write may retain old bytes but cannot publish for a different ${kind.toLowerCase()}`, async (f, advance) => {
      await change(f, advance, kind);
      await complete(f, advance);
      assert.equal(f.inspect().connectCalls, 0);
      await f.finish();
    });
  }
  await scenario('returning to the same conversation does not revive a held attachment', async (f, advance) => {
    await change(f, advance, 'Conversation');
    await change(f, advance, 'Conversation');
    await complete(f, advance);
    assert.equal(f.inspect().connectCalls, 0);
    await f.finish();
  });
  await scenario('removing the exact transcript retires its held send', async (f, advance) => {
    await advance('The actual composer removal retires the transcript', action('removeDraft'), f.remove);
    await complete(f, advance);
    assert.equal(f.inspect().connectCalls, 0);
    await f.finish();
  });
  await scenario('a refusal after owner retirement leaves the new draft intact', async (f, advance) => {
    await complete(f, advance);
    await change(f, advance, 'Owner');
    await advance('The replacement owner attaches its own transcript', action('attach'), f.attach);
    await advance('The retired pre-dispatch refusal cannot put its old attachment back', action('retiredRefusal'), f.refuse);
    assert.equal(f.inspect().draftSelection, JSON.stringify({id: 'synthetic-note', revision: 'fixture-v2'}));
  });
  await scenario('closed confirmed message restores only in its recorded owner and conversation', async (f, advance) => {
    await complete(f, advance);
    await advance('A closed transport receipt records and settles the exact bubble', [action('confirmRecorded'), action('finish')], f.accept);
    assert.equal(f.inspect().sendCalls, 1);
    const records = f.inspect().records;
    assert.equal(records.length, 2, 'Client and canonical message keys each hold the same exact attachment');
    assert.deepEqual(records[0], records[1]);
    assert.equal(records[0].transcriptAttachment.selection, JSON.stringify({id: 'synthetic-note', revision: 'fixture-v1'}));
    await change(f, advance, 'Owner');
    await reload(f, advance);
    await change(f, advance, 'Owner');
    await change(f, advance, 'Conversation');
    await reload(f, advance);
    await change(f, advance, 'Conversation');
    await reload(f, advance);
  });
  return traces;
}

export async function checkChatAttachments(extraSources = []) {
  const source = join(root, 'apps/app/src/prototype/agent-adapter.ts');
  const sources = [source, fileURLToPath(import.meta.url),
    join(root, 'test/support/strip-types.mjs'),
    join(root, 'specs/quint/refinement/application/index.mjs'),
    join(root, 'test/quint-application-refinement.test.mjs'), ...chatAttachmentComposerSources, ...extraSources];
  const driverHashes = captureInputs(sources);
  const text = readFileSync(source, 'utf8');
  const start = text.indexOf('function attachmentKey(');
  const end = text.indexOf('\nconst preDispatchRefusals', start);
  assert.ok(start >= 0 && end > start, 'actual attachment helper boundaries');
  const load = new Function('browserDocuments', stripTypeScriptTypes(text.slice(start, end), {mode: 'strip'}) +
    '\nreturn {saveAttachment,restoreAttachments};');
  const traces = [];
  for (const kind of ['transcript', 'image']) for (const change of ['owner', 'conversation']) {
    const stored = new Map();
    const port = {
      async read(key) { return stored.get(key) ?? null; },
      async edit(key, update) { const next = await update(stored.get(key) ?? null); stored.set(key, {raw: next.raw}); return next.result; },
    };
    let helpers = load(port), owner = 1, conversation = 1;
    const session = () => ({origin: 'https://alpha.invalid', ownerId: `owner-${owner}`, agentId: 'agent'});
    const message = {id: 'server-message', clientMessageId: 'client-message', from: 'user', text: 'Summarize this for me'};
    const attachment = kind === 'transcript'
      ? {transcriptAttachment: {title: 'Voice note', text: 'A saved transcript'}}
      : {cameraAttachment: {image: 'data:image/png;base64,AQID', title: 'Photo'}};
    const visible = async () => {
      const [restored] = await helpers.restoreAttachments([message], session(), `conversation-${conversation}`);
      return Boolean(restored.transcriptAttachment || restored.cameraAttachment);
    };
    const saved = () => qset([...stored.keys()].map(key => {
      const [, , subject, , thread] = JSON.parse(key);
      return Number(subject.slice('owner-'.length)) * 10 + Number(thread.slice('conversation-'.length));
    }));
    const trace = {name: `${kind}-${change}-reload`, expect: {'s.visible': await visible()}, steps: []};
    // This separate helper campaign receives an already recorded history row as input.
    await helpers.saveAttachment(session(), `conversation-${conversation}`, message.clientMessageId, attachment);
    trace.steps.push({action: [action('attach'), action('send'), action('store'), action('confirmRecorded')], expect: {'s.saved': saved()}});
    helpers = load(port);
    trace.steps.push({action: [action('finish'), action('reload')], expect: {'s.visible': await visible(), 's.saved': saved()}});
    if (change === 'owner') owner = 2; else conversation = 2;
    trace.steps.push({action: [action(change === 'owner' ? 'switchOwner' : 'switchConversation'), action('reload')], expect: {'s.visible': await visible(), 's.saved': saved()}});
    if (change === 'owner') owner = 1; else conversation = 1;
    trace.steps.push({action: [action(change === 'owner' ? 'switchOwner' : 'switchConversation'), action('reload')], expect: {'s.visible': await visible(), 's.saved': saved()}});
    // The server ID alone must not replace a distinct client message's attachment key.
    const [different] = await helpers.restoreAttachments([{...message, clientMessageId: 'other-message'}], session(), `conversation-${conversation}`);
    assert.equal(different.transcriptAttachment, undefined);
    assert.equal(different.cameraAttachment, undefined);
    traces.push(trace);
  }
  traces.push(...await composerTraces());
  return checkTraces({model: 'ChatAttachments', sources: [...new Set(sources)], driverHashes, traces, scope: 'bounded-component', assumptions: [
    'Actual attachment key, save, restore, composer send, transcript chip projection and subscription code execute over closed document, shell, draft-controller and transport ports.',
    'The source campaign bounds two owners and two conversations. Four helper traces cover synthetic image and transcript bytes, and the composer traces cover a transcript. The draft-controller port supplies text release, and the closed transport supplies the recorded message receipt.',
    'Queued React commits, unrestricted overlapping sends, physical browser storage, installed event delivery and image preview remain separate obligations.',
  ]});
}
