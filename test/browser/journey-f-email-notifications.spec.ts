import {openBrowserCalendar} from './helpers/browser-calendar';
import {localDraftRow} from './inbox-draft-navigation';
// Journey F: Email + reconnect notifications, driven through rendered controls in the browser build.
//
// Evidence boundary: a pass is source/test evidence for the browser renderer only. It is NOT
// APK, emulator, AOSP image, physical-device or real-integration evidence. No real account,
// OAuth grant, Gmail request or mail delivery is involved anywhere in this file.
//
// The loop is a small serial group because the product has two distinct mail paths:
//  1. Development profile (/?mode=dev): the built-in local development mailbox. Inbox load,
//     open a message, local draft that survives reload, local send, exactly one Sent record.
//     This path has no provider review and no receipt by design ("Sent locally").
//  2. Production renderer (/) with a SYNTHETIC managed mail provider installed at the Cloud
//     client boundary (connectionController.getCloudClient + the secure slot store), the same
//     boundary inbox-folders-drafts.spec.ts and gmail-mvp-scope.spec.ts control. The fixture
//     keeps its "server" state in localStorage under a test-owned key so it survives reloads
//     like a remote provider would. Reviewed send, exactly one receipt, and a lost dispatch
//     response (the provider accepts the message, the reply never arrives) are driven here.
//  3. Development profile with tools (/?mode=dev&tools=1): a Calendar reminder notice that
//     becomes due, survives a reload and, when tapped, opens exactly its own event. The clock
//     is a Playwright fixed clock; media is guarded so no alert sound is played.
//
// Native-only steps (not provable here):
// - Real Gmail OAuth grant, provider delivery and server-side idempotency.
// - Keystore-encrypted draft/operation slots (the fixture store is plain test storage).
// - OS notification delivery, the system shade, notification permission, lock-screen taps and
//   process death between delivery and tap (the browser build shows a simulated shade).
// - Hosted scheduled-digest results need a local-agent build (VITE_LOCAL_AGENT) and are covered
//   by dev-hosted-journey.spec.ts on its own server; they are not repeated here.
//
// After a provider-confirmed send the local copies of exactly that draft (open composer, retained
// unsaved copy, saved local draft) are removed, so the sent email is not offered again. Unknown and
// failed outcomes keep every copy. Identity and edit cases: scripts/test-inbox-sent-cleanup.mjs.
import {test, expect, type Page} from '@playwright/test';
import {guardCalendarFixture} from './calendar-draft-readiness';
import {returnToApps} from './app-navigation';

test.describe.configure({mode: 'serial'});
const button = (page: Page, name: string) => page.getByRole('button', {name, exact: true});
const PROVIDER = 'journey-f-provider';

