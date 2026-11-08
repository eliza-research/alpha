// Alpha AOSP product descriptor on the shared Cuttlefish source lock (AP-14). Source and staging-input checks
// only: no AOSP checkout, image build or boot is involved.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { aospProductLockProblems, AOSP_TARGETS, PRODUCT_DESCRIPTOR } from "../scripts/stage-aosp.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const hex = (char, length = 64) => char.repeat(length);

/** A copy of the committed product files with every unset value filled by a synthetic reviewed value. */
function completeLock(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-aosp-lock-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), JSON.stringify(value, null, 2)); };
  fs.copyFileSync(path.join(root, "app.config.json"), path.join(dir, "app.config.json"));
  const product = read(PRODUCT_DESCRIPTOR);
  product.hostPackages = product.hostPackages.map((pkg, index) => ({ ...pkg, version: "1.0.0", sha256: hex(String(index + 1)) }));
  product.signer.platformCertificateSha256 = hex("c");
  write(PRODUCT_DESCRIPTOR, product);
  write(product.brandConfig, read(product.brandConfig));
  // The shared reviewed Cuttlefish profile, exactly as pinned.
  const lock = read(product.sourceLock.file);
  write(product.sourceLock.file, lock);
  write("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: hex("d") });
  return { dir, write, product, lock };
}

test("the committed Cuttlefish product names its target, lock, host packages and signer, and is still incomplete", () => {
  const product = read(PRODUCT_DESCRIPTOR);
  assert.ok(AOSP_TARGETS.includes(product.target));
  assert.equal(product.sourceLock.profile, "cuttlefish");
  assert.deepEqual(product.hostPackages.map(pkg => pkg.name), ["cuttlefish-base", "cuttlefish-user"]);
  assert.equal(product.signer.apkDescriptor, "android/release-signer.json");
  const brand = read(product.brandConfig);
  assert.equal(brand.packageName, read("app.config.json").appId);
  assert.equal(brand.envPrefix, "ELIZA", "brand environment names stay on the upstream ELIZA_ prefix");
  // Pixel 10a (stallion) has its own source lock and production descriptor; the Cuttlefish product never stages against them.
  assert.equal(product.separateLocks.pixel10a, "vendor/eliza/packages/os/android/sources/pixel10a-stallion.json");
  assert.notEqual(product.sourceLock.file, product.separateLocks.pixel10a);
  assert.equal(read(product.physicalProduct).product, "alpha_stallion_phone");
  assert.equal(fs.existsSync(path.join(root, "android/aosp/pixel10.lock.json")), false, "the unadmitted Pixel 10 placeholder lock is retired");
  // The source lock is the shared reviewed Cuttlefish profile; Alpha keeps no lock of its own.
  assert.equal(product.sourceLock.file, "vendor/eliza/packages/os/android/aosp.lock.json");
  // The OS build tools resolve aospLockPath against packages/os, so a brand on the shared lock omits it.
  assert.equal(brand.aospLockPath, undefined);
  assert.equal(fs.existsSync(path.join(root, "android/aosp/aosp.lock.json")), false, "Alpha's unreviewed Cuttlefish lock is retired");
  const problems = aospProductLockProblems(root);
  assert.ok(!problems.some(problem => /manifest|aosp\.lock\.json/.test(problem)), problems.join("\n"));
  for (const expected of [/host package cuttlefish-base needs a version and a SHA-256/,
    /platformCertificateSha256 must be a SHA-256/])
    assert.ok(problems.some(problem => expected.test(problem)), `${expected}\n${problems.join("\n")}`);
});

