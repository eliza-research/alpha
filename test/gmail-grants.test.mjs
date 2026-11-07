// Incremental Gmail grants (P-37, issue #421) against synthetic account rows. No Google account,
// OAuth consent or mailbox is involved; live Gmail qualification is a separate gate.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { googleAccountAccessLabel, gmailCapabilitiesFor, requiredGmailCapability, gmailGrantTier, gmailActionGrant, gmailInboxAllows, gmailModifyIncomplete, gmailReadCacheKey, gmailGrantChange, GMAIL_MODIFY_CAPABILITIES } from "../apps/app/src/runtime/gmail-grants.ts";

const account = (capabilities, patch = {}) => ({ configured: true, connected: true, reason: "connected", connectionId: "grant-1", label: "Mailbox", grantedCapabilities: capabilities, ...patch });
const READ = ["google.gmail.triage"], MODIFY = [...READ, ...GMAIL_MODIFY_CAPABILITIES];
const caps = (patch = {}) => ({ version: 1, from: "a@example.invalid", threads: true, send: true, providerDrafts: true, mailboxMutations: true, attachments: true, providerExactlyOnce: false, atomicDraftReplacement: false, readState: true, draftsList: true, forwardAttachments: false, searchTrash: false, ...patch });

test("read is requested first; modify is one incremental step that keeps read", () => {
  assert.deepEqual(gmailCapabilitiesFor("read"), ["google.basic_identity", "google.gmail.triage"]);
  assert.deepEqual(gmailCapabilitiesFor("modify"), ["google.basic_identity", "google.gmail.triage", "google.gmail.send", "google.gmail.drafts", "google.gmail.mailbox"]);
});

test("approved mailbox actions map to the change capability they need", () => {
  assert.equal(requiredGmailCapability("send"), "google.gmail.send");
  for (const kind of ["draft-create", "draft-replace", "draft-delete"]) assert.equal(requiredGmailCapability(kind), "google.gmail.drafts");
  for (const kind of ["archive", "unarchive", "trash", "untrash", "mark-read", "mark-unread"]) assert.equal(requiredGmailCapability(kind), "google.gmail.mailbox");
  assert.equal(gmailActionGrant(account(READ), "archive"), "upgrade", "a read-only account is offered the modify step, nothing is prepared");
  assert.equal(gmailActionGrant(account(MODIFY), "send"), "granted");
  assert.equal(gmailActionGrant(account(["google.gmail.send"]), "send"), "unreadable", "change access without read access reads nothing");
  assert.equal(gmailActionGrant(account(MODIFY, { connected: false }), "send"), "unreadable");
  assert.equal(gmailInboxAllows(caps({ mailboxMutations: false }), "trash"), false);
  assert.equal(gmailInboxAllows(caps(), "draft-create"), true);
  assert.equal(gmailInboxAllows(null, "send"), false);
  assert.equal(gmailModifyIncomplete(caps({ send: false })), true);
  assert.equal(gmailModifyIncomplete(caps()), false);
});

test("grant tiers", () => {
  assert.equal(gmailGrantTier(account(READ)), "readonly");
  assert.equal(gmailGrantTier(account(MODIFY)), "modify");
  assert.equal(gmailGrantTier(account([...READ, "google.gmail.send"])), "readonly", "a partial change grant is not the modify tier");
  assert.equal(gmailGrantTier(account(MODIFY, { connectionId: null })), "none");
});