/** Synthetic managed provider. Re-installed after every load; its state lives in localStorage. */
async function installProvider(page: Page) {
  await page.evaluate(async KEY => {
    const {connectionController: c} = await import('/src/runtime/connection-ui.tsx');
    await c.initialize();
    const {inboxLocalStore: s} = await import('/src/runtime/inbox-local-store.ts');
    const load = () => JSON.parse(localStorage.getItem(KEY) || '{"slots":{},"receipts":{},"sent":[],"dispatches":0,"prepares":0,"loseNextReply":false,"unsure":false}');
    const save = (value: unknown) => localStorage.setItem(KEY, JSON.stringify(value));
    s.read = async (key: string) => structuredClone(load().slots[key] ?? null);
    s.compareExchange = async (key: string, prior: unknown, next: unknown) => {
      const value = load();
      if (JSON.stringify(value.slots[key] ?? null) !== JSON.stringify(prior)) return {status: 'conflict'};
      if (next === null) delete value.slots[key]; else value.slots[key] = next;
      save(value); return {status: 'saved'};
    };
    const mail = (id: string, threadId: string, subject: string, extra: Record<string, unknown> = {}) => ({id, threadId, subject, from: 'Synthetic sender', fromEmail: 'sender@example.invalid', to: ['owner@example.invalid'], cc: [], replyTo: null, snippet: 'Preview ' + id, receivedAt: '2026-10-06T12:00:00Z', unread: false, ...extra});
    const inbox = [mail('m1', 't1', 'Harbour schedule'), mail('m2', 't2', 'Second fixture')];
    const digest = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('');
    const everything = () => [...inbox, ...load().sent];
    const client = {
      gmailAccounts: async () => [{connectionId: 'fixture-grant', label: 'Fixture mailbox', configured: true, connected: true, reason: 'connected', grantedCapabilities: ['google.gmail.triage','google.gmail.send','google.gmail.mailbox']}],
      gmailInboxCapabilities: async () => ({version: 1, from: 'owner@example.invalid', threads: true, send: true, providerDrafts: false, mailboxMutations: false, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, readState: false, draftsList: false, forwardAttachments: false, opaqueAttachments: false, searchTrash: false, attachmentPolicy: {maximumOutgoing: 1, maximumBytes: 5242880, maximumTotalBytes: 5242880}}),
      gmailSearch: async (_grant: string, query: string) => ({messages: query === 'in:sent' ? load().sent : query === 'in:inbox' ? inbox : [], syncedAt: '2026-10-08T12:00:00Z', nextPageToken: null}),
      gmailRead: async (_grant: string, id: string) => ({message: everything().find((m: any) => m.id === id), bodyText: 'Body of ' + id, links: []}),
      gmailThread: async (_grant: string, threadId: string) => {
        const rows = everything().filter((m: any) => m.threadId === threadId);
        return {messages: rows.map((message: any) => ({message, bodyText: 'Body of ' + message.id, historyId: 'h-' + message.id, attachments: []})), total: rows.length, offset: 0, historyId: 'thread-history', nextOffset: null};
      },
      gmailPrepareOperation: async (_grant: string, requestId: string, proposal: any) => {
        const value = load(); value.prepares++;
        const review = {...proposal, from: 'owner@example.invalid', attachments: []};
        const receipt = {requestId, kind: proposal.kind, state: 'prepared', reviewDigest: await digest(JSON.stringify(review)), providerResult: null, rejectionCode: null};
        value.receipts[requestId] = receipt; save(value); return {receipt, review};
      },
      // The provider accepts each request id once. With loseNextReply the message IS accepted
      // and recorded, but the reply is lost in transit (the client sees a network failure).
      gmailDispatchOperation: async (_grant: string, requestId: string, reviewDigest: string, proposal: any) => {
        const value = load(); value.dispatches++;
        if (value.receipts[requestId]?.state !== 'succeeded') {
          const id = 'sent-' + (value.sent.length + 1);
          value.sent.push(mail(id, 'thread-' + id, proposal.subject, {to: proposal.to, from: 'Owner'}));
          value.receipts[requestId] = {requestId, kind: 'send', state: 'succeeded', reviewDigest, providerResult: {messageId: id, threadId: 'thread-' + id}, rejectionCode: null};
        }
        const lost = value.loseNextReply; value.loseNextReply = false; save(value);
        if (lost) throw new TypeError('Failed to fetch');
        // A provider reply that names another operation (wrong request ID) must never be accepted.
        if (value.wrongReceipt) return {...value.receipts[requestId], requestId: 'another-request'};
        return value.receipts[requestId];
      },
      // While "unsure" the provider cannot yet tell whether delivery completed.
      gmailOperation: async (_grant: string, requestId: string) => { const value = load(), receipt = value.receipts[requestId]; return value.unsure ? {...receipt, state: 'outcome-unknown', providerResult: null} : receipt; },
    };
    c.getCloudClient = () => ({client, sessionId: 'fixture-session', credentialId: 'fixture'} as any);
    const snapshot = {...c.getSnapshot(), cloudAccount: {environment: 'production', userId: 'fixture-owner', sessionId: 'fixture-session', credentialId: 'fixture'}} as any;
    c.getSnapshot = () => snapshot;
  }, PROVIDER);
}
const provider = (page: Page) => page.evaluate(KEY => { const v = JSON.parse(localStorage.getItem(KEY)!); return {dispatches: v.dispatches as number, prepares: v.prepares as number, sent: v.sent.map((m: any) => m.subject) as string[], receipts: Object.values(v.receipts).map((r: any) => r.state) as string[]}; }, PROVIDER);
const setProvider = (page: Page, patch: Record<string, boolean>) => page.evaluate(([KEY, patch]) => { const v = JSON.parse(localStorage.getItem(KEY as string)!); localStorage.setItem(KEY as string, JSON.stringify({...v, ...(patch as object)})); }, [PROVIDER, patch] as const);
async function openProviderInbox(page: Page, reload = false) {
  await guardCalendarFixture(page.context());
  await page.addInitScript(() => localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})));
  // A signed-in fixture account models an installation that already finished access setup; with
  // setup pending the startup walkthrough would cover Inbox once the swapped snapshot re-renders.
  await page.addInitScript(() => localStorage.setItem('alpha:startup-permission-walkthrough:v1', JSON.stringify({version: 1, status: 'completed', step: 4})));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:|localhost:)/, route => route.abort());
  // Provider initialization and rendered Inbox controls below establish readiness.
  // Loading unrelated resources is not part of the mail operation contract.
  if (reload) await page.reload({waitUntil: 'domcontentloaded'}); else await page.goto('/', {waitUntil: 'domcontentloaded'});
  await installProvider(page);
  await button(page, 'Inbox').click();
  // A saved operation reopens its review over the list, so either surface proves the mailbox loaded.
  await expect(button(page, 'Refresh inbox').or(page.getByRole('dialog', {name: 'Review mail operation'}))).toBeVisible();
}
async function compose(page: Page, subject: string, body: string) {
  await button(page, 'Compose').click();
  await page.getByRole('textbox', {name: 'To', exact: true}).fill('friend@example.invalid');
  await page.getByRole('textbox', {name: 'To', exact: true}).press('Enter');
  await expect(button(page, 'Remove friend@example.invalid')).toBeVisible();
  await page.getByRole('textbox', {name: 'Subject', exact: true}).fill(subject);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill(body);
}

