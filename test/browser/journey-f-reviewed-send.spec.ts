import {returnToApps} from './app-navigation';
import {retainedMailReview} from './helpers/retained-mail-review';
import {retainedMailDraft} from './helpers/retained-mail-draft';
import {refreshInbox} from './helpers/mail-actions';
import {localDraftRow} from './inbox-draft-navigation';
// Journey F, reviewed provider operations: what the review shows is exactly what is dispatched.
//
// Evidence boundary: source/test evidence for the browser renderer only. Not APK, emulator, AOSP
// image, physical-device or real-integration evidence. No real account, OAuth grant, Gmail request
// or mail delivery is involved.
//
// Tests drive the current composer and confirmations, and inspect retained review metadata against a SYNTHETIC managed mail
// provider installed at the Cloud client boundary (connectionController.getCloudClient and the
// secure slot store), the same boundary journey-f-email-notifications.spec.ts controls. The
// provider keeps its "server" state in localStorage under a test-owned key so it survives reloads
// like a remote provider would, and it records the exact JSON text of every prepare and dispatch.
//
// Covered (audit step IDs):
//  F-5   Cc, Bcc and an attachment appear in the send review, and the dispatched request equals
//        the reviewed one byte for byte.
//  F-10  An email edited after its review gets a new review under a new request ID; the first
//        review's digest is never dispatched. A saved older version of a sent email is kept, labelled
//        'Earlier version of a sent email' and reopened only after a confirmation.
//  F-12  A mailbox that changes between pages never shows a message twice; a refused cursor says
//        so and reloads from the start only when asked.
//  F-13  Trash and its undo are reviewed operations; an unknown trash outcome is handled like an
//        unknown send (no automatic retry, no second confirmation, no second operation).
import {createHash} from 'node:crypto';
import {test, expect, type Page} from '@playwright/test';

const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
async function messageAction(page:Page,name:string){
  await page.locator('summary[aria-label="Message actions"]').click();
  await button(page,name).click();
}
const KEY = 'journey-f-review-provider';
type Options = {inbox?: string[]; pageSize?: number; strictCursors?: boolean; forward?: boolean; accounts?: number; deferPaging?:boolean};

