#!/usr/bin/env node
// spec/app/image/index.md, "Story: Stage Alpha into an image"; spec/app/image/index.md, "Story: Keep the phone and messages on Alpha's phone"; spec/app/image/index.md, "Story: Let a handed-over phone update its launcher on its own"; spec/app/image/index.md, "Story: Update an Alpha Pixel by cable, and get back"; spec/app/image/index.md, "Story: Sign Alpha's releases with one key"; spec/release/os.md, "Story: Enrol the image's updater"; spec/release/os.md, "Story: Update an image by hand"; spec/release/os.md, "Story: Recover an image"; spec/release/os.md, "Story: Run the drills"; spec/release/os.md, "Enrolment is staged only with exactly the pinned profile, and staged disabled"; spec/release/os.md, "A drill's result is recorded by the release owner only once that drill has been run, and a failed drill takes back physical recovery and turns the updater off"
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aaptManifestTree, composeProduct, createDevelopmentLauncherDescriptor, decrypt, enrollUpdater, generate, otaMain, parseArgs, provisioningComponents,
  requireClockProduct, signRelease, signReleaseRequest, stageLauncher, stageListener, validateDescriptor, verifyDeviceSource, verifyImage, verifySecureCameraSource,
  verifySource, writeImageCapability, writeImageProvisioningOverlay, writeReleaseRecord, writeRoleOverrides, writeSecureCameraOverlay,
} from "@elizaos/os";
import { Data, Effect } from "effect";
import {
  alphaChannel, alphaPrivileged, channelIsAlphas, firstBootGrants, grantsAdmitted, imageTelephony, listenerImage, privilegedAdmitted, provisionsHome, readsChannel,
  readsSourceLock, signerRecordAdmitted, stageProblems, type OtaCommand, type Patch, type Stage, type Target,
} from "../gen/app__image.ts";
import * as Os from "../gen/release__os.ts";
import { ReleaseRefused, dispatch, ledger, runCli } from "./release.ts";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A path of this package, or of eliza's os package when it starts with `@elizaos/os/`. */
export const place = (relative: string) => relative.startsWith("@elizaos/os/") ? fileURLToPath(import.meta.resolve(relative)) : join(app, relative);
const sha256File = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const json = (relative: string): unknown => JSON.parse(readFileSync(place(relative), "utf8"));

export class UsageError extends Data.TaggedError("UsageError")<{ readonly message: string }> {}
export class StageRefused extends Data.TaggedError("StageRefused")<{ readonly problems: readonly string[]; readonly message: string }> {}
export class InputUnreadable extends Data.TaggedError("InputUnreadable")<{ readonly message: string }> {}

/** Reads and checks done before any tool runs, as the failure they are. */
const attempt = <A>(read: () => A) => Effect.try({
  try: read,
  catch: (cause) => cause instanceof UsageError || cause instanceof StageRefused || cause instanceof ReleaseRefused ? cause : new InputUnreadable({ message: cause instanceof Error ? cause.message : String(cause) }),
});

const PRODUCTS: Readonly<Record<Target, string>> = { Cuttlefish: "aosp/cuttlefish.json", Pixel10a: "aosp/pixel10a.json" };
const RELEASE = "aosp/pixel10a-release.json";
const CHANNEL = "aosp/pixel10a-ota-channel.json";
const KEY_MANIFEST = "aosp/signing/alpha-key-manifest.json";
const ENROLLMENT = "aosp/pilot-system-update-enrollment.json";
const RELEASE_SIGNER = "aosp/signing/release-signer.json";
const SUITE_REGISTRY = "android/suite/apps.json";
const SUITE_CONTROL_BRIDGE_DIR = "aosp/control-bridge";
const SUITE_SANDBOXED_PLAY_DIR = "aosp/sandboxed-play";
const SUITE_LAUNCHER3_DIR = "aosp/launcher3";
const SUITE_BRANDING_DIR = "aosp/branding";
const SUITE_BRANDING_MAKEFILE = "aosp/branding/branding.mk";
const ALPHA_NEXT_ROLES_OVERLAY_MODULE = "AlphaNextRolesOverlay";
const ALPHA_NEXT_DEFAULT_ROLES: Readonly<Record<string, string>> = {
  HOME: "com.android.launcher3",
  ASSISTANT: "ai.alphacompute.alphaphone/ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionService",
  DIALER: "ai.alphacompute.phone",
  SMS: "ai.alphacompute.messages",
  BROWSER: "ai.alphacompute.browser",
  NOTES: "ai.alphacompute.notes",
};
const FORBIDDEN_BINARY_EXTENSIONS = new Set([".apk", ".apex", ".jar", ".dex", ".so", ".vdex", ".odex"]);
const ANDROID_PACKAGE_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const HEX_40 = /^[0-9a-f]{40}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const PRIVILEGED_SUITE_PERMISSIONS = new Set([
  "android.permission.INSTALL_SELF_UPDATES",
  "android.permission.READ_PRIVILEGED_PHONE_STATE",
]);
const CAPABILITY_VALUES = "android/app/src/main/res/values/aosp-capabilities.xml";
const STOCK_SOURCE_LOCK = "@elizaos/os/aosp/sources/pixel10a-stallion.json";
const SHARED_SOURCE_LOCK = "@elizaos/os/aosp/aosp.lock.json";
const LISTENER_CERTIFICATE = "aosp/signing/public/alphaphone_app.x509.pem";
const IMAGE_PROVISIONING = { module: "AlphaImageCapabilityOverlay", overlayable: "AlphaImageProvisioning", resource: "alpha_aosp_image_capability" };
const SENSE = { moduleName: "AlphaSense", componentPackage: "ai.alphacompute.alphaphone.sense", wakeNames: ["alpha"] };
const NATIVE_ABI: Readonly<Record<Target, "x86_64" | "arm64-v8a">> = { Cuttlefish: "x86_64", Pixel10a: "arm64-v8a" };
const PLACEHOLDER = /^(unset|todo|tbd)$|placeholder/i;

const PATCHES: Readonly<Record<string, { readonly patch: Patch; readonly manifest: string; readonly file: string }>> = {
  "chip": { patch: "Chip", manifest: "@elizaos/os/aosp/sense/systemui/chip/manifest.json", file: "@elizaos/os/aosp/sense/systemui/chip/listening-chip.patch" },
  "ops": { patch: "Ops", manifest: "@elizaos/os/aosp/sense/systemui/manifest.json", file: "@elizaos/os/aosp/sense/systemui/microphone-ops.patch" },
  "assist": { patch: "Assist", manifest: "@elizaos/os/aosp/sense/systemui/assist/manifest.json", file: "@elizaos/os/aosp/sense/systemui/assist/assist-identity.patch" },
  "protected-power": { patch: "ProtectedPower", manifest: "@elizaos/os/aosp/sense/systemui/power/manifest.json", file: "@elizaos/os/aosp/sense/systemui/power/protected-power-voice.patch" },
  "soong-memory": { patch: "SoongMemory", manifest: "aosp/build-host/manifest.json", file: "aosp/build-host/soong-memory.patch" },
  "sense-policy": { patch: "SensePolicy", manifest: "aosp/branding/sense-policy/manifest.json", file: "aosp/branding/sense-policy/alpha-sense-policy.patch" },
};
const SOONG_APP_NATIVE = { manifest: "@elizaos/os/aosp/patches/soong-app-native/manifest.json", file: "@elizaos/os/aosp/patches/soong-app-native/soong-app-native.patch" };

const OTA_COMMANDS: Readonly<Record<string, OtaCommand>> = {
  "check": "Check", "apply": "Apply", "status": "Status", "fallback": "Fallback", "stock-archive": "StockArchive", "verify-stock": "VerifyStock", "retain-known-good": "RetainKnownGood",
};

