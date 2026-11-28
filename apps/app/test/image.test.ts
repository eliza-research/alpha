import { execFileSync } from "node:child_process";
import { createHash, createPublicKey } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync as readdir, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { alphaPrivileged, firstBootGrants } from "../gen/app__image.ts";
import * as Channel from "../gen/release.ts";
import { aosp, otaArguments, place } from "../scripts/aosp.ts";
import { inventory, licences } from "../scripts/licences.ts";
import {
  type Adb, type ChannelPort, type Offer, type ToolsPin, ReleaseRefused, apkUrl, avbMetadata, compareUrl, compared, custodyProof, kept, ledger, manifestUrl, osBuildOf, osPlanOf, osSignedOf,
  pilotUpdate, publishRelease, readBack, release,
} from "../scripts/release.ts";

const scratches: string[] = [];
afterEach(() => { for (const directory of scratches.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const scratch = () => { const directory = mkdtempSync(join(tmpdir(), "alpha-release-")); scratches.push(directory); return directory; };
const write = (directory: string, name: string, value: unknown) => { const file = join(directory, name); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); return file; };
const digest = (seed: string) => createHash("sha256").update(seed).digest("hex");
const digestOf = (bytes: Uint8Array | undefined) => createHash("sha256").update(bytes ?? new Uint8Array()).digest("hex");

/** What a `pnpm aosp` command answered: its result, or the tag and words of the failure it ended with. */
async function run(...argv: string[]) {
  const exit = await Effect.runPromiseExit(aosp(argv));
  if (Exit.isSuccess(exit)) return { ok: true as const, value: exit.value as Record<string, unknown> };
  const failure = Cause.squash(exit.cause) as { _tag?: string; message?: string; reason?: string; problems?: readonly string[] };
  return { ok: false as const, tag: failure._tag, said: failure.reason ?? failure.message ?? "", problems: failure.problems };
}

const descriptor = (overrides: Record<string, unknown>) => ({
  schemaVersion: 1, brand: "alpha", moduleName: "AlphaPhone", packageName: "ai.alphacompute.alphaphone",
  apkSha256: digest("launcher"), certificateSha256: digest("signer"), ...overrides,
});

describe("Stage Alpha into an image (spec/app/image/index.md, \"Story: Stage Alpha into an image\")", () => {
  const stage = (...argv: string[]) => run("stage", "--apk", "launcher.apk", "--aosp-source", "aosp", "--output", "staged", ...argv);

  it("refuses an unreviewed or half-configured stage, naming every problem, before it reads any APK or source", async () => {
    // spec/app/image/index.md, "A production stage, and every listener image, needs a reviewed launcher descriptor and a product with no field unset": the Cuttlefish product's host packages are still UNSET.
    expect(await stage("--target", "cuttlefish")).toMatchObject({ ok: false, tag: "StageRefused", problems: ["NoReviewedDescriptor", "ProductIncomplete"] });
    // spec/app/image/index.md, "Owner telephony is for a development stage of either target, and never for a listener image"
    expect(await stage("--target", "cuttlefish", "--owner-telephony", "--descriptor", "reviewed.json")).toMatchObject({ ok: false, problems: ["ProductIncomplete", "OwnerTelephonyOutsideDevelopment"] });
    // spec/app/image/index.md, "A listener image is a Pixel 10a stage with the listener, its qualification record and the chip, ops, protected power and Sense policy patches"
    expect(await stage("--target", "pixel10a", "--factory-image", "factory.zip", "--development", "--listener-apk", "sense.apk", "--listener-qualification", "q.json", "--patch", "chip"))
      .toMatchObject({ ok: false, problems: ["NoReviewedDescriptor", "ListenerImageIncomplete"] });
    // spec/app/image/index.md, "The Sense policy patch belongs only to a listener image, and the protected power and generic assist patches never come together"
    expect(await stage("--target", "pixel10a", "--factory-image", "factory.zip", "--development", "--patch", "protected-power", "--patch", "assist", "--patch", "sense-policy"))
      .toMatchObject({ ok: false, problems: ["SensePolicyWithoutAListenerImage", "PowerAndAssistTogether"] });
    expect(await stage("--target", "pixel10a", "--development")).toMatchObject({ ok: false, tag: "UsageError", said: "--target pixel10a needs --factory-image" });
  });

  it("stages Alpha's launcher only with Alpha's first-boot grants and its two privileged permissions, or none", async () => {
    const directory = scratch();
    const grants = firstBootGrants;
    const stageWith = (overrides: Record<string, unknown>) => run("stage", "--target", "cuttlefish", "--development", "--apk", "launcher.apk", "--aosp-source", "aosp", "--output", "staged",
      "--descriptor", write(directory, `${Object.keys(overrides).join("-")}.json`, descriptor(overrides)));
    // spec/app/image/index.md, "The first-boot grants are exactly the startup walkthrough's, Contacts and phone state, each revocable, and never messages, calls or call history"
    expect(await stageWith({ defaultPermissions: [...grants, "android.permission.READ_SMS"] }))
      .toMatchObject({ ok: false, tag: "StageRefused", problems: [expect.stringContaining("first-boot grants")] });
    // spec/app/image/index.md, "On an image the launcher holds exactly two privileged permissions, its phone's own identifiers and the install of its own updates, or none": the identifiers alone are not Alpha's set.
    expect(await stageWith({ defaultPermissions: grants, privilegedPermissions: alphaPrivileged.slice(0, 1) }))
      .toMatchObject({ ok: false, tag: "StageRefused", problems: [expect.stringContaining("privileged permissions")] });
    expect(await stageWith({ packageName: "com.example.launcher", defaultPermissions: grants }))
      .toMatchObject({ ok: false, tag: "StageRefused", problems: [expect.stringContaining("not Alpha's launcher")] });
  });
});

describe("Update an Alpha Pixel by cable, and get back (spec/app/image/index.md, \"Story: Update an Alpha Pixel by cable, and get back\"; spec/release/os.md, \"Story: Update an image by hand\")", () => {
  const channel = JSON.parse(readFileSync(place("aosp/pixel10a-ota-channel.json"), "utf8")) as { otaCertificateSha256: string; avbPublicKeySha256: string };
  const fingerprint = (build: number) => `Alpha/alpha_stallion_phone/stallion:17/CP2A.${build}/${build}:user/release-keys`;
  const release = (build: number, rollbackIndex: number) => ({
    schema: 1, kind: "aosp-release-compatibility", product: "alpha_stallion_phone", device: "stallion", channel: "stable",
    build: { fingerprint: fingerprint(build), securityPatch: `2026-${String(build).padStart(2, "0")}-05`, dateUtc: String(1790000000 + build) },
    artifacts: { signedTargetFiles: { file: `signed-target_files-${build}.zip`, sha256: digest(`target files ${build}`) }, ota: { file: `ota-${build}.zip`, sha256: digest(`ota ${build}`), type: "full", incrementalFrom: null } },
    verifiedBoot: { publicKeySha256: channel.avbPublicKeySha256, rollbackIndexes: [{ partition: "vbmeta", location: 0, index: String(rollbackIndex) }] },
    payload: { metadata: { "post-build": fingerprint(build), "post-timestamp": String(1790000000 + build) } },
    certificates: { releasekey: channel.otaCertificateSha256 },
    problems: [], imageBooted: false, signedUpdateApplied: false, releaseQualified: false, deviceAcceptanceVerified: false,
  });

  it("admits a newer signed release of Alpha's one channel and refuses one that would lower the rollback index", async () => {
    const directory = scratch();
    const installed = write(directory, "installed.json", release(9, 3));
    // spec/app/image/index.md, "Alpha has one update channel, stable, for alpha_stallion_phone on stallion, and refuses downgrades": the check reads Alpha's channel without being told to.
    expect(await run("ota", "check", "--from", installed, "--to", write(directory, "candidate.json", release(10, 3))))
      .toMatchObject({ ok: true, value: { admitted: true, executed: false } });
    expect(await run("ota", "check", "--from", installed, "--to", write(directory, "lower.json", release(10, 2))))
      .toMatchObject({ ok: false, tag: "OtaRefused", said: "A rollback index decreased or disappeared" });
    expect(await run("ota", "check", "--from", installed, "--to", write(directory, "foreign.json", { ...release(10, 3), product: "alpha_cf_x86_64_phone" })))
      .toMatchObject({ ok: false, tag: "SigningRefused", said: "The release belongs to another channel, product, or device" });
  });

  it("gives each operator command Alpha's channel and stock source lock only where it reads them", () => {
    // spec/app/image/index.md, "Each operator command reads Alpha's channel and the stallion stock source lock where it reads one and the operator named none"
    const named = (argv: string[]) => [argv.includes("--channel"), argv.includes("--source-lock")];
    expect(["check", "apply", "status", "fallback", "stock-archive", "verify-stock", "retain-known-good"].map((command) => named(otaArguments([command]))))
      .toEqual([[true, false], [true, false], [false, false], [false, false], [true, true], [false, true], [true, false]]);
    expect(otaArguments(["check", "--channel", "other.json"])).toEqual(["check", "--channel", "other.json"]);
  });

  it("keeps the image's updater off until every gate passed, and records a drill only once it was run (spec/release/os.md, \"Story: Enrol the image's updater\"; spec/release/os.md, \"Story: Run the drills\")", async () => {
    const directory = scratch();
    const os = (...argv: string[]) => run("os", "--ledger", join(directory, "os.json"), ...argv);
    // spec/release/os.md, "A drill's result is recorded by the release owner only once that drill has been run, and a failed drill takes back physical recovery and turns the updater off"
    expect(await os("drill", "--drill", "signed-update", "--passed")).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/os.md, "Enrolment is staged only with exactly the pinned profile, and staged disabled"
    expect(await os("stage")).toMatchObject({ ok: true, value: { staged: true, enabled: false } });
    // spec/release/os.md, "The updater is enabled only when every gate has passed"
    expect(await os("enable")).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/os.md, "Two release records are compatible only from the installed build to a newer one of the pinned product, device and keys that wipes nothing"
    expect(await os("check", "--from", "stock", "--to", write(directory, "wiping.json", { ...release(10, 3), payload: { metadata: { "ota-wipe": "yes" } } }))).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await os("check", "--from", "stock", "--to", write(directory, "candidate.json", release(10, 3)))).toMatchObject({ ok: true, value: { apply: "Checked" } });
    // spec/release/os.md, "A checked update is applied with a journal, can be interrupted, and resumes from the journal"
    for (const step of ["start", "interrupt", "resume", "finish"]) expect((await os(step)).ok).toBe(true);
    expect(await os("drill", "--drill", "interrupted-update", "--passed")).toMatchObject({ ok: true, value: { drills: { signedUpdate: "NotRun", interruptedUpdate: "Passed" } } });
    // spec/release/os.md, "A gate passes once, and physical recovery only after all four drills passed"
    expect(await os("pass", "--gate", "physical-recovery")).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/os.md, "A phone falls back, when steady or interrupted, to the pinned stock factory image or to the known-good release": only the pinned factory archive is flashed.
    writeFileSync(join(directory, "factory.zip"), "another archive");
    expect(await os("fallback", "--to", "stock", "--image", join(directory, "factory.zip"))).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await os("retain-known-good")).toMatchObject({ ok: true, value: { knownGood: 1790000010 } });
    expect(await os("fallback", "--to", "known-good")).toMatchObject({ ok: true, value: { seen: { rollbackRan: true } } });
  });
});