/** Synthetic managed provider. Re-installed after every load; its state lives in localStorage. */
async function installProvider(page: Page, options: Options = {}) {
  await page.evaluate(async ([KEY, options]) => {
    const {connectionController: c} = await import('/src/runtime/connection-ui.tsx');
    const {inboxLocalStore: s} = await import('/src/runtime/inbox-local-store.ts');
    const {CloudProtocolError} = await import('/src/runtime/cloud-protocol.ts');
    const {reviewMailAttachment} = await import('/src/runtime/inbox-attachment.ts');
    const initial = {slots: {}, receipts: {}, effects: {}, prepared: [], dispatched: [], sent: [], trashed: [], searches: [],
      inbox: options.inbox || ['m1', 'm2'], revision: 1, history: {}, loseNextReply: false, unsure: false, slowPrepare: 0};
    const load = () => JSON.parse(localStorage.getItem(KEY) || JSON.stringify(initial));
    const save = (value: unknown) => localStorage.setItem(KEY, JSON.stringify(value));
    if (!localStorage.getItem(KEY)) save(initial);
    s.read = async (key: string) => structuredClone(load().slots[key] ?? null);
    s.compareExchange = async (key: string, prior: unknown, next: unknown) => {
      const value = load();
      if (JSON.stringify(value.slots[key] ?? null) !== JSON.stringify(prior)) return {status: 'conflict'};
      if (next === null) delete value.slots[key]; else value.slots[key] = next;
      save(value); return {status: 'saved'};
    };
    const mail = (id: string, extra: Record<string, unknown> = {}) => ({id, threadId: 'thread-' + id, subject: 'Subject ' + id, from: 'Sender ' + id, fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], cc: [], replyTo: null, snippet: 'Preview ' + id, receivedAt: '2026-10-06T12:00:00Z', unread: false, ...extra});
    const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
    const size = options.pageSize || 25;
    const client = {
      gmailAccounts: async () => [{connectionId: 'fixture-grant', label: 'Fixture mailbox', configured: true, connected: true, reason: 'connected', grantedCapabilities: ['google.gmail.triage','google.gmail.send','google.gmail.mailbox']},
        ...(options.accounts === 2 ? [{connectionId: 'second-grant', label: 'Second mailbox', configured: true, connected: true, reason: 'connected', grantedCapabilities: ['google.gmail.triage','google.gmail.send','google.gmail.mailbox']}] : [])],
      gmailInboxCapabilities: async () => ({version: 1, from: 'owner@example.invalid', threads: true, send: true, providerDrafts: false, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, readState: false, draftsList: false, forwardAttachments: !!options.forward, opaqueAttachments: false, searchTrash: true, attachmentPolicy: {maximumOutgoing: 1, maximumBytes: 5242880, maximumTotalBytes: 5242880}}),
      // Cursors are "revision:offset". A lenient provider keeps serving an old cursor against the
      // current mailbox (rows shift); a strict one refuses a cursor cut from an older revision.
      gmailSearch: async (_grant: string, query: string, _signal: AbortSignal, _max: number, pageToken?: string) => {
        if(pageToken&&options.deferPaging&&!(window as any).mailPageRaceReleased){await new Promise<void>((resolve,reject)=>{(window as any).releaseMailPage=()=>{(window as any).mailPageRaceReleased=true;resolve();};_signal.addEventListener('abort',()=>reject(_signal.reason),{once:true});});_signal.throwIfAborted();}
        const value = load(); value.searches.push([query, pageToken ?? null]); save(value);
        const ids: string[] = query === 'in:inbox' ? value.inbox : query === 'in:trash' ? value.trashed : [];
        const [cut, start] = pageToken ? pageToken.split(':').map(Number) : [value.revision, 0];
        if (pageToken && options.strictCursors && cut !== value.revision) throw new CloudProtocolError('http', 400, {error: 'Invalid Gmail page token.'});
        return {messages: ids.slice(start, start + size).map(id => mail(id)), syncedAt: '2026-10-08T12:00:00Z', nextPageToken: start + size < ids.length ? `${value.revision}:${start + size}` : null};
      },
      gmailRead: async (_grant: string, id: string) => ({message: mail(id), bodyText: 'Body of ' + id, links: [],historyId:load().history[id]||'h-'+id,attachments:options.forward?[{partId:'part-1',name:'original-plan.pdf',mimeType:'application/pdf',size:4321,supported:true}]:[]}),
      gmailThread: async (_grant: string, threadId: string) => {
        const id = threadId.replace('thread-', ''), value = load();
        return {messages: [{message: mail(id), bodyText: 'Body of ' + id, historyId: value.history[id] || 'h-' + id, attachments: options.forward ? [{partId: 'part-1', name: 'original-plan.pdf', mimeType: 'application/pdf', size: 4321, supported: true}] : []}], total: 1, offset: 0, historyId: 'thread-history', nextOffset: null};
      },
      // Prepare is idempotent per request ID and records the exact proposal text it was given.
      gmailPrepareOperation: async (grant: string, requestId: string, proposal: any) => {
        const slow = load().slowPrepare; if (slow) await new Promise(resolve => setTimeout(resolve, slow));
        const attachments = await Promise.all((proposal.attachments || []).map(async (file: any) => { const {text: _text, ...metadata} = await reviewMailAttachment(file) as any; return metadata; }));
        const review = proposal.kind === 'send'
          ? {kind: proposal.kind, mode: proposal.mode, from: 'owner@example.invalid', to: proposal.to, cc: proposal.cc, bcc: proposal.bcc, subject: proposal.subject, bodyText: proposal.bodyText, attachments,
            ...(proposal.forwardAttachments ? {forwardSource: {messageId: proposal.forwardAttachments.messageId, historyId: proposal.forwardAttachments.historyId}, forwardedAttachments: proposal.forwardAttachments.partIds.map((partId: string) => ({partId, name: 'original-plan.pdf', mimeType: 'application/pdf', size: 4321, sha256: 'ab'.repeat(32)}))} : {})}
          : {kind: proposal.kind, messageId: proposal.messageId, expectedHistoryId: proposal.expectedHistoryId, from: 'owner@example.invalid'};
        const receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null};
        const value = load(); value.prepared.push({grant, requestId, digest: receipt.reviewDigest, proposal: JSON.stringify(proposal)});
        value.receipts[requestId] = receipt; save(value); return {receipt, review};
      },
      // Each request ID takes effect once. With loseNextReply the change IS made and recorded but
      // the reply is lost in transit (the client sees a network failure).
      gmailDispatchOperation: async (grant: string, requestId: string, reviewDigest: string, proposal: any) => {
        const value = load(); value.dispatched.push({grant, requestId, digest: reviewDigest, proposal: JSON.stringify(proposal)});
        if (value.receipts[requestId]?.reviewDigest !== reviewDigest) { save(value); throw new CloudProtocolError('http', 409, {error: 'Review digest changed'}); }
        if (!value.effects[requestId]) {
          value.effects[requestId] = true; value.revision++;
          let providerResult: Record<string, unknown>;
          if (proposal.kind === 'send') { const id = 'sent-' + (value.sent.length + 1); value.sent.push(proposal.subject); providerResult = {messageId: id, threadId: 'thread-' + id}; }
          else {
            const id = proposal.messageId, next = 'h' + (Number((value.history[id] || 'h1-').slice(1).split('-')[0]) + 1) + '-' + id;
            if (proposal.kind === 'trash') { value.inbox = value.inbox.filter((m: string) => m !== id); value.trashed.push(id); }
            else { value.trashed = value.trashed.filter((m: string) => m !== id); value.inbox.unshift(id); }
            value.history[id] = next; providerResult = {messageId: id, labelIds: proposal.kind === 'trash' ? ['TRASH'] : ['INBOX'], historyId: next};
          }
          value.receipts[requestId] = {requestId, kind: proposal.kind, state: 'succeeded', reviewDigest, providerResult, rejectionCode: null};
        }
        const lost = value.loseNextReply; value.loseNextReply = false; save(value);
        if (lost) throw new TypeError('Failed to fetch');
        return value.receipts[requestId];
      },
      gmailOperation: async (_grant: string, requestId: string) => { const value = load(), receipt = value.receipts[requestId]; return value.unsure ? {...receipt, state: 'outcome-unknown', providerResult: null} : receipt; },
    };
    c.getCloudClient = () => ({client, sessionId: 'fixture-session', credentialId: 'fixture'} as any);
    const snapshot = {...c.getSnapshot(), cloudAccount: {environment: 'production', userId: 'fixture-owner', sessionId: 'fixture-session', credentialId: 'fixture'}} as any;
    c.getSnapshot = () => snapshot;
  }, [KEY, options] as const);
}
type Recorded = {grant: string; requestId: string; digest: string; proposal: string};
const provider = (page: Page) => page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!), KEY) as Promise<{prepared: Recorded[]; dispatched: Recorded[]; sent: string[]; trashed: string[]; inbox: string[]; searches: [string, string | null][]; receipts: Record<string, {state: string; kind: string}>}>;
const setProvider = (page: Page, patch: Record<string, unknown>) => page.evaluate(([KEY, patch]) => { const v = JSON.parse(localStorage.getItem(KEY as string)!); localStorage.setItem(KEY as string, JSON.stringify({...v, ...(patch as object)})); }, [KEY, patch] as const);
async function openInbox(page: Page, options: Options = {}, reload = false) {
  if (reload) await page.reload(); else await page.goto('/');
  await installProvider(page, options);
  await button(page, 'Inbox').click();
  // A saved operation reopens its review over the list, so either surface proves the mailbox loaded.
  await expect(page.getByLabel('Mail options',{exact:true}).or(page.getByRole('dialog', {name:/^(Review mail operation|Send this email\?)$/})).filter({visible:true}).first()).toBeVisible();
}
async function compose(page: Page, subject: string, body: string) {
  await button(page, 'Compose').click();
  await page.getByRole('textbox', {name: 'To', exact: true}).fill('friend@example.invalid');
  await page.getByRole('textbox', {name: 'To', exact: true}).press('Enter');
  await expect(button(page, 'Remove friend@example.invalid')).toBeVisible();
  await page.getByRole('textbox', {name: 'Subject', exact: true}).fill(subject);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill(body);
}
const rows = (page: Page) => page.getByRole('button', {name: /^Sender m\d+, Subject m\d+$/}).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')!.replace(/^Sender (m\d+),.*/, '$1')));
const notOpenStatus = 'This review is for an email that is not open in the composer, so it cannot be confirmed. Nothing was sent. Open that email and choose Send to review it again, or cancel this review.';
const editedStatus = 'This email was edited after this review, so the review was discarded. Nothing was sent. Review the current email before sending.';

