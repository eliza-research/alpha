// AOSP listener staging (issue #424) from the checked-in image configuration and fabricated
// `aapt dump permissions` output. Not image-build, boot, grant or device evidence.
import test from "node:test";
import {execFileSync} from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FORBIDDEN, INDICATOR_EXEMPT_ROLES, LISTENER_SOURCE, UNPRIVILEGED, apkPermissions, checkListenerDescriptor, checkListenerOverlay, checkListenerPermissions, checkListenerSpeechBundle, checkListenerSpeechNatives, listenerPackage, listenerProductMakefile, privappPermissions, stageListener, verifyAospListener } from "../scripts/aosp-listener.mjs";

const root = path.resolve(import.meta.dirname, "..");
const APP = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8")).appId;
const PKG = listenerPackage(APP);
const read = name => fs.readFileSync(path.join(root, LISTENER_SOURCE, name), "utf8");
const privapp = read("permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml");
const overlay = read("overlay/frameworks/base/core/res/res/values/config.xml");
const manifestPermissions = () => [...fs.readFileSync(path.join(root, "android/sense/src/main/AndroidManifest.xml"), "utf8").replace(/<!--[\s\S]*?-->/g, "")
  .matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")/g)].map(match => match[1]);
const dump = (permissions = manifestPermissions(), pkg = PKG) =>
  [`package: ${pkg}`, ...permissions.map(name => `uses-permission: name='${name}'`), `permission: ${PKG}.permission.LISTENER_CONTROL`].join("\n");
const SIGNER = "a".repeat(64);

test("the privapp allowlist matches exactly the privileged permissions the listener manifest requests", () => {
  assert.equal(PKG, "ai.elizaresearch.alphaphone.sense");
  assert.deepEqual(privappPermissions(privapp, PKG), ["android.permission.CAPTURE_AUDIO_HOTWORD", "android.permission.START_ACTIVITIES_FROM_BACKGROUND"]);
  const { requested, privileged } = checkListenerPermissions(dump(), privapp, PKG);
  assert.deepEqual(requested.filter(name => !UNPRIVILEGED.includes(name)), privileged);
  for (const name of FORBIDDEN) assert.ok(!requested.includes(name) && !privileged.includes(name), name);
  assert.deepEqual(apkPermissions(dump()).packageName, PKG);
});

test("a listener with network, call/output capture or unreviewed permissions is refused", () => {
  for (const extra of ["android.permission.INTERNET", "android.permission.CAPTURE_AUDIO_OUTPUT", "android.permission.READ_PHONE_STATE", "android.permission.RECORD_BACKGROUND_AUDIO"])
    assert.throws(() => checkListenerPermissions(dump([...manifestPermissions(), extra]), privapp, PKG), /must not request/, extra);
  assert.throws(() => checkListenerPermissions(dump([...manifestPermissions(), "android.permission.READ_CONTACTS"]), privapp, PKG), /outside the reviewed set/);
  assert.throws(() => checkListenerPermissions(dump(manifestPermissions().filter(name => !name.endsWith("CAPTURE_AUDIO_HOTWORD"))), privapp, PKG), /does not request/);
  assert.throws(() => checkListenerPermissions(dump(manifestPermissions(), APP), privapp, PKG), /expected/);
  const widened = privapp.replace("</privapp-permissions>", '<permission name="android.permission.CAPTURE_AUDIO_OUTPUT" /></privapp-permissions>');
  assert.throws(() => checkListenerPermissions(dump(), widened, PKG), /must not request or be granted/);
  assert.throws(() => privappPermissions(privapp.replace(PKG, APP), PKG), /exactly/, "the ordinary Alpha app gets no privapp grant");
});

test("hardware invocation keeps emergency and camera gestures and clears indicator-exempt roles", () => {
  assert.equal(checkListenerOverlay(overlay), true);
  assert.throws(() => checkListenerOverlay(overlay.replace(">5<", ">1<")), /assistant/);
  assert.throws(() => checkListenerOverlay(overlay.replace('config_keyChordPowerVolumeUp">2<', 'config_keyChordPowerVolumeUp">3<')), /power menu/);
  assert.throws(() => checkListenerOverlay(overlay.replace("</resources>", '<integer name="config_doublePressOnPowerBehavior">0</integer></resources>')), /must not change/);
  assert.throws(() => checkListenerOverlay(overlay.replace("</resources>", '<bool name="config_emergencyGestureEnabled">false</bool></resources>')), /must not change/);
  assert.equal(INDICATOR_EXEMPT_ROLES.length, 6, "all six PermissionManager EXEMPTED_ROLES");
  for (const role of INDICATOR_EXEMPT_ROLES) {
    const set = holder => overlay.replace(`${role}" translatable="false"><`, `${role}" translatable="false">${holder}<`);
    assert.ok(overlay.includes(`${role}" translatable="false"></string>`), `${role} is overlaid to empty`);
    assert.throws(() => checkListenerOverlay(set("com.example.ambient")), /must be empty/, role);
    assert.throws(() => checkListenerOverlay(set(PKG), [APP, PKG]), /names an Alpha package/, role);
    assert.throws(() => checkListenerOverlay(set(APP), [APP, PKG]), /names an Alpha package/, role);
    assert.throws(() => checkListenerOverlay(overlay.replace(new RegExp(`<string name="${role}"[^>]*></string>`), "")), /overlaid to empty/, role);
  }
  assert.throws(() => checkListenerOverlay(overlay.replace('config_supportsMicToggle">true', 'config_supportsMicToggle">false')), /toggle/);
  const makefile = read("listener.mk");
  assert.match(makefile, /^PRODUCT_PACKAGES \+= AlphaSense$/m);
  assert.match(makefile, /^PRODUCT_PRODUCT_PROPERTIES \+= ro\.hotword\.detection_service_required=true$/m);
  assert.doesNotMatch(makefile, /persist\.|ALPHA_/);
  const sysconfig = read("sysconfig/alphaphone-sense.xml").replace(/<!--[\s\S]*?-->/g, "");
  assert.doesNotMatch(sysconfig, /allow-in-power-save|bg-restriction-exemption|allow-in-data-usage-save/);
  assert.match(sysconfig, /android\.os\.usertype\.full\.SYSTEM/);
  const allowed = [...sysconfig.matchAll(/<allow-association target="([^"]+)" allowed="([^"]+)"/g)].map(match => (assert.equal(match[1], PKG), match[2])).sort();
  assert.deepEqual(allowed, [APP, "com.android.permissioncontroller", "com.android.settings", "com.android.systemui"], "the consent flow's system packages may associate; nothing else");
  const bp = read("Android.bp");
  assert.match(bp, /privileged: true/);
  assert.match(bp, /presigned: true/);
  assert.match(bp, /system_ext_specific: true/);
  assert.match(bp, /preprocessed: true/);
  assert.doesNotMatch(bp, /skip_preprocessed_apk_checks/);
});

test("staging copies the reviewed configuration and APK and refuses a different signer", t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "listener-stage-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const apk = path.join(output, "input.apk");
  execFileSync("python3", ["test/fixtures/write-listener-apk.py", apk]);
  fs.writeFileSync(path.join(output, "product.mk"), "# launcher\n");
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: "b".repeat(64), launcherSigner: SIGNER, appId: APP }), /launcher's certificate/);
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: undefined, launcherSigner: undefined, appId: APP }), /launcher's certificate/);
  assert.equal(fs.existsSync(path.join(output, "listener")), false, "nothing copied after a refusal");
  const target = stageListener({ root, output, apk, dump: dump(), signer: SIGNER, launcherSigner: SIGNER, appId: APP });
  assert.deepEqual(fs.readFileSync(path.join(target, "AlphaSense.apk")), fs.readFileSync(apk));
  const chipSigner = fs.readFileSync(path.join(target, "systemui/chip/overlay/frameworks/base/packages/SystemUI/res/values/alpha-listener-certificate.xml"), "utf8");
  assert.match(chipSigner, new RegExp(`>${SIGNER}</string>`), "only the admitted APK signer is configured for SystemUI");
  assert.equal(fs.readFileSync(path.join(target, "systemui/chip/manifest.json"), "utf8"), read("systemui/chip/manifest.json"));
  for (const file of ["systemui/manifest.json", "systemui/microphone-ops.patch"])
    assert.equal(fs.readFileSync(path.join(target, file), "utf8"), read(file), "staged SystemUI input matches reviewed bytes");
  for (const file of ["Android.bp", "listener.mk", "permissions/privapp-permissions-ai.elizaresearch.alphaphone.sense.xml", "sysconfig/alphaphone-sense.xml", "overlay/frameworks/base/core/res/res/values/config.xml"])
    assert.ok(fs.existsSync(path.join(target, file)), file);
  assert.match(fs.readFileSync(path.join(output, "product.mk"), "utf8"), /^include .*\/listener\/listener\.mk$/m);
  assert.throws(() => stageListener({ root, output, apk, dump: dump(), signer: SIGNER, launcherSigner: SIGNER, appId: APP }), /already exists/);  // The listener captures only with the chip's indicator lease, so every staged listener requires the chip patch.
  const productMk = fs.readFileSync(path.join(output, "product.mk"), "utf8");
  assert.match(productMk, /^include .*\/listener\/systemui\/chip\/chip\.mk$/m, "the chip certificate overlay is part of the staged product");
  const required = JSON.parse(fs.readFileSync(path.join(target, "systemui/required-source-patches.json"), "utf8"));
  const chipManifest = JSON.parse(read("systemui/chip/manifest.json"));
  assert.equal(required.systemuiChip, true);
  assert.deepEqual(required.requiredSourcePatches.map(row => [row.bundle, row.patchSha256, row.revision]), [["chip", chipManifest.patchSha256, chipManifest.revision]]);
  assert.deepEqual([required.sourcePatched, required.imageBuilt], [false, false], "staging records a requirement, never a patched source or image");
});