test('development mailbox: load, open a message, local draft survives reload, one local send', async ({page}) => {
  test.setTimeout(180_000);
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !/^(127\.0\.0\.1|localhost)$/.test(new URL(request.url()).hostname)) external.push(request.url()); });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('alpha.dev.app.inbox') || '{"sent":[],"localDrafts":[]}'));
  await page.goto('/?mode=dev');
  await button(page, 'Inbox').click();
  await expect(page.getByRole('heading', {name: 'Inbox', exact: true})).toBeVisible();
  await page.getByText('Dinner Friday?', {exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Dinner Friday?', exact: true})).toBeVisible();
  await expect(page.getByRole('region', {name: 'Email message'})).toContainText('tacos');
  await button(page, 'Back to inbox').click();

  await compose(page, 'Journey local draft', 'Draft body kept on this device');
  await button(page, 'Save draft locally').click();
  await expect(page.getByText('Saved locally', {exact: true})).toBeVisible();
  expect((await stored()).localDrafts).toHaveLength(1);
  expect((await stored()).sent || []).toEqual([]);

  await page.reload();
  await button(page, 'Inbox').click();
  await button(page, 'Restore local draft').click();
  await expect(page.getByRole('textbox', {name: 'Subject', exact: true})).toHaveValue('Journey local draft');
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Draft body kept on this device');
  await expect(button(page, 'Remove friend@example.invalid')).toBeVisible();
  await button(page, 'Send email').click();
  await expect(page.getByText('Sent locally', {exact: true})).toBeVisible();

  await page.reload();
  await button(page, 'Inbox').click();
  await expect(button(page, 'Restore local draft')).toHaveCount(0);
  await button(page, 'Sent').click();
  await expect(page.getByText('Journey local draft', {exact: true})).toHaveCount(1);
  const saved = await stored();
  expect(saved.localDrafts).toEqual([]);
  expect(saved.sent.filter((m: any) => m.subj === 'Journey local draft')).toHaveLength(1);
  expect(saved.sent[0]).toMatchObject({to: ['friend@example.invalid'], subj: 'Journey local draft'});
  expect(external).toEqual([]);
});