test.beforeEach(async ({page}) => {
  // Nothing in this file may leave the machine.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/, route => route.abort());
  // A signed-in fixture account models an installation that already finished access setup; with
  // setup pending the startup walkthrough would cover Inbox once the swapped snapshot re-renders.
  await page.addInitScript(() => localStorage.setItem('alpha:startup-permission-walkthrough:v1', JSON.stringify({version: 1, status: 'completed', step: 4})));
});

test('F-5: send retains the exact headers, body and attachment across reload and dispatches the confirmed request byte for byte', async ({page}) => {
  test.setTimeout(180_000);
  const bytes = Buffer.from('Harbour timetable\r\nCafé line with exact bytes\n');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await openInbox(page);
  await compose(page, 'Timetable for Friday', 'Line one of the reviewed body.\nLine two.');
  await page.getByRole('button', {name: 'Cc and Bcc', exact: true}).click();
  await page.getByRole('textbox', {name: 'Cc', exact: true}).fill('carol@example.invalid, dave@example.invalid');
  await page.getByRole('textbox', {name: 'Bcc', exact: true}).fill('audit@example.invalid');
  const chooser = page.waitForEvent('filechooser');
  await button(page, 'Attach file').click();
  await (await chooser).setFiles({name: 'timetable.txt', mimeType: 'text/plain', buffer: bytes});
  await expect(button(page, 'Remove timetable.txt')).toBeVisible();
  expect(await provider(page)).toMatchObject({prepared: [], dispatched: [], sent: []});

  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect(review.getByRole('heading', {name:'Send this email?',exact:true})).toBeVisible();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Review every field before confirming. No mail has been sent.');
  const reviewed = async () => {
    expect(await retainedMailReview(page)).toMatchObject({from:'owner@example.invalid',to:'friend@example.invalid',cc:'carol@example.invalid, dave@example.invalid',bcc:'audit@example.invalid',subject:'Timetable for Friday',target:''});
    expect((await retainedMailReview(page)).attachments).toBe(`timetable.txt · text/plain · ${bytes.length} bytes · SHA-256 ${sha256}`);
    await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('Line one of the reviewed body.\nLine two.');
  };
  await reviewed();
  expect(await provider(page)).toMatchObject({dispatched: [], sent: []});
  expect((await provider(page)).prepared).toHaveLength(1);

  // Reload in the middle of the review: the same saved review is shown again and nothing new is
  // prepared. It cannot be sent until the email it was made for is back in the composer.
  await openInbox(page, {}, true);
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe(notOpenStatus);
  await reviewed();
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  await (await localDraftRow(page)).click();
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Saved mail operation. Check its exact review and receipt before continuing.');
  await reviewed();
  expect((await provider(page)).prepared).toHaveLength(1);

  // A double press on Send is one dispatch.
  await review.getByRole('button', {name: 'Yes', exact: true}).dblclick();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  const state = await provider(page);
  expect(state.prepared).toHaveLength(1);
  expect(state.dispatched).toHaveLength(1);
  expect(state.sent).toEqual(['Timetable for Friday']);
  // Byte for byte: the dispatched request text is the prepared one, under the reviewed digest.
  expect(state.dispatched[0]).toEqual(state.prepared[0]);
  // And the prepared request is what the review showed: no recipient, text or byte beyond it.
  expect(JSON.parse(state.prepared[0].proposal)).toEqual({
    kind: 'send', mode: 'compose', to: ['friend@example.invalid'], cc: ['carol@example.invalid', 'dave@example.invalid'], bcc: ['audit@example.invalid'],
    subject: 'Timetable for Friday', bodyText: 'Line one of the reviewed body.\nLine two.',
    attachments: [expect.objectContaining({name: 'timetable.txt', mimeType: 'text/plain', dataBase64: bytes.toString('base64')})],
  });
});