const USAGE = [
  "pnpm aosp stage --target cuttlefish|pixel10a --apk FILE --aosp-source DIR --output NEW_DIR [--development [--owner-telephony]] [--descriptor FILE] [--factory-image FILE (pixel10a)] [--listener-apk FILE --listener-descriptor FILE [--listener-qualification FILE --listener-voice-host FILE --listener-voice-host-sha256 SHA256 --listener-models FILE --listener-models-sha256 SHA256]] [--patch chip|ops|assist|protected-power|soong-memory|sense-policy ...] [--aapt PATH] [--apksigner PATH]",
  "pnpm aosp ota check|apply|status|fallback|stock-archive|verify-stock|retain-known-good [eliza's operator options]",
  "pnpm aosp verify --target pixel10a|cuttlefish --serial SERIAL --user N --expected FILE [--adb PATH] [--out NEW_FILE]",
  "pnpm aosp sign --request FILE [--dry-run]",
  "pnpm aosp record --request FILE",
  "pnpm aosp keys generate --output NEW_DIR --passphrase-file FILE [--organization NAME] [--only a,b] | keys decrypt --input DIR --output NEW_DIR --passphrase-file FILE [--only a,b]",
  "pnpm aosp enroll --checkout DIR --certificate PEM --product-makefile-sha256 HEX --receipt NEW_FILE [--execute]",
  "pnpm aosp os --ledger FILE stage | pass --gate GATE | enable | check --from RECORD|stock --to RECORD | start | interrupt | resume | finish | retain-known-good | fallback --to stock --image FILE | fallback --to known-good | drill --drill DRILL --passed|--failed",
  "pnpm aosp suite validate [--registry FILE] [--with-launcher3] [--with-control-bridge] [--with-sandboxed-play]",
  "pnpm aosp suite stage --target cuttlefish|pixel10a --output NEW_DIR [--registry FILE] [--apks-dir DIR] [--with-launcher3] [--with-control-bridge] [--with-sandboxed-play]",
].join("\n");

interface Flags {
  readonly values: Readonly<Record<string, string>>;
  readonly switches: ReadonlySet<string>;
  readonly repeated: Readonly<Record<string, readonly string[]>>;
}

function flags(argv: readonly string[], spec: { readonly valued: readonly string[]; readonly switches?: readonly string[]; readonly repeated?: readonly string[] }): Flags {
  const values: Record<string, string> = {};
  const switches = new Set<string>();
  const repeated: Record<string, string[]> = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] ?? "";
    const name = argument.startsWith("--") ? argument.slice(2) : "";
    if (spec.switches?.includes(name)) {
      if (switches.has(name)) throw new UsageError({ message: `${argument} is given twice` });
      switches.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!spec.valued.includes(name) && !spec.repeated?.includes(name)) throw new UsageError({ message: `unknown argument ${argument}` });
    if (value === undefined || value === "" || value.startsWith("--")) throw new UsageError({ message: `${argument} needs a value` });
    index++;
    if (spec.repeated?.includes(name)) repeated[name] = [...(repeated[name] ?? []), value];
    else if (Object.hasOwn(values, name)) throw new UsageError({ message: `${argument} is given twice` });
    else values[name] = value;
  }
  return { values, switches, repeated };
}

function required(found: Flags, ...names: string[]): string[] {
  const missing = names.filter((name) => found.values[name] === undefined);
  if (missing.length) throw new UsageError({ message: `${missing.map((name) => `--${name}`).join(", ")} required` });
  return names.map((name) => found.values[name] ?? "");
}

function placeholders(value: unknown): number {
  if (typeof value === "string") return PLACEHOLDER.test(value.trim()) ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((total: number, item: unknown) => total + placeholders(item), 0);
  if (typeof value === "object" && value !== null) return Object.entries(value).reduce((total, [key, item]) => total + (key === "description" ? 0 : placeholders(item)), 0);
  return 0;
}

/** Whether the target's product, with Pixel's release descriptor, has no field unset. */
const productComplete = (target: Target) =>
  (target === "Pixel10a" ? [PRODUCTS.Pixel10a, RELEASE] : [PRODUCTS.Cuttlefish]).every((relative) => placeholders(json(relative)) === 0);

const patchReference = (name: string, manifest: string, file: string) =>
  ({ name, manifestFile: place(manifest), manifestSha256: sha256File(place(manifest)), patchFile: place(file) });

/** The stage a command line asks for, read before any APK, descriptor or source. */
export function stageRequest(argv: readonly string[]) {
  const found = flags(argv, {
    valued: ["target", "apk", "aosp-source", "output", "descriptor", "factory-image", "listener-apk", "listener-descriptor", "listener-qualification", "listener-voice-host", "listener-voice-host-sha256", "listener-models", "listener-models-sha256", "aapt", "apksigner"],
    switches: ["development", "owner-telephony"],
    repeated: ["patch"],
  });
  const [targetName = "", apk = "", source = "", output = ""] = required(found, "target", "apk", "aosp-source", "output");
  if (targetName !== "cuttlefish" && targetName !== "pixel10a") throw new UsageError({ message: "--target must be cuttlefish or pixel10a" });
  const target: Target = targetName === "pixel10a" ? "Pixel10a" : "Cuttlefish";
  if (found.values["factory-image"] !== undefined && target !== "Pixel10a") throw new UsageError({ message: "--factory-image belongs to --target pixel10a" });
  if (target === "Pixel10a" && found.values["factory-image"] === undefined) throw new UsageError({ message: "--target pixel10a needs --factory-image" });
  if (found.values["listener-descriptor"] !== undefined && found.values["listener-apk"] === undefined) throw new UsageError({ message: "--listener-descriptor needs --listener-apk" });
  if (found.values["listener-qualification"] !== undefined && found.values["listener-apk"] === undefined) throw new UsageError({ message: "--listener-qualification needs --listener-apk" });
  if (found.values["listener-apk"] !== undefined && found.values["listener-descriptor"] === undefined && found.values["listener-qualification"] === undefined) {
    throw new UsageError({ message: "--listener-apk needs --listener-descriptor" });
  }
  const voiceHost = found.values["listener-voice-host"];
  const voiceHostHash = found.values["listener-voice-host-sha256"];
  const models = found.values["listener-models"];
  const modelsHash = found.values["listener-models-sha256"];
  const speech = voiceHost !== undefined && voiceHostHash !== undefined && models !== undefined && modelsHash !== undefined
    && /^[0-9a-f]{64}$/.test(voiceHostHash) && /^[0-9a-f]{64}$/.test(modelsHash)
    ? { voiceHost: { file: voiceHost, sha256: voiceHostHash }, models: { file: models, sha256: modelsHash } }
    : undefined;
  if ([voiceHost, voiceHostHash, models, modelsHash].some((input) => input !== undefined)
    && (speech === undefined || found.values["listener-apk"] === undefined))
    throw new UsageError({ message: "Listener speech needs its APK, both reviewed files, and their SHA-256 digests" });
  const named = found.repeated.patch ?? [];
  const unknown = named.filter((name) => !Object.hasOwn(PATCHES, name));
  if (unknown.length) throw new UsageError({ message: `--patch takes ${Object.keys(PATCHES).join(", ")}, not ${unknown.join(", ")}` });
  if (new Set(named).size !== named.length) throw new UsageError({ message: "a --patch is given twice" });
  const stage: Stage = {
    target,
    mode: found.switches.has("development") ? "Development" : "Production",
    descriptorReviewed: found.values.descriptor !== undefined,
    productComplete: productComplete(target),
    ownerTelephony: found.switches.has("owner-telephony"),
    listener: found.values["listener-apk"] !== undefined && found.values["listener-descriptor"] !== undefined,
    qualified: found.values["listener-qualification"] !== undefined,
    speechPinned: speech !== undefined,
    patches: named.flatMap((name) => PATCHES[name]?.patch ?? []),
    branding: false,
  };
  const problems = stageProblems(stage);
  if (problems.length) throw new StageRefused({ problems, message: `Refusing the ${stage.target} ${stage.mode} stage: ${problems.join(", ")}` });
  return { found, stage, apk, source, output, speech };
}

interface Launcher { readonly moduleName: string; readonly packageName: string }