test("production staging includes the Listening chip by default; only an explicit development call omits it", t => {
  const stage = fs.readFileSync(path.join(root, "scripts/stage-aosp.mjs"), "utf8");
  const call = /stageListener\(\{[^}]*\}\)/.exec(stage)?.[0];
  assert.ok(call, "stage-aosp stages the listener");
  assert.doesNotMatch(call, /systemuiChip/, "stage-aosp (production and development) takes the chip default");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "listener-stage-nochip-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const apk = path.join(output, "input.apk");
  execFileSync("python3", ["test/fixtures/write-listener-apk.py", apk]);
  fs.writeFileSync(path.join(output, "product.mk"), "# launcher\n");
  const target = stageListener({ root, output, apk, dump: dump(), signer: SIGNER, launcherSigner: SIGNER, appId: APP, systemuiChip: false });
  assert.doesNotMatch(fs.readFileSync(path.join(output, "product.mk"), "utf8"), /chip\.mk/);
  const required = JSON.parse(fs.readFileSync(path.join(target, "systemui/required-source-patches.json"), "utf8"));
  assert.equal(required.systemuiChip, false);assert.deepEqual(required.requiredSourcePatches, []);
  assert.match(required.consequence, /never captures/);
  assert.match(fs.readFileSync(path.join(root, LISTENER_SOURCE, "systemui/chip/chip.mk"), "utf8"), /production included/);
});

