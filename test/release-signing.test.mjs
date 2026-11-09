// Release signing policy decisions; these are not APK build or signing evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditWebBundle } from "../scripts/audit-production-bundle.mjs";
import { appLinkFilters, signInAppLinkProblems, assetLinksProblems, fingerprint, PLACEHOLDER, renderAssetLinks, SIGNER_FILE, TEMPLATE } from "../scripts/render-assetlinks.mjs";
import { partialSigningProblem, releaseAdmission, signingRequested, validateReleaseSigner } from "../scripts/build-android.mjs";

const ALL = { ELIZAOS_KEYSTORE_PATH: "/k", ELIZAOS_KEYSTORE_PASSWORD: "p", ELIZAOS_KEY_ALIAS: "a", ELIZAOS_KEY_PASSWORD: "q" };
const SIGNER = "a".repeat(64);
const descriptor = (signerSha256 = SIGNER, versionCode = null) => ({ schema: 1, signerSha256, lastRelease: { versionCode, versionName: null, recordedAt: null } });

test("a partial ELIZAOS_ signing set is refused by name, never by value", () => {
  assert.equal(partialSigningProblem({}), null);
  assert.equal(partialSigningProblem(ALL), null);
  const { ELIZAOS_KEY_PASSWORD, ...partial } = ALL;
  const problem = partialSigningProblem(partial);
  assert.match(problem, /missing ELIZAOS_KEY_PASSWORD/);
  assert.ok(!problem.includes("/k") && !problem.includes("\"p\""));
  assert.match(partialSigningProblem({ ...ALL, ELIZAOS_KEY_ALIAS: "  " }), /missing ELIZAOS_KEY_ALIAS/, "blank counts as missing, as in Gradle");
  assert.equal(signingRequested({ ...ALL, ELIZAOS_KEY_ALIAS: " " }), false);
  const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
  assert.match(gradle, /releaseSigningMissing\.size\(\) < releaseSigningNames\.size\(\)\)\n throw new GradleException/);
  assert.doesNotMatch(gradle, /producing unsigned release APKs/);
});

test("invalid release signer fingerprints, versions and schemas are refused", () => {
  assert.throws(() => validateReleaseSigner({ ...descriptor(), signerSha256: "ABC" }), /signerSha256/);
  assert.throws(() => validateReleaseSigner({ ...descriptor(), lastRelease: { versionCode: 0 } }), /versionCode/);
  assert.throws(() => validateReleaseSigner({ ...descriptor(), schema: 2 }), /schema/);
});

test("only a release signed by the recorded signer with an advancing versionCode is admitted", () => {
  const ok = releaseAdmission({ signed: true, signerSha256: SIGNER, versionCode: 3 }, descriptor(SIGNER, 2));
  assert.deepEqual(ok, { failures: [], blockers: [], signerMatches: true });
  const unsigned = releaseAdmission({ signed: false, signerSha256: null, versionCode: 3 }, descriptor());
  assert.deepEqual(unsigned.failures, []);
  assert.deepEqual(unsigned.blockers, ["unsigned release"]);
  assert.equal(unsigned.signerMatches, false);
  const unset = releaseAdmission({ signed: true, signerSha256: SIGNER, versionCode: 3 }, descriptor("unset"));
  assert.equal(unset.signerMatches, false);
  assert.match(unset.blockers.join(), /signer is unset/);
  const mismatch = releaseAdmission({ signed: true, signerSha256: "b".repeat(64), versionCode: 3 }, descriptor());
  assert.match(mismatch.failures.join(), /does not match/);
  const stale = releaseAdmission({ signed: true, signerSha256: SIGNER, versionCode: 2 }, descriptor(SIGNER, 2));
  assert.match(stale.failures.join(), /not greater than the last recorded release 2/);
  const staleUnsigned = releaseAdmission({ signed: false, signerSha256: null, versionCode: 1 }, descriptor(SIGNER, 2));
  assert.deepEqual(staleUnsigned.failures, []);
  assert.match(staleUnsigned.blockers.join(), /not greater/);
});

test("verify-apks requires signed:true and the descriptor match for distributable", () => {
  const source = fs.readFileSync("scripts/verify-apks.mjs", "utf8");
  assert.match(source, /row\.distributable = !testMocks && row\.signed === true && row\.releaseAdmission\.signerMatches === true/);
  assert.match(source, /Release signing admission failed/);
  // A PACKAGED distribution must ship the regenerated runtime notices (Bun and bundled packages).
  assert.match(source, /runtime\.distributable === true && row\.runtimeNotices === true/);
  assert.match(source, /entry\?\.name === BUN_ENTRY/);
});