test('synthetic provider: reviewed send leaves exactly one receipt and one message after reload', async ({page}) => {
  test.setTimeout(35_000);
  page.setDefaultTimeout(5_000);
  const review = page.getByRole('dialog', {name: 'Review mail operation'});
  await test.step('Read message and conversation', async () => {
    await openProviderInbox(page);
    // Account-switch controls appear only when multiple readable accounts exist.
    await expect(button(page, 'Fixture mailbox')).toHaveCount(0);
    await expect(button(page, 'Synthetic sender, Harbour schedule')).toBeVisible();
    await button(page, 'Synthetic sender, Harbour schedule').click();
    const message = page.getByRole('region', {name: 'Email message'});
    await expect(message.getByRole('heading', {name: 'Harbour schedule', exact: true})).toBeVisible();
    await message.getByRole('button', {name: 'Show conversation', exact: true}).click();
    await expect(message).toContainText('1 messages in this thread');
    await expect(message).toContainText('Body of m1');
    await button(page, 'Back to inbox').click();
  });

  await test.step('Save local draft', async () => {
    await compose(page, 'Journey reviewed send', 'Reviewed body');
    await button(page, 'Save draft locally').click();
    await expect(page.getByRole('status').filter({hasText: 'Saved locally on this device'})).toBeVisible();
    expect(await provider(page)).toMatchObject({prepares: 0, dispatches: 0, sent: []});
  });

  await test.step('Reload and restore', async () => {
    await openProviderInbox(page, true);
    await (await localDraftRow(page)).click();
    await expect(page.getByRole('textbox', {name: 'Subject', exact: true})).toHaveValue('Journey reviewed send');
    await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('Reviewed body');
  });

  await test.step('Review without dispatch', async () => {
    await button(page, 'Send email').click();
    await expect(review.getByRole('status')).toHaveText('Review every field before confirming. No mail has been sent.');
    await expect(review).toContainText('From: owner@example.invalid');
    await expect(review).toContainText('To: friend@example.invalid');
    await expect(review).toContainText('Subject: Journey reviewed send');
    await expect(review.getByText('Reviewed body', {exact: true})).toBeVisible();
    expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 0, sent: []});
  });

  await test.step('Confirm receipt', async () => {
    await review.getByRole('button', {name: 'Send this email', exact: true}).click();
    await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
    await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
    await expect(review).toContainText('"messageId":"sent-1"');
    // The confirmed send removes the saved local draft and the composer copy it came from.
    await expect(review).toContainText('The local draft and unsaved copy of this sent email were removed from this device.');
    await expect.poll(() => page.evaluate(KEY => Object.keys(JSON.parse(localStorage.getItem(KEY)!).slots).filter(key => key.startsWith('inbox-drafts:')), PROVIDER)).toEqual([]);
  });

  await test.step('Reload receipt without replay', async () => {
    // Reload: the saved receipt is shown again; nothing is prepared or dispatched a second time.
    await openProviderInbox(page, true);
    await expect(review.getByRole('status')).toHaveText('Saved mail operation. Check its exact review and receipt before continuing.');
    await expect(review).toContainText('"messageId":"sent-1"');
    await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
    await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
    await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
    await expect(review).toContainText('The local draft and unsaved copy of this sent email were removed from this device.');
    await review.getByRole('button', {name: 'Close receipt', exact: true}).click();
    await expect(review).toHaveCount(0);
    await expect(button(page, 'Mail review / receipt')).toHaveCount(0);
    // The sent email is not offered again in any form.
    for (const name of ['Restore local draft', 'Resume unsaved email', 'Continue draft']) await expect(button(page, name)).toHaveCount(0);
    await button(page, 'Sent').click();
    await expect(page.getByRole('button', {name: /Journey reviewed send/})).toHaveCount(1);
    expect(await provider(page)).toEqual({prepares: 1, dispatches: 1, sent: ['Journey reviewed send'], receipts: ['succeeded']});
    await button(page, 'Compose').click();
    await expect(page.getByRole('textbox', {name: 'Subject', exact: true})).toHaveValue('');
    await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toHaveValue('');
    await expect(button(page, 'Remove friend@example.invalid')).toHaveCount(0);
  });


});

