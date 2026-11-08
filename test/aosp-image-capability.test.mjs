// Alpha AOSP image capability (P-36, issue #420): renderer detection, image staging output and the
// native gating contract, checked from source. No APK build, emulator or image boot is involved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectAospImage, admittedAospViews, AOSP_IMAGE_VIEWS, ADMITTED_AOSP_VIEW_ADAPTERS } from "../apps/app/src/runtime/aosp-image.ts";
import { IMAGE_FEATURE_VERSION, imageFeatureName, renderImageCapability, writeImageCapability } from "../scripts/aosp-image-capability.mjs";

const PKG = "ai.elizaresearch.alphaphone";
const read = file => fs.readFileSync(file, "utf8");
const JAVA = "android/app/src/main/java/ai/elizaresearch/alphaphone";
const header = (methods = ["imageCapability", "status"]) => ({ name: "AlphaTelephony", methods: methods.map(name => ({ name, rtype: "promise" })) });

test("the renderer sees the image only through the native image-only plugin on Android", () => {
  assert.equal(detectAospImage("android", [header()]), true);
  assert.equal(detectAospImage("web", [header()]), false, "a browser never has the image");
  assert.equal(detectAospImage("ios", [header()]), false);
  assert.equal(detectAospImage("android", []), false, "standalone and sideloaded launcher installs register no plugin");
  assert.equal(detectAospImage("android", undefined), false);
  assert.equal(detectAospImage("android", [header(["status"])]), false, "the capability method itself must be registered");
  assert.equal(detectAospImage("android", [{ name: "DeviceApps", methods: [{ name: "imageCapability" }] }]), false);
});

test("image views open only on the image and only with an admitted adapter", () => {
  assert.deepEqual([...AOSP_IMAGE_VIEWS].sort(), ["contacts", "messages", "phone"]);
  assert.deepEqual(ADMITTED_AOSP_VIEW_ADAPTERS, ["messages", "phone"], "only the implemented native Messages and Phone adapters are admitted");
  assert.deepEqual(admittedAospViews(true), ["messages", "phone"]);
  assert.deepEqual(admittedAospViews(false), [], "a standalone or sideloaded install admits no phone view");
  assert.deepEqual(admittedAospViews(false, ["contacts"]), [], "no install without the image admits a view");
  assert.deepEqual(admittedAospViews(true, ["contacts", "wallet", "inbox"]), ["contacts"], "only image views can be admitted this way");
});

test("the renderer capability ignores URLs, storage, flags and the launcher flavor", () => {
  const source = read("apps/app/src/runtime/aosp-image.ts");
  for (const forbidden of [/location\./, /localStorage/, /sessionStorage/, /testMocksEnabled|VITE_ELIZA_DEV_ALLOW_TEST_MOCKS/, /IS_LAUNCHER|buildInfo|launcher\s*[:=]/])
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), forbidden);
  const features = read("apps/app/src/prototype/mvp-features.ts");
  assert.match(features, /admittedAospViews\(aospImage\)/);
  assert.match(features, /new Set\(\["phone", "messages", "contacts", "wallet"\]\.filter\(view => !ENABLED_MVP_VIEWS\.has\(view\)\)\)/, "restored state, routes and deep links drop every unavailable view");
});

test("image staging declares the versioned system feature in the product partition", t => {
  assert.equal(imageFeatureName(PKG), `${PKG}.aosp_image`);
  assert.throws(() => imageFeatureName("Not a package"), /Invalid package/);
  const files = renderImageCapability(PKG);
  const xml = files[`image-capability/${PKG}.aosp_image.xml`];
  assert.match(xml, new RegExp(`<feature name="${PKG.replaceAll(".", "\\.")}\\.aosp_image" version="${IMAGE_FEATURE_VERSION}" />`));
  assert.match(files.productMakefile, new RegExp(`PRODUCT_COPY_FILES \\+= \\$\\(image_capability_dir\\)/${PKG.replaceAll(".", "\\.")}\\.aosp_image\\.xml:\\$\\(TARGET_COPY_OUT_PRODUCT\\)/etc/permissions/`));
  assert.doesNotMatch(files.productMakefile, /\bALPHA_/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-image-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, "product.mk"), "PRODUCT_PACKAGES += AlphaPhone\n");
  writeImageCapability(out, PKG);
  assert.ok(fs.existsSync(path.join(out, `image-capability/${PKG}.aosp_image.xml`)));
  assert.match(read(path.join(out, "product.mk")), /etc\/permissions/);
  assert.throws(() => writeImageCapability(out, PKG), /EEXIST/);
});