test("revoke and account or session changes isolate cached mail and unsent reviews", () => {
  const s = "session-1";
  assert.equal(gmailReadCacheKey(s, account([])), null, "nothing may be shown without the read grant");
  assert.equal(gmailReadCacheKey(null, account(READ)), null);
  assert.notEqual(gmailReadCacheKey(s, account(READ)), gmailReadCacheKey("session-2", account(READ)));
  assert.notEqual(gmailReadCacheKey(s, account(READ)), gmailReadCacheKey(s, account(READ, { connectionId: "grant-2" })));
  assert.equal(gmailReadCacheKey(s, account(READ)), gmailReadCacheKey(s, account(MODIFY)), "adding change access keeps what was read");
  assert.deepEqual(gmailGrantChange({ sessionId: s, account: account(READ) }, { sessionId: s, account: account(MODIFY) }), { dropReadCache: false, withdrawn: [] });
  assert.deepEqual(gmailGrantChange({ sessionId: s, account: account(MODIFY) }, { sessionId: s, account: account([...READ, "google.gmail.drafts"]) }), { dropReadCache: false, withdrawn: ["google.gmail.send", "google.gmail.mailbox"] });
  assert.deepEqual(gmailGrantChange({ sessionId: s, account: account(MODIFY) }, { sessionId: s, account: account([]) }), { dropReadCache: true, withdrawn: [...GMAIL_MODIFY_CAPABILITIES] }, "revoked read access withdraws everything");
  assert.deepEqual(gmailGrantChange({ sessionId: s, account: account(MODIFY) }, { sessionId: s, account: undefined }), { dropReadCache: true, withdrawn: [...GMAIL_MODIFY_CAPABILITIES] }, "a disconnected account");
  assert.equal(gmailGrantChange({ sessionId: s, account: account(READ) }, { sessionId: "session-2", account: account(READ) }).dropReadCache, true);
});

test("Inbox uses the single modify step and discards unsent reviews when change access is withdrawn", () => {
  const inbox = fs.readFileSync("apps/app/src/prototype/inbox-cloud-adapter.ts", "utf8");
  const panel=fs.readFileSync('apps/app/src/runtime/google-connection-ui.tsx','utf8'),flow=fs.readFileSync('apps/app/src/runtime/google-connect-flow.ts','utf8');
  assert.match(flow,/connect\(abort\.signal, 'write', 'modify'/,'one consent asks for Gmail changes together with Calendar');
  assert.doesNotMatch(panel,/connect\('(send|drafts|mailbox)'\)/,'no separate per-capability buttons');
  // A consent browser that never hid Alpha must not lock the panel: a quiet Cancel ends the wait.
  assert.match(panel,/\{connecting&&<button className="alpha-connection-cancel" onClick=\{\(\)=>googleConnect\.cancel\(\)\}>Cancel<\/button>\}/);
  assert.match(flow,/cancel\(\) \{ active\?\.abort\(\); \}/);
  assert.match(flow,/if \(abort\.signal\.aborted\) \{ if \(active === abort\) set\('idle'\); return; \}/,'a cancelled wait returns the panel to idle');
  assert.doesNotMatch(inbox, /connect\('(send|drafts|mailbox)'\)/, "no separate per-capability consent prompts");
  assert.match(inbox, /if\(previous&&grantChange\.withdrawn\.length\)provider\.withdrawn\(\);/);
  assert.match(inbox, /const dropped=previous!==selected\|\|\(!!previous&&grantChange\.dropReadCache\);/, "a changed read-cache identity drops what was read");
  assert.match(inbox, /const cached=key&&inboxPreview\?\.key===key&&inboxPreview\.sessionId===binding\?\.sessionId&&inboxPreview\.accountId===selected/, "Home shows the preview only under the identity it was read with");
  // Behaviour: scripts/test-inbox-cloud-flow.mjs (read grant withdrawn) and scripts/test-inbox-grant-withdrawal.mjs.
  const provider = fs.readFileSync("apps/app/src/prototype/inbox-provider-controls.ts", "utf8");
  assert.match(provider, /if\(!gmailInboxAllows\(caps,kind as GmailMailboxAction\)\)/);
  assert.match(provider, /static async discardUnsent|InboxOperation\.discardUnsent\(inboxLocalStore,pending\.owner,pending\.grant\)/, "the discard is bound to the grant, not the live operation");
});

 test("account access is labelled only when it is partial",()=>{
 assert.equal(googleAccountAccessLabel(account([...MODIFY,"google.calendar.read","google.calendar.write"])),"","full access needs no label");
 assert.equal(googleAccountAccessLabel(account([...READ,"google.calendar.read"])),"Limited access");
 assert.equal(googleAccountAccessLabel(account([...READ,"google.gmail.send","google.calendar.read","google.calendar.write"])),"Limited access","send-only consent is still partial");
 assert.equal(googleAccountAccessLabel(account(MODIFY)),"Gmail only");
 assert.equal(googleAccountAccessLabel(account(["google.calendar.read","google.calendar.write"])),"Calendar only");
 assert.equal(googleAccountAccessLabel(account([])),"Not authorized");
 });
