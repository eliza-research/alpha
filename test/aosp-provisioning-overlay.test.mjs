// Provisioning overlay rendering and default-product staging from fabricated aapt and apksigner output; not image or boot evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { provisioningComponents, renderProvisioningOverlay, writeProvisioningOverlay } from "../scripts/aosp-provisioning-overlay.mjs";

const PKG = "ai.elizaresearch.alphaphone";
const str = value => `"${value}" (Raw: "${value}")`;
const element = (indent, tag, attrs = {}) => [`${" ".repeat(indent)}E: ${tag} (line=1)`,
  ...Object.entries(attrs).map(([key, value]) => `${" ".repeat(indent + 2)}A: android:${key}(0x01010003)=${value.startsWith("(") ? value : str(value)}`)];
const filter = (indent, action, categories = []) => [...element(indent, "intent-filter"), ...element(indent + 2, "action", { name: action }),
  ...categories.flatMap(name => element(indent + 2, "category", { name }))];
function zip(file, entries) {
  execFileSync("python3", ["-c", "import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for k,v in json.loads(sys.argv[2]).items(): z.writestr(k,v)", file, JSON.stringify(entries)]);
}
function tree({ homes = 1, autofillPermission = "android.permission.BIND_AUTOFILL_SERVICE" } = {}) {
  return ["N: android=http://schemas.android.com/apk/res/android", "  E: manifest (line=2)", "    E: application (line=3)",
    ...Array.from({ length: homes }, (_, i) => [...element(6, "activity", { name: `${PKG}.${i ? "Other" : "Main"}Activity`, exported: "(type 0x12)0xffffffff" }),
      ...filter(8, "android.intent.action.MAIN", ["android.intent.category.LAUNCHER"]),
      ...filter(8, "android.intent.action.MAIN", ["android.intent.category.HOME", "android.intent.category.DEFAULT"])]).flat(),
    ...element(6, "activity", { name: `${PKG}.AlphaAssistActivity`, exported: "(type 0x12)0xffffffff" }), ...filter(8, "android.intent.action.ASSIST", ["android.intent.category.DEFAULT"]),
    ...element(6, "service", { name: "ai.eliza.plugins.passwords.ElizaPasswordAutofillService", permission: autofillPermission, exported: "(type 0x12)0xffffffff" }), ...filter(8, "android.service.autofill.AutofillService"),
    ...element(6, "service", { name: `${PKG}.ElizaAgentService` }),
  ].join("\n");
}

test("components come from the APK manifest and must be unique", () => {
  assert.deepEqual(provisioningComponents(tree(), PKG), {
    home: `${PKG}.MainActivity`, assistant: `${PKG}.AlphaAssistActivity`, autofill: "ai.eliza.plugins.passwords.ElizaPasswordAutofillService",
  });
  assert.throws(() => provisioningComponents(tree({ homes: 0 }), PKG), /HOME/);
  assert.throws(() => provisioningComponents(tree({ homes: 2 }), PKG), /exactly one/);
  assert.throws(() => provisioningComponents(tree({ autofillPermission: "none" }), PKG), /AUTOFILL/);
});

test("the overlay sets default HOME, assistant and Autofill offer additively", t => {
  const files = renderProvisioningOverlay(PKG, provisioningComponents(tree(), PKG));
  assert.match(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], new RegExp(`config_defaultAssistant" translatable="false">${PKG}<`));
  assert.match(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], /config_defaultAutofillService" translatable="false">ai\.elizaresearch\.alphaphone\/ai\.eliza\.plugins\.passwords\.ElizaPasswordAutofillService</);
  assert.match(files["provisioning/preferred-apps/launcher-home.xml"], /<item name="ai\.elizaresearch\.alphaphone\/ai\.elizaresearch\.alphaphone\.MainActivity"/);
  assert.match(files["provisioning/preferred-apps/launcher-home.xml"], /android\.intent\.category\.HOME/);
  assert.doesNotMatch(files.productMakefile, /LOCAL_OVERRIDES_PACKAGES|Launcher3/, "the stock launcher stays as a recovery path");
  assert.doesNotMatch(files.productMakefile, /\bALPHA_/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-provision-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, "product.mk"), "PRODUCT_PACKAGES += AlphaPhone\n");
  writeProvisioningOverlay(out, PKG, provisioningComponents(tree(), PKG));
  assert.match(fs.readFileSync(path.join(out, "product.mk"), "utf8"), /PRODUCT_PACKAGE_OVERLAYS \+= \$\(launcher_provisioning_dir\)\/overlay/);
  assert.ok(fs.existsSync(path.join(out, "provisioning/preferred-apps/launcher-home.xml")));
  assert.throws(() => writeProvisioningOverlay(out, PKG, provisioningComponents(tree(), PKG)), /EEXIST/);
});

