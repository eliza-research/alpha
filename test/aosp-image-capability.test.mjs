// Alpha AOSP image capability (P-36, issue #420): renderer detection, image staging output and the
// native gating contract, checked from source. No APK build, emulator or image boot is involved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectAospImage, admittedAospViews, AOSP_IMAGE_VIEWS, ADMITTED_AOSP_VIEW_ADAPTERS } from "../apps/app/src/runtime/aosp-image.ts";
import { IMAGE_FEATURE_VERSION, imageFeatureName, renderImageCapability, writeImageCapability } from "../scripts/aosp-image-capability.ts";

const PKG = "ai.alphacompute.alphaphone";
const read = file => fs.readFileSync(file, "utf8");
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