describe("Ship what Alpha is built from, with its licences (spec/app/image/licences.md, \"Story: Ship what Alpha is built from, with its licences\")", () => {
  it("lists every shipped part with its licence and flags, keeps the committed notices current, and writes the same inventory as a bill of materials", () => {
    const found = inventory();
    const entry = (name: string) => found.notices.find((notice) => notice.name === name);
    // spec/app/image/licences.md, "An open-source licence never blocks a release; a bundled font blocks it only when its check could not run, or, on the owner's word, when it has no licence recorded"
    expect(found.fontCheck).toBe("FontResolved");
    expect(entry("Denton typeface")).toMatchObject({ license: "LicenseRef-Commercial-Font", flags: ["proprietary-licence-held-outside-repo"] });
    expect(entry("Public Sans")).toMatchObject({ license: "OFL-1.1", flags: [] });
    expect(entry("react")).toMatchObject({ license: "MIT", flags: [] });
    expect(entry("rolldown")).toMatchObject({ license: "MIT" });
    expect(entry("fsevents")).toBeUndefined();
    expect(entry("elizaOS (@elizaos/agent, @elizaos/os, @elizaos/cloud)")).toMatchObject({ license: "MIT" });
    expect(found.notices.some((notice) => notice.name.startsWith("@elizaos/") || notice.name.startsWith("@repo/"))).toBe(false);
    // spec/app/image/licences.md, "A licence identifier belongs to one family, and each family has its flags": what the Android classpath cannot name is flagged unknown, never dropped.
    expect(entry("com.google.android.gms:play-services-auth")).toMatchObject({ license: "UNKNOWN", flags: ["unknown-licence"] });
    expect(licences(["--check"])).toMatchObject({ current: true, entries: found.notices.length });
    const sbom = join(scratch(), "sbom.json");
    licences(["--sbom", sbom]);
    const bill = JSON.parse(readFileSync(sbom, "utf8")) as { bomFormat: string; components: { name: string; properties: unknown[] }[] };
    expect([bill.bomFormat, bill.components.length]).toEqual(["CycloneDX", found.notices.length]);
    expect(bill.components.find((component) => component.name === "Denton typeface")?.properties).toEqual([{ name: "alpha:licence-flag", value: "proprietary-licence-held-outside-repo" }]);
  }, 300_000);
});

