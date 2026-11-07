// App Links association on the Eliza Cloud web host (docs/human-actions.md H-13). Cloud publishes
// /.well-known/assetlinks.json only from ELIZA_ANDROID_ASSET_LINKS_JSON, one entry per app, and a
// malformed value or a duplicate package publishes [] for every app. These cases check the value an
// operator is given and the published-document check, with synthetic fingerprints and a stubbed fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLOUD_ASSET_LINKS, cloudAssetLinksConfig, cloudEntryProblems, fingerprint, publishedAssetLinksCheck,
  readAssetLinksSource, renderAssetLinks, statementsToCloudEntries, TEMPLATE,
} from "../scripts/render-assetlinks.mjs";

const root = path.resolve(import.meta.dirname, "..");
const packageName = JSON.parse(fs.readFileSync(path.join(root, "app.config.json"), "utf8")).appId;
const RELEASE = "a1".repeat(32);
const DEV = "22".repeat(32);
const OTHER = "b2".repeat(32);
const elizaEntry = { package_name: "ai.elizaos.app", sha256_cert_fingerprints: [fingerprint(OTHER)], relations: CLOUD_ASSET_LINKS.relations };
/** What Cloud serves for an entry list (packages/cloud/shared/src/lib/auth/android-asset-links.ts). */
const publish = entries => JSON.stringify(entries.map(entry => ({ relation: entry.relations ?? CLOUD_ASSET_LINKS.defaultRelations,
  target: { namespace: "android_app", package_name: entry.package_name, sha256_cert_fingerprints: entry.sha256_cert_fingerprints } })));

test("the Cloud value adds Alpha's release certificate without touching other apps or duplicating Alpha", () => {
  // Today's shape: Alpha listed with a development signer beside another app.
  const published = publish([elizaEntry, { package_name: packageName, sha256_cert_fingerprints: [fingerprint(DEV)] }]);
  const entries = statementsToCloudEntries(JSON.parse(published));
  assert.deepEqual(entries[0], elizaEntry, "relations survive the round trip");
  assert.equal(entries[1].relations, undefined, "the default relation stays implicit");
  const replaced = cloudAssetLinksConfig({ entries, packageName, signerSha256: RELEASE });
  assert.deepEqual(JSON.parse(replaced.text), [elizaEntry, { package_name: packageName, sha256_cert_fingerprints: [fingerprint(RELEASE)] }]);
  assert.deepEqual(replaced.removed, [fingerprint(DEV)], "a dropped development signer is reported");
  const kept = cloudAssetLinksConfig({ entries, packageName, signerSha256: RELEASE, keep: [DEV], debugFingerprints: [DEV] });
  assert.deepEqual(kept.entries[1].sha256_cert_fingerprints, [fingerprint(RELEASE), fingerprint(DEV)], "release first, kept values after");
  assert.deepEqual(kept.keptDebug, [fingerprint(DEV)]);
  assert.deepEqual(kept.removed, []);
  assert.deepEqual(cloudEntryProblems(kept.entries), []);
  // With nothing published, the value is Alpha's single entry.
  assert.deepEqual(JSON.parse(cloudAssetLinksConfig({ packageName, signerSha256: RELEASE }).text), [{ package_name: packageName, sha256_cert_fingerprints: [fingerprint(RELEASE)] }]);
});

test("the Cloud value is refused for an unset or debug release signer and for values Cloud would publish as []", () => {
  assert.throws(() => cloudAssetLinksConfig({ packageName, signerSha256: "unset" }), /H-09/);
  assert.throws(() => cloudAssetLinksConfig({ packageName, signerSha256: DEV, debugFingerprints: [DEV] }), /debug signing certificate/);
  const full = Array.from({ length: CLOUD_ASSET_LINKS.maxEntries }, (_, index) => ({ package_name: `org.example.app${index}`, sha256_cert_fingerprints: [fingerprint(OTHER)] }));
  assert.throws(() => cloudAssetLinksConfig({ entries: full, packageName, signerSha256: RELEASE }), /at most 16/);
  const many = Array.from({ length: 8 }, (_, index) => String(index).repeat(64));
  assert.throws(() => cloudAssetLinksConfig({ packageName, signerSha256: RELEASE, keep: many }), /1 to 8 distinct/);
  assert.match(cloudEntryProblems([elizaEntry, elizaEntry]).join(), /appears twice/);
  assert.match(cloudEntryProblems([{ package_name: packageName, sha256_cert_fingerprints: [RELEASE] }]).join(), /upper-case colon-separated/);
  assert.match(cloudEntryProblems([{ ...elizaEntry, relations: ["delegate_permission/other"] }]).join(), /relations must be/);
  assert.match(cloudEntryProblems([{ ...elizaEntry, target: {} }]).join(), /fields other than/);
  assert.throws(() => statementsToCloudEntries([{ relation: ["x"], target: { namespace: "web", site: "https://example.com" } }]), /android_app targets only/);
});