/** The descriptor a stage installs: the reviewed one, or one described from a development APK, held to Alpha's first-boot grants and privileges. */
const launcherDescriptor = (found: Flags, stage: Stage, apk: string, apksigner: string) => Effect.gen(function* () {
  const { launcher } = (yield* attempt(() => json(PRODUCTS[stage.target]))) as { readonly launcher: Launcher };
  const supplied = found.values.descriptor;
  const descriptor = supplied === undefined
    ? { ...(yield* createDevelopmentLauncherDescriptor({ identity: { brand: "alpha", ...launcher }, apk, apksigner, development: true })),
        defaultPermissions: firstBootGrants, privilegedPermissions: alphaPrivileged }
    : yield* validateDescriptor(yield* attempt((): unknown => JSON.parse(readFileSync(supplied, "utf8"))));
  const problems: string[] = [];
  if (descriptor.packageName !== launcher.packageName || descriptor.moduleName !== launcher.moduleName) problems.push(`the descriptor is not Alpha's launcher ${launcher.packageName} (${launcher.moduleName})`);
  if (!grantsAdmitted([...(descriptor.defaultPermissions ?? [])])) problems.push(`its first-boot grants must be exactly ${JSON.stringify(firstBootGrants)}`);
  if (!privilegedAdmitted([...(descriptor.privilegedPermissions ?? [])])) problems.push(`its privileged permissions must be exactly ${JSON.stringify(alphaPrivileged)} or none`);
  if (problems.length) return yield* new StageRefused({ problems, message: `Refusing the launcher descriptor: ${problems.join("; ")}` });
  return { descriptor, launcher };
});

const stage = (argv: readonly string[]) => Effect.gen(function* () {
  const { found, stage, apk, source, output, speech } = yield* attempt(() => stageRequest(argv));
  const aapt = found.values.aapt ?? "aapt";
  const apksigner = found.values.apksigner ?? "apksigner";
  const { descriptor, launcher } = yield* launcherDescriptor(found, stage, apk, apksigner);
  const production = stage.mode === "Production" || listenerImage(stage);
  const lockFile = place(stage.target === "Pixel10a" ? STOCK_SOURCE_LOCK : SHARED_SOURCE_LOCK);
  const profile = { name: stage.target === "Pixel10a" ? "pixel10a" : "cuttlefish", file: lockFile, sha256: yield* attempt(() => sha256File(lockFile)) };
  const patches = yield* attempt(() => [patchReference("soong-app-native", SOONG_APP_NATIVE.manifest, SOONG_APP_NATIVE.file),
    ...(found.repeated.patch ?? []).flatMap((name) => { const known = PATCHES[name]; return known === undefined ? [] : [patchReference(known.patch === "ProtectedPower" ? "power" : name, known.manifest, known.file)]; })]);
  const factory = found.values["factory-image"];
  const sourceOptions = { profile, sourceRoot: source, ...(factory === undefined ? {} : { factory }), patches };
  yield* (stage.target === "Pixel10a" ? verifyDeviceSource(sourceOptions) : verifySource(sourceOptions));
  const provisioning = {
    assistant: listenerImage(stage) ? { tag: "ListenerAssistant" as const, power: true } : { tag: "NoAssistant" as const },
    requires: { autofill: true, allFilesAccess: true },
    telephonyRoles: true,
    lockScreen: "SystemOwnsLockScreen" as const,
  };
  if (!imageTelephony(stage)) yield* provisioningComponents(yield* aaptManifestTree(apk, { aapt }), launcher.packageName, {
    assistant: { tag: "NoAssistant" },
    requires: { autofill: false, allFilesAccess: false },
    telephonyRoles: false,
    lockScreen: provisioning.lockScreen,
  });
  const scratch = yield* attempt(() => mkdtempSync(join(tmpdir(), "alpha-aosp-")));
  return yield* Effect.ensuring(Effect.gen(function* () {
    const descriptorFile = join(scratch, "launcher.json");
    yield* attempt(() => writeFileSync(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
    const staged = yield* stageLauncher({
      descriptor: descriptorFile, apk, output, aapt, apksigner, development: !production,
      nativeAbi: NATIVE_ABI[stage.target], nativeInstall: "soong", deferSoong: true,
      ...(provisionsHome(stage) ? { provisioning } : {}),
    });
    const tree = yield* aaptManifestTree(join(output, "Launcher.apk"), { aapt });
    yield* writeImageCapability(output, launcher.packageName);
    yield* requireClockProduct(output);
    yield* writeSecureCameraOverlay(output, (yield* verifySecureCameraSource(source)).source);
    if (imageTelephony(stage)) {
      if (!provisionsHome(stage)) yield* writeRoleOverrides(output, launcher.packageName, (yield* provisioningComponents(tree, launcher.packageName, provisioning)).overrides);
      const hostValues = yield* attempt(() => readFileSync(place(CAPABILITY_VALUES), "utf8"));
      yield* writeImageProvisioningOverlay(output, launcher.packageName, { mode: production ? "StageProduction" : "StageDevelopment", hostValues, ...IMAGE_PROVISIONING });
    }
    const listenerApk = found.values["listener-apk"];
    const listenerDescriptor = found.values["listener-descriptor"];
    const qualification = found.values["listener-qualification"];
    if (stage.listener && listenerApk !== undefined && listenerDescriptor !== undefined) yield* stageListener({
      output, launcher: { apk: join(output, "Launcher.apk"), descriptor: descriptorFile }, apk: listenerApk,
      descriptor: listenerDescriptor,
      ...(speech === undefined ? {} : { speech }),
      ...SENSE, policyCertificate: place(LISTENER_CERTIFICATE), sdkCommit: ((yield* attempt(() => json("../../eliza.lock.json"))) as { readonly commit: string }).commit,
      source: sourceOptions, production, aapt, apksigner,
      ...(qualification === undefined ? {} : { activation: provisioning, qualification: { file: qualification, sha256: yield* attempt(() => sha256File(qualification)) } }),
    });
    const product = yield* composeProduct({ output, descriptor: place(PRODUCTS[stage.target]), source: sourceOptions, purpose: production ? "Production" : "Development", provisioning });
    return { staged: staged.evidence, product, imageTelephony: imageTelephony(stage), claims: "staging only: not an image build, a boot, an update or acceptance" };
  }), Effect.sync(() => rmSync(scratch, { recursive: true, force: true })));
});

/** The operator's arguments, with Alpha's channel and the stallion stock source lock where the command reads one and none was given. */
export function otaArguments(argv: readonly string[]): string[] {
  const command = OTA_COMMANDS[argv[0] ?? ""];
  const args = [...argv];
  if (command === undefined) return args;
  if (readsChannel(command) && !args.includes("--channel")) args.push("--channel", place(CHANNEL));
  if (readsSourceLock(command) && !args.includes("--source-lock")) args.push("--source-lock", place(STOCK_SOURCE_LOCK));
  return args;
}

const ota = (argv: readonly string[]) => Effect.gen(function* () {
  if (argv.includes("--channel") || argv.includes("--source-lock")) {
    return yield* new UsageError({ message: "--channel and --source-lock are pinned by Alpha and cannot be overridden" });
  }
  const channel = (yield* attempt(() => json(CHANNEL))) as { readonly channel: string; readonly product: string; readonly device: string; readonly downgradeAllowed: boolean };
  if (!channelIsAlphas({ name: channel.channel, product: channel.product, device: channel.device, downgradeAllowed: channel.downgradeAllowed }))
    return yield* new UsageError({ message: `${CHANNEL} is not Alpha's channel ${JSON.stringify(alphaChannel)}` });
  return yield* otaMain(otaArguments(argv));
});

const verify = (argv: readonly string[]) => Effect.gen(function* () {
  const found = yield* attempt(() => flags(argv, { valued: ["target", "serial", "user", "expected", "adb", "out"] }));
  const [target = "", serial = "", user = "", expectedFile = ""] = yield* attempt(() => required(found, "target", "serial", "user", "expected"));
  if (target !== "pixel10a" && target !== "cuttlefish") return yield* new UsageError({ message: "--target must be pixel10a or cuttlefish" });
  const expected = yield* attempt((): unknown => JSON.parse(readFileSync(expectedFile, "utf8")));
  const report = yield* verifyImage({ target, serial, user, expected, ...(found.values.adb === undefined ? {} : { adb: found.values.adb }) });
  const out = found.values.out;
  if (out !== undefined) yield* attempt(() => writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 }));
  return report;
});