test('F-5: send retains empty Cc, Bcc and attachment metadata', async ({page}) => {
  test.setTimeout(120_000);
  await openInbox(page);
  await compose(page, 'Plain', 'Only a body');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  expect(await retainedMailReview(page)).toMatchObject({from:'owner@example.invalid',to:'friend@example.invalid',cc:'',bcc:''});
  expect((await retainedMailReview(page)).attachments).toBe('No attachments.');
  expect(JSON.parse((await provider(page)).prepared[0].proposal)).toMatchObject({cc: [], bcc: [], attachments: []});
});

test('F-5: a forward lists the original attachments it will send, and removing one changes the reviewed request', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page, {forward: true});
  await button(page, 'Sender m1, Subject m1').click();
  await expect(page.getByRole('region', {name: 'Email message'})).toContainText('Body of m1');
  await messageAction(page, 'Forward');
  await expect(button(page, 'Remove original-plan.pdf (original)')).toBeVisible();
  await page.getByRole('textbox', {name: 'To', exact: true}).fill('friend@example.invalid');
  await page.getByRole('textbox', {name: 'To', exact: true}).press('Enter');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  // The forwarded original is part of what will be sent, so the review names it with its size.
  expect((await retainedMailReview(page)).attachments).toBe(`original-plan.pdf (forwarded original) · 4321 bytes · SHA-256 ${'ab'.repeat(32)}`);
  expect(JSON.parse((await provider(page)).prepared[0].proposal)).toMatchObject({mode: 'forward', subject: 'Fwd: Subject m1', attachments: [], forwardAttachments: {messageId: 'm1', historyId: 'h-m1', partIds: ['part-1']}});
  // Removing the original after that review is an edit: the review is discarded and the next one
  // says the email has no attachments.
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  await button(page, 'Remove original-plan.pdf (original)').click();
  expect((await provider(page)).dispatched).toHaveLength(0);
  await button(page, 'Send email').click();
  expect((await retainedMailReview(page)).attachments).toBe('No attachments.');
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  const state = await provider(page);
  expect(state.dispatched).toEqual([state.prepared[1]]);
  expect(JSON.parse(state.dispatched[0].proposal)).not.toHaveProperty('forwardAttachments');
});