test("the published-document check passes only for the recorded release certificate", () => {
  const releaseDocument = renderAssetLinks({ template: fs.readFileSync(path.join(root, TEMPLATE), "utf8"), signerSha256: RELEASE, packageName });
  assert.deepEqual(publishedAssetLinksCheck(releaseDocument, { packageName, signerSha256: RELEASE }), { granted: true, problems: [], notes: [] });
  const developmentOnly = publish([{ package_name: packageName, sha256_cert_fingerprints: [fingerprint(DEV)] }]);
  const dev = publishedAssetLinksCheck(developmentOnly, { packageName, signerSha256: RELEASE, debugFingerprints: [DEV] });
  assert.equal(dev.granted, false);
  assert.match(dev.problems.join(), /not for the release certificate/);
  assert.match(dev.notes.join(), /recorded debug signing certificate/);
  const unset = publishedAssetLinksCheck(developmentOnly, { packageName, signerSha256: "unset" });
  assert.equal(unset.granted, false);
  assert.match(unset.problems.join(), /H-09/);
  assert.match(publishedAssetLinksCheck("[]", { packageName, signerSha256: RELEASE }).problems.join(), /publishes \[\]/);
  assert.match(publishedAssetLinksCheck(publish([elizaEntry]), { packageName, signerSha256: RELEASE }).problems.join(), /no statement grants/);
  const loginOnly = JSON.stringify([{ relation: ["delegate_permission/common.get_login_creds"], target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: [fingerprint(RELEASE)] } }]);
  assert.equal(publishedAssetLinksCheck(loginOnly, { packageName, signerSha256: RELEASE }).granted, false, "get_login_creds alone is not an App Link grant");
  assert.equal(publishedAssetLinksCheck("{", { packageName, signerSha256: RELEASE }).granted, false);
});

test("a published URL must answer 200 with JSON and no redirect, as Android's verifier requires", async () => {
  const response = (status, body, type = "application/json; charset=utf-8") => ({ status, headers: new Headers(type ? { "content-type": type } : {}), text: async () => body });
  const calls = [];
  const ok = await readAssetLinksSource("https://eliza.app/.well-known/assetlinks.json", { fetchImpl: async (url, init) => { calls.push({ url, redirect: init.redirect }); return response(200, "[]"); } });
  assert.deepEqual(ok, { text: "[]", problems: [] });
  assert.deepEqual(calls, [{ url: "https://eliza.app/.well-known/assetlinks.json", redirect: "manual" }]);
  assert.match((await readAssetLinksSource("https://eliza.app/x", { fetchImpl: async () => response(301, "") })).problems.join(), /does not follow redirects/);
  assert.match((await readAssetLinksSource("https://eliza.app/x", { fetchImpl: async () => response(404, "") })).problems.join(), /HTTP 404/);
  assert.match((await readAssetLinksSource("https://eliza.app/x", { fetchImpl: async () => response(200, "[]", "text/html") })).problems.join(), /not application\/json/);
  assert.match((await readAssetLinksSource("http://eliza.app/x", { fetchImpl: async () => { throw new Error("must not fetch"); } })).problems.join(), /not https/);
});

test("the CLI prints the Cloud value, checks a file and refuses unknown option mixes", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-assetlinks-cloud-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const file of ["scripts/render-assetlinks.mjs", TEMPLATE, "app.config.json"]) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(dir, file));
  }
  const signer = value => fs.writeFileSync(path.join(dir, "android/release-signer.json"), JSON.stringify({ schema: 1, signerSha256: value, lastRelease: { versionCode: null, versionName: null, recordedAt: null } }));
  const cli = args => spawnSync(process.execPath, ["scripts/render-assetlinks.mjs", ...args], { cwd: dir, encoding: "utf8" });
  const published = path.join(dir, "published.json");
  fs.writeFileSync(published, publish([elizaEntry, { package_name: packageName, sha256_cert_fingerprints: [fingerprint(DEV)] }]));

  signer("unset");
  const unset = cli(["--cloud-config", "--published", published]);
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /record the release certificate first/);
  assert.equal(unset.stdout, "");
  assert.equal(cli(["--check", published]).status, 1);

  signer(RELEASE);
  const value = cli(["--cloud-config", "--published", published, "--keep-fingerprint", DEV]);
  assert.equal(value.status, 0, value.stderr);
  const entries = JSON.parse(value.stdout);
  assert.deepEqual(entries.map(entry => entry.package_name), ["ai.elizaos.app", packageName]);
  assert.deepEqual(entries[1].sha256_cert_fingerprints, [fingerprint(RELEASE), fingerprint(DEV)]);
  assert.match(value.stderr, /ELIZA_ANDROID_ASSET_LINKS_JSON/);
  assert.doesNotMatch(value.stderr, /lists no statement|without --published/);
  // A value that could not include the other apps' entries says so before it is printed.
  const alone = cli(["--cloud-config"]);
  assert.equal(alone.status, 0, alone.stderr);
  assert.match(alone.stderr, /without --published the value below holds only Alpha's entry; setting it replaces every other app's entry/);
  assert.deepEqual(JSON.parse(alone.stdout).map(entry => entry.package_name), [packageName]);
  const emptyFile = path.join(dir, "empty.json");
  fs.writeFileSync(emptyFile, "[]");
  const empty = cli(["--cloud-config", "--published", emptyFile]);
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stderr, /lists no statement, so no other app's entry could be read from it/);
  const servedFile = path.join(dir, "served.json");
  fs.writeFileSync(servedFile, publish(entries));
  const check = cli(["--check", servedFile]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /is also granted to 22:22/);
  const failed = cli(["--check", published]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /not for the release certificate/);
  for (const args of [["--cloud-config", "--check", published], ["--check", published, "--out", "x.json"], ["--keep-fingerprint", DEV], ["--published", published], ["--check"]])
    assert.equal(cli(args).status, 2, `usage error for ${args.join(" ")}`);
  // The original render mode still writes the statement file for a host Alpha controls.
  const out = path.join(dir, "out/assetlinks.json");
  assert.equal(cli(["--out", out]).status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8"))[0].target.sha256_cert_fingerprints, [fingerprint(RELEASE)]);
});