test("staging, native check and feature declaration agree", () => {
  const stage = read("scripts/stage-aosp.mjs");
  const call = stage.indexOf("writeImageCapability(output, identity.appId)");
  assert.ok(call > 0, "stage-aosp writes the image capability");
  // The production-only provisioning overlay comes after the capability (an earlier production branch
  // only refuses an incomplete product lock), so development and production images both declare it.
  assert.ok(call < stage.indexOf("writeProvisioningOverlay(output"), "development and production images both declare it");
  const admission = stage.indexOf("\nadmitApk({");
  assert.ok(admission > stage.indexOf("function admitApk("), "the admission call site, not the definition");
  assert.ok(admission > 0 && admission < call, "test-mocks and non-distributable APKs are refused before the capability is written");
  // Pixel 10a takes the declaration from the shared composition every brand uses; it is never written twice.
  assert.match(stage, /if \(!physical\) \{\n  const capability = writeImageCapability\(output, identity\.appId\);/);
  assert.match(read("vendor/eliza/packages/os/scripts/android/pixel10a-product.ts"), /writeImageCapability\(output, launcher\.packageName\)/);
  assert.match(read("scripts/aosp-image-capability.mjs"), /from "\.\.\/vendor\/eliza\/packages\/os\/scripts\/android\/image-capability\.mjs"/);
  // The on-device decision is the shared plugin-native-messages ImageCapability; Alpha passes only its build flags and resource.
  const shared = read("vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/ImageCapability.java");
  assert.match(shared, new RegExp(`public static final int FEATURE_VERSION = ${IMAGE_FEATURE_VERSION};`));
  assert.match(shared, /return packageName \+ "\.aosp_image";/);
  assert.match(shared, /return launcherBuild && !debugBuild && !testMocks && systemInstalled && provisioned && imageFeature;/, "every fact is required");
  assert.match(shared, /if \(!provisioned\(context\)\) return false;/, "telephony cannot bypass the production RRO capability");
  assert.match(shared, /ApplicationInfo\.FLAG_SYSTEM/);
  assert.match(shared, /hasSystemFeature\(featureName\(app\.getPackageName\(\)\), FEATURE_VERSION\)/);
  const capabilities = read(`${JAVA}/AlphaImageCapabilities.java`);
  assert.match(capabilities, /new ImageCapability\(BuildConfig\.IS_LAUNCHER,BuildConfig\.DEBUG,\s*BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS,R\.bool\.alpha_aosp_image_capability\)/);
  const capability = read(`${JAVA}/AlphaImageCapability.java`);
  assert.match(capability, /return AlphaImageCapabilities\.IMAGE\.admitted\(context\);/);
  assert.doesNotMatch(capability + capabilities, /\.hasSystemFeature\(|ApplicationInfo\.FLAG_SYSTEM|getBoolean\(/, "Alpha keeps no copy of the decision");
});

test("the telephony plugin is registered and answers only on the verified image", () => {
  const main = read(`${JAVA}/MainActivity.java`);
  assert.match(main, /if \(AlphaImageCapability\.verified\(this\)\) registerPlugin\(AlphaTelephonyPlugin\.class\);/);
  assert.equal((main.match(/AlphaTelephonyPlugin/g) || []).length, 1, "no unconditional registration");
  assert.doesNotMatch(main, /plugins\.contacts\.ContactsPlugin|MessagesPlugin|PhonePlugin/, "upstream telephony plugins with write paths are not registered");
  // Alpha's subclass adds contact search to the shared TelephonyPlugin base; both are checked.
  const alpha = read(`${JAVA}/AlphaTelephonyPlugin.java`);
  const plugin = read("vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/TelephonyPlugin.java") + "\n" + alpha;
  assert.match(alpha, /public class AlphaTelephonyPlugin extends TelephonyPlugin \{/);
  assert.match(alpha, /protected SmsTelephonyConfiguration configuration\(\) \{ return AlphaTelephony\.CONFIGURATION; \}/);
  // Every @PluginMethod, overrides of Capacitor's inherited permission methods included.
  const methods = [...plugin.matchAll(/@PluginMethod public void (\w+)\(PluginCall call\)\s*\{\s*([^\n]*)/g)];
  assert.equal(methods.length, (plugin.match(/@PluginMethod/g) || []).length, "no plugin method escapes the check");
  assert.deepEqual(methods.map(m => m[1]).sort(), ["cancelSmsReview", "checkPermissions", "composeSms", "dial", "imageCapability", "listMessages", "listRecentCalls", "listThreads", "markThreadRead", "mmsSendResult", "observeMessages", "requestAccess", "requestPermissions", "requestRole", "searchContacts", "sendMms", "sendSms", "smsSendHistory", "smsSendResult", "status"]);
  for (const [, name, first] of methods) assert.match(first, /^if \(!?refused\(call\)\)/, `${name} re-checks the capability before anything else`);
  for (const callback of plugin.matchAll(/@(?:Permission|Activity)Callback private void (\w+)\([^)]*\) \{ (.*)/g)) assert.match(callback[2], /refused\(call\)/, `${callback[1]} re-checks the capability`);
  assert.doesNotMatch(plugin, /sendTextMessage|sendMultipartTextMessage|ACTION_CALL\b|placeCall|WRITE_CONTACTS|insert\(|applyBatch/, "no direct call or contact write; native SMS dispatch lives only in the shared SmsTelephony behind the native review");
  assert.equal((plugin.match(/SmsTelephony\.dispatch\(/g) || []).length, 1, "one dispatch site, inside the owner's Send decision");
  assert.match(plugin, /Intent\.ACTION_DIAL/); assert.match(plugin, /Intent\.ACTION_SENDTO/);
  assert.match(plugin, /if \(!eligibleFor\(role\)\)/, "a role request Android could only refuse is never shown");
});

test("the Home Phone shortcut exists only in the launcher build (P-36)", () => {
  const system = read(`${JAVA}/AlphaSystemPlugin.java`);
  assert.match(system, /@Override protected boolean isDefaultAppEnabled\(String role\)\{return BuildConfig\.IS_LAUNCHER&&AlphaImageCapabilities\.defaultAppEnabled\(getContext\(\),role\);\}/, "standalone resolves no dial hand-off, so the drawer shows no Phone entry; the shared ElizaSystem refuses resolve and open alike");
  assert.match(system, /isLauncherBuild\(\)\{return BuildConfig\.IS_LAUNCHER;\}/, "the shared build read reports Alpha's launcher flavor");
});

test("no Alpha Java lists or launches apps: installed apps and default hand-offs are the shared ElizaSystem", () => {
  assert.equal(fs.existsSync(`${JAVA}/DeviceAppsPlugin.java`), false);
  const product = read(`${JAVA}/AlphaDeviceAppsPlugin.java`);
  assert.deepEqual([...product.matchAll(/@PluginMethod public void (\w+)/g)].map(m => m[1]), ["platformCapabilities"]);
  // The password-provider hand-off opens one verified-publisher app by package; it is not the
  // launcher inventory. Nothing else in Alpha may list or launch apps.
  const handoffs = new Set(["PasswordProviderSupport.java"]);
  // App info (the Apps drawer's long-press menu) needs only the package in the entry's profile:
  // a disabled app or one in a paused or locked work profile still opens Android's App details
  // (where it is enabled again); a removed app or profile is refused. It resolves no launch.
  const system = read(`${JAVA}/AlphaSystemPlugin.java`);
  const info = system.slice(system.indexOf("@PluginMethod public void openAppInfo("));
  assert.ok(info.length < system.length, "AlphaSystemPlugin.openAppInfo exists");
  assert.equal((system.match(/SystemLauncherApps\.resolve\(/g) || []).length, 0, 'App info is not refused like a launch');
  assert.doesNotMatch(info, /SystemLauncherApps\.(PROFILE_LOCKED|DISABLED)\b/);
  assert.match(info, /getPackageManager\(\)\.getApplicationInfo\(name,PackageManager\.MATCH_DISABLED_COMPONENTS\)/);
  assert.match(info, /launcher\.getApplicationInfo\(name,PackageManager\.MATCH_DISABLED_COMPONENTS,handle\)/);
  assert.match(info, /startAppDetailsActivity\(new ComponentName\(name,activity==null\|\|activity\.isEmpty\(\)\?name:activity\),handle,null,null\)/);
  assert.match(info, /Settings\.ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/AppInfoInstrumentedTest.java'), /com\.android\.settings/, 'App info has a device test');
  for (const name of fs.readdirSync(JAVA).filter(file => file.endsWith(".java") && !handoffs.has(file))) {
    const source = read(`${JAVA}/${name}`), checked = source;
    assert.doesNotMatch(checked, /SystemLauncherApps\.(list|launchIntent|resolve)\(|getLaunchIntentForPackage|startMainActivity|CATEGORY_LAUNCHER/, `${name} lists or launches no app`);
  }
});

test("permissions: standalone has none, the launcher declares read access only, nothing writes", () => {
  const main = read("android/app/src/main/AndroidManifest.xml");
  const launcher = read("android/app/src/launcher/AndroidManifest.xml");
  const standalone = read("android/app/src/standalone/AndroidManifest.xml");
  const declared = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")[^>]*\/>/g)].map(m => m[1]);
  const removed = xml => [...xml.matchAll(/<uses-permission android:name="([^"]+)"[^>]*tools:node="remove"[^>]*\/>/g)].map(m => m[1]);
  for (const permission of ["READ_CONTACTS", "READ_PHONE_STATE"]) {
    assert.ok(!declared(main).includes(`android.permission.${permission}`), `main does not declare ${permission}`);
    assert.ok(declared(launcher).includes(`android.permission.${permission}`), `launcher declares ${permission}`);
    assert.ok(removed(standalone).includes(`android.permission.${permission}`), `standalone removes ${permission}`);
  }
  assert.ok(removed(main).includes("android.permission.WRITE_CONTACTS"), "contact writes are removed from every build");
  for (const xml of [main, launcher, standalone])
    for (const permission of ["WRITE_CALL_LOG", "ANSWER_PHONE_CALLS", "MANAGE_OWN_CALLS"])
      assert.ok(!declared(xml).includes(`android.permission.${permission}`), `${permission} is not declared`);
  // Recent calls (AP-08): the launcher reads them on the verified image; no other build declares it.
  assert.ok(declared(launcher).includes("android.permission.READ_CALL_LOG"), "launcher declares READ_CALL_LOG");
  assert.ok(!declared(main).includes("android.permission.READ_CALL_LOG"), "main does not declare READ_CALL_LOG");
  assert.ok(removed(standalone).includes("android.permission.READ_CALL_LOG"), "standalone removes READ_CALL_LOG");
  const plugin = read("android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaTelephonyPlugin.java");
  assert.match(plugin, /@Permission\(alias = "callLog", strings = \{ Manifest\.permission\.READ_CALL_LOG \}\)/, "the image plugin declares the optional call-log alias");
  // CALL_PHONE reaches only the dialer-role holder, and only the launcher can be offered that role.
  assert.ok(declared(launcher).includes("android.permission.CALL_PHONE") && !declared(main).includes("android.permission.CALL_PHONE"));
  assert.ok(removed(standalone).includes("android.permission.CALL_PHONE"), "standalone removes CALL_PHONE from the shared phone module");
  // The ringing-call screen is a full-screen intent, which Android drops without this permission; only the
  // launcher has the dialer role's call service, and only that service posts one.
  assert.ok(declared(launcher).includes("android.permission.USE_FULL_SCREEN_INTENT"), "launcher declares USE_FULL_SCREEN_INTENT for the incoming-call screen");
  assert.ok(!declared(main).includes("android.permission.USE_FULL_SCREEN_INTENT") && !declared(standalone).includes("android.permission.USE_FULL_SCREEN_INTENT"), "no other build asks for full-screen intents");
  // RECEIVE_* reach only the SMS-role holder; only the launcher can be offered that role.
  for (const permission of ["RECEIVE_SMS", "RECEIVE_MMS", "RECEIVE_WAP_PUSH"]) {
    assert.ok(declared(launcher).includes(`android.permission.${permission}`) && !declared(main).includes(`android.permission.${permission}`));
    assert.ok(removed(standalone).includes(`android.permission.${permission}`));
  }
  // SMS reads and reviewed sends (#421): launcher flavor only, never main or standalone.
  for (const permission of ["SEND_SMS", "READ_SMS"]) {
    assert.ok(!declared(main).includes(`android.permission.${permission}`) && !declared(standalone).includes(`android.permission.${permission}`), `${permission} is launcher-only`);
    assert.ok(declared(launcher).includes(`android.permission.${permission}`), `launcher declares ${permission}`);
  }
  assert.match(launcher, /android\.intent\.action\.SENDTO"\/><data android:scheme="smsto"/);
  assert.doesNotMatch(main, /<intent><action android:name="android\.intent\.action\.SENDTO"\/><data android:scheme="smsto"\/><\/intent>/, "only the image-capable flavor can see SMS handlers");
});

test("telephony shares the bounded Contacts provider adapter", () => {
  const plugin=read(`${JAVA}/AlphaTelephonyPlugin.java`);
  assert.match(plugin,/new ContactsCatalog\(getContext\(\)\)\.list\(query, limit, cancel\)/);
  assert.doesNotMatch(plugin,/ContactsReader/);
});
test("queued contacts cannot return data after access or lifecycle changes", () => {
  // AlphaContactsPlugin inherits the shared AOSP-profile address book's fence.
  assert.match(read(`${JAVA}/AlphaContactsPlugin.java`),/extends AddressBookPlugin/);
  const contacts=read('vendor/eliza/plugins/plugin-native-contacts/android/src/main/java/ai/eliza/plugins/contacts/AddressBookPlugin.java');
  assert.match(contacts,/handleOnResume/);assert.match(contacts,/ACTION_SCREEN_OFF/);
  assert.match(contacts,/handleOnPause/);assert.match(contacts,/handleOnDestroy/);
  assert.match(contacts,/runOnUiThread/);assert.match(contacts,/ticket == generation\.get\(\)/);
  // AlphaTelephonyPlugin's reads (contact search included) use the shared base's fence.
  const shared=read('vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/TelephonyPlugin.java');
  assert.match(shared,/handleOnResume/);assert.match(shared,/ACTION_SCREEN_OFF/);
  assert.match(shared,/handleOnPause/);assert.match(shared,/handleOnDestroy/);
  assert.match(shared,/main\.post\(\(\) -> \{\n      if \(fenceResult && !current\(access, cancel, alias\)\)/);assert.match(shared,/protected final void fencedRead\(PluginCall call, String alias, String noun, Read read\) \{ fenced\(call, alias, noun, read, true\); \}/,'reads are fenced again before their result is published');assert.match(shared,/access == generation\.get\(\)/);
  assert.match(read(`${JAVA}/AlphaTelephonyPlugin.java`),/fencedRead\(call, "contacts", "Contacts"/);
});

test("dialer- and SMS-role components exist only in the launcher, disabled until the image is verified", () => {
  const launcher = read("android/app/src/launcher/AndroidManifest.xml"), standalone = read("android/app/src/standalone/AndroidManifest.xml"), main = read("android/app/src/main/AndroidManifest.xml");
  const component = name => launcher.match(new RegExp(`<(?:service|activity|receiver) android:name="\\.${name}"[^>]*>`))?.[0] ?? "";
  for (const name of ["AlphaInCallService", "AlphaCallActivity", "AlphaDialPadActivity", "AlphaSmsDeliverReceiver", "AlphaMmsWapPushReceiver", "AlphaMmsResultReceiver", "AlphaRespondViaMessageService", "AlphaSmsComposeActivity"]) {
    assert.match(component(name), /android:enabled="false"/, `${name} is declared disabled`);
    assert.doesNotMatch(main + standalone, new RegExp(name), `${name} is launcher-only`);
  }
  assert.match(component("AlphaInCallService"), /android:permission="android\.permission\.BIND_INCALL_SERVICE"/, "only Telecom can bind the call service");
  assert.match(component("AlphaCallActivity"), /android:exported="false"/);
  assert.match(component("AlphaSmsDeliverReceiver"), /android:permission="android\.permission\.BROADCAST_SMS"/);
  assert.match(component("AlphaMmsWapPushReceiver"), /android:permission="android\.permission\.BROADCAST_WAP_PUSH"/);
  assert.match(component("AlphaRespondViaMessageService"), /android:permission="android\.permission\.SEND_RESPOND_VIA_MESSAGE"/);
  assert.match(component("AlphaMmsResultReceiver"), /android:exported="false"/);
  assert.match(launcher, /<provider android:name="ai\.eliza\.plugins\.messages\.MmsFileProvider" android:authorities="\$\{applicationId\}\.mms" android:enabled="false" android:exported="false" android:grantUriPermissions="true" \/>/);
  assert.match(read("android/app/src/launcher/java/ai/elizaresearch/alphaphone/AlphaTelephonyRoles.java"), /AlphaSmsDeliverReceiver\.class, AlphaMmsWapPushReceiver\.class, AlphaMmsResultReceiver\.class, AlphaRespondViaMessageService\.class, AlphaSmsComposeActivity\.class, ai\.eliza\.plugins\.messages\.MmsFileProvider\.class/);
  assert.match(launcher, /android\.telecom\.IN_CALL_SERVICE_UI" android:value="true"/);
  const roles = read("android/app/src/launcher/java/ai/elizaresearch/alphaphone/AlphaTelephonyRoles.java");
  assert.match(roles, /boolean image = AlphaImageCapability\.verified\(context\);/);
  assert.match(roles, /int wanted = image \? PackageManager\.COMPONENT_ENABLED_STATE_ENABLED : PackageManager\.COMPONENT_ENABLED_STATE_DEFAULT;/, "anything but the verified image returns to the disabled manifest state");
  assert.match(read("android/app/src/standalone/java/ai/elizaresearch/alphaphone/AlphaTelephonyRoles.java"), /static void sync\(Context context\) \{\}/);
  const activity = read(`${JAVA}/MainActivity.java`);
  assert.ok(activity.indexOf("AlphaTelephonyRoles.sync(this);") > 0 && activity.indexOf("AlphaTelephonyRoles.sync(this);") < activity.indexOf("registerPlugin(AlphaTelephonyPlugin.class)"), "roles follow the image before the plugin is registered");
  // The shared surfaces place calls only from the owner's press and leave emergency routing to Telecom.
  const shared = "vendor/eliza/plugins/plugin-native-phone/android/src/main/java/ai/eliza/plugins/phone";
  const pad = read(`${shared}/TelecomDialPadActivity.java`), dial = read(`${shared}/TelecomDial.java`);
  assert.equal((pad.match(/TelecomDial\.originate\(/g) || []).length, 1, "one placement, from the Call press");
  assert.match(pad, /call\.setOnClickListener\(view -> place\(\)\);/); assert.match(pad, /call\.setFilterTouchesWhenObscured\(true\)/);
  assert.match(dial, /telecom\.placeCall\(telUri, extras\)/);
  const apk = read("scripts/apk.mjs");
  assert.match(apk, /"ai\.elizaresearch\.alphaphone\.AlphaInCallService": "android\.permission\.BIND_INCALL_SERVICE"/);
  assert.match(apk, /if \(data\.xml\.includes\('android\.permission\.CALL_PHONE'\) !== wantsHome\)/);
  // Per-flavor recent-calls packaging: launcher only, and call-log writes never.
  assert.match(apk, /if \(data\.xml\.includes\('android\.permission\.READ_CALL_LOG'\) !== wantsHome\)/);
  assert.match(apk, /for \(const permission of \['WRITE_CALL_LOG', 'MANAGE_OWN_CALLS', 'ANSWER_PHONE_CALLS'\]\)/);
});