function requestOf(argv: readonly string[], switches: readonly string[], reserved: readonly string[]) {
  const found = flags(argv, { valued: ["request"], switches });
  const [file = ""] = required(found, "request");
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UsageError({ message: `${file} must hold a JSON object` });
  }
  const request = parsed as Readonly<Record<string, unknown>>;
  const overridden = reserved.filter((key) => Object.hasOwn(request, key));
  if (overridden.length > 0) {
    throw new UsageError({ message: `${file} must not set Alpha-pinned field(s): ${overridden.join(", ")}` });
  }
  return { request, switches: found.switches };
}

const sign = (argv: readonly string[]) => Effect.gen(function* () {
  const signer = yield* attempt(() => json(RELEASE_SIGNER));
  if (!signerRecordAdmitted({ rotation: typeof signer === "object" && signer !== null && Object.hasOwn(signer, "apkSigningRotation") }))
    return yield* new UsageError({ message: `${RELEASE_SIGNER} still has apkSigningRotation; Alpha signs with one key. Delete the apkSigningRotation object.` });
  const alpha = { descriptor: place(RELEASE), product: place(PRODUCTS.Pixel10a), channel: place(CHANNEL), keyManifest: place(KEY_MANIFEST) };
  const { request, switches } = yield* attempt(() => requestOf(argv, ["dry-run"], Object.keys(alpha)));
  return yield* signRelease(yield* signReleaseRequest({ ...request, ...alpha }, switches.has("dry-run")));
});

const record = (argv: readonly string[]) => Effect.gen(function* () {
  const { request } = yield* attempt(() => requestOf(argv, [], ["channel"]));
  return yield* writeReleaseRecord({ ...request, channel: place(CHANNEL) });
});

const keys = (argv: readonly string[]) => Effect.gen(function* () {
  const [command, ...rest] = argv;
  switch (command) {
    case "generate": {
      const options = yield* Effect.mapError(parseArgs(rest.includes("--manifest") ? rest : [...rest, "--manifest", place(KEY_MANIFEST)]), (failure) => new UsageError({ message: failure.reason }));
      return yield* generate(options);
    }
    case "decrypt": {
      const found = yield* attempt(() => flags(rest, { valued: ["input", "output", "passphrase-file", "only"] }));
      const [input = "", output = "", passphraseFile = ""] = yield* attempt(() => required(found, "input", "output", "passphrase-file"));
      return yield* decrypt({ input, output, passphraseFile, ...(found.values.only === undefined ? {} : { only: found.values.only }) });
    }
    default:
      return yield* new UsageError({ message: `keys takes generate or decrypt, not ${command ?? "nothing"}` });
  }
});

const enroll = (argv: readonly string[]) => Effect.gen(function* () {
  const found = yield* attempt(() => flags(argv, { valued: ["checkout", "certificate", "product-makefile-sha256", "receipt"], switches: ["execute"] }));
  const [checkout = "", certificate = "", productMakefileSha256 = "", receipt = ""] = yield* attempt(() => required(found, "checkout", "certificate", "product-makefile-sha256", "receipt"));
  const profile = yield* attempt(() => enrolledProfile());
  if (!Os.isPinned(profile)) {
    return yield* new UsageError({ message: `${ENROLLMENT} does not match the OS spec's pinned profile` });
  }
  const pilot = (yield* attempt(() => json(ENROLLMENT))) as { readonly manifestUrl: string; readonly hosts: readonly string[]; readonly product: string; readonly device: string; readonly otaCertificateSha256: string };
  const channel = { manifestUrl: pilot.manifestUrl, hosts: pilot.hosts, product: pilot.product, device: pilot.device, otaCertificateSha256: pilot.otaCertificateSha256 };
  return yield* enrollUpdater({ checkout, descriptor: place(PRODUCTS.Pixel10a), channel, certificate, productMakefileSha256, receipt, execute: found.switches.has("execute") });
});

const GATES: Readonly<Record<string, Os.Gate>> = {
  "signed-image": "SignedImage", "channel": "ChannelGate", "trust": "Trust", "selinux": "Selinux", "engine": "Engine",
  "physical-recovery": "PhysicalRecovery", "cache-retention": "CacheRetention", "candidate-recovery": "CandidateRecovery",
};
const DRILLS: Readonly<Record<string, Os.Drill>> = {
  "signed-update": "SignedUpdate", "interrupted-update": "InterruptedUpdate", "compatible-rollback": "CompatibleRollback", "stock-recovery": "StockRecovery",
};

/** The profile the image's enrolment stages: the pilot enrolment's manifest, hosts, product, device and certificate, with the channel's verified-boot key. */
function enrolledProfile(): Os.Profile {
  const pilot = json(ENROLLMENT) as { readonly manifestUrl: string; readonly hosts: readonly string[]; readonly product: string; readonly device: string; readonly otaCertificateSha256: string; readonly rotatePlatformOrAVBKeys: boolean; readonly wipeData: boolean };
  const channel = json(CHANNEL) as { readonly avbPublicKeySha256: string; readonly downgradeAllowed: boolean };
  return {
    manifest: pilot.manifestUrl, hosts: pilot.hosts.join(" "), product: pilot.product, device: pilot.device,
    certificate: pilot.otaCertificateSha256, avb: channel.avbPublicKeySha256, rotate: pilot.rotatePlatformOrAVBKeys, wipe: pilot.wipeData, downgrade: channel.downgradeAllowed,
  };
}

function parseBuildDate(raw: unknown, file: string): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageError({ message: `Invalid build.dateUtc in ${file}: expected a positive integer epoch timestamp` });
  }
  return value;
}

function parseOtaWipe(raw: unknown): boolean {
  if (raw === undefined || raw === "") return false;
  if (typeof raw !== "string") return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "no" || normalized === "false" || normalized === "0") return false;
  return true;
}

/** A signed release record as the OS spec reads it, or the stock image. */
function imageRecord(file: string): Os.ImageRecord {
  if (file === "stock") return Os.stock;
  const record = JSON.parse(readFileSync(file, "utf8")) as {
    readonly build: { readonly dateUtc: string | number }; readonly product: string; readonly device: string;
    readonly certificates: { readonly releasekey: string }; readonly verifiedBoot: { readonly publicKeySha256: string };
    readonly payload?: { readonly metadata?: Readonly<Record<string, string>> };
  };
  return {
    build: parseBuildDate(record.build.dateUtc, file), product: record.product, device: record.device, certificate: record.certificates.releasekey,
    avb: record.verifiedBoot.publicKeySha256, wipe: parseOtaWipe(record.payload?.metadata?.["ota-wipe"]),
  };
}