test('synthetic provider: a lost send reply is an unknown outcome and is never sent again', async ({page}) => {
  test.setTimeout(180_000);
  await openProviderInbox(page);
  await compose(page, 'Journey lost reply', 'Body whose reply is lost');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Review mail operation'});
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toBeVisible();
  await setProvider(page, {loseNextReply: true, unsure: true});
  await review.getByRole('button', {name: 'Send this email', exact: true}).click();
  await expect(review.getByRole('status')).toContainText('Gmail may not have received this change');
  await expect(review.getByRole('status')).toContainText('check the saved receipt before trying again');
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
  await expect(review.getByRole('button', {name: 'Close receipt', exact: true})).toHaveCount(0);
  await expect(review.getByRole('button', {name: 'Cancel unsent review', exact: true})).toHaveCount(0);
  expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 1});
  // "Retry" after an uncertain dispatch only re-reads the receipt; it must not dispatch again.
  await review.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Delivery outcome is unknown. Check the saved receipt; do not send this message again.');
  expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 1});

  // Reload while the outcome is unknown: no automatic resend, no way to confirm or discard.
  await openProviderInbox(page, true);
  await expect(review.getByRole('status')).toHaveText('Saved mail operation. Check its exact review and receipt before continuing.');
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Delivery outcome is unknown. Check the saved receipt; do not send this message again.');
  await expect(review.getByRole('button', {name: 'Close receipt', exact: true})).toHaveCount(0);
  await review.getByRole('button', {name: 'Close mail review', exact: true}).click();
  await expect(button(page, 'Mail review / receipt')).toBeVisible();
  // An unknown outcome keeps the local copy. A second operation cannot start while it is unresolved.
  await (await localDraftRow(page)).click();
  await expect(page.getByRole('textbox', {name: 'Subject', exact: true})).toHaveValue('Journey lost reply');
  await button(page, 'Send email').click();
  await expect(review.getByRole('status')).toHaveText('Review the saved operation before starting another.');
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
  expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 1});

  // The provider later resolves the receipt; an explicit check reconciles to exactly one message.
  await setProvider(page, {unsure: false});
  await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  await expect(review).toContainText('"messageId":"sent-1"');
  // Only now, with the provider's confirmation, is the retained copy of that email removed.
  await expect(review).toContainText('The local draft and unsaved copy of this sent email were removed from this device.');
  await openProviderInbox(page, true);
  await expect(review).toContainText('"messageId":"sent-1"');
  await review.getByRole('button', {name: 'Close receipt', exact: true}).click();
  for (const name of ['Restore local draft', 'Resume unsaved email', 'Continue draft']) await expect(button(page, name)).toHaveCount(0);
  await button(page, 'Sent').click();
  await expect(page.getByRole('button', {name: /Journey lost reply/})).toHaveCount(1);
  expect(await provider(page)).toEqual({prepares: 1, dispatches: 1, sent: ['Journey lost reply'], receipts: ['succeeded']});
});