test("assetlinks.json is rendered only from the recorded release signer, never unset, a placeholder or a debug key", t => {
  const template = fs.readFileSync(TEMPLATE, "utf8");
  const packageName = JSON.parse(fs.readFileSync("app.config.json", "utf8")).appId;
  const text = renderAssetLinks({ template, signerSha256: SIGNER, packageName });
  const [statement] = JSON.parse(text);
  assert.deepEqual(statement.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(statement.target.package_name, "ai.elizaresearch.alphaphone");
  assert.deepEqual(statement.target.sha256_cert_fingerprints, [fingerprint(SIGNER)]);
  assert.match(statement.target.sha256_cert_fingerprints[0], /^(AA:){31}AA$/);
  assert.doesNotMatch(text, new RegExp(PLACEHOLDER));
  assert.deepEqual(assetLinksProblems(text), []);
  assert.throws(() => renderAssetLinks({ template, signerSha256: PLACEHOLDER, packageName }), /placeholder/);
  assert.throws(() => renderAssetLinks({ template, signerSha256: "ABC", packageName }), /64 lower-case hex/);
  assert.throws(() => renderAssetLinks({ template, signerSha256: SIGNER, packageName: "other.app" }), /not other\.app/);
  const debugKey = "d".repeat(64);
  assert.throws(() => renderAssetLinks({ template, signerSha256: debugKey, packageName, debugFingerprints: [fingerprint(debugKey)] }), /debug signing certificate/);
  // The checker refuses a published file that kept the template placeholder or names a debug key.
  assert.match(assetLinksProblems(template).join(), /still contains RELEASE_CERT_SHA256_PLACEHOLDER/);
  const debugFile = text.replace(fingerprint(SIGNER), fingerprint(debugKey));
  assert.match(assetLinksProblems(debugFile, { debugFingerprints: [debugKey] }).join(), /is a debug signing certificate/);
  assert.match(assetLinksProblems(text.replace(fingerprint(SIGNER), "unset")).join(), /unset release signer/);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-assetlinks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(path.join(root, TEMPLATE)), { recursive: true });
  fs.writeFileSync(path.join(root, TEMPLATE), template);
  fs.writeFileSync(path.join(root, SIGNER_FILE), JSON.stringify(descriptor("unset")));
  fs.writeFileSync(path.join(root, "app.config.json"), JSON.stringify({ appId: packageName }));
  const script = new URL("../scripts/render-assetlinks.mjs", import.meta.url);
  const out = path.join(root, "assetlinks.json");
  const run = spawnSync(process.execPath, [fileURLToPath(script), "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /signerSha256 is "unset"/);
  assert.equal(fs.existsSync(out), false);
});

test("the bundle audit fails an assetlinks.json with a placeholder or debug fingerprint", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-assetlinks-audit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, ".well-known"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(dir, "build-flags.json"), JSON.stringify({ testMocks: false }));
  fs.writeFileSync(path.join(dir, ".well-known/assetlinks.json"), fs.readFileSync(TEMPLATE));
  assert.deepEqual(auditWebBundle(dir).findings.map(row => row.rule), ["assetlinks.json still contains RELEASE_CERT_SHA256_PLACEHOLDER"]);
  const packageName = JSON.parse(fs.readFileSync("app.config.json", "utf8")).appId;
  fs.writeFileSync(path.join(dir, ".well-known/assetlinks.json"), renderAssetLinks({ template: fs.readFileSync(TEMPLATE, "utf8"), signerSha256: SIGNER, packageName }));
  assert.equal(auditWebBundle(dir).ok, true);
  assert.equal(auditWebBundle(dir, { debugFingerprints: [SIGNER] }).ok, false);
});