/** The OS event a command line names, read before the ledger is opened. */
function osEvent(argv: readonly string[]): Os.Event {
  const [name = "", ...rest] = argv;
  switch (name) {
    case "stage": return { type: "stage", profile: enrolledProfile() };
    case "enable": case "interrupt": case "resume": case "finish": return { type: name };
    case "start": return { type: "startApply" };
    case "retain-known-good": return { type: "retainKnownGood" };
    case "pass": {
      const gate = GATES[required(flags(rest, { valued: ["gate"] }), "gate")[0] ?? ""];
      if (gate === undefined) throw new UsageError({ message: `--gate takes ${Object.keys(GATES).join(", ")}` });
      return { type: "pass", gate };
    }
    case "check": {
      const [from = "", to = ""] = required(flags(rest, { valued: ["from", "to"] }), "from", "to");
      return { type: "check", base: imageRecord(from), goal: imageRecord(to) };
    }
    case "fallback": {
      const found = flags(rest, { valued: ["to", "image"] });
      const [to = ""] = required(found, "to");
      if (to !== "stock" && to !== "known-good") throw new UsageError({ message: "--to takes stock or known-good" });
      const image = found.values.image;
      if ((to === "stock") !== (image !== undefined)) throw new UsageError({ message: "--image names the stock factory image, and only for --to stock" });
      return { type: "fallback", toStock: to === "stock", image: image === undefined ? "" : sha256File(image) };
    }
    case "drill": {
      const found = flags(rest, { valued: ["drill"], switches: ["passed", "failed"] });
      const drill = DRILLS[required(found, "drill")[0] ?? ""];
      if (drill === undefined) throw new UsageError({ message: `--drill takes ${Object.keys(DRILLS).join(", ")}` });
      if (found.switches.has("passed") === found.switches.has("failed")) throw new UsageError({ message: "say --passed or --failed" });
      return { type: "recordDrill", drill, passed: found.switches.has("passed") };
    }
    default: throw new UsageError({ message: `os takes stage, pass, enable, check, start, interrupt, resume, finish, retain-known-good, fallback or drill, not ${name || "nothing"}` });
  }
}

/** The release owner's record of the image's updater, its gates, the updates applied by hand and the drills, each step held to the OS spec. */
const os = (argv: readonly string[]) => Effect.gen(function* () {
  const [flag, file, ...rest] = argv;
  if (flag !== "--ledger" || file === undefined) return yield* new UsageError({ message: "os needs --ledger FILE first" });
  const event = yield* attempt(() => osEvent(rest));
  return yield* attempt(() => ledger<Os.Os, Os.Event>(Os, file).take(event));
});

/** One app descriptor in `apps/app/android/suite/apps.json`. */
export interface SuiteAppEntry {
  readonly id: string;
  readonly view: string | null;
  readonly surface: "overlay" | "app";
  readonly applicationId: string;
  readonly label: string;
  readonly defaultRoles: readonly string[];
  readonly permissions: readonly string[];
  readonly allowedAgentRoutePrefixes: readonly string[];
  readonly allowedCloudRoutePrefixes: readonly string[];
  readonly allowedSecureStoreSlots: readonly string[];
  readonly assetsProfile: "core" | "thin" | "ocr";
  readonly imageOnly: boolean;
  readonly taskAffinity: string;
}

/** Parsed schema v1 multi-APK suite registry. */
export interface SuiteRegistry {
  readonly schemaVersion: 1;
  readonly corePackage: string;
  readonly ipcPermission: string;
  readonly apps: readonly SuiteAppEntry[];
}

/** Selection of optional AOSP platform modules wired into a suite stage. */
export interface SuiteModuleSelection {
  readonly launcher3: boolean;
  readonly controlBridge: boolean;
  readonly sandboxedPlay: boolean;
}

interface SuiteModuleStatus {
  readonly enabled: boolean;
  readonly present: boolean;
  readonly makefile: string | null;
  readonly makefileSha256: string | null;
  readonly blueprint: string | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const walkFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
};

/** Parses and validates `apps/app/android/suite/apps.json` into a typed registry. */
export function parseSuiteRegistry(raw: unknown): { readonly registry?: SuiteRegistry; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (!isRecord(raw)) return { problems: ["suite registry must be a JSON object"] };
  if (raw.schemaVersion !== 1) problems.push("suite registry schemaVersion must be 1");
  const corePackage = typeof raw.corePackage === "string" ? raw.corePackage : "";
  const ipcPermission = typeof raw.ipcPermission === "string" ? raw.ipcPermission : "";
  if (corePackage !== "ai.alphacompute.alphaphone") problems.push(`corePackage must be ai.alphacompute.alphaphone, got ${JSON.stringify(raw.corePackage)}`);
  if (ipcPermission !== "ai.alphacompute.permission.AGENT_IPC") problems.push(`ipcPermission must be ai.alphacompute.permission.AGENT_IPC, got ${JSON.stringify(raw.ipcPermission)}`);
  if (!Array.isArray(raw.apps) || raw.apps.length === 0) {
    problems.push("suite registry apps must be a non-empty array");
    return { problems };
  }
  const seenIds = new Set<string>();
  const seenPackages = new Set<string>();
  const parsedApps: SuiteAppEntry[] = [];
  for (const [index, candidate] of raw.apps.entries()) {
    if (!isRecord(candidate)) {
      problems.push(`apps[${index}] must be an object`);
      continue;
    }
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const label = typeof candidate.label === "string" ? candidate.label : "";
    const applicationId = typeof candidate.applicationId === "string" ? candidate.applicationId : "";
    const taskAffinity = typeof candidate.taskAffinity === "string" ? candidate.taskAffinity : "";
    const surface = candidate.surface === "overlay" || candidate.surface === "app" ? candidate.surface : undefined;
    const assetsProfile = candidate.assetsProfile === "core" || candidate.assetsProfile === "thin" || candidate.assetsProfile === "ocr" ? candidate.assetsProfile : undefined;
    const view = candidate.view === null || typeof candidate.view === "string" ? candidate.view : undefined;
    const imageOnly = typeof candidate.imageOnly === "boolean" ? candidate.imageOnly : undefined;
    if (!/^[a-z][a-z0-9-]*$/.test(id)) problems.push(`apps[${index}].id is invalid: ${JSON.stringify(candidate.id)}`);
    else if (seenIds.has(id)) problems.push(`duplicate suite app id: ${id}`);
    else seenIds.add(id);
    if (!ANDROID_PACKAGE_ID.test(applicationId)) problems.push(`apps[${index}].applicationId is invalid: ${JSON.stringify(candidate.applicationId)}`);
    else if (seenPackages.has(applicationId)) problems.push(`duplicate applicationId: ${applicationId}`);
    else seenPackages.add(applicationId);
    if (label.trim() === "") problems.push(`apps[${index}].label must be non-empty`);
    if (surface === undefined) problems.push(`apps[${index}].surface must be overlay or app`);
    if (assetsProfile === undefined) problems.push(`apps[${index}].assetsProfile must be core, thin, or ocr`);
    if (view === undefined) problems.push(`apps[${index}].view must be a string or null`);
    else if (surface === "overlay" && view !== null) problems.push(`apps[${index}] overlay surface must have view: null`);
    else if (surface === "app" && (view === null || view.trim() === "")) problems.push(`apps[${index}] app surface must name a view`);
    if (imageOnly === undefined) problems.push(`apps[${index}].imageOnly must be boolean`);
    if (taskAffinity.trim() === "") problems.push(`apps[${index}].taskAffinity must be non-empty`);
    if (!isStringArray(candidate.defaultRoles)) problems.push(`apps[${index}].defaultRoles must be a string array`);
    if (!isStringArray(candidate.permissions)) problems.push(`apps[${index}].permissions must be a string array`);
    if (!isStringArray(candidate.allowedAgentRoutePrefixes)) problems.push(`apps[${index}].allowedAgentRoutePrefixes must be a string array`);
    if (!isStringArray(candidate.allowedCloudRoutePrefixes)) problems.push(`apps[${index}].allowedCloudRoutePrefixes must be a string array`);
    if (!isStringArray(candidate.allowedSecureStoreSlots)) problems.push(`apps[${index}].allowedSecureStoreSlots must be a string array`);
    if (surface !== undefined && assetsProfile !== undefined && view !== undefined && imageOnly !== undefined
      && isStringArray(candidate.defaultRoles) && isStringArray(candidate.permissions)
      && isStringArray(candidate.allowedAgentRoutePrefixes) && isStringArray(candidate.allowedCloudRoutePrefixes)
      && isStringArray(candidate.allowedSecureStoreSlots)) {
      parsedApps.push({
        id, view, surface, applicationId, label,
        defaultRoles: candidate.defaultRoles, permissions: candidate.permissions,
        allowedAgentRoutePrefixes: candidate.allowedAgentRoutePrefixes,
        allowedCloudRoutePrefixes: candidate.allowedCloudRoutePrefixes,
        allowedSecureStoreSlots: candidate.allowedSecureStoreSlots,
        assetsProfile, imageOnly, taskAffinity,
      });
    }
  }
  const coreEntry = parsedApps.find((entry) => entry.id === "core");
  if (coreEntry === undefined) problems.push("suite registry must include a core entry");
  else if (coreEntry.applicationId !== corePackage) problems.push(`core entry applicationId ${coreEntry.applicationId} does not match corePackage ${corePackage}`);
  if (problems.length > 0) return { problems };
  return { registry: { schemaVersion: 1, corePackage, ipcPermission, apps: parsedApps }, problems };
}