test('F-10: an email edited after its review is reviewed again under a new request, and the first digest is never dispatched', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await compose(page, 'Edited after review', 'First body');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('First body');
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  expect((await provider(page)).prepared).toHaveLength(1);

  // Unchanged email, Send pressed again: the same review, no second prepare.
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  await expect(review).toHaveCount(0);
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('First body');
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  expect((await provider(page)).prepared).toHaveLength(1);

  // Close the review without cancelling it, then edit the body. The saved review is now stale.
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Second body');
  expect((await provider(page)).dispatched).toHaveLength(0);
  // The stale review is gone: its chip is not offered, so its Send button cannot be reached.
  await returnToApps(page);await button(page,'Inbox').click();
  await expect(button(page, 'Mail review / receipt')).toHaveCount(0);
  expect((await provider(page)).dispatched).toEqual([]);

  await (await localDraftRow(page)).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Second body');
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('Second body');
  expect((await retainedMailReview(page)).body).not.toBe('First body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Review every field before confirming. No mail has been sent.');
  let state = await provider(page);
  expect(state.prepared).toHaveLength(2);
  expect(state.prepared[1].requestId).not.toBe(state.prepared[0].requestId);
  expect(state.prepared[1].digest).not.toBe(state.prepared[0].digest);
  expect(JSON.parse(state.prepared[1].proposal).bodyText).toBe('Second body');

  // Reload with the second review pending. The saved review reopens, but it cannot be sent while
  // its email is not open in the composer; with the unchanged email resumed it can, and only the
  // second request is ever dispatched.
  await openInbox(page, {}, true);
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('Second body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe(notOpenStatus);
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  await (await localDraftRow(page)).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Second body');
  await button(page, 'Send email').click();
  expect((await provider(page)).prepared).toHaveLength(2);
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  state = await provider(page);
  expect(state.dispatched).toEqual([state.prepared[1]]);
  expect(state.dispatched.map(d => d.digest)).not.toContain(state.prepared[0].digest);
  expect(state.sent).toEqual(['Edited after review']);
});

test('F-10: a saved older version of a sent email is kept, labelled as such, and reopened only after a confirmation', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await compose(page, 'Versioned plan', 'Saved first text');
  await retainedMailDraft(page,'save');
  await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/^Saved locally/);
  // Edited after saving and sent without saving again: the saved copy is an earlier version.
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Sent final text');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  expect((await retainedMailReview(page)).draftNote).toContain('An earlier saved version of this email is still on this device.');
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  // Never removed on its own, and offered only under its label; Restore local draft is not shown.
  await expect(await localDraftRow(page)).toContainText('Earlier version of a sent email');
  await expect(button(page, 'Restore local draft')).toHaveCount(0);
  // After a reload the receipt reopens; closing it leaves the label, which is kept with the saved copy.
  await openInbox(page, {}, true);
  await retainedMailReview(page,'clear');
  await expect(review).toHaveCount(0);
  await expect(await localDraftRow(page)).toContainText('Earlier version of a sent email');
  // Declining the confirmation leaves it closed; accepting opens it, still unsent.
  const prompts: string[] = [];
  page.once('dialog', dialog => { prompts.push(dialog.message()); void dialog.dismiss(); });
  await (await localDraftRow(page)).click();
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toContain('earlier version of an email that was already sent');
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveCount(0);
  page.once('dialog', dialog => { prompts.push(dialog.message()); void dialog.accept(); });
  await (await localDraftRow(page)).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Saved first text');
  await expect.poll(()=>retainedMailDraft(page,'status')).toMatch(/Earlier version of a sent email\. Sending it creates another message/);
  const state = await provider(page);
  expect(state.sent).toEqual(['Versioned plan']);
  expect(state.dispatched).toHaveLength(1);
  expect(JSON.parse(state.dispatched[0].proposal).bodyText).toBe('Sent final text');
});

test('F-10: an edit made while the review is still being prepared cannot be sent under that review', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await compose(page, 'Edited during prepare', 'Body sent for review');
  await setProvider(page, {slowPrepare: 2500});
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await retainedMailReview(page,'close');
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Body changed while the review was loading');
  // The delayed provider response settles before a fresh review can start.
  await expect.poll(async()=>(await provider(page)).prepared.length,{timeout:15_000}).toBe(1);
  await expect.poll(async()=>(await retainedMailReview(page)).busy).toBe(false);
  await expect(review).toHaveCount(0,{timeout:15_000});
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  await setProvider(page, {slowPrepare: 0});
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('Body changed while the review was loading');
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  const state = await provider(page);
  expect(state.prepared.map(p => JSON.parse(p.proposal).bodyText)).toEqual(['Body sent for review', 'Body changed while the review was loading']);
  expect(state.dispatched).toEqual([state.prepared[1]]);
});