const channelBase = manifestUrl().slice(0, manifestUrl().lastIndexOf("/") + 1);

/**
 * Alpha's channel on GitHub as a journey keeps it: the stable release's assets by name, and what anyone downloads
 * from their addresses. An upload under a kept name fails unless it clobbers, as `gh release upload` does.
 */
function channelAt(assets: Record<string, Uint8Array> = {}, recordFile = place("aosp/signing/release-signer.json")) {
  const uploads: string[] = [];
  const port: ChannelPort = {
    listed: Effect.sync(() => Object.keys(assets)),
    upload: (file, name, clobber) => Effect.suspend(() => {
      if (Object.hasOwn(assets, name) && !clobber) return Effect.fail(new ReleaseRefused({ message: `${name} already exists` }));
      assets[name] = readFileSync(file);
      uploads.push(name);
      return Effect.void;
    }),
    read: (url, bound) => Effect.suspend(() => {
      const bytes = assets[url.startsWith(channelBase) ? url.slice(channelBase.length) : url];
      if (bytes === undefined || bytes.length > bound) return Effect.fail(new ReleaseRefused({ message: `${url} answered 404` }));
      return Effect.succeed({ size: bytes.length, sha256: digestOf(bytes), bytes });
    }),
    recordFile,
  };
  return { assets, uploads, port };
}
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

/** What a `pnpm release` command answered over `port`: its result, or the tag and words of the failure it ended with. */
const releasedOver = (port: ChannelPort) => async (...argv: string[]) => {
  const exit = await Effect.runPromiseExit(release(argv, port));
  if (Exit.isSuccess(exit)) return { ok: true as const, value: exit.value as Record<string, unknown> };
  const failure = Cause.squash(exit.cause) as { _tag?: string; message?: string };
  return { ok: false as const, tag: failure._tag, said: failure.message ?? "" };
};
const released = releasedOver(channelAt().port);

