// Incremental Gmail grants (P-37, issue #421) against synthetic account rows. No Google account,
// OAuth consent or mailbox is involved; live Gmail qualification is a separate gate.
import test from "node:test";
import assert from "node:assert/strict";
import { googleAccountAccessLabel, gmailCapabilitiesFor, requiredGmailCapability, gmailGrantTier, gmailActionGrant, gmailInboxAllows, gmailModifyIncomplete, gmailReadCacheKey, gmailGrantChange, gmailGrantLabel, GMAIL_MODIFY_CAPABILITIES } from "../apps/app/src/runtime/gmail-grants.ts";

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

test("grant tiers and labels", () => {
  assert.equal(gmailGrantTier(account(READ)), "readonly");
  assert.equal(gmailGrantTier(account(MODIFY)), "modify");
  assert.equal(gmailGrantTier(account([...READ, "google.gmail.send"])), "readonly", "a partial change grant is not the modify tier");
  assert.equal(gmailGrantTier(account(MODIFY, { connectionId: null })), "none");
  assert.equal(gmailGrantLabel([account(READ)]), "Read access authorized");
  assert.equal(gmailGrantLabel([account(READ), account(MODIFY, { connectionId: "grant-2" })]), "Read and change access authorized");
  assert.equal(gmailGrantLabel([account([])]), "Authorization required");
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

 test("connection status reflects send-only and Calendar write grants",()=>{
 assert.equal(googleAccountAccessLabel(account([...READ,"google.calendar.read"])),"Connected · Gmail: Read access · Calendar: Read access");
 assert.equal(googleAccountAccessLabel(account([...READ,"google.gmail.send","google.calendar.read","google.calendar.write"])),"Connected · Gmail: Read and send access · Calendar: Read and edit access");
 });
