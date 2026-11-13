// AOSP SMS/MMS contract (issue #421): the native journal and provider mapping on the JVM, the renderer
// contract against a recording stub, and source checks of the native and manifest boundaries. No SIM,
// radio, provider, image or carrier is involved; nothing here establishes a real send or delivery.
import {scaledTimeout} from "../specs/quint/refinement/timeouts.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { javaBinary } from "./fixtures/jvm-tools.mjs";
import { createAospTelephony, TelephonyUnavailable, parseTelephonyStatus, parseThreads, parseMessages, parseSmsSendResult, parseSmsJournal, smsBindingText, smsBindingHash, reviewSms } from "../apps/app/src/runtime/aosp-telephony.ts";

const root = resolve(import.meta.dirname, "..");
const SHARED = join(root, "vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages");
const read = file => readFileSync(join(root, file), "utf8");
const status = (patch = {}) => ({
  version: 2, voiceCapable: true, smsCapable: true,
  permissions: { contacts: "granted", phoneState: "granted", sms: "granted", sendSms: "granted" }, sendMode: "direct",
  roles: { dialer: { available: true, held: false, eligible: false }, sms: { available: true, held: false, eligible: false } },
  defaultDialer: "com.android.dialer", defaultSms: "com.android.messaging",
  subscriptions: [{ id: 3, slot: 0, displayName: "Work", carrierName: "Carrier A", defaultSms: true, defaultVoice: true }],
  defaultSmsSubscriptionId: 3, ...patch,
});
function stub(answers = {}) {
  const calls = [], listeners = [];
  const plugin = new Proxy({}, { get: (_, method) => method === "then" ? undefined : method === "addListener"
    ? async (event, listener) => { listeners.push([event, listener]); return { remove: async () => { calls.push(["remove", event]); } }; }
    : async options => { calls.push([method, options]); const answer = answers[method]; if (answer instanceof Error) throw answer; return typeof answer === "function" ? answer(options) : answer; } });
  return { plugin, calls, listeners };
}

