import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';
import {stripTypeScriptTypes} from '../../../../test/support/strip-types.mjs';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
import {join} from 'node:path';

/** Storage-bound projection; live composer and native persistence remain separate checks. */
export async function checkChatAttachments(extraSources = []) {
  const source = join(root, 'apps/app/src/prototype/agent-adapter.ts');
  const sources = [source, fileURLToPath(import.meta.url),
    join(root, 'test/support/strip-types.mjs'),
    join(root, 'specs/quint/refinement/application/index.mjs'),
    join(root, 'test/quint-application-refinement.test.mjs'), ...extraSources];
  const driverHashes = captureInputs(sources);
  const text = readFileSync(source, 'utf8');
  const start = text.indexOf('function attachmentKey(');
  const end = text.indexOf('\nconst preDispatchRefusals', start);
  assert.ok(start >= 0 && end > start, 'actual attachment helper boundaries');
  const load = new Function('browserDocuments', stripTypeScriptTypes(text.slice(start, end), {mode: 'strip'}) +
    '\nreturn {saveAttachment,restoreAttachments};');
  const action = (name, ...args) => ({name, args});
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
    // A dispatched message is external input to these storage helpers, not a UI-send proof.
    await helpers.saveAttachment(session(), `conversation-${conversation}`, message.clientMessageId, attachment);
    trace.steps.push({action: [action('attach'), action('send'), action('store')], expect: {'s.saved': saved()}});
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
  return checkTraces({model: 'ChatAttachments', sources, driverHashes, traces, scope: 'bounded-component', assumptions: [
    'The actual save and restore helpers execute unchanged. A controlled document port retains the raw saved bytes across fresh helper instances; this is not browser restart or device-durability evidence.',
    'Four traces cover transcript and image attachments across two owners and two conversations, with a separate client-message identity negative control.',
    'Only saved attachment bindings and restored visibility are observed. Dispatch, draft placement, refusal recovery, image preview and the physical storage backend remain separate UI and integration obligations.',
  ]});
}
