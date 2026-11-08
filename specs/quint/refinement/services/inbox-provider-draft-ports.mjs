import {createInboxFixture} from './inbox-coordinator-ports.mjs';

// The product coordinator executes unchanged. These are the external Gmail responses it receives.
export async function createProviderDraftFixture() {
  const fixture = await createInboxFixture();
  const provider = {
    draft: null,
    revision: 0,
    sourceHistory: 'history-1',
    sourceBytes: 1,
    prepared: new Map(),
    gates: {},
    reviewTransform: null,
  };
  const digest = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');
  const key = (grant, request) => `${grant}/${request}`;
  fixture.client.gmailPrepareOperation = (grant, request, proposal, signal) => fixture.observeTask(async () => {
    fixture.state.prepares++;
    fixture.events.push(['prepare', grant, request]);
    if (['draft-replace', 'draft-delete'].includes(proposal.kind) &&
        (!provider.draft || provider.draft.providerDigest !== proposal.expectedDigest)) throw Error('Provider draft changed');
    const files = await Promise.all((proposal.attachments || []).map(file => fixture.modules.reviewAttachment(file)));
    let review = {...structuredClone(proposal), from: 'owner-1@example.test', attachments: files.map(({text, ...metadata}) => metadata)};
    if (proposal.forwardAttachments) {
      const source = proposal.forwardAttachments;
      if (source.historyId !== provider.sourceHistory) throw Error('Selected message changed');
      review.forwardSource = {messageId: source.messageId, historyId: source.historyId};
      review.forwardedAttachments = source.partIds.map(partId => ({partId, name: `source-${partId}.txt`, mimeType: 'text/plain',
        size: 1, sha256: String(provider.sourceBytes).repeat(64)}));
    }
    const forwardBytes = proposal.forwardAttachments ? provider.sourceBytes : 0;
    fixture.events.push(['metadata', request, provider.sourceHistory, forwardBytes]);
    if (provider.reviewTransform) review = provider.reviewTransform(review);
    const reviewDigest = await digest(JSON.stringify(review));
    const receipt = {requestId: request, kind: proposal.kind, state: 'prepared', reviewDigest, providerResult: null, rejectionCode: null};
    provider.prepared.set(request, {proposal: structuredClone(proposal), forwardBytes, receipt});
    fixture.receipts.set(key(grant, request), receipt);
    if (provider.gates.prepare) await provider.gates.prepare({grant, request, proposal, signal});
    return {review, receipt};
  });
  fixture.client.gmailDraft = (grant, draftId, signal) => fixture.observeTask(async () => {
    if (!provider.draft || provider.draft.draftId !== draftId) throw Error('Provider draft missing');
    // This is the actual CloudProtocol.gmailDraft shape, including its readback-only messageId.
    const result = {draftId, messageId: 'provider-message', providerDigest: provider.draft.providerDigest};
    fixture.events.push(['draft-read', grant, draftId, result.providerDigest]);
    if (provider.gates.read) await provider.gates.read({grant, draftId, signal, result});
    return result;
  });
  fixture.client.gmailDispatchOperation = (grant, request, reviewDigest, proposal, signal) => fixture.observeTask(async () => {
    const prepared = provider.prepared.get(request);
    if (!prepared || prepared.receipt.reviewDigest !== reviewDigest ||
        JSON.stringify(prepared.proposal) !== JSON.stringify(proposal)) throw Error('Unexpected dispatch identity');
    fixture.state.dispatches++;
    fixture.events.push(['dispatch', grant, request]);
    if (provider.gates.dispatch) await provider.gates.dispatch({grant, request, proposal, signal});
    const rejected = fixture.state.outcome === 'rejected';
    let providerResult = null;
    if (!rejected) {
      provider.revision++;
      if (proposal.kind === 'draft-delete') {
        provider.draft = null;
        providerResult = {draftId: proposal.draftId};
      } else {
        provider.draft = {draftId: 'provider-1', providerDigest: String(provider.revision).repeat(64),
          bodyText: proposal.bodyText, forwardBytes: prepared.forwardBytes, parts: proposal.forwardAttachments?.partIds || []};
        providerResult = {draftId: provider.draft.draftId, providerDigest: provider.draft.providerDigest};
      }
    }
    const receipt = {requestId: request, kind: proposal.kind, state: rejected ? 'rejected' : 'succeeded',
      reviewDigest, providerResult, rejectionCode: rejected ? 'policy' : null};
    fixture.receipts.set(key(grant, request), receipt);
    if (fixture.state.outcome === 'lost') throw new TypeError('Failed to fetch');
    return receipt;
  });
  return Object.assign(fixture, {providerState: provider});
}