test("a fully populated fixture lock is complete; each unset, placeholder or foreign field is refused", t => {
  const { dir, write, product, lock } = completeLock(t);
  assert.deepEqual(aospProductLockProblems(dir), []);
  const refuse = (rel, value, pattern) => {
    const original = fs.readFileSync(path.join(dir, rel), "utf8");
    write(rel, value);
    assert.ok(aospProductLockProblems(dir).some(problem => pattern.test(problem)), `${rel}: ${pattern}\n${aospProductLockProblems(dir).join("\n")}`);
    fs.writeFileSync(path.join(dir, rel), original);
  };
  refuse(product.sourceLock.file, { ...lock, profiles: { ...lock.profiles, cuttlefish: { ...lock.profiles.cuttlefish, manifest: { ...lock.profiles.cuttlefish.manifest, commit: "UNSET" } } } }, /manifest\.commit/);
  refuse(product.sourceLock.file, { ...lock, profiles: { ...lock.profiles, cuttlefish: { ...lock.profiles.cuttlefish, manifest: { ...lock.profiles.cuttlefish.manifest, tag: "REVISION_PLACEHOLDER" } } } }, /manifest\.tag is unset or a placeholder/);
  refuse(product.brandConfig, { ...read(product.brandConfig), aospDeviceTreePaths: ["device/google/cuttlefish/vsoc_arm64/phone/other.mk"] }, /does not admit alphaphone_cf_x86_64_phone/);
  refuse(PRODUCT_DESCRIPTOR, { ...product, hostPackages: [{ ...product.hostPackages[0], sha256: "unset" }] }, /cuttlefish-base needs a version and a SHA-256/);
  refuse(PRODUCT_DESCRIPTOR, { ...product, hostPackages: [] }, /lists no Cuttlefish host package/);
  refuse(PRODUCT_DESCRIPTOR, { ...product, target: "pixel10a" }, /target must be one of/);
  write("vendor/eliza/packages/os/android/sources/pixel10a-stallion.json", { schema: 1, target: "pixel10a" });
  refuse(PRODUCT_DESCRIPTOR, { ...product, sourceLock: { file: "vendor/eliza/packages/os/android/sources/pixel10a-stallion.json", profile: "cuttlefish" } }, /separate product's lock; it is not admitted for the Cuttlefish product/);
  refuse(PRODUCT_DESCRIPTOR, { ...product, signer: { ...product.signer, platformCertificateSha256: "UNSET" } }, /platformCertificateSha256/);
  refuse("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: "unset" }, /signerSha256 is "unset"/);
  refuse(product.brandConfig, { ...read(product.brandConfig), packageName: "ai.elizaos.app" }, /packageName ai\.elizaos\.app is not ai\.elizaresearch\.alphaphone/);
  // The upstream brand-config schema is applied through the pinned vendor loader.
  const { lunchTarget, ...brand } = read(product.brandConfig);
  refuse(product.brandConfig, brand, /missing required string field "lunchTarget"/);
  fs.rmSync(path.join(dir, PRODUCT_DESCRIPTOR));
  assert.deepEqual(aospProductLockProblems(dir), [`${PRODUCT_DESCRIPTOR} is missing`]);
});

test("stage-aosp --production refuses an incomplete lock before reading any APK and accepts a complete one", t => {
  const { dir } = completeLock(t);
  const stage = (cwd, args) => spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), ...args], { cwd, encoding: "utf8" });
  const unset = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-aosp-unset-"));
  t.after(() => fs.rmSync(unset, { recursive: true, force: true }));
  for (const rel of ["app.config.json", "android/release-signer.json", "vendor/eliza/packages/os/android/aosp.lock.json", ...fs.readdirSync(path.join(root, "android/aosp")).map(name => `android/aosp/${name}`)]) {
    fs.mkdirSync(path.dirname(path.join(unset, rel)), { recursive: true });
    // android/aosp also holds directories (the listener image configuration).
    fs.cpSync(path.join(root, rel), path.join(unset, rel), { recursive: true });
  }
  // The committed (unset) product: refused, naming the gaps, without touching the APK path.
  let out = stage(unset, ["--apk", "absent.apk", "--descriptor", "reviewed.json", "--production"]);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /Refusing production staging: the Alpha AOSP product lock is incomplete\.[\s\S]*host package cuttlefish-base needs a version and a SHA-256/);
  assert.doesNotMatch(out.stderr, /absent\.apk/);
  // A complete fixture lock passes the lock check and reaches APK admission.
  out = stage(dir, ["--apk", "absent.apk", "--descriptor", "reviewed.json", "--production"]);
  assert.notEqual(out.status, 0);
  assert.doesNotMatch(out.stderr, /product lock is incomplete/);
  assert.match(out.stderr, /absent\.apk/);
  // Development staging does not consult the product lock.
  assert.doesNotMatch(stage(unset, ["--apk", "absent.apk", "--development"]).stderr, /product lock/);
});