function signerBytesInSource(source: string, expectedHex: string): boolean {
  const bytes = [...source.matchAll(/\(byte\)\s*0x([0-9a-fA-F]{2})/g)].map((match) => (match[1] ?? "").toLowerCase());
  return bytes.length === 32 && bytes.join("") === expectedHex.toLowerCase();
}

function checkModuleFiles(
  label: string,
  requiredFiles: readonly string[],
  enabled: boolean,
): { readonly present: boolean; readonly problems: string[] } {
  const missing = requiredFiles.filter((relative) => !existsSync(place(relative)));
  return {
    present: missing.length === 0,
    problems: enabled ? missing.map((relative) => `${label} missing ${relative}`) : [],
  };
}

function validateControlBridgeModule(enabled: boolean, signerHex: string): { readonly status: SuiteModuleStatus; readonly problems: readonly string[] } {
  const makefile = `${SUITE_CONTROL_BRIDGE_DIR}/control-bridge.mk`;
  const blueprint = `${SUITE_CONTROL_BRIDGE_DIR}/Android.bp`;
  const requiredFiles = [
    blueprint,
    makefile,
    `${SUITE_CONTROL_BRIDGE_DIR}/AndroidManifest.xml`,
    `${SUITE_CONTROL_BRIDGE_DIR}/privapp-permissions-alpha-control.xml`,
    `${SUITE_CONTROL_BRIDGE_DIR}/aidl/ai/alphacompute/control/IAlphaControlBridge.aidl`,
    `${SUITE_CONTROL_BRIDGE_DIR}/src/ai/alphacompute/control/AlphaControlBridgeService.java`,
    `${SUITE_CONTROL_BRIDGE_DIR}/sepolicy/alpha_control_bridge.te`,
    `${SUITE_CONTROL_BRIDGE_DIR}/sepolicy/seapp_contexts`,
  ];
  const { present, problems } = checkModuleFiles("control-bridge", requiredFiles, enabled);
  if (enabled && present) {
    const manifest = readFileSync(place(`${SUITE_CONTROL_BRIDGE_DIR}/AndroidManifest.xml`), "utf8");
    if (manifest.includes("android.permission.INTERNET")) problems.push("control-bridge manifest must not request INTERNET");
    const sepolicy = readFileSync(place(`${SUITE_CONTROL_BRIDGE_DIR}/sepolicy/alpha_control_bridge.te`), "utf8");
    if (!sepolicy.includes("neverallow alpha_control_bridge") || sepolicy.includes("net_domain(")) {
      problems.push("control-bridge sepolicy must deny network sockets via neverallow");
    }
    const service = readFileSync(place(`${SUITE_CONTROL_BRIDGE_DIR}/src/ai/alphacompute/control/AlphaControlBridgeService.java`), "utf8");
    if (!service.includes("CAPTURE_SECURE_LAYERS = false")) problems.push("control-bridge must hardcode CAPTURE_SECURE_LAYERS = false");
    if (!signerBytesInSource(service, signerHex)) problems.push("control-bridge ALPHA_SIGNER_SHA256 does not match release-signer.json");
  }
  return {
    status: {
      enabled,
      present,
      makefile: present ? makefile : null,
      makefileSha256: present ? sha256File(place(makefile)) : null,
      blueprint: present ? blueprint : null,
    },
    problems,
  };
}

function validateSandboxedPlayModule(enabled: boolean): { readonly status: SuiteModuleStatus; readonly problems: readonly string[] } {
  const makefile = `${SUITE_SANDBOXED_PLAY_DIR}/sandboxed-play.mk`;
  const blueprint = `${SUITE_SANDBOXED_PLAY_DIR}/Android.bp`;
  const pinFile = `${SUITE_SANDBOXED_PLAY_DIR}/gmscompat-pin.json`;
  const requiredFiles = [
    blueprint,
    makefile,
    `${SUITE_SANDBOXED_PLAY_DIR}/privapp-permissions-alpha-play.xml`,
    pinFile,
    `${SUITE_SANDBOXED_PLAY_DIR}/manifests/AlphaWebViewConfigOverlay.xml`,
    `${SUITE_SANDBOXED_PLAY_DIR}/overlay/frameworks/base/core/res/res/xml/config_webview_packages.xml`,
    `${SUITE_SANDBOXED_PLAY_DIR}/installer/AndroidManifest.xml`,
    `${SUITE_SANDBOXED_PLAY_DIR}/installer/src/ai/alphacompute/playinstaller/PlayPackageVerifier.java`,
    `${SUITE_SANDBOXED_PLAY_DIR}/installer/src/ai/alphacompute/playinstaller/AlphaPlayInstallerService.java`,
  ];
  const { present, problems } = checkModuleFiles("sandboxed-play", requiredFiles, enabled);
  if (enabled) {
    for (const file of walkFiles(place(SUITE_SANDBOXED_PLAY_DIR))) {
      const lower = file.toLowerCase();
      if ([...FORBIDDEN_BINARY_EXTENSIONS].some((suffix) => lower.endsWith(suffix))) {
        problems.push(`sandboxed-play must not contain binary artifact ${file}`);
      }
    }
    if (present) {
      const privapp = readFileSync(place(`${SUITE_SANDBOXED_PLAY_DIR}/privapp-permissions-alpha-play.xml`), "utf8");
      if (privapp.includes("com.google.android") || privapp.includes("com.android.vending")) {
        problems.push("sandboxed-play privapp-permissions must never grant privileges to Google packages");
      }
      const pinRaw = json(pinFile);
      if (placeholders(pinRaw) > 0) problems.push("gmscompat-pin.json contains placeholder values");
      if (!isRecord(pinRaw) || pinRaw.schemaVersion !== 1 || pinRaw.failClosed !== true || pinRaw.proprietaryBinariesInRepo !== false) {
        problems.push("gmscompat-pin.json must declare schemaVersion 1, failClosed true, proprietaryBinariesInRepo false");
      } else if (!isRecord(pinRaw.repositories)) {
        problems.push("gmscompat-pin.json must declare repositories");
      } else {
        for (const key of ["GmsCompat", "GmsCompatConfig", "frameworksBaseGmsCompat"]) {
          const entry = pinRaw.repositories[key];
          if (!isRecord(entry) || typeof entry.commit !== "string" || !HEX_40.test(entry.commit) || !Array.isArray(entry.verifiedFiles) || entry.verifiedFiles.length === 0) {
            problems.push(`gmscompat-pin.json repository ${key} must pin a 40-char commit and verifiedFiles`);
            continue;
          }
          for (const verified of entry.verifiedFiles) {
            if (!isRecord(verified) || typeof verified.sha256 !== "string" || !HEX_64.test(verified.sha256)) {
              problems.push(`gmscompat-pin.json repository ${key} has invalid verifiedFiles sha256`);
            }
          }
        }
      }
    }
  }
  return {
    status: {
      enabled,
      present,
      makefile: present ? makefile : null,
      makefileSha256: present ? sha256File(place(makefile)) : null,
      blueprint: present ? blueprint : null,
    },
    problems,
  };
}