test('F-10: a reload between an edit and the discard of its review never lets the earlier text be sent', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await compose(page, 'Edited then reloaded', 'First body');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  // The provider stops answering the store, so the discard that follows the edit cannot complete:
  // the first review is still saved when the page reloads, and the edit is in the retained copy.
  await page.evaluate(async () => {
    const {inboxLocalStore: s} = await import('/src/runtime/inbox-local-store.ts');
    s.compareExchange = () => new Promise(() => {});
  });
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Second body');
  // Wait until the retained copy of the edit holds the second text before reloading.
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const open = indexedDB.open('alpha.browser.documents.v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, store = db.transaction('documents').objectStore('documents'), keys = store.getAllKeys(), values = store.getAll();
      values.onsuccess = () => { db.close(); resolve(keys.result.some((key, index) => String(key).includes('inbox-drafts:v1:unsaved:') && JSON.stringify(values.result[index]).includes('Second body'))); };
      values.onerror = () => { db.close(); reject(values.error); };
    };
  }))).toBe(true);
  expect(Object.values((await page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)!).slots, KEY)) as Record<string, {phase?: string}>).map(slot => slot.phase)).toEqual(['review']);

  await openInbox(page, {}, true);
  // The saved review of the first text reopens. It says why it cannot be sent and offers no Send.
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('First body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe(notOpenStatus);
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  expect((await retainedMailReview(page)).canClear).toBe(true);
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  // Resuming the edited email discards that review; the edited text gets its own.
  await (await localDraftRow(page)).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Second body');
  expect((await provider(page)).dispatched).toHaveLength(0);
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('Second body');
  expect((await retainedMailReview(page)).body).not.toBe('First body');
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  const state = await provider(page);
  expect(state.prepared.map(p => JSON.parse(p.proposal).bodyText)).toEqual(['First body', 'Second body']);
  expect(state.dispatched).toEqual([state.prepared[1]]);
  expect(state.sent).toEqual(['Edited then reloaded']);
});

test('F-10: a review made under one From account cannot be sent after the email moved to another account', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page, {accounts: 2});
  await compose(page, 'Moved between accounts', 'One body');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Send this email?'});
  await expect(review.getByRole('button', {name: 'Yes', exact: true})).toBeVisible();
  if(await review.isVisible())await review.getByRole('button', {name: 'No', exact: true}).click();
  // The From switcher moves the email to the second account, where it is reviewed and sent once.
  await expect(button(page, 'From account')).toHaveText('From Fixture mailbox');
  await button(page, 'From account').click();
  await expect(button(page, 'From account')).toHaveText('From Second mailbox');
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('One body');
  await button(page, 'Send email').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('One body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Review every field before confirming. No mail has been sent.');
  await review.getByRole('button', {name: 'Yes', exact: true}).click();
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe('Provider confirmed this operation.');
  let state = await provider(page);
  expect(state.prepared.map(p => p.grant)).toEqual(['fixture-grant', 'second-grant']);
  expect(state.dispatched).toEqual([state.prepared[1]]);
  await retainedMailReview(page,'clear');

  // Back on the first account its saved review of the same email reappears. It offers no Send.
  await button(page, 'Fixture mailbox').click();
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('One body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe(notOpenStatus);
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  // The same holds after a reload on that account.
  await openInbox(page, {accounts: 2}, true);
  await expect.poll(async()=>(await retainedMailReview(page)).body).toBe('One body');
  await expect.poll(async()=>(await retainedMailReview(page)).status).toBe(notOpenStatus);
  expect((await retainedMailReview(page)).canConfirm).toBe(false);
  await retainedMailReview(page,'clear');
  await expect(review).toHaveCount(0);
  await expect(button(page, 'Mail review / receipt')).toHaveCount(0);
  state = await provider(page);
  expect(state.dispatched).toHaveLength(1);
  expect(state.sent).toEqual(['Moved between accounts']);
});

