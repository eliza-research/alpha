// Provisioning overlay rendering from a fabricated aapt xmltree; not image or boot evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { provisioningComponents, renderProvisioningOverlay, requestsAllFilesAccess, writeProvisioningOverlay } from "../scripts/aosp-provisioning-overlay.ts";
import { assertImageLauncherManifest } from "../scripts/stage-aosp.ts";

const PKG = "ai.alphacompute.alphaphone";
const str = value => `"${value}" (Raw: "${value}")`;
const element = (indent, tag, attrs = {}) => [`${" ".repeat(indent)}E: ${tag} (line=1)`,
  ...Object.entries(attrs).map(([key, value]) => `${" ".repeat(indent + 2)}A: android:${key}(0x01010003)=${value.startsWith("(") ? value : str(value)}`)];
const filter = (indent, action, categories = []) => [...element(indent, "intent-filter"), ...element(indent + 2, "action", { name: action }),
  ...categories.flatMap(name => element(indent + 2, "category", { name }))];
function tree({ homes = 1, autofillPermission = "android.permission.BIND_AUTOFILL_SERVICE", allFiles = true, assistant = {} } = {}) {
  return ["N: android=http://schemas.android.com/apk/res/android", "  E: manifest (line=2)",
    ...element(4, "uses-permission", { name: "android.permission.RECORD_AUDIO" }),
    ...(allFiles ? element(4, "uses-permission", { name: "android.permission.MANAGE_EXTERNAL_STORAGE" }) : []),
    "    E: application (line=3)",
    ...Array.from({ length: homes }, (_, i) => [...element(6, "activity", { name: `${PKG}.${i ? "Other" : "Main"}Activity`, exported: "(type 0x12)0xffffffff" }),
      ...filter(8, "android.intent.action.MAIN", ["android.intent.category.LAUNCHER"]),
      ...filter(8, "android.intent.action.MAIN", ["android.intent.category.HOME", "android.intent.category.DEFAULT"])]).flat(),
    ...element(6, "activity", { name: `${PKG}.AlphaAssistActivity`, exported: "(type 0x12)0xffffffff", ...assistant }), ...filter(8, "android.intent.action.ASSIST", ["android.intent.category.DEFAULT"]),
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

test("listener-free production admits the disabled assistant and keeps HOME and Autofill", () => {
  const assistant = {enabled: "(type 0x12)0x0", exported: "(type 0x12)0x0"};
  const components = provisioningComponents(tree({assistant}), PKG, {assistant: false});
  assert.deepEqual(components, {
    home: `${PKG}.MainActivity`, assistant: null, autofill: "ai.eliza.plugins.passwords.ElizaPasswordAutofillService",
  });
  const files = renderProvisioningOverlay(PKG, components, {freshTelephony: true});
  assert.doesNotMatch(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], /config_defaultAssistant/);
  assert.throws(() => provisioningComponents(tree(), PKG, {assistant: false}), /must not ship an enabled ACTION_ASSIST/);
});

test("Files all-files access: the launcher must request MANAGE_EXTERNAL_STORAGE (granted as preinstalled)", () => {
  assert.equal(requestsAllFilesAccess(tree()), true);
  assert.equal(requestsAllFilesAccess(tree({ allFiles: false })), false);
  assert.throws(() => provisioningComponents(tree({ allFiles: false }), PKG), /MANAGE_EXTERNAL_STORAGE/);
  const files = renderProvisioningOverlay(PKG, provisioningComponents(tree(), PKG), {freshTelephony: true});
  assert.match(files["provisioning/README.md"], /MANAGE_EXTERNAL_STORAGE/);
});

test("the overlay sets default HOME, assistant and Autofill offer additively", t => {
  const components = provisioningComponents(tree(), PKG);
  const files = renderProvisioningOverlay(PKG, components, {freshTelephony: true});
  assert.match(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], new RegExp(`config_defaultAssistant" translatable="false">${PKG}<`));
  assert.match(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], /config_defaultAutofillService" translatable="false">ai\.alphacompute\.alphaphone\/ai\.eliza\.plugins\.passwords\.ElizaPasswordAutofillService</);
  assert.match(files["provisioning/preferred-apps/launcher-home.xml"], /<item name="ai\.alphacompute\.alphaphone\/ai\.alphacompute\.alphaphone\.MainActivity"/);
  assert.match(files["provisioning/preferred-apps/launcher-home.xml"], /android\.intent\.category\.HOME/);
  assert.doesNotMatch(files.productMakefile, /LOCAL_OVERRIDES_PACKAGES|Launcher3/, "the stock launcher stays as a recovery path");
  assert.doesNotMatch(files.productMakefile, /\bALPHA_/);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-provision-"));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, "product.mk"), "PRODUCT_PACKAGES += AlphaPhone\n");
  writeProvisioningOverlay(out, PKG, components, {freshTelephony: true});
  assert.match(fs.readFileSync(path.join(out, "product.mk"), "utf8"), /PRODUCT_PACKAGE_OVERLAYS \+= \$\(launcher_provisioning_dir\)\/overlay/);
  assert.ok(fs.existsSync(path.join(out, "provisioning/preferred-apps/launcher-home.xml")));
  const feature = `${PKG}.fresh_telephony_setup`;
  assert.ok(fs.readFileSync(path.join(out, "product.mk"), "utf8")
    .includes(`$(dir $(launcher_provisioning_dir))branding/provision/fresh-telephony.xml:$(TARGET_COPY_OUT_PRODUCT)/etc/permissions/${feature}.xml`));
  assert.equal(fs.existsSync(path.join(out, "branding/provision/fresh-telephony.xml")), false,
    "the feature file is supplied only by the Provision source stage");
  assert.throws(() => writeProvisioningOverlay(out, PKG, components, {freshTelephony: true}), /EEXIST/);
});

test("Sense qualification provisioning leaves fresh telephony assignment disabled", () => {
  const assistant = {enabled: "(type 0x12)0x0"};
  const components = provisioningComponents(tree({assistant}), PKG, {assistant: true});
  const files = renderProvisioningOverlay(PKG, components, {freshTelephony: false});
  assert.match(files["provisioning/overlay/frameworks/base/core/res/res/values/config.xml"], /config_defaultAssistant/);
  assert.doesNotMatch(files.productMakefile, /fresh-telephony|fresh_telephony_setup/);
  assert.doesNotMatch(files["provisioning/README.md"], /Fresh telephony setup/);
});

test("production staging refuses an old or unprotected launcher manifest even with prior admission", () => {
  const withReceiver = (permission, enabled = "(type 0x12)0xffffffff") => [tree(), ...element(6, "receiver", {
    name: `${PKG}.AlphaTelephonySetupReceiver`,
    exported: "(type 0x12)0xffffffff",
    enabled,
    permission,
  })].join("\n");
  const rolePermission = "android.permission.MANAGE_ROLE_HOLDERS";
  assert.doesNotThrow(() => assertImageLauncherManifest(tree(), false));
  assert.throws(() => assertImageLauncherManifest(tree(), true), /Invalid AlphaTelephonySetupReceiver/);
  assert.throws(() => assertImageLauncherManifest(withReceiver("android.permission.INTERNET"), true), /MANAGE_ROLE_HOLDERS/);
  assert.throws(() => assertImageLauncherManifest(withReceiver(rolePermission, "(type 0x12)0x0"), true), /AlphaTelephonySetupReceiver/);
  assert.doesNotThrow(() => assertImageLauncherManifest(withReceiver(rolePermission), true));
});