function validateLauncher3Module(enabled: boolean): { readonly status: SuiteModuleStatus; readonly problems: readonly string[] } {
  const blueprint = `${SUITE_LAUNCHER3_DIR}/Android.bp`;
  const makefile = `${SUITE_LAUNCHER3_DIR}/launcher3.mk`;
  const hasBlueprint = existsSync(place(blueprint));
  const hasMakefile = existsSync(place(makefile));
  const problems: string[] = [];
  if (enabled && !hasBlueprint) problems.push(`launcher3 missing ${blueprint}`);
  return {
    status: {
      enabled,
      present: hasBlueprint,
      makefile: hasMakefile ? makefile : null,
      makefileSha256: hasMakefile ? sha256File(place(makefile)) : null,
      blueprint: hasBlueprint ? blueprint : null,
    },
    problems,
  };
}

function suiteModuleSelection(switches: ReadonlySet<string>): SuiteModuleSelection {
  const explicit = switches.has("with-launcher3") || switches.has("with-control-bridge") || switches.has("with-sandboxed-play");
  if (explicit) {
    return {
      launcher3: switches.has("with-launcher3"),
      controlBridge: switches.has("with-control-bridge"),
      sandboxedPlay: switches.has("with-sandboxed-play"),
    };
  }
  return {
    launcher3: existsSync(place(`${SUITE_LAUNCHER3_DIR}/Android.bp`)),
    controlBridge: true,
    sandboxedPlay: true,
  };
}

function suiteModuleName(entry: SuiteAppEntry): string {
  if (entry.id === "core") return "AlphaPhone";
  const camel = entry.id
    .split("-")
    .map((part) => (part.length > 0 ? `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}` : ""))
    .join("");
  return `Alpha${camel}App`;
}

function suiteAppIsPrivileged(entry: SuiteAppEntry): boolean {
  return entry.id === "core" || entry.permissions.some((permission) => PRIVILEGED_SUITE_PERMISSIONS.has(permission));
}

function renderSuiteMakefile(
  target: Target,
  apps: readonly SuiteAppEntry[],
  modules: { readonly launcher3: SuiteModuleStatus; readonly controlBridge: SuiteModuleStatus; readonly sandboxedPlay: SuiteModuleStatus },
): string {
  const packages = [
    ...apps.map((entry) => suiteModuleName(entry)),
    ALPHA_NEXT_ROLES_OVERLAY_MODULE,
  ];
  const lines: string[] = [
    `# Alpha NEXT multi-APK suite product configuration (${target}).`,
    "alpha_suite_dir := $(patsubst %/,%,$(dir $(lastword $(MAKEFILE_LIST))))",
    "PRODUCT_PACKAGES += \\",
    ...packages.map((name, index) => `    ${name}${index + 1 < packages.length ? " \\" : ""}`),
  ];
  if (existsSync(place(SUITE_BRANDING_MAKEFILE))) {
    lines.push("$(call inherit-product, $(alpha_suite_dir)/branding/branding.mk)");
  }
  if (modules.launcher3.enabled) {
    if (modules.launcher3.makefile !== null) {
      lines.push("$(call inherit-product, $(alpha_suite_dir)/launcher3/launcher3.mk)");
    } else {
      lines.push("PRODUCT_PACKAGES += AlphaLauncher3Overlay AlphaPartnerCustomization");
    }
  }
  if (modules.controlBridge.enabled && modules.controlBridge.makefile !== null) {
    lines.push("$(call inherit-product, $(alpha_suite_dir)/control-bridge/control-bridge.mk)");
  }
  if (modules.sandboxedPlay.enabled && modules.sandboxedPlay.makefile !== null) {
    lines.push("$(call inherit-product, $(alpha_suite_dir)/sandboxed-play/sandboxed-play.mk)");
  }
  return `${lines.join("\n")}\n`;
}

function renderSuiteBlueprint(apps: readonly SuiteAppEntry[]): string {
  const blocks = [
    'package {\n    default_applicable_licenses: ["Android-Apache-2.0"],\n}',
    ...apps.map((entry) => {
      const isCore = entry.id === "core";
      return [
        "android_app_import {",
        `    name: "${suiteModuleName(entry)}",`,
        `    apk: "apks/${entry.id}.apk",`,
        "    presigned: true,",
        "    product_specific: true,",
        ...(suiteAppIsPrivileged(entry) ? ["    privileged: true,"] : []),
        ...(isCore
          ? [
            "    preprocessed: true,",
            "    dex_preopt: {",
            "        enabled: false,",
            "    },",
            "    required: [",
            `        "${ALPHA_NEXT_ROLES_OVERLAY_MODULE}",`,
            "    ],",
          ]
          : []),
        "}",
      ].join("\n");
    }),
  ];
  return `${blocks.join("\n\n")}\n`;
}

function writeAlphaNextRolesOverlay(outputDir: string): { readonly files: readonly string[]; readonly roles: Readonly<Record<string, string>> } {
  const rolesDir = join(outputDir, "roles");
  const valuesDir = join(rolesDir, "res", "values");
  mkdirSync(valuesDir, { recursive: true });
  const bp = [
    'package {',
    '    default_applicable_licenses: ["Android-Apache-2.0"],',
    '}',
    "",
    "runtime_resource_overlay {",
    `    name: "${ALPHA_NEXT_ROLES_OVERLAY_MODULE}",`,
    '    manifest: "AndroidManifest.xml",',
    "    product_specific: true,",
    '    resource_dirs: ["res"],',
    "}",
    "",
  ].join("\n");
  const manifestXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android"',
    '    package="ai.alphacompute.alpha.overlay.roles">',
    '    <overlay',
    '        android:targetPackage="android"',
    '        android:isStatic="true"',
    '        android:priority="100" />',
    "</manifest>",
    "",
  ].join("\n");
  const configXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    `    <string name="config_defaultHomePackage" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.HOME}</string>`,
    `    <string name="config_defaultAssistant" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.ASSISTANT}</string>`,
    `    <string name="config_defaultDialer" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.DIALER}</string>`,
    `    <string name="config_defaultSms" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.SMS}</string>`,
    `    <string name="config_defaultBrowser" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.BROWSER}</string>`,
    `    <string name="config_defaultNotes" translatable="false">${ALPHA_NEXT_DEFAULT_ROLES.NOTES}</string>`,
    "</resources>",
    "",
  ].join("\n");
  const bpPath = join(rolesDir, "Android.bp");
  const manifestPath = join(rolesDir, "AndroidManifest.xml");
  const configPath = join(valuesDir, "config.xml");
  const jsonPath = join(rolesDir, "roles-overrides.json");
  writeFileSync(bpPath, bp, { flag: "wx" });
  writeFileSync(manifestPath, manifestXml, { flag: "wx" });
  writeFileSync(configPath, configXml, { flag: "wx" });
  writeFileSync(jsonPath, `${JSON.stringify({ schemaVersion: 1, roles: ALPHA_NEXT_DEFAULT_ROLES }, null, 2)}\n`, { flag: "wx" });
  return {
    files: [
      "roles/Android.bp",
      "roles/AndroidManifest.xml",
      "roles/res/values/config.xml",
      "roles/roles-overrides.json",
    ],
    roles: ALPHA_NEXT_DEFAULT_ROLES,
  };
}

function copyDirectoryTreeClean(sourceDir: string, destinationDir: string): void {
  cpSync(sourceDir, destinationDir, {
    recursive: true,
    filter: (src) => {
      const normalized = src.replaceAll("\\", "/");
      return !normalized.includes("/__pycache__") && !normalized.endsWith(".pyc") && !normalized.endsWith("/.git");
    },
  });
}