test('F-13: Trash and its undo are reviewed operations and the restored message returns to the list', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await button(page, 'Sender m1, Subject m1').click();
  await expect(page.getByRole('region', {name: 'Email message'})).toContainText('Body of m1');
  await messageAction(page, 'Move to Trash');
  const review = page.getByRole('dialog', {name: 'Review mail operation'});
  await expect(review.getByRole('heading', {name: 'Move message to Trash', exact: true})).toBeVisible();
  await expect(review.getByRole('status')).toHaveText('Review this change before confirming. Nothing has been changed.');
  await expect(review).toContainText('Selected message/draft: m1');
  let state = await provider(page);
  expect(state.prepared.map(p => JSON.parse(p.proposal))).toEqual([{kind: 'trash', messageId: 'm1', expectedHistoryId: 'h-m1'}]);
  expect(state).toMatchObject({dispatched: [], trashed: [], inbox: ['m1', 'm2']});

  await review.getByRole('button', {name: 'Confirm this change', exact: true}).dblclick();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  state = await provider(page);
  expect(state.dispatched).toEqual(state.prepared);
  expect(state).toMatchObject({trashed: ['m1'], inbox: ['m2']});

  // The second tap of that double press did not land on the Undo control that replaced Confirm.
  await expect(review.getByRole('heading', {name: 'Move message to Trash', exact: true})).toBeVisible();
  expect(state.prepared).toHaveLength(1);
  await page.waitForTimeout(800); // the double-tap guard after an operation settles
  // Undo is a new reviewed operation bound to the message as Trash left it; nothing runs before Confirm.
  await review.getByRole('button', {name: 'Review undo mailbox change', exact: true}).click();
  await expect(review.getByRole('heading', {name: 'Restore from Trash', exact: true})).toBeVisible();
  await expect(review.getByRole('status')).toHaveText('Review this change before confirming. Nothing has been changed.');
  state = await provider(page);
  expect(JSON.parse(state.prepared[1].proposal)).toEqual({kind: 'untrash', messageId: 'm1', expectedHistoryId: 'h2-m1'});
  expect(state.dispatched).toHaveLength(1);
  expect(state.trashed).toEqual(['m1']);
  await page.waitForTimeout(800);
  await review.getByRole('button', {name: 'Confirm this change', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  state = await provider(page);
  expect(state.dispatched).toEqual(state.prepared);
  expect(state).toMatchObject({trashed: [], inbox: ['m1', 'm2']});
  // A restore is not itself offered for undo (that would be a second trash without a fresh look).
  await expect(review.getByRole('button', {name: 'Review undo mailbox change', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Close receipt', exact: true}).click();
  await expect(review).toHaveCount(0);
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2']);
});

test('F-13: a lost Trash reply is an unknown outcome, handled like an unknown send', async ({page}) => {
  test.setTimeout(180_000);
  await openInbox(page);
  await button(page, 'Sender m2, Subject m2').click();
  await messageAction(page, 'Move to Trash');
  const review = page.getByRole('dialog', {name: 'Review mail operation'});
  await expect(review.getByRole('button', {name: 'Confirm this change', exact: true})).toBeVisible();
  await setProvider(page, {loseNextReply: true, unsure: true});
  await review.getByRole('button', {name: 'Confirm this change', exact: true}).click();
  await expect(review.getByRole('status')).toContainText('Gmail may not have received this change');
  await expect(review.getByRole('status')).toContainText('check the saved receipt before trying again');
  await expect(review.getByRole('button', {name: 'Confirm this change', exact: true})).toHaveCount(0);
  await expect(review.getByRole('button', {name: 'Close receipt', exact: true})).toHaveCount(0);
  await expect(review.getByRole('button', {name: 'Cancel unsent review', exact: true})).toHaveCount(0);
  await expect(review.getByRole('button', {name: 'Review undo mailbox change', exact: true})).toHaveCount(0);
  expect((await provider(page)).dispatched).toHaveLength(1);
  // Retry only reads the receipt back.
  await review.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('The outcome of this change is unknown. Check the saved receipt; do not repeat the change.');
  expect((await provider(page)).dispatched).toHaveLength(1);

  // Reload while unknown: nothing is dispatched, nothing can be confirmed or discarded, and no
  // second operation can start.
  await openInbox(page, {}, true);
  await expect(review.getByRole('status')).toHaveText('Saved mail operation. Check its exact review and receipt before continuing.');
  await expect(review.getByRole('button', {name: 'Confirm this change', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('The outcome of this change is unknown. Check the saved receipt; do not repeat the change.');
  await expect(review.getByRole('button', {name: 'Close receipt', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Close mail review', exact: true}).click();
  await button(page, 'Sender m1, Subject m1').click();
  await messageAction(page, 'Move to Trash');
  await expect(review.getByRole('status')).toHaveText('Review the saved operation before starting another.');
  await expect(review).toContainText('Selected message/draft: m2');
  await expect(review.getByRole('button', {name: 'Confirm this change', exact: true})).toHaveCount(0);
  let state = await provider(page);
  expect(state.prepared).toHaveLength(1);
  expect(state.dispatched).toHaveLength(1);

  // The provider later resolves the receipt; an explicit check reconciles to exactly one change.
  await setProvider(page, {unsure: false});
  await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  await expect(review.getByRole('button', {name: 'Review undo mailbox change', exact: true})).toBeVisible();
  state = await provider(page);
  expect(state.dispatched).toEqual(state.prepared);
  expect(state).toMatchObject({trashed: ['m2'], inbox: ['m1']});
});

const mailboxChanged = 'Newer mail arrived while this list was loading and is not shown yet. Load newer mail to read the list again.';
test('F-12: new mail between pages never shows a message twice, and the list says it is no longer the whole mailbox', async ({page}) => {
  test.setTimeout(120_000);
  await openInbox(page, {inbox: ['m1', 'm2', 'm3', 'm4', 'm5'], pageSize: 2,deferPaging:true});
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2']);
  await page.waitForFunction(()=>!!(window as any).releaseMailPage);
  // A message arrives after page one was read. The provider still serves the old cursor, so its
  // second page starts one row early and repeats m2.
  await setProvider(page, {inbox: ['m9', 'm1', 'm2', 'm3', 'm4', 'm5'], revision: 2});await page.evaluate(()=>{(window as any).releaseMailPage();(window as any).releaseMailPage=null;});
  await button(page, 'Load more').click();
  // The repeat is dropped, every message that was in the mailbox is still listed once, and the
  // list states that newer mail is missing from it and how to load it.
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2', 'm3']);
  await expect(page.getByText(mailboxChanged, {exact: true}).first()).toBeVisible();
  // Dismiss the readable notice through its real control. A later new notice must still fail
  // the absence assertion below; the newer-mail control stays until the list is read again.
  await page.locator('[data-alpha-toast]').filter({hasText:mailboxChanged}).click();
  await expect(button(page, 'Load newer mail')).toBeVisible();
  await button(page, 'Load more').click();
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  await expect(button(page, 'Load more')).toHaveCount(0);
  await expect(button(page, 'Load newer mail')).toBeVisible();
  // It loads the mailbox as it is now, newest first, with nothing repeated or left out.
  await button(page, 'Load newer mail').click();
  await expect.poll(() => rows(page)).toEqual(['m9', 'm1']);
  await expect(button(page, 'Load newer mail')).toHaveCount(0);
  await button(page, 'Load more').click();
  await button(page, 'Load more').click();
  await expect.poll(() => rows(page)).toEqual(['m9', 'm1', 'm2', 'm3', 'm4', 'm5']);
  await expect(page.getByText(/Newer mail arrived/)).toHaveCount(0);
  expect((await provider(page)).searches).toEqual([['in:inbox', null], ['in:inbox', '1:2'], ['in:inbox', '2:4'], ['in:inbox', null], ['in:inbox', '2:2'], ['in:inbox', '2:4']]);
});

test('F-12: a message the provider lists twice in one page is shown once', async ({page}) => {
  await openInbox(page, {inbox: ['m1', 'm1', 'm2', 'm3', 'm3'], pageSize: 3});
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2']);
  await button(page, 'Load more').click();
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2', 'm3']);
  // Nothing moved between the pages, so the list does not claim that newer mail is missing.
  await expect(button(page, 'Load newer mail')).toHaveCount(0);
});

test('F-12: a cursor the provider refuses after the mailbox changed keeps the loaded page and says how to reload', async ({page}) => {
  test.setTimeout(120_000);
  await openInbox(page, {inbox: ['m1', 'm2', 'm3', 'm4'], pageSize: 2, strictCursors: true,deferPaging:true});
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2']);
  await page.waitForFunction(()=>!!(window as any).releaseMailPage);await setProvider(page, {inbox: ['m1', 'm3', 'm4'], revision: 2});await page.evaluate(()=>(window as any).releaseMailPage());
  await button(page, 'Load more').click();
  await expect(page.getByText('Invalid Gmail page token. The messages already shown were kept. Retry reloads the list from the start.', {exact: true}).first()).toBeVisible();
  // The loaded page stays (it is not silently mixed with a page from the new mailbox) and the
  // refused cursor is not offered again.
  expect(await rows(page)).toEqual(['m1', 'm2']);
  await expect(button(page, 'Load more')).toHaveCount(0);
  expect((await provider(page)).searches).toEqual([['in:inbox', null], ['in:inbox', '1:2']]);
  await refreshInbox(page);
  await expect.poll(() => rows(page)).toEqual(['m1', 'm3']);
  await button(page, 'Load more').click();
  await expect.poll(() => rows(page)).toEqual(['m1', 'm3', 'm4']);
  expect((await provider(page)).searches.slice(2)).toEqual([['in:inbox', null], ['in:inbox', '2:2']]);
});

test('F-12: a message removed between pages is never duplicated, and Refresh shows the exact mailbox', async ({page}) => {
  // Recorded limit: the search contract carries no mailbox revision, so when a row is REMOVED
  // between pages a provider that keeps serving the old cursor skips one message and the
  // renderer cannot tell. This asserts what does hold.
  test.setTimeout(120_000);
  await openInbox(page, {inbox: ['m1', 'm2', 'm3', 'm4', 'm5'], pageSize: 2});
  await expect.poll(() => rows(page)).toEqual(['m1', 'm2']);
  await setProvider(page, {inbox: ['m2', 'm3', 'm4', 'm5'], revision: 2});
  await button(page, 'Load more').click();
  await expect.poll(async () => (await rows(page)).length).toBe(4);
  const loaded = await rows(page);
  expect(new Set(loaded).size).toBe(loaded.length);
  await refreshInbox(page);
  await expect.poll(() => rows(page)).toEqual(['m2', 'm3']);
  await button(page, 'Load more').click();
  await expect.poll(() => rows(page)).toEqual(['m2', 'm3', 'm4', 'm5']);
});