test("the privileged listener is pinned by a reviewed descriptor and must carry its qualified speech bundle", () => {
  const hash = "c".repeat(64);
  const good = { packageName: PKG, apkSha256: hash, certificateSha256: SIGNER };
  assert.equal(checkListenerDescriptor(good, { appId: APP, apkSha256: hash, signer: SIGNER }), true);
  assert.throws(() => checkListenerDescriptor(null, { appId: APP, apkSha256: hash, signer: SIGNER }), /required/);
  assert.throws(() => checkListenerDescriptor({ ...good, packageName: APP }, { appId: APP, apkSha256: hash, signer: SIGNER }), /expected/);
  assert.throws(() => checkListenerDescriptor(good, { appId: APP, apkSha256: "d".repeat(64), signer: SIGNER }), /apkSha256/, "other bytes with the right name and signer are refused");
  assert.throws(() => checkListenerDescriptor(good, { appId: APP, apkSha256: hash, signer: "b".repeat(64) }), /certificateSha256/);
  assert.throws(() => checkListenerDescriptor({ ...good, apkSha256: "x" }, { appId: APP, apkSha256: "x", signer: SIGNER }), /apkSha256/);
  // The listener uses the same libelizainference voice host (shared paradee-voice library) as Alpha.
  const voiceHost = JSON.parse(fs.readFileSync(path.join(root, "android/voice-host/qualified-voice-host.json"), "utf8"));
  const arm = voiceHost.abis.find(row => row.abi === "arm64-v8a");
  const entries = ["AndroidManifest.xml", "classes.dex", "assets/paradee-voice/v1/manifest.json", "lib/arm64-v8a/libparadeevoicejni.so", ...arm.libraries.map(lib => `lib/arm64-v8a/${lib.name}`)];
  const manifest = paths => JSON.stringify({ format: "eliza-paradee-voice-v2", files: paths.map(file => ({ path: file })) });
  const full = () => manifest([...voiceHost.models.map(row => row.path)]);
  assert.deepEqual(checkListenerSpeechBundle(entries, voiceHost, full), ["arm64-v8a"]);
  assert.throws(() => checkListenerSpeechBundle(entries.filter(name => !name.startsWith("assets/")), voiceHost, full), /no assets\/paradee-voice\/v1\/manifest\.json/, "an APK without the bundle can never listen");
  assert.throws(() => checkListenerSpeechBundle(entries, voiceHost, () => manifest(voiceHost.models.filter(row => !row.path.startsWith("asr/")).map(row => row.path))), /no asr\/phonon-2-fv5\.gguf/, "a read-aloud-only bundle cannot recognise speech");
  assert.throws(() => checkListenerSpeechBundle(entries.filter(name => !name.startsWith("lib/")), voiceHost, full), /no recorded voice host ABI/);
  const hashes = Object.fromEntries(arm.libraries.map(lib => [`lib/arm64-v8a/${lib.name}`, lib.sha256]));
  assert.equal(checkListenerSpeechNatives(["arm64-v8a"], voiceHost, entry => hashes[entry]), true);
  assert.throws(() => checkListenerSpeechNatives(["arm64-v8a"], voiceHost, () => "0".repeat(64)), /differs from the recorded voice host library/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "scripts/aosp-listener.mjs"), "utf8"), /sherpa|local-speech/i);
});