function resolveStagedApkSource(apksDir: string, appId: string): string | undefined {
  const candidates = appId === "core"
    ? ["core.apk", "launcher-debug.apk", "alpha-launcher-debug.apk", "ai.alphacompute.alphaphone.apk"]
    : [`${appId}.apk`, `${appId}-debug.apk`, `ai.alphacompute.${appId}.apk`];
  for (const name of candidates) {
    const candidate = join(apksDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function readReleaseSignerSha256(): string {
  const raw = json(RELEASE_SIGNER);
  if (!isRecord(raw) || typeof raw.signerSha256 !== "string" || !HEX_64.test(raw.signerSha256)) {
    throw new InputUnreadable({ message: `${RELEASE_SIGNER} does not contain a valid signerSha256` });
  }
  return raw.signerSha256;
}

/** Validates the multi-APK suite registry and selected AOSP platform modules. */
export function validateSuiteState(options: { readonly registryFile?: string; readonly selection: SuiteModuleSelection }) {
  const registryPath = options.registryFile ?? place(SUITE_REGISTRY);
  if (!existsSync(registryPath)) {
    throw new StageRefused({ problems: [`missing suite registry ${registryPath}`], message: `Refusing suite command: missing ${registryPath}` });
  }
  const parsed = parseSuiteRegistry(JSON.parse(readFileSync(registryPath, "utf8")) as unknown);
  const signerHex = readReleaseSignerSha256();
  const launcher3 = validateLauncher3Module(options.selection.launcher3);
  const controlBridge = validateControlBridgeModule(options.selection.controlBridge, signerHex);
  const sandboxedPlay = validateSandboxedPlayModule(options.selection.sandboxedPlay);
  const problems = [...parsed.problems, ...launcher3.problems, ...controlBridge.problems, ...sandboxedPlay.problems];
  if (problems.length > 0 || parsed.registry === undefined) {
    throw new StageRefused({ problems, message: `Refusing Alpha suite: ${problems.join("; ")}` });
  }
  return {
    registryPath,
    registrySha256: sha256File(registryPath),
    signerSha256: signerHex,
    registry: parsed.registry,
    modules: { launcher3: launcher3.status, controlBridge: controlBridge.status, sandboxedPlay: sandboxedPlay.status },
  };
}

const validateSuiteFor = (switches: ReadonlySet<string>, registryFile: string | undefined) => {
  const selection = suiteModuleSelection(switches);
  return validateSuiteState({
    ...(registryFile === undefined ? {} : { registryFile }),
    selection,
  });
};

const suite = (argv: readonly string[]) => Effect.gen(function* () {
  const [subcommand, ...rest] = argv;
  switch (subcommand) {
    case "validate": {
      const found = yield* attempt(() => flags(rest, {
        valued: ["registry"],
        switches: ["with-launcher3", "with-control-bridge", "with-sandboxed-play"],
      }));
      const checked = yield* attempt(() => validateSuiteFor(found.switches, found.values.registry));
      return {
        valid: true,
        schemaVersion: checked.registry.schemaVersion,
        registrySha256: checked.registrySha256,
        signerSha256: checked.signerSha256,
        corePackage: checked.registry.corePackage,
        ipcPermission: checked.registry.ipcPermission,
        appCount: checked.registry.apps.length,
        thinAppCount: checked.registry.apps.filter((entry) => entry.surface === "app").length,
        imageOnlyIds: checked.registry.apps.filter((entry) => entry.imageOnly).map((entry) => entry.id),
        modules: checked.modules,
      };
    }
    case "stage": {
      const found = yield* attempt(() => flags(rest, {
        valued: ["target", "output", "registry", "apks-dir"],
        switches: ["with-launcher3", "with-control-bridge", "with-sandboxed-play"],
      }));
      const [targetName = "", output = ""] = yield* attempt(() => required(found, "target", "output"));
      if (targetName !== "cuttlefish" && targetName !== "pixel10a") {
        return yield* new UsageError({ message: "--target must be cuttlefish or pixel10a" });
      }
      const target: Target = targetName === "pixel10a" ? "Pixel10a" : "Cuttlefish";
      const checked = yield* attempt(() => validateSuiteFor(found.switches, found.values.registry));
      if (existsSync(output)) {
        return yield* new UsageError({ message: `--output ${output} already exists; provide a new directory` });
      }
      const apksDir = found.values["apks-dir"];
      const resolvedApks = yield* attempt(() => {
        const missing: string[] = [];
        const rows = checked.registry.apps.map((entry) => {
          const apkFile = apksDir === undefined ? undefined : resolveStagedApkSource(apksDir, entry.id);
          if (apksDir !== undefined && apkFile === undefined) missing.push(`missing APK for ${entry.id} in ${apksDir}`);
          return {
            entry,
            apkFile,
            apkSha256: apkFile !== undefined ? sha256File(apkFile) : null,
          };
        });
        if (missing.length > 0) {
          throw new StageRefused({ problems: missing, message: `Refusing suite stage: ${missing.join("; ")}` });
        }
        return rows;
      });
      const stagedApps = resolvedApks.map(({ entry, apkSha256 }) => ({
        id: entry.id,
        moduleName: suiteModuleName(entry),
        applicationId: entry.applicationId,
        surface: entry.surface,
        privileged: suiteAppIsPrivileged(entry),
        preprocessedNative: entry.id === "core",
        imageOnly: entry.imageOnly,
        defaultRoles: entry.defaultRoles,
        apkSha256,
      }));
      const makefileContent = renderSuiteMakefile(target, checked.registry.apps, checked.modules);
      const blueprintContent = renderSuiteBlueprint(checked.registry.apps);
      const stagedDirs: string[] = [];
      const rolesOverlay = yield* attempt(() => {
        mkdirSync(output, { recursive: true });
        if (existsSync(place(SUITE_BRANDING_DIR))) {
          copyDirectoryTreeClean(place(SUITE_BRANDING_DIR), join(output, "branding"));
          stagedDirs.push("branding");
        }
        if (checked.modules.launcher3.enabled && existsSync(place(SUITE_LAUNCHER3_DIR))) {
          copyDirectoryTreeClean(place(SUITE_LAUNCHER3_DIR), join(output, "launcher3"));
          stagedDirs.push("launcher3");
        }
        if (checked.modules.controlBridge.enabled && existsSync(place(SUITE_CONTROL_BRIDGE_DIR))) {
          copyDirectoryTreeClean(place(SUITE_CONTROL_BRIDGE_DIR), join(output, "control-bridge"));
          stagedDirs.push("control-bridge");
        }
        if (checked.modules.sandboxedPlay.enabled && existsSync(place(SUITE_SANDBOXED_PLAY_DIR))) {
          copyDirectoryTreeClean(place(SUITE_SANDBOXED_PLAY_DIR), join(output, "sandboxed-play"));
          stagedDirs.push("sandboxed-play");
        }
        if (apksDir !== undefined) {
          const apksOut = join(output, "apks");
          mkdirSync(apksOut, { recursive: true });
          for (const item of resolvedApks) {
            if (item.apkFile !== undefined) {
              copyFileSync(item.apkFile, join(apksOut, `${item.entry.id}.apk`));
            }
          }
          stagedDirs.push("apks");
        }
        const roles = writeAlphaNextRolesOverlay(output);
        stagedDirs.push("roles");
        return roles;
      });
      const manifest = {
        schemaVersion: 1,
        target,
        registrySha256: checked.registrySha256,
        signerSha256: checked.signerSha256,
        modules: checked.modules,
        stagedDirectories: stagedDirs,
        roleOverrides: rolesOverlay.roles,
        apps: stagedApps,
        claims: "suite staging only: not an image build, a boot, an update or acceptance",
      };
      yield* attempt(() => {
        writeFileSync(join(output, "alpha-suite.mk"), makefileContent, { flag: "wx" });
        writeFileSync(join(output, "Android.bp"), blueprintContent, { flag: "wx" });
        writeFileSync(join(output, "suite-stage-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      });
      return {
        output,
        makefile: join(output, "alpha-suite.mk"),
        blueprint: join(output, "Android.bp"),
        manifestFile: join(output, "suite-stage-manifest.json"),
        ...manifest,
      };
    }
    default:
      return yield* new UsageError({ message: `suite takes validate or stage, not ${subcommand ?? "nothing"}` });
  }
});

const commands = { stage, ota, verify, sign, record, keys, enroll, os, suite } as const;

/** One `pnpm aosp` command, as an effect over Node's services. */
export const aosp = (argv: readonly string[]) => dispatch(commands, argv, (message) => new UsageError({ message }));

if (import.meta.main) await runCli(aosp(process.argv.slice(2)), USAGE, (failure) => failure instanceof UsageError);
