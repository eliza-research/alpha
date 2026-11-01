// AOSP SMS/MMS contract (issue #421): the native journal and provider mapping on the JVM, the renderer
// contract against a recording stub, and source checks of the native and manifest boundaries. No SIM,
// radio, provider, image or carrier is involved; nothing here establishes a real send or delivery.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createAospTelephony, TelephonyUnavailable, parseTelephonyStatus, parseThreads, parseMessages, parseSmsSendResult, parseSmsJournal, smsBindingText, smsBindingHash, reviewSms } from "../apps/app/src/runtime/aosp-telephony.ts";

const root = resolve(import.meta.dirname, "..");
const JAVA = join(root, "android/app/src/main/java/ai/elizaresearch/alphaphone");
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
  const java = name => process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", name) : name;
  try {
    execFileSync(java("javac"), ["--release", "11", "-d", dir, ...["SmsSendJournal", "SmsRecords", "SmsPageCursor"].map(name => join(SHARED, `${name}.java`)), join(root, "test/fixtures/SmsSendJournalTest.java")], { timeout: 60000 });
    const body = "Running late \"5\" min\né😀\t\u0001";
    const expected = createHash("sha256").update(smsBindingText({ recipients: ["+15555550100", "5550101"], body, subscriptionId: 3 })).digest("hex");
    const namespace = read("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaTelephony.java").match(/"(alpha-sms-operation:v1:)"/)[1];
    assert.match(execFileSync(java("java"), ["-Djava.io.tmpdir=" + dir, "-cp", dir, "ai.eliza.plugins.messages.SmsSendJournalTest", expected, namespace], { encoding: "utf8", timeout: 120000 }), /PASS alpha sms journal compatibility/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Alpha keeps its installed SMS identity when using the shared core", () => {
  const identity = read("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaTelephony.java");
  for (const value of ["sms-send-ledger:v1:device", "alpha-sms-sends.journal", "alpha-sms-operation:v1:", "ai.elizaresearch.alphaphone.SMS_SENT", "ai.elizaresearch.alphaphone.SMS_DELIVERED", "alphaphone-sms", "operationId", "partIndex"])
    assert.ok(identity.includes(`"${value}"`), `installed identity ${value} is kept`);
  assert.match(identity, /AlphaSmsSendReceiver\.class, AlphaImageCapability::verified,/, "callbacks keep the installed receiver; admission is the verified image");
  assert.match(identity, /store\.readCredentialSlot\(slot\)/); assert.match(identity, /store\.writeCredentialSlot\(slot, value\)/);
  for (const retired of ["AlphaSms", "SmsSendJournal", "SmsRecords", "SmsPageCursor"]) assert.equal(existsSync(join(JAVA, `${retired}.java`)), false, `${retired} is the shared implementation, not an Alpha copy`);
});

test("binding text equals the shared sms.send.v1 contract field order", async () => {
  const review = { recipients: ["+15555550123"], body: "Exact SMS fixture", subscriptionId: 3 };
  assert.equal(smsBindingText(review), JSON.stringify({ body: review.body, recipients: review.recipients, subscriptionId: 3, type: "sms_send" }));
  assert.equal(await smsBindingHash(review), createHash("sha256").update(smsBindingText(review)).digest("hex"));
});