// spec/release/index.md, "Story: Qualify and publish a release"
describe("Qualify and publish a release", () => {
  // spec/release/index.md, "Phones read the launcher channel from the stable release of Alpha's repository, eliza-research/alpha, known by its permanent id; APKs kept under the repository's earlier names stay valid"
  it("names the one launcher channel, and keeps the APKs of the repository's earlier names", async () => {
    expect(await released("channel")).toEqual({ ok: true, value: {
      repository: "eliza-research/alpha", repositoryId: 1396333361, tag: "app-stable-alphacompute",
      manifestUrl: "https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json",
    } });
    expect([
      kept("https://github.com/alphacompute/alpha/releases/download/app-stable/alpha-phone-80.apk", 80),
      kept("https://github.com/someone/alpha/releases/download/app-stable-alphacompute/alpha-phone-80.apk", 80),
      kept("https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-phone-80.apk", 81),
    ]).toEqual([true, false, false]);
  });

  // spec/release/index.md, "A build is a candidate only when its verification recorded it distributable: no test mocks, the production bundle audit passed, Alpha's one signer, the runtime packaged with its notices, an on-device voice slot, and for an image its platform certificate"
  it("refuses a build its verification recorded with test mocks, and one with no row at all", async () => {
    const directory = scratch();
    const mocked = await released("blockers", "--apk-manifest", write(directory, "mocked.json", { results: [{ variant: "launcher", mode: "release", testMocks: true }] }));
    const empty = await released("blockers", "--apk-manifest", write(directory, "empty.json", { results: [] }));
    expect([mocked.ok, mocked.ok ? "" : mocked.said.includes("\"mocks\":true"), empty.ok]).toEqual([false, true, false]);
  });

  it("uploads the admitted APK once, moves the manifest only after anyone downloads exactly its bytes, reads it back and records it (spec/release/index.md, \"The manifest is moved only after the download was verified, with the APK still in the channel's final inventory, the channel unchanged since publishing began, and the version above the floor and the published version as they are then\")", async () => {
    const directory = scratch();
    const recordFile = join(directory, "release-signer.json");
    copyFileSync(place("aosp/signing/release-signer.json"), recordFile);
    const channel = channelAt({ "alpha-update-stable.json": json({ versionCode: 121 }), "alpha-phone-121.apk": json("alpha 121") }, recordFile);
    const now = Math.floor(Date.now() / 3_600_000);
    const qualified = (number: number, age = 0) => {
      const file = join(directory, `run-${number}.json`);
      const state: Channel.Channel = { ...Channel.initial, stage: "Qualified", number, attempt: 1, lastNumber: number, plan: 1, reviewed: true, signers: 1, deliveredAt: now - age, qualifiedAt: now - age };
      write(directory, `run-${number}.json`, { state, taken: [] });
      const apk = join(directory, `alpha-phone-${number}.apk`);
      writeFileSync(apk, `alpha ${number} signed`);
      const bytes = readFileSync(apk);
      const manifestFile = write(directory, `manifest-${number}.json`, { schema: "alpha-update/v1", versionCode: number, apkUrl: apkUrl(number), sha256: digestOf(bytes), sizeBytes: bytes.length });
      const read = { sha256: digestOf(bytes), apk: { launcher: true, signer: true, version: number, debuggable: false, bytes: bytes.length, entries: true } };
      return { run: ledger<Channel.Channel, Channel.Event>(Channel, file), file, apk, manifestFile, read };
    };
    const published = async (release: ReturnType<typeof qualified>, port: ChannelPort = channel.port) => {
      const exit = await Effect.runPromiseExit(publishRelease({ ...release, port }));
      return Exit.isSuccess(exit) ? { ok: true as const, state: exit.value } : { ok: false as const, said: String(Cause.squash(exit.cause)) };
    };
    // spec/release/index.md, "The anonymous download must return the exact size and digest before anything else moves"; spec/release/index.md, "Reading the manifest back settles it: naming this release confirms it, naming an older one sends the same candidate back to repair it, and naming a newer one means another release overtook this one"
    const first = qualified(122);
    expect(await published(first)).toMatchObject({ ok: true, state: { stage: "Published", pointer: 122, pointerRead: true, reused: false } });
    expect(channel.uploads).toEqual(["alpha-phone-122.apk", "alpha-update-stable.json"]);
    // spec/release/index.md, "Recording the release raises the floor to its version, only once the manifest was read back naming it"
    expect(await releasedOver(channel.port)("record", "--run", first.file, "--manifest", first.manifestFile)).toMatchObject({ ok: true, value: { lastRelease: { versionCode: 122 }, state: { stage: "Recorded", floor: 122 } } });
    expect((JSON.parse(readFileSync(recordFile, "utf8")) as { lastRelease: { versionCode: number } }).lastRelease.versionCode).toBe(122);
    // spec/release/index.md, "The APK is uploaded while the receipt is valid, above the floor and the published version; one already on the channel is never overwritten, only reused": a damaged APK left by a delivery that failed half way is reused, never verifies, and nothing moves.
    channel.assets["alpha-phone-123.apk"] = json("half an upload");
    const damaged = qualified(123);
    const damagedResult = await published(damaged);
    expect(damagedResult.ok).toBe(false);
    expect(damagedResult.ok ? "" : damagedResult.said).toContain("not the admitted APK");
    expect([channel.uploads.length, damaged.run.state.stage, damaged.run.state.reused, JSON.parse(new TextDecoder().decode(channel.assets["alpha-update-stable.json"]))]).toEqual([2, "Uploaded", true, { schema: "alpha-update/v1", versionCode: 122, apkUrl: apkUrl(122), sha256: first.read.sha256, sizeBytes: first.read.apk.bytes }]);
    // spec/release/index.md, "Qualification and upload both happen before the receipt expires"
    const stale = qualified(124, 30);
    const staleResult = await published(stale);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.ok ? "" : staleResult.said).toContain("refuses the upload");
    // spec/release/index.md, "The channel's retained APKs raise the floor: a candidate is numbered, and a release published, only above every APK any writer keeps there"
    channel.assets["alpha-phone-130.apk"] = json("alpha 130");
    const floorResult = await published(qualified(125));
    expect(floorResult.ok).toBe(false);
    expect(floorResult.ok ? "" : floorResult.said).toContain("refuses the upload");
    delete channel.assets["alpha-phone-130.apk"];
    // spec/release/index.md, "A manifest that did not take can be repaired by the same candidate": a manifest that still names the older release sends the candidate back, and moving it again settles it.
    const stuck = { ...channel.port, upload: (file: string, name: string, clobber: boolean) => name === "alpha-update-stable.json" ? Effect.void : channel.port.upload(file, name, clobber) };
    const repaired = qualified(126);
    expect(await published(repaired, stuck)).toMatchObject({ ok: true, state: { stage: "Verified", pointer: 122 } });
    expect(await published(repaired)).toMatchObject({ ok: true, state: { stage: "Published", pointer: 126, pointerRead: true } });
    // spec/release/index.md, "Another release can overtake this one"
    const overtaking = { ...channel.port, upload: (file: string, name: string, clobber: boolean) => name === "alpha-update-stable.json" ? Effect.sync(() => { channel.assets[name] = json({ versionCode: 140 }); }) : channel.port.upload(file, name, clobber) };
    expect(await published(qualified(127), overtaking)).toMatchObject({ ok: true, state: { stage: "Abandoned", pointer: 140, floor: 140 } });
  });

  // spec/release/index.md, "A manifest names the release by a version name of 1 to 64 characters with no control character, and by notes of at most 500, as phones show them"
  it("refuses a manifest whose name or notes a phone would not show", async () => {
    const directory = scratch();
    const long = await released("manifest", "--apk", join(directory, "alpha-phone-122.apk"), "--version", "122", "--notes", "x".repeat(501), "--out", join(directory, "m.json"));
    expect(long).toMatchObject({ ok: false, tag: "UsageError" });
    expect(long.ok ? "" : long.said).toContain("notes of at most 500");
  });

  it("reports the channel healthy only for a launcher of Alpha's one key above every floor, kept and served exactly (spec/release/index.md, \"The channel is healthy only while its manifest names a launcher of Alpha's one key, above the retired channel and the last recorded release, at an address it keeps, served with exactly its size and digest\")", async () => {
    const reviewed = (JSON.parse(readFileSync(place("aosp/signing/release-signer.json"), "utf8")) as { signerSha256: string }).signerSha256;
    const apk = json("alpha 122");
    const offer = { schema: "alpha-update/v1", variant: "launcher", versionCode: 122, signerSha256: reviewed, apkUrl: apkUrl(122), sha256: digestOf(apk), sizeBytes: apk.length };
    const status = (manifest: unknown) => releasedOver(channelAt({ "alpha-update-stable.json": json(manifest), "alpha-phone-122.apk": apk }).port)("status");
    expect(await status(offer)).toMatchObject({ ok: true, value: { versionCode: 122, kept: true, exact: true } });
    for (const unhealthy of [{ signerSha256: digest("another key") }, { variant: "companion" }, { sha256: digest("other bytes") }]) {
      const checked = await status({ ...offer, ...unhealthy });
      expect(checked.ok).toBe(false);
      expect(checked.ok ? "" : checked.said).toContain("not healthy");
    }
    // spec/release/index.md, "Phones read the launcher channel from the stable release of Alpha's repository, eliza-research/alpha, known by its permanent id; APKs kept under the repository's earlier names stay valid": the Android build reads the manifest from the very address the release publishes.
    const host = JSON.parse(readFileSync(place("android/host.json"), "utf8")) as { buildConfigFields: { name: string; value: unknown }[] };
    expect(host.buildConfigFields.find((field) => field.name === "ALPHA_UPDATE_MANIFEST_URL")?.value).toBe(manifestUrl());
  });

  // spec/release/index.md, "An APK is admitted to the channel only as Alpha's launcher, first signed by Alpha's one key, at the candidate's version, not debuggable, of at most 2 GiB, and with only the entries a release may hold"
  it("moves nothing for an APK it cannot admit", async () => {
    const directory = scratch();
    const missing = await released("publish", "--run", join(directory, "run.json"), "--apk", join(directory, "alpha-phone-122.apk"), "--manifest", write(directory, "m.json", {}), "--execute");
    expect([missing.ok, missing.tag !== "UsageError"]).toEqual([false, true]);
    expect((await released("publish", "--apk", "x", "--manifest", "y")).tag).toBe("UsageError");
  });
});

/** A verify row of an unsigned release candidate with nothing else to block it, as eliza's verification records one. */
const candidateRow = (overrides: Record<string, unknown> = {}) => ({
  mode: "release", sha256: digest("candidate"), testMocks: false, bundleAudit: "passed", signed: false, runtime: "PACKAGED", runtimeNotices: true,
  runtimeProfile: "native", voiceHost: { packaged: true, differences: [], qualified: true }, licenceBlockers: [], distributable: false, ...overrides,
});