test("stage-aosp wires the listener and requires it for production images", () => {
  const stage = fs.readFileSync(path.join(root, "scripts/stage-aosp.mjs"), "utf8");
  assert.match(stage, /"--listener-apk"/);
  assert.match(stage, /"--listener-descriptor"/);
  assert.match(stage, /if \(production && !listenerApk\)\s*throw/);
  assert.match(stage, /if \(production && !listenerDescriptor\)\s*throw/);
  assert.match(stage, /checkListenerDescriptor\(/);
  assert.match(stage, /if \(production\) throw new Error\(`Refusing \$\{listenerApk\}: \$\{problem\.message\}`\)/, "production refuses a listener without its speech bundle");
  assert.match(stage, /a debuggable listener is staged only with --development/);
  assert.ok(stage.indexOf("stageListener(") > stage.indexOf("writeProvisioningOverlay("), "listener makefile is appended after the provisioning lines");
});

test("the read-only image check needs a privileged, persistent listener and a nonprivileged Alpha", () => {
  const listenerDump = ({ flags = "[ SYSTEM HAS_CODE PERSISTENT ]", privateFlags = "[ PRIVILEGED SYSTEM_EXT ]", extra = "" } = {}) =>
    `Packages:\n  Package [${PKG}]\n    flags=${flags}\n    privateFlags=${privateFlags}\n    requested permissions:\n      android.permission.RECORD_AUDIO\n    install permissions:\n      android.permission.CAPTURE_AUDIO_HOTWORD: granted=true\n${extra}    runtime permissions:\n      android.permission.RECORD_AUDIO: granted=false\n`;
  const device = (overrides = {}) => (...args) => {
    const command = args.join(" ");
    if (command.startsWith("shell pm list packages -s")) return overrides.packages ?? `package:${PKG}\n`;
    if (command === `shell dumpsys package ${PKG}`) return overrides.listener ?? listenerDump();
    if (command === `shell dumpsys package ${APP}`) return overrides.alpha ?? `  Package [${APP}]\n    privateFlags=[ PRODUCT ]\n`;
    if (command === "shell getprop ro.hotword.detection_service_required") return overrides.prop ?? "true\n";
    if (command.startsWith("shell dumpsys activity services")) return overrides.services ?? "ACTIVITY MANAGER SERVICES (dumpsys activity services)\n  (nothing)\n";
    if (command === "shell device_config get privacy camera_mic_icons_enabled") return overrides.icons ?? "null\n";
    if (command.startsWith("shell cmd role get-role-holders --user 0 android.app.role.SYSTEM_")) return (overrides.roles ?? {})[args.at(-1)] ?? "\n";
    throw new Error(`unexpected ${command}`);
  };
  const result = verifyAospListener(device(), "0", APP);
  assert.equal(result.recordAudioGranted, false, "RECORD_AUDIO is not pre-granted");
  assert.equal(result.listeningServiceRunning, false, "nothing listens before consent");
  assert.equal(result.indicatorVerified, false);
  assert.equal(result.invocationVerified, false);
  assert.throws(() => verifyAospListener(device(), "", APP), /user/);
  assert.throws(() => verifyAospListener(device({ packages: "" }), "0", APP), /system package/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ privateFlags: "[ SYSTEM_EXT ]" }) }), "0", APP), /privileged/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ flags: "[ SYSTEM HAS_CODE ]" }) }), "0", APP), /persistent/);
  assert.throws(() => verifyAospListener(device({ listener: listenerDump({ extra: "      android.permission.INTERNET: granted=true\n" }) }), "0", APP), /INTERNET/);
  assert.throws(() => verifyAospListener(device({ alpha: "    privateFlags=[ PRIVILEGED PRODUCT ]\n" }), "0", APP), /nonprivileged/);
  assert.throws(() => verifyAospListener(device({ prop: "\n" }), "0", APP), /detection_service_required/);
  assert.throws(() => verifyAospListener(device({ icons: "false\n" }), "0", APP), /camera_mic_icons_enabled/);
  assert.equal(verifyAospListener(device({ icons: "true\n" }), "0", APP).privileged, true);
  assert.throws(() => verifyAospListener(device({ roles: { "android.app.role.SYSTEM_UI_INTELLIGENCE": "com.example.intelligence\n" } }), "0", APP), /SYSTEM_UI_INTELLIGENCE is held/);
  assert.equal(verifyAospListener(device({ services: `  * ServiceRecord{1 u0 ${PKG}/.ListeningService}\n` }), "0", APP).listeningServiceRunning, true);
});

