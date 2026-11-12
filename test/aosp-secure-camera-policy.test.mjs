// Manifest policy regressions reused from remote df5ddb4a/6547118d.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assertNoAlphaLockScreenSurface, secureCameraActions as names } from "../scripts/aosp-secure-camera-contract.ts";
const secureCameraActions = names.map(name => `android.media.action.${name}`);
const PKG = "ai.alphacompute.alphaphone";
const TRUE = "(type 0x12)0xffffffff";
const str = value => `"${value}" (Raw: "${value}")`;
const element = (indent, tag, attrs = {}) => [`${" ".repeat(indent)}E: ${tag} (line=1)`,
  ...Object.entries(attrs).map(([key, value]) => `${" ".repeat(indent + 2)}A: android:${key}(0x01010003)=${value.startsWith("(") ? value : str(value)}`)];
const filter = (indent, action, categories = []) => [...element(indent, "intent-filter"), ...element(indent + 2, "action", { name: action }),
  ...categories.flatMap(name => element(indent + 2, "category", { name }))];
function tree({ mainAttrs = {}, extra = [] } = {}) {
  return ["N: android=http://schemas.android.com/apk/res/android", "  E: manifest (line=2)", "    E: application (line=3)",
    ...element(6, "activity", { name: `${PKG}.MainActivity`, exported: TRUE, ...mainAttrs }),
    ...filter(8, "android.intent.action.MAIN", ["android.intent.category.HOME", "android.intent.category.DEFAULT"]),
    ...element(6, "activity", { name: `${PKG}.AlphaAssistActivity` }), ...filter(8, "android.intent.action.ASSIST", ["android.intent.category.DEFAULT"]),
    ...extra,
  ].join("\n");
}

test("an Alpha APK with a lock-screen surface or secure-camera handler is refused", () => {
  assert.equal(assertNoAlphaLockScreenSurface(tree()), true);
  for (const attr of ["showWhenLocked", "showOnLockScreen", "turnScreenOn"])
    assert.throws(() => assertNoAlphaLockScreenSurface(tree({ mainAttrs: { [attr]: TRUE } })), new RegExp(`MainActivity sets android:${attr}`));
  assert.equal(assertNoAlphaLockScreenSurface(tree({ mainAttrs: { showWhenLocked: "(type 0x12)0x0" } })), true);
  assert.throws(() => assertNoAlphaLockScreenSurface(tree({ mainAttrs: { showWhenLocked: "(type 0x1)0x7f010001" } })), /showWhenLocked/);
  for (const action of secureCameraActions) {
    const extra = [...element(6, "activity", { name: `${PKG}.LockCamera` }), ...filter(8, action, ["android.intent.category.DEFAULT"])];
    assert.throws(() => assertNoAlphaLockScreenSurface(tree({ extra })), new RegExp(`LockCamera handles ${action.replaceAll(".", "\\.")}`));
  }
  const alias = [...element(6, "activity-alias", { name: `${PKG}.Alias`, targetActivity: `${PKG}.MainActivity` }), ...filter(8, secureCameraActions[0])];
  assert.throws(() => assertNoAlphaLockScreenSurface(tree({ extra: alias })), /Alias handles/);
});

test("the shared Pixel 10a stager applies the same refusal to Alpha's composition", async () => {
  const { enforceLauncherLockScreenPolicy } = await import("../vendor/eliza/packages/os/scripts/android/pixel10a-product.ts");
  const product = JSON.parse(fs.readFileSync("android/aosp/pixel10a-composition.json", "utf8"));
  assert.equal(product.launcher.refuseLockScreenSurfaces, true);
  assert.equal(enforceLauncherLockScreenPolicy(product, tree()), true);
  assert.throws(() => enforceLauncherLockScreenPolicy(product, tree({ mainAttrs: { showWhenLocked: TRUE } })), /Alpha does not implement/);
});