describe("Build a candidate and sign it (spec/release/index.md, \"Story: Build a candidate\"; spec/release/index.md, \"Story: Sign a release\")", () => {
  it("numbers each candidate above the floor, mirrors it once, and signs only from the reviewed plan of its own attempt", async () => {
    const directory = scratch();
    const run = join(directory, "run.json");
    const unsigned = join(directory, "launcher-release-unsigned.apk");
    writeFileSync(unsigned, "unsigned candidate bytes");
    const debugRow = candidateRow({ mode: "debug", sha256: digest("debug"), signed: true, signerSha256: digest("debug key"), distributable: false });
    const verified = write(directory, "apk-manifest.json", { results: [debugRow, candidateRow()] });
    const lock = JSON.parse(readFileSync(place("../../eliza.lock.json"), "utf8")) as { remote: string; branch: string; commit: string };
    const upstream = join(directory, "upstream.json");
    const candidate = (number: string, apks: string, reached = upstream) => released("candidate", "--run", run, "--number", number, "--attempt", "1", "--apk-manifest", apks, "--upstream", reached);
    // spec/release/index.md, "A candidate is built only from an eliza pin that the branch its lock names reaches, by a compare made for exactly that pin"
    const comparison = `https://api.github.com/repos/elizaOS/eliza/compare/${lock.commit}...${lock.branch}`;
    const page = `${comparison}?per_page=1&page=2`;
    const ancestry = { status: "ahead", merge_base_commit: { sha: lock.commit } };
    const large = json({ ...ancestry, files: [{ patch: "x".repeat(65_537) }] });
    const published = channelAt({ [comparison]: large, [page]: json(ancestry) });
    expect(compareUrl(lock)).toBe(page);
    expect(await releasedOver(channelAt({ [page]: large }).port)("upstream", "--out", upstream)).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await releasedOver(published.port)("upstream", "--out", upstream)).toMatchObject({ ok: true, value: { ...lock, status: "ahead", mergeBase: lock.commit } });
    expect([compared({ ...lock, status: "diverged", mergeBase: digest("older") }, lock), compared({ ...lock, commit: "0".repeat(40), status: "ahead", mergeBase: lock.commit }, lock)])
      .toEqual([{ forThePin: true, reached: false }, { forThePin: false, reached: true }]);
    const diverged = await candidate("121", verified, write(directory, "diverged.json", { ...lock, status: "diverged", mergeBase: "0".repeat(40) }));
    expect(diverged).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(diverged.ok ? "" : diverged.said).toContain("\"upstream\":true");
    expect(await candidate("121", verified, write(directory, "another.json", { ...lock, branch: "main", status: "ahead", mergeBase: lock.commit }))).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    const stage = () => (JSON.parse(readFileSync(run, "utf8")) as { state: { stage: string; attempt: number; reviewed: boolean } }).state;
    // spec/release/index.md, "A build is a candidate only when its verification recorded it distributable: no test mocks, the production bundle audit passed, Alpha's one signer, the runtime packaged with its notices, an on-device voice slot, and for an image its platform certificate"
    expect(await candidate("121", write(directory, "mocked.json", { results: [debugRow, candidateRow({ testMocks: true })] }))).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/index.md, "A build its verification found not distributable is no candidate, and its run number is spent"
    expect(await candidate("121", verified)).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/index.md, "A candidate is built only when none is in flight, numbered by a run above every run before it, the floor and the published version"
    expect(await candidate("74", verified)).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await candidate("122", verified)).toMatchObject({ ok: true, value: { stage: "Built", number: 122 } });
    expect(await candidate("123", verified)).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    // spec/release/index.md, "The candidate is mirrored privately, creating the object only if it is absent, or reusing one whose bytes read back the same"
    const mirror = join(directory, "private");
    expect(await released("mirror", "--run", run, "--apk", unsigned, "--to", mirror)).toMatchObject({ ok: true, value: { mirrored: join(mirror, "alpha-phone-122-unsigned.apk") } });
    // spec/release/index.md, "A signing plan names the attempt it was made from, and is reviewed before use"
    const planned = await released("plan", "--run", run, "--apk", unsigned, "--out", join(directory, "plan.json"));
    const planSha256 = planned.ok ? String(planned.value.planSha256) : "";
    expect(await released("review", "--run", run, "--plan", join(directory, "plan.json"), "--plan-sha256", digest("another plan"))).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await released("review", "--run", run, "--plan", join(directory, "plan.json"), "--plan-sha256", planSha256)).toMatchObject({ ok: true, value: { stage: "Planned", reviewed: true, plan: 1 } });
    // spec/release/index.md, "Signing happens only in the protected environment, from the reviewed plan of the same attempt, with one signer and no key rotation": a keystore inside the working tree is not the protected one.
    const sign = (keystore: string) => released("sign", "--run", run, "--plan", join(directory, "plan.json"), "--apk", unsigned, "--out", join(directory, "signed.apk"), "--keystore", keystore, "--key-label", "alpha-release");
    const unguarded = await sign(place("aosp/signing/release-signer.json"));
    expect([unguarded.ok, unguarded.ok ? "" : unguarded.said.includes("protected keystore")]).toEqual([false, true]);
    // spec/release/index.md, "A rerun keeps its number and takes a new attempt, before signing only": the plan reviewed for the first attempt no longer signs.
    expect(await released("rerun", "--run", run)).toMatchObject({ ok: true, value: { number: 122, attempt: 2 } });
    const keystore = join(directory, "release.p12");
    writeFileSync(keystore, "keystore", { mode: 0o600 });
    process.env.ALPHA_APP_RELEASE_KEYSTORE_PASSWORD = "test";
    try {
      expect(await sign(keystore)).toMatchObject({ ok: false, said: "signing needs the reviewed plan of this attempt" });
    } finally {
      delete process.env.ALPHA_APP_RELEASE_KEYSTORE_PASSWORD;
    }
    expect([stage().stage, stage().attempt]).toEqual(["Planned", 2]);
    // spec/release/index.md, "A candidate can be abandoned before it is published": its number stays spent.
    expect(await released("abandon", "--run", run)).toMatchObject({ ok: true, value: { stage: "Abandoned" } });
    expect(await candidate("122", verified)).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(await candidate("123", verified)).toMatchObject({ ok: true, value: { stage: "Built", number: 123 } });
  });
});

const PACKAGE = "ai.alphacompute.alphaphone";
const STOCK = "com.android.launcher3/.Launcher";

/** Answers one fake adb line from the first matching pattern. */
function replyFor(answers: readonly [RegExp, () => string][], line: string) {
  const answer = answers.find(([pattern]) => pattern.test(line));
  if (answer === undefined) throw new Error(`the phone does not answer adb ${line}`);
  return answer[1]();
}