test("JVM: Alpha's installed journal stays compatible with the shared reviewed-SMS core", () => {
  const dir = mkdtempSync(join(tmpdir(), "alpha-sms-"));
  try {
    execFileSync(javaBinary("javac"), ["--release", "11", "-d", dir, ...["SmsSendJournal", "SmsRecords", "SmsPageCursor"].map(name => join(SHARED, `${name}.java`)), join(root, "test/fixtures/SmsSendJournalTest.java")], { timeout: scaledTimeout(60000) });
    const body = "Running late \"5\" min\né😀\t\u0001";
    const expected = createHash("sha256").update(smsBindingText({ recipients: ["+15555550100", "5550101"], body, subscriptionId: 3 })).digest("hex");
    const namespace = read("android/app/src/main/java/ai/alphacompute/alphaphone/AlphaTelephony.java").match(/"(alpha-sms-operation:v1:)"/)[1];
    assert.match(execFileSync(javaBinary("java"), ["-Djava.io.tmpdir=" + dir, "-cp", dir, "ai.eliza.plugins.messages.SmsSendJournalTest", expected, namespace], { encoding: "utf8", timeout: scaledTimeout(120000) }), /PASS alpha sms journal compatibility/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("binding text equals the shared sms.send.v1 contract field order", async () => {
  const review = { recipients: ["+15555550123"], body: "Exact SMS fixture", subscriptionId: 3 };
  assert.equal(smsBindingText(review), JSON.stringify({ body: review.body, recipients: review.recipients, subscriptionId: 3, type: "sms_send" }));
  assert.equal(await smsBindingHash(review), createHash("sha256").update(smsBindingText(review)).digest("hex"));
});

test("status reports send mode and the default SIM truthfully", () => {
  assert.equal(parseTelephonyStatus(status()).sendMode, "direct");
  assert.equal(parseTelephonyStatus(status()).defaultSmsSubscriptionId, 3);
  assert.throws(() => parseTelephonyStatus(status({ permissions: { contacts: "granted", phoneState: "granted", sms: "granted", sendSms: "denied" } })), /send mode/, "direct without the send permission is refused");
  assert.throws(() => parseTelephonyStatus(status({ smsCapable: false })), /send mode/);
  assert.throws(() => parseTelephonyStatus(status({ defaultSmsSubscriptionId: 9 })), /default SMS subscription/, "a default that is not an active SIM is refused");
  const none = parseTelephonyStatus(status({ sendMode: "handoff", permissions: { contacts: "granted", phoneState: "prompt", sms: "prompt", sendSms: "denied" }, subscriptions: null, defaultSmsSubscriptionId: null }));
  assert.equal(none.defaultSmsSubscriptionId, null); assert.equal(none.sendMode, "handoff");
  assert.throws(() => parseTelephonyStatus(status({ sendMode: "auto" })), /send mode/);
});

test("direct review uses the shared contract bounds", () => {
  const s = parseTelephonyStatus(status());
  assert.deepEqual(reviewSms({ recipients: ["1", "2", "3", "4", "5", "6"].map(n => `+1555555010${n}`), body: "x" }, s, "direct"), { problem: "too-many-recipients" });
  assert.deepEqual(reviewSms({ recipients: ["+15555550100"], body: "x".repeat(1601) }, s, "direct"), { problem: "body-too-long" });
  assert.deepEqual(reviewSms({ recipients: ["+15555550100"], body: "a\ud800" }, s, "direct"), { problem: "invalid-body" });
  assert.equal(reviewSms({ recipients: ["+15555550100"], body: "x".repeat(1601) }, s).review.body.length, 1601, "the handoff keeps its own bounds");
  assert.equal(reviewSms({ recipients: ["+15555550100"], body: "hi" }, s, "direct").review.subscriptionId, 3);
});

test("threads and messages are bounded, stable and truthful about status", async () => {
  const thread = { id: "thread:4", date: 1700000000000, messageCount: 2, snippet: "hi", unread: true, addresses: ["+15555550100"] };
  const sms = { id: "sms:9", kind: "sms", threadId: "thread:4", direction: "outgoing", status: "delivered", date: 1700000000000, read: true, subscriptionId: 3, addresses: ["+15555550100"], body: "hi", deliveryReport: "complete", attachments: 0 };
  const mms = { id: "mms:9", kind: "mms", threadId: "thread:4", direction: "incoming", status: "received", date: 1699999999000, read: false, subscriptionId: null, addresses: ["+15555550100"], body: "", deliveryReport: null, attachments: 1 };
  const { plugin, calls } = stub({ listThreads: { threads: [thread] }, listMessages: { messages: [sms, mms] } });
  const client = createAospTelephony(plugin, true);
  assert.deepEqual(await client.listThreads(10), [thread]);
  assert.deepEqual(await client.listMessages("thread:4", 10, 1700000000001), [sms, mms]);
  assert.deepEqual(calls, [["listThreads", { limit: 10 }], ["listMessages", { threadId: "thread:4", limit: 10, before: 1700000000001 }]]);
  await assert.rejects(client.listThreads(51), RangeError);
  await assert.rejects(client.listMessages("4", 10), RangeError);
  await assert.rejects(client.listMessages("thread:4", 10, -1), RangeError);
  assert.throws(() => parseThreads({ threads: [thread, thread] }, 5), /thread id/, "duplicate IDs refused");
  assert.throws(() => parseThreads({ threads: [thread, { ...thread, id: "thread:5" }] }, 1), /threads/, "more rows than asked for are refused");
  assert.throws(() => parseMessages({ messages: [{ ...sms, deliveryReport: "pending" }] }, "thread:4", 5), /message status/, "delivered only with a complete delivery report");
  assert.throws(() => parseMessages({ messages: [{ ...mms, status: "delivered", direction: "outgoing", deliveryReport: "complete" }] }, "thread:4", 5), /delivery report/, "MMS delivery is never claimed");
  assert.throws(() => parseMessages({ messages: [{ ...mms, status: "sent" }] }, "thread:4", 5), /message status/, "incoming messages are received or read");
  assert.throws(() => parseMessages({ messages: [{ ...sms, threadId: "thread:5" }] }, "thread:4", 5), /message id/, "rows of another thread are refused");
  assert.throws(() => parseMessages({ messages: [{ ...sms, id: "mms:9" }] }, "thread:4", 5), /message id/, "kind and ID agree");
  assert.throws(() => parseMessages({ messages: [{ ...sms, body: "x".repeat(2001) }] }, "thread:4", 5), /message body/);
});

test("change notices carry no content and stop cleanly", async () => {
  const { plugin, calls, listeners } = stub({ observeMessages: undefined });
  const client = createAospTelephony(plugin, true);
  let changes = 0; const updated = [];
  const stop = await client.observeMessages(() => changes++, id => updated.push(id));
  for (const [event, listener] of listeners) listener(event === "messagesChanged" ? { sequence: 1 } : { operationId: "op-1" });
  listeners[1][1]({ operationId: "bad id!" });
  assert.equal(changes, 1); assert.deepEqual(updated, ["op-1"]);
  await stop();
  assert.deepEqual(calls.filter(([m]) => m === "observeMessages").map(([, o]) => o), [{ enabled: true }, { enabled: false }]);
  const refused = stub({ observeMessages: new Error("permission-required") });
  await assert.rejects(createAospTelephony(refused.plugin, true).observeMessages(() => {}), /permission-required/);
  assert.deepEqual(refused.calls.filter(([m]) => m === "remove").length, 1, "listeners are removed when observing is refused");
});

test("native sends: exact binding, evidence-backed status, no resend", async () => {
  const review = { recipients: ["+15555550100", "+15555550101"], body: "On my way", subscriptionId: 3 };
  const hash = await smsBindingHash(review);
  const part = (index, recipientIndex, partIndex, sent = "unknown", delivery = "unknown") => ({ index, recipientIndex, partIndex, sent, delivery });
  const result = (patch = {}) => ({ kind: "sms-send", operationId: "op-1", subscriptionId: 3, bindingHash: hash, status: "submitted", parts: [part(0, 0, 0), part(1, 1, 0)], createdAt: 1, ...patch });
  const { plugin, calls } = stub({ sendSms: result(), smsSendResult: result({ status: "sent", parts: [part(0, 0, 0, "success"), part(1, 1, 0, "success")] }) });
  const client = createAospTelephony(plugin, true);
  assert.equal((await client.sendSms(review, "op-1")).status, "submitted");
  assert.deepEqual(calls[0], ["sendSms", { operationId: "op-1", recipients: review.recipients, body: review.body, subscriptionId: 3 }]);
  assert.equal((await client.smsSendResult(review, "op-1")).status, "sent");
  assert.deepEqual(calls[1], ["smsSendResult", { operationId: "op-1" }], "reading a result never sends");
  await assert.rejects(client.sendSms({ ...review, subscriptionId: null }, "op-2"), RangeError, "a native send needs the reviewed SIM");
  await assert.rejects(client.sendSms(review, "bad id"), RangeError);
  // Status must be backed by part evidence and bound to exactly the reviewed content.
  for (const [patch, why] of [
    [{ status: "sent" }, "sent without sent callbacks"],
    [{ status: "delivered", parts: [part(0, 0, 0, "success"), part(1, 1, 0, "success")] }, "delivered without delivery reports"],
    [{ status: "cancelled" }, "cancelled with parts"],
    [{ bindingHash: "0".repeat(64) }, "other content"],
    [{ subscriptionId: 4 }, "other SIM"],
    [{ operationId: "op-2" }, "other operation"],
    [{ parts: [part(0, 0, 0)] }, "a recipient without parts"],
    [{ parts: [part(0, 0, 0, "unknown", "success"), part(1, 1, 0)] }, "delivery before sent"],
    [{ parts: [part(0, 1, 0), part(1, 0, 0)] }, "part order"],
    [{ extra: true }, "extra fields"],
  ]) assert.throws(() => parseSmsSendResult(result(patch), review, "op-1", hash), /SMS/, why);
  assert.equal(parseSmsSendResult(result({ status: "failed", parts: [part(0, 0, 0, "failed"), part(1, 1, 0, "success")] }), review, "op-1", hash).status, "failed");
  assert.equal(parseSmsSendResult(result({ status: "denied", parts: [] }), review, "op-1", hash).parts.length, 0);
});

test("journal history restores unknown operations without draft content or optimistic delivery", async () => {
 const row={kind:'sms-send',operationId:'lost-transport',subscriptionId:3,bindingHash:'a'.repeat(64),status:'unknown',parts:[{index:0,recipientIndex:0,partIndex:0,sent:'unknown',delivery:'unknown'}],createdAt:1};
 assert.equal(parseSmsJournal({receipts:[row]})[0].operationId,'lost-transport');
 assert.throws(()=>parseSmsJournal({receipts:[row,row]}),/journal/);
 assert.throws(()=>parseSmsJournal({receipts:[{...row,status:'delivered'}]}),/SMS/);
 assert.throws(()=>parseSmsJournal({receipts:[{...row,body:'must not leak'}]}),/SMS/);
 const {plugin,calls}=stub({smsSendHistory:{receipts:[row]}});
 assert.equal((await createAospTelephony(plugin,true).smsSendHistory())[0].status,'unknown');
 assert.deepEqual(calls.map(([method])=>method),['smsSendHistory']);
 await assert.rejects(createAospTelephony(plugin,false).smsSendHistory(),TelephonyUnavailable);
});


test("standalone SMS stays unavailable at the UI and agent boundaries", async () => {
  // UI: the Messages view stays deferred and no image view adapter is admitted for it.
  const { ADMITTED_AOSP_VIEW_ADAPTERS, admittedAospViews } = await import("../apps/app/src/runtime/aosp-image.ts");
  assert.ok(ADMITTED_AOSP_VIEW_ADAPTERS.includes("messages"));
  assert.deepEqual(admittedAospViews(false, ["messages", "phone", "contacts"]), []);
  // Agent SMS is negotiated only by the verified image, then validated by the reviewed shared contract.
  // One negotiation (deviceCapabilities) serves the resident, remote and Cloud runtimes.
  const {selectDeviceCapabilities}=await import("../apps/app/src/runtime/phone-context.ts");
  const profile={android:true,native:true,camera:false,foregroundReview:false,clockRepeatDays:false,aospImage:false};
  assert.equal(selectDeviceCapabilities(["sms.send.v1"],profile).includes("sms.send.v1"),false,"a standalone APK never negotiates SMS");
  assert.equal(selectDeviceCapabilities(["sms.send.v1"],{...profile,aospImage:true}).includes("sms.send.v1"),true,"the image negotiates SMS when the agent offers it");
  assert.equal(selectDeviceCapabilities([],{...profile,aospImage:true}).includes("sms.send.v1"),false);
});