test("the https autoVerify filter defaults to the configured Cloud host and is read back from the APK manifest", () => {
  const gradle = fs.readFileSync("android/app/build.gradle", "utf8");
  const manifest = fs.readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");
  // The main manifest uses a generated overlay so changing the deployment changes its return host.
  assert.doesNotMatch(manifest.replace(/<!--[\s\S]*?-->/g, ""), /autoVerify/);
  assert.match(gradle, /project\.findProperty\('ELIZAOS_APP_LINK_HOST'\) \?: envValue\('ELIZAOS_APP_LINK_HOST'\)/);
  assert.match(gradle, /def appLinkHost = .*\? cloudWebHost :/);
  assert.match(gradle, /appLinkHost != cloudWebHost/,'a mismatched override is still rejected');
  assert.ok(gradle.includes('<activity android:name="${identity.appId}.MainActivity" android:exported="true">'), 'the generated App Link activity explicitly exports its external return intent');
  assert.match(gradle, /manifestPlaceholders = \[appOrientation: identity\.orientation, appLinkHost: appLinkHost\]/);
  assert.match(gradle, /if \(appLinkHost\) androidComponents \{ onVariants\(selector\(\)\.all\(\)\) \{ variant -> variant\.sources\.manifests\.addStaticManifestFile\(appLinksManifest\) \} \}/);
  assert.match(gradle, /<intent-filter android:autoVerify="true">[^\n]*android:scheme="https" android:host="\\\$\{appLinkHost\}" android:pathPrefix="\/alphaphone\/cloud-delegation"/);
  assert.doesNotMatch(gradle, /ALPHA_APP_LINK/);
  // verify-apks records the filter from `aapt dump xmltree` of the packaged manifest.
  const filter = scheme => [
    "      E: intent-filter (line=40)",
    "        A: http://schemas.android.com/apk/res/android:autoVerify(0x010104ee)=(type 0x12)0xffffffff",
    "        E: action (line=41)",
    "          A: http://schemas.android.com/apk/res/android:name(0x01010003)=\"android.intent.action.VIEW\" (Raw: \"android.intent.action.VIEW\")",
    "        E: data (line=44)",
    `          A: http://schemas.android.com/apk/res/android:scheme(0x01010027)="${scheme}" (Raw: "${scheme}")`,
    "          A: http://schemas.android.com/apk/res/android:host(0x01010028)=\"links.example.com\" (Raw: \"links.example.com\")",
  ];
  const custom = ["      E: intent-filter (line=30)", "        E: data (line=31)",
    "          A: http://schemas.android.com/apk/res/android:scheme(0x01010027)=\"alphaphone\" (Raw: \"alphaphone\")",
    "          A: http://schemas.android.com/apk/res/android:host(0x01010028)=\"cloud-delegation\" (Raw: \"cloud-delegation\")"];
  assert.deepEqual(appLinkFilters([...custom, ...filter("https"), "    E: activity (line=50)"].join("\n")), { present: true, hosts: ["links.example.com"] });
  assert.deepEqual(appLinkFilters(custom.join("\n")), { present: false, hosts: [] }, "custom-scheme filters alone do not establish a verified return");
  assert.deepEqual(appLinkFilters(filter("http").join("\n")), { present: false, hosts: [] });
  assert.match(fs.readFileSync("scripts/verify-apks.mjs", "utf8"), /appLinks: appLinkFilters\(xml\),/);
});

test('APK admission requires the exact sign-in return for the configured deployment', () => {
  const filter = (host, pathAttribute = 'path', path = '/alphaphone/auth/callback') => `
      E: intent-filter (line=40)
        A: android:autoVerify(0x010104ee)=(type 0x12)0xffffffff
        E: action (line=41)
          A: android:name(0x01010003)="android.intent.action.VIEW"
        E: category (line=42)
          A: android:name(0x01010003)="android.intent.category.DEFAULT"
        E: category (line=43)
          A: android:name(0x01010003)="android.intent.category.BROWSABLE"
        E: data (line=44)
          A: android:scheme(0x01010027)="https"
          A: android:host(0x01010028)="${host}"
          A: android:${pathAttribute}(0x0101002a)="${path}"
      E: activity (line=50)`;
  assert.deepEqual(signInAppLinkProblems(filter('eliza.app'), ['eliza.app']), []);
  for (const xml of ['', filter('alphacompute.ai'), filter('eliza.app','pathPrefix'), filter('eliza.app','path','/alphaphone/cloud-delegation'),
    filter('eliza.app').replace('android.intent.category.BROWSABLE','android.intent.category.DEFAULT'),
    filter('eliza.app').replace('0xffffffff','0x0')]) {
    assert.equal(signInAppLinkProblems(xml, ['eliza.app']).length, 1);
  }
  assert.equal(signInAppLinkProblems(filter('eliza.app'), ['eliza.app','staging.eliza.app']).length, 1);
  assert.deepEqual(signInAppLinkProblems(filter('eliza.app')+filter('staging.eliza.app'), ['eliza.app','staging.eliza.app']), []);
});