/** A pilot phone at the other end of adb: Home's holder, Alpha's installed version and data, and every command it was sent. */
function pilotPhone({ install = (): void => undefined, agentLog = "1790000003.000 ElizaAgent: Detached agent health check passed" } = {}) {
  const apk = digest("alpha 122");
  const phone = { holders: [PACKAGE], activity: `${PACKAGE}/.MainActivity`, version: 121, started: false, sent: [] as string[] };
  const adb: Adb = (args) => {
    const line = args.join(" ");
    phone.sent.push(line);
    const home = /^shell cmd role add-role-holder --user 0 android\.app\.role\.HOME (\S+)$/.exec(line);
    if (home?.[1] !== undefined) { phone.holders = [home[1]]; return ""; }
    const activity = /^shell cmd package set-home-activity --user 0 (\S+)$/.exec(line);
    if (activity?.[1] !== undefined) { phone.activity = activity[1]; return ""; }
    if (line.startsWith("install -r ")) { install(); phone.version = 122; return "Success"; }
    return replyFor([
      [/^shell am get-current-user$/, () => "0"],
      [/^shell cmd role get-role-holders /, () => phone.holders.join(";")],
      [/^shell cmd package resolve-activity /, () => `priority=0 preferredOrder=0\n${phone.activity}`],
      [/^shell cmd package query-activities /, () => `${STOCK}\n${PACKAGE}/.MainActivity`],
      [/^shell dumpsys package /, () => `versionCode=${phone.version} minSdk=35\n  userId=10234\n  firstInstallTime=2026-11-01 10:00:00`],
      [/^shell am force-stop /, () => ""],
      [/^shell ps -A -o PID,NAME$/, () => `PID NAME\n1 init${phone.started ? `\n2 ${PACKAGE}` : ""}`],
      [/^shell run-as /, () => `${digest("notes")}  ./files/notes.db\nREADBACK_EXIT=0`],
      [/^shell content query /, () => "No content provider found"],
      [/^shell pm path /, () => "package:/data/app/alpha/base.apk"],
      [/^shell sha256sum /, () => `${apk}  /data/app/alpha/base.apk`],
      [/^shell date \+%s$/, () => "1790000000"],
      [/^shell am start /, () => { phone.started = true; return ""; }],
      [/^shell logcat /, () => agentLog],
      [/^shell dumpsys activity services /, () => "ACTIVITY MANAGER SERVICES (dumpsys activity services)"],
    ], line);
  };
  return { phone, adb, apk: { file: "alpha-phone-122.apk", sha256: apk, versionCode: 122 } };
}

describe("Update a pilot phone by cable (spec/release/pilot.md, \"Story: Update a pilot phone by cable\")", () => {
  it("hands Home to the stock launcher, installs in place, checks Alpha's data, gives Home back and starts the agent, holding the phone throughout", () => {
    const locks = scratch();
    let second: { _tag?: string; message?: string } | undefined;
    const { phone, adb, apk } = pilotPhone({ install: () => {
      // spec/release/pilot.md, "A run claims the phone's lock, and no other run can start until it is released"
      try { pilotUpdate({ adb, serial: "pilot-1", apk, locks }); } catch (failure) { second = failure as { _tag?: string; message?: string }; }
    } });
    const update = pilotUpdate({ adb, serial: "pilot-1", apk, locks });
    expect([second?._tag, second?.message?.includes("another pilot run holds this phone")]).toEqual(["ReleaseRefused", true]);
    // spec/release/pilot.md, "A pilot update claims the phone, reads its data, installs, checks, restores Home and starts the agent, in that order"
    expect(update.state).toMatchObject({ leg: "Done", locked: false, moved: true, restoration: "Restored", before: "Inventory", verified: true, stopped: true, agent: "Running", passed: true, home: "AlphaHome" });
    expect(update.receipt).toEqual({ packageMatches: true, data: "DataPreserved", passed: true });
    const at = (prefix: string) => phone.sent.findIndex((line) => line.startsWith(prefix));
    // spec/release/pilot.md, "When Alpha is Home, Home is handed to the stock launcher first, and a handoff Android did not confirm leaves Home split"; spec/release/pilot.md, "Cleaning up records whether the agent stopped, then Home is restored if the run moved it"
    expect([at("shell cmd role add-role-holder --user 0 android.app.role.HOME com.android.launcher3") < at("shell run-as"), at("shell run-as") < at("install -r"),
      at("install -r") < at(`shell cmd role add-role-holder --user 0 android.app.role.HOME ${PACKAGE}`), at(`shell cmd role add-role-holder --user 0 android.app.role.HOME ${PACKAGE}`) < at("shell am start")])
      .toEqual([true, true, true, true]);
    expect(pilotUpdate({ adb: pilotPhone().adb, serial: "pilot-1", apk, locks }).state.leg).toBe("Done");
  });

  // spec/release/pilot.md, "A run passes only when the agent came back"
  it("fails a run whose agent never says it is running, even with Alpha's process up", () => {
    const { adb, apk } = pilotPhone({ agentLog: "" });
    const update = pilotUpdate({ adb, serial: "pilot-3", apk, locks: scratch() });
    expect([update.state.leg, update.state.agent, update.state.passed]).toEqual(["Done", "NotVerified", false]);
  });

  it("never takes an installer that did not return as installed, and then gives Home back without starting the agent", () => {
    const { phone, adb, apk } = pilotPhone({ install: () => { throw new Error("adb: device offline"); } });
    const update = pilotUpdate({ adb, serial: "pilot-2", apk, locks: scratch() });
    // spec/release/pilot.md, "An installer that does not return is never taken as installed"; spec/release/pilot.md, "The agent is started only after a verified install, a clean stop and Home restored or never moved"
    expect(update.state).toMatchObject({ leg: "Done", dispatched: true, returned: false, verified: false, agent: "Unstarted", passed: false, restoration: "Restored" });
    expect([update.failures, phone.sent.some((line) => line.startsWith("shell am start"))]).toEqual([["adb: device offline"], false]);
  });
});

describe("Read back a phone that updated itself (spec/release/index.md, \"Story: Read back a phone that updated itself\")", () => {
  it("passes a phone that took the offer in place with Alpha as the installer, and not one another program installed", () => {
    const offer: Offer = { versionCode: 122, sha256: digest("alpha 122"), sizeBytes: 4096, apkUrl: "https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-phone-122.apk", signerSha256: digest("signer") };
    const phone = { version: 121, apk: digest("alpha 121"), initiator: "com.android.shell", sent: [] as string[] };
    const adb: Adb = (args) => {
      const line = args.join(" ");
      phone.sent.push(line);
      return replyFor([
        [/^shell am get-current-user$/, () => "0"],
        [/^shell dumpsys package /, () => `versionCode=${phone.version} minSdk=35\n  userId=10234\n  firstInstallTime=2026-11-01 10:00:00\n  installInitiatingPackageName=${phone.initiator}`],
        [/^shell pm path /, () => "package:/data/app/alpha/base.apk"],
        [/^shell sha256sum /, () => `${phone.apk}  /data/app/alpha/base.apk`],
        [/^shell cmd role get-role-holders /, () => PACKAGE],
        [/^shell cmd package resolve-activity /, () => `priority=0\n${PACKAGE}/.MainActivity`],
      ], line);
    };
    const before = readBack({ adb, offer });
    Object.assign(phone, { version: 122, apk: offer.sha256, initiator: PACKAGE });
    // spec/release/index.md, "A phone updated itself only when it kept its install, runs the offered version with the offered APK's exact bytes, Alpha started the install, and Home and the offer did not change"
    expect(readBack({ adb, offer, before: before.observed })).toMatchObject({ passed: true, readback: { sameInstall: true, advanced: true, exact: true, selfInitiated: true, homeKept: true, offerKept: true } });
    phone.initiator = "com.android.shell";
    expect(readBack({ adb, offer, before: before.observed })).toMatchObject({ passed: false, readback: { selfInitiated: false } });
    expect(phone.sent.every((line) => !/install|role add|set-home|am start|force-stop/.test(line))).toBe(true);
  });
});