test("the operator value is judged exactly as the pinned Cloud parser judges it", async t => {
  // Cloud's own parser at the pin, read from the submodule's objects (no checkout of packages/cloud is needed).
  const pin = JSON.parse(fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8")).commit;
  const shown = spawnSync("git", ["-C", path.join(root, "vendor/eliza"), "show", `${pin}:packages/cloud/shared/src/lib/auth/android-asset-links.ts`], { encoding: "utf8", maxBuffer: 1 << 22 });
  if (shown.status !== 0) { t.skip("the pinned Cloud source is not available in vendor/eliza"); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-cloud-asset-links-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "android-asset-links.ts");
  fs.writeFileSync(file, shown.stdout);
  const cloud = await import(pathToFileURL(file).href);
  assert.equal(CLOUD_ASSET_LINKS.variable, cloud.ANDROID_ASSET_LINKS_ENV);
  assert.deepEqual([...CLOUD_ASSET_LINKS.relations], [...cloud.ANDROID_ASSET_LINKS_RELATIONS]);

  const alpha = { package_name: packageName, sha256_cert_fingerprints: [fingerprint(RELEASE), fingerprint(DEV)] };
  const prints = count => Array.from({ length: count }, (_, index) => fingerprint(index.toString(16).padStart(2, "0").repeat(32)));
  const candidates = {
    "two apps": [elizaEntry, alpha],
    "default relations": [{ package_name: packageName, sha256_cert_fingerprints: [fingerprint(RELEASE)] }],
    "duplicate package": [alpha, { ...alpha, sha256_cert_fingerprints: [fingerprint(OTHER)] }],
    "lower-case fingerprint": [{ ...alpha, sha256_cert_fingerprints: [fingerprint(RELEASE).toLowerCase()] }],
    "repeated fingerprint": [{ ...alpha, sha256_cert_fingerprints: [fingerprint(RELEASE), fingerprint(RELEASE)] }],
    "eight fingerprints": [{ ...alpha, sha256_cert_fingerprints: prints(8) }],
    "nine fingerprints": [{ ...alpha, sha256_cert_fingerprints: prints(9) }],
    "no fingerprint": [{ ...alpha, sha256_cert_fingerprints: [] }],
    "unknown relation": [{ ...alpha, relations: ["delegate_permission/common.use_as_origin"] }],
    "empty relations": [{ ...alpha, relations: [] }],
    "extra field": [{ ...alpha, namespace: "android_app" }],
    "invalid package": [{ ...alpha, package_name: "alphaphone" }],
    "sixteen apps": Array.from({ length: 16 }, (_, index) => ({ package_name: `ai.example.app${index}`, sha256_cert_fingerprints: [fingerprint(RELEASE)] })),
    "seventeen apps": Array.from({ length: 17 }, (_, index) => ({ package_name: `ai.example.app${index}`, sha256_cert_fingerprints: [fingerprint(RELEASE)] })),
    "too large": Array.from({ length: 16 }, (_, index) => ({ package_name: `ai.example.${"a".repeat(200)}${index}`, sha256_cert_fingerprints: prints(8) })),
  };
  for (const [name, entries] of Object.entries(candidates)) {
    const parsed = cloud.parseAndroidAssetLinksConfig(JSON.stringify(entries));
    assert.equal(cloudEntryProblems(entries).length === 0, parsed.ok, `${name}: Alpha says ${JSON.stringify(cloudEntryProblems(entries))}, Cloud says ${JSON.stringify(parsed)}`);
    // What Cloud publishes for an accepted value reads back as the same entries.
    if (parsed.ok) assert.deepEqual(statementsToCloudEntries(parsed.statements), entries.map(entry => ({ ...entry })), name);
  }
});