test('synthetic provider: a send reply that names another operation is not shown as confirmed and is never sent again', async ({page}) => {
  test.setTimeout(180_000);
  await openProviderInbox(page);
  await compose(page, 'Journey wrong receipt', 'Body whose reply names another operation');
  await button(page, 'Send email').click();
  const review = page.getByRole('dialog', {name: 'Review mail operation'});
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toBeVisible();
  await setProvider(page, {wrongReceipt: true});
  await review.getByRole('button', {name: 'Send this email', exact: true}).click();
  // The reply is refused: no confirmation, no provider message ID from the foreign receipt, no second Send.
  await expect(review.getByRole('status')).toHaveText('Gmail answered for a different request, so nothing was confirmed. Check the saved receipt before trying again; do not send this message again.');
  await expect(review).not.toContainText('"messageId"');
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
  expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 1});
  // After a reload the saved operation is still unresolved and still cannot be sent again.
  await openProviderInbox(page, true);
  await expect(review.getByRole('status')).toHaveText('Saved mail operation. Check its exact review and receipt before continuing.');
  await expect(review.getByRole('button', {name: 'Send this email', exact: true})).toHaveCount(0);
  expect(await provider(page)).toMatchObject({prepares: 1, dispatches: 1});
  // Its own receipt, read back by request ID, reconciles to exactly one message.
  await setProvider(page, {wrongReceipt: false});
  await review.getByRole('button', {name: 'Check saved receipt', exact: true}).click();
  await expect(review.getByRole('status')).toHaveText('Provider confirmed this operation.');
  await expect(review).toContainText('"messageId":"sent-1"');
  expect(await provider(page)).toEqual({prepares: 1, dispatches: 1, sent: ['Journey wrong receipt'], receipts: ['succeeded']});
});

test('a due reminder notice tapped after reload opens exactly its own event, once', async ({page, context}) => {
  test.setTimeout(180_000);
  await guardCalendarFixture(context);
  await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  await page.addInitScript(() => { if (!localStorage.getItem('alpha.connection.selection.v1')) localStorage.setItem('alpha.connection.selection.v1', JSON.stringify({kind: 'offline'})); });
  const events = () => page.evaluate(async () => JSON.parse((await (await import('/src/browser/calendar-store.ts')).calendarDocument.readRaw()) || '{"events":[]}').events as {title: string; begin: number; alert: number}[]);
  const notices = () => page.evaluate(async () => { const {registerPlugin} = await import('/src/platform-plugins.ts'); return (await registerPlugin<any>('AlphaNotifications').list()).items.filter((n: any) => n.id.startsWith('calendar:')).map((n: any) => n.title as string); });
  await page.goto('/?mode=dev&tools=1');
  await openBrowserCalendar(page);
  for (const title of ['Harbour pickup', 'Dentist check']) {
    await button(page, 'New event').click();
    await page.getByRole('textbox', {name: 'Title', exact: true}).fill(title);
    await button(page, '10 min').click();
    await button(page, 'Save event').click();
    await expect(button(page, 'Save event')).toHaveCount(0);
    // Saving opens the new event's detail page.
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
    await button(page, 'Back to calendar').click();
  }
  const rows = await events();
  expect(rows.map(row => row.title).sort()).toEqual(['Dentist check', 'Harbour pickup']);
  expect(rows.every(row => row.alert === 10)).toBe(true);
  expect(await notices()).toEqual([]);

  // Both reminders become due, then the app is reloaded before either notice is tapped.
  await page.clock.setFixedTime(new Date(Math.max(...rows.map(row => row.begin)) - 60_000));
  await page.reload();
  await openBrowserCalendar(page);
  await returnToApps(page);
  await expect.poll(async () => (await notices()).length).toBe(2);
  await button(page, 'Device controls').click();
  await button(page, 'Notifications').click();
  await expect(button(page, 'Open Harbour pickup')).toHaveCount(1);
  await expect(button(page, 'Open Dentist check')).toHaveCount(1);
  await button(page, 'Open Harbour pickup').click();
  await expect(button(page, 'Back to calendar')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Harbour pickup', exact: true})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Dentist check', exact: true})).toHaveCount(0);
  // The tapped notice is consumed exactly once; the other reminder is untouched.
  await expect.poll(notices).toEqual(['Dentist check']);
  await page.reload();
  await expect.poll(notices).toEqual(['Dentist check']);
  expect((await events()).map(row => row.title).sort()).toEqual(['Dentist check', 'Harbour pickup']);
  await returnToApps(page);
});