test("off the verified image no message read, observer or send reaches native code", async () => {
  const { plugin, calls } = stub();
  for (const client of [createAospTelephony(null, false), createAospTelephony(plugin, false)]) {
    await assert.rejects(client.listThreads(), TelephonyUnavailable);
    await assert.rejects(client.listMessages("thread:1"), TelephonyUnavailable);
    await assert.rejects(client.observeMessages(() => {}), TelephonyUnavailable);
    await assert.rejects(client.sendSms({ recipients: ["+15555550100"], body: "x", subscriptionId: 3 }, "op-1"), TelephonyUnavailable);
    await assert.rejects(client.smsSendResult({ recipients: ["+15555550100"], body: "x", subscriptionId: 3 }, "op-1"), TelephonyUnavailable);
    await assert.rejects(client.requestAccess("sms"), TelephonyUnavailable);
  }
  assert.deepEqual(calls, []);
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

test("native boundary: image-only plugin methods, immutable explicit callbacks, journal before dispatch", () => {
  const plugin = readFileSync(join(SHARED, "TelephonyPlugin.java"), "utf8");
  const sms = readFileSync(join(SHARED, "SmsTelephony.java"), "utf8");
  const alpha = read("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaTelephonyPlugin.java");
  const receiver = read("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaSmsSendReceiver.java");
  // Reads: READ_SMS, generation fence before and after the provider read, cancellation.
  assert.match(alpha, /alias = "sms", strings = \{ Manifest\.permission\.READ_SMS \}/);
  assert.match(alpha, /alias = "sendSms", strings = \{ Manifest\.permission\.SEND_SMS \}/);
  assert.match(alpha, /public class AlphaTelephonyPlugin extends TelephonyPlugin/);
  assert.match(plugin, /if \(!current\(access, cancel, alias\)\) throw new SecurityException\(\);/);
  assert.match(plugin, /if \(fenceResult && !current\(access, cancel, alias\)\) call\.reject\(noun \+ " access changed/);
  assert.match(plugin, /fencedRead\(PluginCall call, String alias, String noun, Read read\) \{ fenced\(call, alias, noun, read, true\); \}/, "every read is re-fenced before its result is published");
  assert.match(plugin, /return !cancel\.isCanceled\(\) && access == generation\.get\(\) && unlockedForeground\(\) && admitted\(\) && getPermissionState\(alias\) == PermissionState\.GRANTED;/);
  assert.match(alpha, /fencedRead\(call, "contacts", "Contacts", cancel ->/, "contact search uses the same fence");
  // Observation is coalesced, content-free and stops on pause, lock and screen-off.
  assert.match(plugin, /main\.postDelayed\(emitChange, 750\)/);
  assert.match(plugin, /private void invalidateReads\(\) \{[^\n]*stopObserving\(\); cancelReview\(\); \}/);
  assert.doesNotMatch(plugin.slice(plugin.indexOf("private final Runnable emitChange"), plugin.indexOf("private final android.database.ContentObserver")), /body|address/i);
  // Sends: native review, re-checked at the decision, journal before the first platform call.
  assert.match(plugin, /existing = journal\.existing\(operationId,/);
  assert.match(plugin, /if \(existing != null\) \{ call\.resolve\(SmsTelephony\.result\(existing\)\); return; \}/, "a repeated ID never reviews or sends again");
  assert.match(plugin, /\.setPositiveButton\("Send"/);
  assert.match(plugin, /if \(!admitted\(\) \|\| !unlockedForeground\(\) \|\| sendBlocker\(sub\) != null\)/);
  assert.equal((plugin.match(/SmsTelephony\.dispatch\(/g) || []).length, 1, "one dispatch site, inside the owner's Send decision");
  const begin = sms.indexOf("journal.beginDispatch("), first = sms.indexOf("manager.sendTextMessage(");
  assert.ok(begin > 0 && begin < first && begin < sms.indexOf("manager.sendMultipartTextMessage("), "journaled before the first platform call");
  // Holding the SMS role, Alpha writes its own sent rows (Android writes none for the default SMS app):
  // each recipient's outbox row precedes its platform call, and only that recipient's sent callbacks settle it.
  const own = sms.indexOf("if (ownsRows) storeOwnRow(");
  assert.ok(own > begin && own < first, "the default SMS app stores its own row before the platform call");
  assert.match(sms, /final boolean ownsRows = MmsStore\.isDefaultSmsApp\(context\);/);
  assert.match(sms, /if \(sent\) settleOwnRow\(app, journal, operation, index\);/);
  const store = readFileSync(join(SHARED, "MmsStore.java"), "utf8");
  assert.match(store, /Telephony\.Sms\.TYPE \+ " = \? AND " \+ Telephony\.Sms\.CREATOR \+ " = \?"/, "only outbox rows Alpha created are settled");
  // SMS callbacks are immutable: the framework can only report the result code.
  const smsCallback = sms.slice(sms.indexOf("private static PendingIntent callback("), sms.indexOf("public interface DispatchGuard"));
  assert.match(smsCallback, /PendingIntent\.FLAG_IMMUTABLE \| PendingIntent\.FLAG_ONE_SHOT/);
  assert.doesNotMatch(smsCallback, /FLAG_MUTABLE/);
  // The one mutable callback is the MMS sent intent, which must carry the carrier's M-Send.conf; it stays
  // explicit and one-shot, and its operation is accepted only when it matches the immutable data URI.
  assert.equal((sms.match(/FLAG_MUTABLE/g) || []).length, 1);
  const mmsDispatch = sms.slice(sms.indexOf("static SmsSendJournal.Record dispatchMms("), sms.indexOf("static boolean sendConfirmed("));
  assert.match(mmsDispatch, /PendingIntent\.FLAG_MUTABLE : 0;\n\s*PendingIntent sent = PendingIntent\.getBroadcast\(context, 0, intent, mutable \| PendingIntent\.FLAG_ONE_SHOT\);/);
  assert.match(mmsDispatch, /setClass\(context, config\.receiverClass\)\.setPackage\(context\.getPackageName\(\)\)/);
  assert.ok(mmsDispatch.indexOf("journal.beginMmsDispatch(") < mmsDispatch.indexOf("manager.sendMultimediaMessage("), "MMS journaled before the platform call");
  assert.match(sms, /if \(mmsFile != null && !Uri\.fromParts\(config\.callbackScheme, operation \+ "\/mms", null\)\.equals\(intent\.getData\(\)\)\) return;/);
  assert.equal((plugin.match(/SmsTelephony\.dispatchMms\(/g) || []).length, 1, "one MMS dispatch site, inside the owner's Send decision");
  assert.match(plugin, /if \(!admitted\(\) \|\| !unlockedForeground\(\) \|\| mmsBlocker\(sub\) != null\) \{ decideMms\(/);
  assert.match(sms, /setClass\(context, config\.receiverClass\)\.setPackage\(context\.getPackageName\(\)\)/);
  assert.match(sms, /createForSubscriptionId\(subscriptionId\)/);
  assert.match(sms, /getSmsManagerForSubscriptionId\(subscriptionId\)/);
  assert.match(plugin, /divideMessage\(body\)/);
  assert.doesNotMatch(sms + plugin + alpha + receiver, /\bresend|retry\(/i, "no automatic resend path");
  assert.match(sms, /if \(intent == null \|\| !config\.admission\.admitted\(context\)\) return;/);
  assert.match(receiver, /SmsTelephony\.handleCallback\(this, context, intent, AlphaTelephony\.CONFIGURATION\)/);
  // Provider-row matching: only rows the platform wrote for Alpha (creator), after the journal entry and
  // within a bounded window, so an identical text from another app or the owner is never claimed.
  const find = sms.slice(sms.indexOf("private static long findRow("));
  assert.match(find, /Telephony\.Sms\.CREATOR \+ " = \?/, "the row must be Alpha's own");
  assert.match(find, /Long\.toString\(record\.createdAt\), Long\.toString\(record\.createdAt \+ ROW_WINDOW_MS\)/, "no row from before the journal entry");
  assert.doesNotMatch(find, /createdAt - /);
  // The owner's Send tap cannot be steered by an overlay; an expired operation ID is refused, never resent.
  assert.match(plugin, /send\.setFilterTouchesWhenObscured\(true\)/);
  assert.match(plugin, /catch \(SmsSendJournal\.Expired expired\) \{ call\.reject\(/);
  assert.match(sms, /receiver\.getResultCode\(\) == Activity\.RESULT_OK/, "sent only from a successful sent callback");
  assert.match(plugin, /main.post\(\(\) -> reviewSmsOnMain\(call\)\);/, "review is marshalled from Capacitor's plugin thread to main");
  assert.match(plugin, /private void reviewSmsOnMain\(PluginCall call\) \{\n  if \(refused\(call\)\) return;/, "admission is rechecked on main before review");
  // Read state: only the default SMS app's write counts, only received messages through the shown one, behind the
  // entry fence; the write's count is still reported if access changes afterwards (the rows were already marked).
  assert.match(plugin, /fencedWrite\(call, "sms", "Messages", cancel -> \{\n   JSObject value = new JSObject\(\);\n   boolean holder = MmsStore\.isDefaultSmsApp\(getContext\(\)\);/);
  assert.match(plugin, /value\.put\("updated", holder \? MmsStore\.markThreadRead\(getContext\(\), thread, through\) : 0\);/);
  const marker = store.slice(store.indexOf("public static int markThreadRead("), store.indexOf("public static boolean hasTransaction("));
  assert.match(marker, /Telephony\.Sms\.TYPE \+ " = \? AND " \+ Telephony\.Sms\.DATE \+ " <= \?/, "only received texts up to the shown one");
  assert.match(marker, /Telephony\.Mms\.MESSAGE_BOX \+ " = \? AND " \+ Telephony\.Mms\.DATE \+ " <= \?/, "only received MMS up to the shown one");
  assert.match(marker, /SmsRecords\.mmsSecondsThrough\(throughMillis\)/, "MMS dates are seconds");
  assert.doesNotMatch(marker, /delete\(|insert\(/, "marking read never adds or removes messages");
  for (const method of ["listThreads", "listMessages", "markThreadRead", "observeMessages", "smsSendHistory", "smsSendResult"])
    assert.match(plugin, new RegExp(`@PluginMethod public void ${method}\\(PluginCall call\\) \\{\\n  if \\(refused\\(call\\)\\) return;`), `${method} re-checks the image capability first`);
});

test("manifests: SMS permissions and the result receiver exist only in the launcher flavor", () => {
  const main = read("android/app/src/main/AndroidManifest.xml"), launcher = read("android/app/src/launcher/AndroidManifest.xml"), standalone = read("android/app/src/standalone/AndroidManifest.xml");
  const declared = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")[^>]*\/>/g)].map(m => m[1]);
  const removed = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"[^>]*tools:node="remove"[^>]*\/>/g)].map(m => m[1]);
  for (const permission of ["READ_SMS", "SEND_SMS"]) {
    assert.ok(declared(launcher).includes(`android.permission.${permission}`));
    assert.ok(!declared(main).includes(`android.permission.${permission}`));
    assert.ok(removed(standalone).includes(`android.permission.${permission}`));
  }
  assert.match(launcher, /<receiver android:name="\.AlphaSmsSendReceiver" android:exported="false" \/>/);
  for (const permission of ["RECEIVE_SMS", "RECEIVE_MMS", "RECEIVE_WAP_PUSH"]) {
    assert.ok(declared(launcher).includes(`android.permission.${permission}`), `${permission} is declared for the image-only SMS role`);
    assert.ok(removed(standalone).includes(`android.permission.${permission}`));
  }
  assert.match(launcher, /<uses-feature android:name="android\.hardware\.telephony" android:required="false" \/>/, "telephony hardware stays optional");
  assert.doesNotMatch(main + standalone, /AlphaSmsSendReceiver/);
  assert.match(launcher, /<receiver android:name="\.AlphaSmsSendReceiver" android:exported="false" \/>/, "the receiver takes explicit intents only: no filter, not exported");
  const apk = read("scripts/apk.mjs");
  assert.match(apk, /for \(const permission of \['READ_SMS', 'SEND_SMS'\]\)/, "APK verification checks the packaged SMS permissions per flavor");
});

test("standalone SMS stays unavailable at the UI and agent boundaries", async () => {
  // UI: the Messages view stays deferred and no image view adapter is admitted for it.
  const features = read("apps/app/src/prototype/mvp-features.ts");
  assert.match(features, /\/\/ "messages",/, "the Messages view is not enabled");
  const { ADMITTED_AOSP_VIEW_ADAPTERS, admittedAospViews } = await import("../apps/app/src/runtime/aosp-image.ts");
  assert.ok(ADMITTED_AOSP_VIEW_ADAPTERS.includes("messages"));
  assert.deepEqual(admittedAospViews(false, ["messages", "phone", "contacts"]), []);
  // Agent SMS is negotiated only by the verified image, then validated by the reviewed shared contract.
  const connection=read("apps/app/src/runtime/connection-ui.tsx");
  // One negotiation (deviceCapabilities) serves the resident, remote and Cloud runtimes.
  assert.equal((connection.match(/if\(aospImage&&.*includes\(SMS_SEND_CAPABILITY\)/g)||[]).length,1);
  assert.match(connection.slice(connection.indexOf('async function deviceCapabilities('),connection.indexOf("return capabilities.join(',');")),/if\(aospImage&&agent\.includes\(SMS_SEND_CAPABILITY\)\)capabilities\.push\(SMS_SEND_CAPABILITY\);/);
  assert.equal((connection.match(/await deviceCapabilities\(/g)||[]).length,3);
  assert.match(read(".eliza/client-features/plugins/plugin-assistant/src/services/device-actions/client-coordinator.ts"),/claimed\.providerIdempotencyKey\s*!==\s*operationId/);
  assert.match(read("apps/app/src/prototype/agent-adapter.ts"),/if\(!aospImage\|\|expectedContext.sensitive/);
  const telephony = read("apps/app/src/runtime/aosp-telephony.ts");
  assert.doesNotMatch(telephony.replace(/\/\*[\s\S]*?\*\//g, ""), /location\.|localStorage|testMocksEnabled/, "nothing outside the native image capability turns messages on");
});