test('listener staging rejects compressed or unaligned archives before copying any configuration',t=>{
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'listener-invalid-'));t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
 const apk=path.join(output,'input.apk');fs.writeFileSync(path.join(output,'product.mk'),'# unchanged\n');
 for(const extension of ['.so','.dex']){
  execFileSync('python3',['test/fixtures/write-listener-apk.py',apk,extension]);
  assert.throws(()=>stageListener({root,output,apk,dump:dump(),signer:SIGNER,launcherSigner:SIGNER,appId:APP}),/JNI and DEX must be stored/);
  assert.equal(fs.existsSync(path.join(output,'listener')),false);
  assert.equal(fs.readFileSync(path.join(output,'product.mk'),'utf8'),'# unchanged\n');
 }
 execFileSync('python3',['-c',"import zipfile,sys;z=zipfile.ZipFile(sys.argv[1],'w');[z.writestr(n,b'x') for n in ['AndroidManifest.xml','classes.dex','lib/arm64-v8a/libfixture.so']];z.close()",apk]);
 assert.throws(()=>stageListener({root,output,apk,dump:dump(),signer:SIGNER,launcherSigner:SIGNER,appId:APP}),/not aligned/);
 assert.equal(fs.existsSync(path.join(output,'listener')),false);
});

test('pinned Soong requires preprocessed modern APKs and accepts only normalized privileged archives',
 {skip:!process.env.ALPHA_SYSTEMUI_TEST_SOURCE||!process.env.ANDROID_HOME},async t=>{
 const {createHash}=await import('node:crypto');
 const checker=path.join(process.env.ALPHA_SYSTEMUI_TEST_SOURCE,'build/soong/scripts/check_prebuilt_presigned_apk.py');
 assert.equal(createHash('sha256').update(fs.readFileSync(checker)).digest('hex'),'b122f7b0b5224a0ffbf5135751e99d02f1dfcc93f4a1f8ffd1e07b2b98996614');
 const tools=path.join(process.env.ANDROID_HOME,'build-tools','36.0.0');const zipalign=path.join(tools,'zipalign');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'listener-soong-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 // ZIP payload and target metadata are synthetic; the Soong checker and SDK zipalign are real.
 const aapt=path.join(dir,'fixture-aapt');fs.writeFileSync(aapt,"#!/bin/sh\nprintf \"targetSdkVersion: '36'\\n\"\n",{mode:0o755});
 const raw=path.join(dir,'raw.apk');execFileSync('python3',['test/fixtures/write-listener-apk.py',raw,'.so']);
 const stamp=path.join(dir,'checked');
 assert.throws(()=>execFileSync('python3',[checker,'--aapt2',aapt,raw,stamp],{stdio:'pipe'}),/must set preprocessed: true/);
 const args=[checker,'--preprocessed','--privileged','--uncompress-priv-app-dex','--zipalign',zipalign];
 assert.throws(()=>execFileSync('python3',[...args,raw,stamp],{stdio:'pipe'}),/compressed JNI/);
 execFileSync('python3',['test/fixtures/write-listener-apk.py',raw,'.dex']);
 assert.throws(()=>execFileSync('python3',[...args,raw,stamp],{stdio:'pipe'}),/compressed dex/);
 const prepared=path.join(dir,'prepared');
 execFileSync('python3',['scripts/prepare-aosp-apk.py','--input',raw,'--output',prepared,'--zipalign',zipalign]);
 const apk=path.join(prepared,'launcher-aosp-unsigned.apk');
 execFileSync('python3',[...args,apk,stamp]);assert.ok(fs.existsSync(stamp));
 execFileSync('python3',['scripts/verify-aosp-listener-apk.py',apk]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(prepared,'preparation.json'))).payloadUnchanged,true);
});

test("listener includes keep the product directory after MAKEFILE_LIST advances", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "listener-make-path-"));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.mkdirSync(path.join(directory, "listener/systemui/chip"), {recursive: true});
  fs.writeFileSync(path.join(directory, "listener/listener.mk"), "PRODUCT_PACKAGES += AlphaSense\n");
  fs.writeFileSync(path.join(directory, "listener/systemui/chip/chip.mk"), "PRODUCT_PACKAGES += ChipWitness\n");
  fs.writeFileSync(path.join(directory, "product.mk"), listenerProductMakefile() + "\nall:\n\t@echo $(PRODUCT_PACKAGES)\n");
  assert.equal(execFileSync("make", ["--no-print-directory", "-f", path.join(directory, "product.mk"), "all"], {encoding: "utf8"}).trim(), "AlphaSense ChipWitness");
});