test("stage-aosp gates the overlay behind --production, never with --development", () => {
  const source = fs.readFileSync("scripts/stage-aosp.mjs", "utf8");
  assert.match(source, /if \(production && development\) throw/);
  assert.match(source, /const tree = execFileSync\(tool\("aapt"\), \["dump", "xmltree", apk, "AndroidManifest\.xml"\]/);
  assert.match(source, /if \(production\) \{\n  const components = provisioningComponents\(tree, identity\.appId\);/);
});

test("stage-aosp publishes the default product only after every listener refusal, refuses the listener for production (P-78), and a refused run leaves nothing to block a rerun", t => {
  const root = path.resolve(import.meta.dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-stage-atomic-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Copies, not a vendor symlink: the shared stager runs only when invoked by its own path.
  const shared = "vendor/eliza/packages/os";
  for (const rel of ["app.config.json", "android/voice-host/qualified-voice-host.json", `${shared}/scripts/android/stage-launcher-overlay.ts`,
    `${shared}/scripts/android/soong-app-native.mjs`, `${shared}/android/products/pixel10a-alpha.json`]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
  }
  // A fake SDK and JDK: aapt and apksigner print fixed inspections, so no Android tool runs.
  const tools = path.join(dir, "sdk/build-tools/36.0.0"), jdk = path.join(dir, "jdk");
  fs.mkdirSync(tools, { recursive: true });
  fs.mkdirSync(jdk);
  fs.writeFileSync(path.join(jdk, "release"), 'JAVA_VERSION="21"\n');
  const manifest = [...tree().split("\n").slice(0, 3), '      A: android:debuggable(0x0101000f)=(type 0x12)0xffffffff', ...tree().split("\n").slice(3)].join("\n");
  fs.writeFileSync(path.join(dir, "manifest.txt"), manifest);
  fs.writeFileSync(path.join(tools, "aapt"), `#!/bin/sh\ncase "$2" in\n  badging) echo "package: name='${PKG}'" ;;\n  xmltree) cat "${path.join(dir, "manifest.txt")}" ;;\n  permissions) cat "$LISTENER_DUMP" ;;\nesac\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(tools, "apksigner"), `#!/bin/sh\necho "Signer #1 certificate SHA-256 digest: ${"ab".repeat(32)}"\n`, { mode: 0o755 });
  const apk = path.join(dir, "launcher-debug.apk"), listenerApk = path.join(dir, "sense-debug.apk");
  zip(apk, { "assets/public/build-flags.json": JSON.stringify({ testMocks: false }) });
  zip(listenerApk, { "classes.dex": "listener" });
  const hash = createHash("sha256").update(fs.readFileSync(apk)).digest("hex");
  const destination = path.join(dir, `artifacts/aosp/alphaphone-${hash.slice(0, 12)}`);
  const stage = (extra, dump, mode = "--development") => {
    fs.writeFileSync(path.join(dir, "dump.txt"), dump);
    return spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), "--apk", apk, mode, "--listener-apk", listenerApk, ...extra], { cwd: dir, encoding: "utf8",
      env: { ...process.env, ANDROID_SDK_ROOT: path.join(dir, "sdk"), ANDROID_HOME: path.join(dir, "sdk"), JAVA_HOME: jdk, LISTENER_DUMP: path.join(dir, "dump.txt") } });
  };
  const leftovers = () => fs.existsSync(path.join(dir, "artifacts/aosp")) ? fs.readdirSync(path.join(dir, "artifacts/aosp")) : [];
  // A listener refused by its reviewed descriptor is refused before any staging output exists.
  fs.writeFileSync(path.join(dir, "listener.json"), JSON.stringify({ packageName: `${PKG}.sense`, apkSha256: "0".repeat(64), certificateSha256: "ab".repeat(32) }));
  for (let run = 0; run < 2; run++) {
    const out = stage(["--listener-descriptor", path.join(dir, "listener.json")], `package: ${PKG}.sense\n`);
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /does not match the reviewed descriptor's apkSha256/);
    assert.doesNotMatch(out.stderr, /Output already exists/);
    assert.deepEqual(leftovers(), []);
  }
  // A listener refused while staging, after the launcher overlay is written, leaves neither the
  // destination nor the temporary directory behind.
  for (let run = 0; run < 2; run++) {
    const out = stage([], "package: org.example.other\n");
    assert.notEqual(out.status, 0);
    assert.match(out.stderr, /Listener APK package is org\.example\.other/);
    assert.doesNotMatch(out.stderr, /Output already exists/);
    assert.equal(fs.existsSync(destination), false);
    assert.deepEqual(leftovers(), []);
  }
  // P-78: production refuses the listener outright, while development (above) admits it for staging.
  const production = stage(["--descriptor", path.join(dir, "listener.json")], `package: ${PKG}.sense\n`, "--production");
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Refusing --listener-apk for --production: wake listening is deferred \(P-78/);
  assert.deepEqual(leftovers(), []);
});