describe("Prove the protected release keys (spec/release/index.md, \"Story: Sign a release\")", () => {
  it("builds the verified-boot metadata Alpha committed from its key", () => {
    const committed = readFileSync(place("aosp/signing/public/avb_pkmd.bin"));
    const bits = committed.readUInt32BE(0);
    const n = committed.subarray(8, 8 + bits / 8).toString("base64url");
    const key = createPublicKey({ key: { kty: "RSA", n, e: "AQAB" }, format: "jwk" }).export({ type: "spki", format: "der" });
    // spec/release/index.md, "The protected keys are proven to be the enrolled ones: each of the nine OS certificates, the two verified-boot keys and Alpha's app key pairs with its committed public identity, none is a test key, and no two are the same"
    expect(avbMetadata(key, bits).equals(committed)).toBe(true);
  });

  it("proves disposable keys that match their committed identities, and refuses when one committed identity is another key's", () => {
    const directory = scratch();
    const keys = join(directory, "keys");
    const committed = join(directory, "public");
    mkdirSync(keys);
    mkdirSync(committed);
    const openssl = (...args: string[]) => execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"] });
    const certificate = (name: string) => {
      openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(directory, `${name}.key`), "-out", join(keys, `${name}.x509.pem`), "-subj", `/CN=${name}`, "-days", "1");
      return createHash("sha256").update(openssl("x509", "-in", join(keys, `${name}.x509.pem`), "-outform", "DER")).digest("hex");
    };
    const names = ["releasekey", "platform", "shared", "media", "networkstack", "sdk_sandbox", "bluetooth", "nfc", "apex"];
    const certificates: Record<string, string> = {};
    const entries: unknown[] = [];
    for (const name of names) {
      certificates[name] = certificate(name);
      openssl("pkcs8", "-topk8", "-in", join(directory, `${name}.key`), "-outform", "DER", "-out", join(keys, `${name}.pk8.enc`), "-passout", "pass:os-secret");
      copyFileSync(join(keys, `${name}.x509.pem`), join(committed, `${name}.x509.pem`));
      entries.push({ name, kind: "x509-pk8", certificateSha256: certificates[name] });
    }
    const avb: Record<string, Buffer> = {};
    for (const name of ["apex_payload", "avb"]) {
      openssl("genrsa", "-out", join(directory, `${name}.key`), "2048");
      openssl("rsa", "-in", join(directory, `${name}.key`), "-pubout", "-out", join(keys, `${name}.pub.pem`));
      openssl("pkcs8", "-topk8", "-in", join(directory, `${name}.key`), "-out", join(keys, `${name}.pem.enc`), "-passout", "pass:os-secret");
      avb[name] = avbMetadata(openssl("pkey", "-pubin", "-in", join(keys, `${name}.pub.pem`), "-outform", "DER"), 2048);
      writeFileSync(join(keys, `${name}.avbpubkey`), avb[name] ?? "");
      entries.push({ name, kind: "avb-rsa", avbPublicKeySha256: digestOf(avb[name]) });
    }
    writeFileSync(join(keys, "avb_pkmd.bin"), avb.avb ?? "");
    writeFileSync(join(committed, "avb_pkmd.bin"), avb.avb ?? "");
    writeFileSync(join(committed, "apex_payload.avbpubkey"), avb.apex_payload ?? "");
    writeFileSync(join(keys, "fingerprints.json"), JSON.stringify({ schemaVersion: 1, testKeys: false, keys: entries }));
    const appSigner = certificate("alphaphone_app");
    copyFileSync(join(keys, "alphaphone_app.x509.pem"), join(committed, "alphaphone_app.x509.pem"));
    openssl("pkcs12", "-export", "-inkey", join(directory, "alphaphone_app.key"), "-in", join(keys, "alphaphone_app.x509.pem"), "-name", "alpha-release", "-out", join(directory, "app.p12"), "-passout", "pass:app-secret");
    rmSync(join(keys, "alphaphone_app.x509.pem"));
    execFileSync("tar", ["czf", join(directory, "keys.tgz"), "-C", keys, ...readdir(keys)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    const archive = readFileSync(join(directory, "keys.tgz")).toString("base64");
    const half = Math.ceil(archive.length / 8) * 4;
    const secrets = {
      ALPHA_OS_RELEASE_KEYS_PART1_B64: archive.slice(0, half), ALPHA_OS_RELEASE_KEYS_PART2_B64: archive.slice(half), ALPHA_OS_RELEASE_KEYS_PASSPHRASE: "os-secret",
      ALPHA_APP_RELEASE_KEYSTORE_B64: readFileSync(join(directory, "app.p12")).toString("base64"), ALPHA_APP_RELEASE_KEYSTORE_PASSWORD: "app-secret",
    };
    const bits = Object.fromEntries([...names, "apex_payload", "avb", "alphaphone_app"].map((name) => [name, 2048]));
    const enrolled = { certificates, avbSha256: digestOf(avb.avb), appSigner, bits, publicDirectory: committed };
    // spec/release/index.md, "The protected keys are proven to be the enrolled ones: each of the nine OS certificates, the two verified-boot keys and Alpha's app key pairs with its committed public identity, none is a test key, and no two are the same"
    expect(custodyProof({ secrets, enrolled, scratch: directory }).custody).toEqual({ pairs: 12, matching: 12, distinct: true, testKeys: false });
    copyFileSync(join(committed, "media.x509.pem"), join(committed, "platform.x509.pem"));
    expect(custodyProof({ secrets, enrolled, scratch: directory }).custody).toEqual({ pairs: 12, matching: 11, distinct: true, testKeys: false });
  }, 300_000);
});

describe("Sign a preserving OS update (spec/release/os.md, \"Story: Sign a preserving OS update\")", () => {
  const pin = JSON.parse(readFileSync(place("aosp/signing/ota-tools.json"), "utf8")) as ToolsPin & { reviewedTargets: { targetFilesSha256: string; sourceCommit: string; sdkCommit: string; targetFingerprint: string; buildTimestamp: number }[] };
  const target = pin.reviewedTargets[0];
  const stored = (prefix: string, sha256: string) => ({ bucket: "alpha-aosp-lab-20261024-private-apks", object: `unsigned/${prefix}/${sha256}.zip`, generation: "1794604543000000", bytes: 4096, sha256 });
  const plan = {
    schema: "alpha-preserving-os-ota-signing/v1", purpose: "pilot-no-platform-key-rotation", sourceCommit: target.sourceCommit, sdkCommit: target.sdkCommit,
    targetFiles: stored("os", target.targetFilesSha256), otaTools: stored("os-tools", pin.sha256), outputObject: `signed/os-ota/${target.targetFilesSha256}/${"0".repeat(32)}/ota.zip`,
    product: "alpha_stallion_phone", device: "stallion", targetFingerprint: target.targetFingerprint, buildTimestamp: target.buildTimestamp,
  };
  const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const zipped = (directory: string, name: string, entries: Record<string, string>) => {
    const root = join(directory, `${name}-entries`);
    for (const [entry, content] of Object.entries(entries)) {
      mkdirSync(join(root, entry, ".."), { recursive: true });
      writeFileSync(join(root, entry), content);
    }
    execFileSync("zip", ["-qrX", join(directory, `${name}.zip`), "."], { cwd: root });
    return join(directory, `${name}.zip`);
  };

  it("admits only the reviewed text of a plan that names one reviewed build, a reviewed producer and the pinned tools", async () => {
    const bytes = text(plan);
    const reviewed = createHash("sha256").update(bytes).digest("hex");
    // spec/release/os.md, "A preserving update is signed only from a plan that names exactly one reviewed build, by a reviewed producer, with the pinned tools, for Alpha's product and device"
    expect(osPlanOf(bytes, reviewed, pin).facts).toEqual({ reviewed: 1, producer: true, tools: true, product: true, output: true, inputs: false });
    expect(() => osPlanOf(bytes, digest("another plan"), pin)).toThrow("not the text that was reviewed");
    const twice = { ...pin, reviewedTargets: [target, target] };
    expect(osPlanOf(bytes, reviewed, twice).facts.reviewed).toBe(2);
    const other = text({ ...plan, sourceCommit: "f".repeat(40), outputObject: "signed/os-ota/elsewhere/ota.zip" });
    expect(osPlanOf(other, createHash("sha256").update(other).digest("hex"), pin).facts).toMatchObject({ reviewed: 0, producer: false, output: false });
    const directory = scratch();
    const file = join(directory, "plan.json");
    writeFileSync(file, bytes);
    expect(await released("os-plan", "--plan", file, "--plan-sha256", reviewed)).toMatchObject({ ok: true, value: { admitted: true, outputObject: plan.outputObject } });
    const osSign = await released("os-sign", "--plan", file, "--plan-sha256", reviewed, "--target-files", file, "--ota-tools", file, "--work", join(directory, "work"));
    expect(osSign).toMatchObject({ ok: false, tag: "ReleaseRefused" });
    expect(osSign.ok ? "" : osSign.said).toContain("\"inputs\":false");
  });

  it("signs from a build that keeps its keys and its phone's data, and from no build that replaces data or brings a hook", () => {
    const directory = scratch();
    const signers = 'name="Settings.apk" certificate="build/make/target/product/security/platform.x509.pem" private_key="build/make/target/product/security/platform.pk8"';
    const keptSigners = createHash("sha256").update('{"Settings.apk":{"certificate":"build/make/target/product/security/platform.x509.pem","private_key":"build/make/target/product/security/platform.pk8"}}').digest("hex");
    const keptBoot = createHash("sha256").update('{"avb_vbmeta_algorithm":"SHA256_RSA4096","avb_vbmeta_key_path":"external/avb/test/data/testkey_rsa4096.pem"}').digest("hex");
    const ours = { ...pin, apkSignerMappingsSha256: keptSigners, avbKeyConfigurationSha256: keptBoot, reviewedTargets: [{ ...target }] };
    const build = (more: Record<string, string> = {}, partitions = "system\nvendor\nboot") => zipped(directory, `build-${Object.keys(more).length}-${partitions.length}`, {
      "META/misc_info.txt": "ab_update=true\navb_vbmeta_key_path=external/avb/test/data/testkey_rsa4096.pem\navb_vbmeta_algorithm=SHA256_RSA4096\nother=1\n",
      "META/ab_partitions.txt": partitions, "META/apkcerts.txt": `${signers}\n`,
      "PRODUCT/etc/build.prop": `ro.build.fingerprint=${target.targetFingerprint}\nro.build.date.utc=${target.buildTimestamp}\n`, ...more,
    });
    const read = (zip: string) => osBuildOf(zip, plan, ours, ours.reviewedTargets[0]).build;
    // spec/release/os.md, "The build keeps its own APK signers and verified-boot keys, replaces no data or trust-state partition, and brings no signing hook of its own"
    expect(read(build())).toEqual({ signersKept: true, bootKeysKept: true, abUpdate: true, dataPartitions: false, hooks: false, identity: true });
    expect(read(build({}, "system\nuserdata"))).toMatchObject({ dataPartitions: true });
    expect(read(build({ "META/releasetools.py": "print()" }))).toMatchObject({ hooks: true });
    expect(osBuildOf(build(), plan, { ...ours, avbKeyConfigurationSha256: digest("rotated") }, ours.reviewedTargets[0]).build.bootKeysKept).toBe(false);
  });

  it("keeps no update its metadata says wipes or downgrades, nor one that no certificate signs whole", () => {
    const directory = scratch();
    const update = (extra: string) => zipped(directory, `ota-${extra.length}`, {
      "META-INF/com/android/metadata": `ota-type=AB\npre-device=stallion\npost-build=${target.targetFingerprint}\npost-timestamp=${target.buildTimestamp}\n${extra}`,
      "payload.bin": "payload",
    });
    // spec/release/os.md, "The signed update is kept only when one certificate, the enrolled release key's, signs it whole, for the planned build and time, with no wipe and no downgrade"
    expect(osSignedOf(update(""), plan, target.buildTimestamp, digest("enrolled"), directory)).toEqual({ enrolled: false, oneSigner: false, postBuild: true, postTime: true, wipes: false, downgrades: false });
    expect(osSignedOf(update("ota-wipe=yes\n"), plan, target.buildTimestamp, digest("enrolled"), directory)).toMatchObject({ wipes: true });
    expect(osSignedOf(update("ota-downgrade=yes\n"), plan, target.buildTimestamp + 1, digest("enrolled"), directory)).toMatchObject({ downgrades: true, postTime: false });
  });
});
