import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliContext, CommandResult } from "../runner.ts";
import {
  DEFAULT_TOKENS_PATH,
  IPC_RES_ROOT,
  LAUNCHER3_RES_ROOT,
  runSyncTokens,
} from "./alpha-next-tokens.ts";

/** Repository-relative path to the authoritative Alpha NEXT suite registry. */
export const DEFAULT_SUITE_PATH = "apps/app/android/suite/apps.json";

const CORE_PACKAGE = "ai.alphacompute.alphaphone";
const IPC_PERMISSION = "ai.alphacompute.permission.AGENT_IPC";
const PACKAGE_NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

const KNOWN_VIEWS: ReadonlySet<string> = new Set([
  "Phone",
  "Messages",
  "Inbox",
  "Telegram",
  "Slack",
  "Calendar",
  "Clock",
  "Reminders",
  "Browser",
  "Camera",
  "Photos",
  "Maps",
  "Notes",
  "Contacts",
  "Files",
  "Workflows",
  "Wallet",
  "Settings",
]);

const FORBIDDEN_THIN_PERMISSIONS: ReadonlySet<string> = new Set([
  "android.permission.INSTALL_SELF_UPDATES",
  "android.permission.INSTALL_PACKAGES",
]);

const VALID_ASSETS_PROFILES: ReadonlySet<string> = new Set(["core", "thin", "ocr"]);
const SKIP_SCAN_DIRS: ReadonlySet<string> = new Set(["build", ".gradle", ".cache", "node_modules", ".git", "test", "androidTest"]);

/** Result of validating `apps/app/android/suite/apps.json`. */
export interface SuiteManifestReport {
  readonly subcommand: "manifest";
  readonly status: "valid" | "invalid" | "missing";
  readonly suitePath: string;
  readonly present: boolean;
  readonly corePackage: string | null;
  readonly appsCount: number;
  readonly viewsCovered: readonly string[];
  readonly missingViews: readonly string[];
  readonly issues: readonly string[];
}

/** One static security invariant check result. */
export interface SecurityInvariantResult {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly findings: readonly string[];
}

/** Result of optional `aapt2 compile` XML syntax verification. */
export interface Aapt2CheckResult {
  readonly ran: boolean;
  readonly passed: boolean;
  readonly aapt2Path: string | null;
  readonly resDir: string;
  readonly detail: string;
}

/** Structured report produced by `pnpm cli alpha-next validate`. */
export interface ValidateReport {
  readonly subcommand: "validate";
  readonly status: "pass" | "incomplete" | "fail";
  readonly tokensInSync: boolean;
  readonly manifestValid: boolean;
  readonly securityPassed: boolean;
  readonly presentCount: number;
  readonly totalCount: number;
  readonly artifacts: readonly { readonly path: string; readonly present: boolean }[];
  readonly security: readonly SecurityInvariantResult[];
  readonly manifest: SuiteManifestReport;
  readonly aapt2?: Aapt2CheckResult;
}

/** CLI flags shared by `manifest` and `validate`. */
export interface ValidateFlags {
  readonly check: boolean;
  readonly aapt2: boolean;
  readonly suite: string | undefined;
  readonly tokens: string | undefined;
  readonly out: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateSuiteEntry(
  rawEntry: unknown,
  index: number,
  seenIds: Set<string>,
  seenAppIds: Set<string>,
  seenViews: Set<string>,
  roleOwners: Map<string, string>,
  issues: string[],
): { readonly isCore: boolean } {
  const prefix = `apps[${String(index)}]`;
  if (!isRecord(rawEntry)) {
    issues.push(`${prefix}: expected object`);
    return { isCore: false };
  }
  const id = typeof rawEntry.id === "string" ? rawEntry.id.trim() : "";
  if (id === "") {
    issues.push(`${prefix}.id: expected non-empty string`);
  } else if (seenIds.has(id)) {
    issues.push(`${prefix}.id: duplicate id "${id}"`);
  } else {
    seenIds.add(id);
  }

  const applicationId = typeof rawEntry.applicationId === "string" ? rawEntry.applicationId.trim() : "";
  if (!PACKAGE_NAME_PATTERN.test(applicationId)) {
    issues.push(`${prefix}.applicationId: invalid Android package "${applicationId}"`);
  } else if (seenAppIds.has(applicationId)) {
    issues.push(`${prefix}.applicationId: duplicate package "${applicationId}"`);
  } else {
    seenAppIds.add(applicationId);
  }

  if (typeof rawEntry.label !== "string" || rawEntry.label.trim() === "") {
    issues.push(`${prefix}.label: expected non-empty string`);
  }

  const isCore = id === "core";
  const surface = rawEntry.surface;
  if (isCore) {
    if (applicationId !== CORE_PACKAGE) {
      issues.push(`${prefix}.applicationId: core must use "${CORE_PACKAGE}", got "${applicationId}"`);
    }
    if (rawEntry.view !== null) {
      issues.push(`${prefix}.view: core must have view=null`);
    }
    if (surface !== undefined && surface !== "overlay") {
      issues.push(`${prefix}.surface: core must have surface="overlay"`);
    }
  } else {
    if (typeof rawEntry.view !== "string" || !KNOWN_VIEWS.has(rawEntry.view)) {
      issues.push(`${prefix}.view: unknown view "${String(rawEntry.view)}"`);
    } else if (seenViews.has(rawEntry.view)) {
      issues.push(`${prefix}.view: duplicate view "${rawEntry.view}"`);
    } else {
      seenViews.add(rawEntry.view);
    }
    if (surface !== undefined && surface !== "app") {
      issues.push(`${prefix}.surface: thin app "${id}" must have surface="app"`);
    }
  }

  const assetsProfile = typeof rawEntry.assetsProfile === "string" ? rawEntry.assetsProfile : "";
  if (!VALID_ASSETS_PROFILES.has(assetsProfile)) {
    issues.push(`${prefix}.assetsProfile: expected core, thin, or ocr, got "${assetsProfile}"`);
  } else if (!isCore && assetsProfile === "core") {
    issues.push(`${prefix}.assetsProfile: thin app "${id}" must not use assetsProfile="core"`);
  }

  if (!isStringArray(rawEntry.defaultRoles)) {
    issues.push(`${prefix}.defaultRoles: expected string array`);
  } else {
    for (const role of rawEntry.defaultRoles) {
      const prior = roleOwners.get(role);
      if (prior !== undefined) {
        issues.push(`${prefix}.defaultRoles: role "${role}" overlaps with "${prior}"`);
      } else {
        roleOwners.set(role, id || prefix);
      }
    }
  }

  if (!isStringArray(rawEntry.permissions)) {
    issues.push(`${prefix}.permissions: expected string array`);
  } else if (!isCore) {
    for (const permission of rawEntry.permissions) {
      if (FORBIDDEN_THIN_PERMISSIONS.has(permission)) {
        issues.push(`${prefix}.permissions: thin app "${id}" must not claim "${permission}"`);
      }
    }
  }

  if (!isStringArray(rawEntry.allowedAgentRoutePrefixes)) {
    issues.push(`${prefix}.allowedAgentRoutePrefixes: expected string array`);
  } else if (!isCore && rawEntry.allowedAgentRoutePrefixes.includes("*")) {
    issues.push(`${prefix}.allowedAgentRoutePrefixes: thin app "${id}" must not claim wildcard "*"`);
  }

  if (rawEntry.allowedCloudRoutePrefixes !== undefined) {
    if (!isStringArray(rawEntry.allowedCloudRoutePrefixes)) {
      issues.push(`${prefix}.allowedCloudRoutePrefixes: expected string array`);
    } else if (!isCore && rawEntry.allowedCloudRoutePrefixes.includes("*")) {
      issues.push(`${prefix}.allowedCloudRoutePrefixes: thin app "${id}" must not claim wildcard "*"`);
    }
  }

  if (rawEntry.allowedSecureStoreSlots !== undefined) {
    if (!isStringArray(rawEntry.allowedSecureStoreSlots)) {
      issues.push(`${prefix}.allowedSecureStoreSlots: expected string array`);
    } else if (!isCore && rawEntry.allowedSecureStoreSlots.includes("*")) {
      issues.push(`${prefix}.allowedSecureStoreSlots: thin app "${id}" must not claim wildcard "*"`);
    }
  }

  return { isCore };
}

/** Validate a parsed `apps/app/android/suite/apps.json` document against Alpha NEXT schema v1 invariants. */
export function validateSuiteManifest(raw: unknown, suitePath: string): SuiteManifestReport {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    return {
      subcommand: "manifest",
      status: "invalid",
      suitePath,
      present: true,
      corePackage: null,
      appsCount: 0,
      viewsCovered: [],
      missingViews: [...KNOWN_VIEWS].sort(),
      issues: ["Suite manifest root must be a JSON object"],
    };
  }

  if (raw.schemaVersion !== 1) {
    issues.push(`schemaVersion: expected 1, got ${String(raw.schemaVersion)}`);
  }
  const corePackage = typeof raw.corePackage === "string" ? raw.corePackage : null;
  if (corePackage !== CORE_PACKAGE) {
    issues.push(`corePackage: expected "${CORE_PACKAGE}", got ${JSON.stringify(raw.corePackage)}`);
  }
  if (raw.ipcPermission !== IPC_PERMISSION) {
    issues.push(`ipcPermission: expected "${IPC_PERMISSION}", got ${JSON.stringify(raw.ipcPermission)}`);
  }

  const apps = Array.isArray(raw.apps) ? raw.apps : undefined;
  if (!apps || apps.length === 0) {
    issues.push("apps: expected non-empty array");
  }

  const seenIds = new Set<string>();
  const seenAppIds = new Set<string>();
  const seenViews = new Set<string>();
  const roleOwners = new Map<string, string>();
  let hasCore = false;

  if (apps) {
    for (let index = 0; index < apps.length; index++) {
      const checked = validateSuiteEntry(apps[index], index, seenIds, seenAppIds, seenViews, roleOwners, issues);
      if (checked.isCore) hasCore = true;
    }
  }
  if (!hasCore) {
    issues.push(`apps: missing required "core" entry (${CORE_PACKAGE})`);
  }

  const viewsCovered = [...seenViews].sort();
  const missingViews = [...KNOWN_VIEWS].filter((view) => !seenViews.has(view)).sort();
  if (missingViews.length > 0) {
    issues.push(`apps: missing required views: ${missingViews.join(", ")}`);
  }

  return {
    subcommand: "manifest",
    status: issues.length === 0 ? "valid" : "invalid",
    suitePath,
    present: true,
    corePackage,
    appsCount: apps?.length ?? 0,
    viewsCovered,
    missingViews,
    issues,
  };
}

/** Execute `pnpm cli alpha-next manifest`. */
export function runManifest(flags: Pick<ValidateFlags, "check" | "suite">, ctx: CliContext): CommandResult<SuiteManifestReport> {
  const suiteFile = flags.suite ? path.resolve(ctx.cwd, flags.suite) : path.join(ctx.rootDir, DEFAULT_SUITE_PATH);
  const suitePath = path.relative(ctx.rootDir, suiteFile).split(path.sep).join("/");
  if (!fs.existsSync(suiteFile)) {
    const missingReport: SuiteManifestReport = {
      subcommand: "manifest",
      status: "missing",
      suitePath,
      present: false,
      corePackage: null,
      appsCount: 0,
      viewsCovered: [],
      missingViews: [...KNOWN_VIEWS].sort(),
      issues: [`Suite registry not found at ${suitePath}`],
    };
    if (flags.check) {
      return { ok: false, message: `Suite registry not found at ${suitePath}.`, data: missingReport };
    }
    return { ok: true, data: missingReport, lines: [`alpha-next manifest: waiting for suite registry at ${suitePath}`] };
  }

  const parsed: unknown = JSON.parse(fs.readFileSync(suiteFile, "utf8"));
  const report = validateSuiteManifest(parsed, suitePath);
  if (report.status !== "valid") {
    return {
      ok: false,
      message: `Suite manifest invalid (${String(report.issues.length)} issue(s)): ${report.issues[0] ?? ""}`,
      data: report,
    };
  }
  return {
    ok: true,
    data: report,
    lines: [
      `alpha-next manifest: valid (${String(report.appsCount)} entries, ${String(report.viewsCovered.length)}/18 views) at ${suitePath}`,
    ],
  };
}

function walkFiles(baseDir: string, predicate: (filePath: string) => boolean): string[] {
  if (!fs.existsSync(baseDir)) return [];
  const matches: string[] = [];
  const stack: string[] = [baseDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_SCAN_DIRS.has(entry.name)) {
          stack.push(path.join(current, entry.name));
        }
        continue;
      }
      if (entry.isFile()) {
        const full = path.join(current, entry.name);
        if (predicate(full)) matches.push(full);
      }
    }
  }
  return matches.sort();
}

/** Run static security invariant checks across Alpha NEXT Android and AOSP paths. */
export function scanSecurityInvariants(rootDir: string): readonly SecurityInvariantResult[] {
  const sharedUidFindings: string[] = [];
  for (const relBase of ["apps/app/android", "apps/app/aosp"]) {
    const files = walkFiles(path.join(rootDir, relBase), (file) => file.endsWith(".xml"));
    for (const file of files) {
      if (fs.readFileSync(file, "utf8").includes("android:sharedUserId")) {
        sharedUidFindings.push(path.relative(rootDir, file).split(path.sep).join("/"));
      }
    }
  }

  const playApkFindings = walkFiles(
    path.join(rootDir, "apps/app/aosp/sandboxed-play"),
    (file) => file.toLowerCase().endsWith(".apk"),
  ).map((file) => path.relative(rootDir, file).split(path.sep).join("/"));

  const localhostFindings: string[] = [];
  const ipcScanRoots = [
    "apps/app/android/alpha-ipc",
    "apps/app/android/alpha-app-runtime",
    "apps/app/android/alpha-control",
    "apps/app/android/suite",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/ipc",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/overlay",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/control",
    "apps/app/aosp/control-bridge",
    "apps/app/aosp/launcher3",
  ];
  const localhostPattern = /\b(?:127\.0\.0\.1|localhost)\b|InetAddress\.getLoopbackAddress|ServerSocket\b/;
  for (const relBase of ipcScanRoots) {
    const files = walkFiles(path.join(rootDir, relBase), (file) => /\.(?:java|kt|aidl|ts|xml)$/.test(file));
    for (const file of files) {
      if (localhostPattern.test(fs.readFileSync(file, "utf8"))) {
        localhostFindings.push(path.relative(rootDir, file).split(path.sep).join("/"));
      }
    }
  }

  const bridgeRel = "apps/app/aosp/control-bridge/src/ai/alphacompute/control/AlphaControlBridgeService.java";
  const bridgeFile = path.join(rootDir, bridgeRel);
  let bridgePassed = true;
  let bridgeDetail = `${bridgeRel} not yet staged`;
  const bridgeFindings: string[] = [];
  if (fs.existsSync(bridgeFile)) {
    const source = fs.readFileSync(bridgeFile, "utf8");
    const setsTrue = /\b(?:CAPTURE_SECURE_LAYERS|captureSecureLayers)\s*=\s*true\b|setCaptureSecureLayers\(\s*true\s*\)/.test(source);
    const setsFalse = /\b(?:CAPTURE_SECURE_LAYERS|captureSecureLayers)\s*=\s*false\b|setCaptureSecureLayers\(\s*false\s*\)/.test(source);
    if (setsTrue || !setsFalse) {
      bridgePassed = false;
      bridgeDetail = `${bridgeRel} must explicitly enforce captureSecureLayers / CAPTURE_SECURE_LAYERS = false`;
      bridgeFindings.push(bridgeRel);
    } else {
      bridgeDetail = `${bridgeRel} enforces captureSecureLayers = false`;
    }
  }

  return [
    {
      id: "no-shared-user-id",
      passed: sharedUidFindings.length === 0,
      detail: sharedUidFindings.length === 0 ? "Zero android:sharedUserId declarations" : `Found android:sharedUserId in ${String(sharedUidFindings.length)} file(s)`,
      findings: sharedUidFindings,
    },
    {
      id: "no-proprietary-play-apks",
      passed: playApkFindings.length === 0,
      detail: playApkFindings.length === 0 ? "Zero proprietary .apk binaries under sandboxed-play" : `Found ${String(playApkFindings.length)} .apk file(s) under sandboxed-play`,
      findings: playApkFindings,
    },
    {
      id: "no-localhost-agent-ipc",
      passed: localhostFindings.length === 0,
      detail: localhostFindings.length === 0 ? "Zero localhost/loopback IPC bindings in Alpha NEXT modules" : `Found loopback reference in ${String(localhostFindings.length)} file(s)`,
      findings: localhostFindings,
    },
    {
      id: "capture-secure-layers-disabled",
      passed: bridgePassed,
      detail: bridgeDetail,
      findings: bridgeFindings,
    },
  ];
}

/** Locate the Android SDK root from environment variables or standard home directory. */
export function resolveAndroidSdkRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANDROID_HOME || env.ANDROID_SDK_ROOT || path.join(os.homedir(), process.platform === "darwin" ? "Library/Android/sdk" : "Android/Sdk");
}

/** Locate `aapt2` under Android SDK build-tools. */
export function resolveAapt2Path(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const sdkRoot = resolveAndroidSdkRoot(env);
  const pinned = path.join(sdkRoot, "build-tools/36.0.0/aapt2");
  if (fs.existsSync(pinned)) return pinned;
  const buildTools = path.join(sdkRoot, "build-tools");
  if (!fs.existsSync(buildTools)) return undefined;
  const versions = fs.readdirSync(buildTools).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(buildTools, version, "aapt2");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Compile an Android resource directory with `aapt2 compile` into a temporary archive to validate XML syntax. */
export function runAapt2CompileCheck(resDir: string, rootDir: string): Aapt2CheckResult {
  const relativeRes = path.relative(rootDir, resDir).split(path.sep).join("/");
  const aapt2Path = resolveAapt2Path();
  if (!aapt2Path) {
    return {
      ran: false,
      passed: false,
      aapt2Path: null,
      resDir: relativeRes,
      detail: "aapt2 not found under ANDROID_HOME/build-tools",
    };
  }
  if (!fs.existsSync(resDir)) {
    return {
      ran: false,
      passed: false,
      aapt2Path,
      resDir: relativeRes,
      detail: `Resource directory not found: ${relativeRes}`,
    };
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-next-aapt2-"));
  const outZip = path.join(tmpDir, "compiled-res.zip");
  try {
    execFileSync(aapt2Path, ["compile", "--dir", resDir, "-o", outZip], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ran: true,
      passed: true,
      aapt2Path,
      resDir: relativeRes,
      detail: `aapt2 compile passed for ${relativeRes}`,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ran: true,
      passed: false,
      aapt2Path,
      resDir: relativeRes,
      detail: `aapt2 compile failed for ${relativeRes}: ${message}`,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Execute `pnpm cli alpha-next validate`. */
export function runValidate(flags: ValidateFlags, ctx: CliContext): CommandResult<ValidateReport> {
  const checkPaths = [
    DEFAULT_TOKENS_PATH,
    DEFAULT_SUITE_PATH,
    "apps/app/android/suite/build-thin.ts",
    "apps/app/android/alpha-ipc/src/main/assets/alpha-suite-policy.json",
    "apps/app/android/alpha-ipc/src/main/aidl/ai/alphacompute/ipc/IAlphaAgentBroker.aidl",
    "apps/app/android/alpha-ipc/src/main/aidl/ai/alphacompute/ipc/IAlphaPlatformBroker.aidl",
    "apps/app/android/alpha-ipc/src/main/aidl/ai/alphacompute/ipc/IAlphaContextRegistry.aidl",
    "apps/app/android/alpha-app-runtime/build.gradle",
    "apps/app/android/alpha-control/build.gradle",
    "apps/app/android/alpha-control/src/main/java/ai/alphacompute/control/AlphaAccessibilityService.java",
    "apps/app/android/alpha-control/src/main/java/ai/alphacompute/control/AlphaControlPolicy.java",
    "apps/app/android/alpha-control/src/main/java/ai/alphacompute/control/AlphaUiControlExecutor.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/ipc/AlphaAgentBrokerService.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/ipc/AlphaPlatformBrokerService.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/ipc/AlphaContextRegistryService.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/ipc/AlphaPreferencesProvider.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/overlay/AlphaVoiceInteractionService.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/overlay/AlphaVoiceInteractionSession.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/widget/AlphaDayWidgetProvider.java",
    "apps/app/android/app/src/main/java/ai/alphacompute/alphaphone/widget/AlphaSearchWidgetProvider.java",
    "apps/app/aosp/launcher3/Android.bp",
    `${LAUNCHER3_RES_ROOT}/values/colors.xml`,
    `${IPC_RES_ROOT}/values/colors.xml`,
    "spec/app/control/index.md",
    "spec/app/control/index.proof.dfy",
    "apps/app/src/control/control.vibe",
    "apps/agent/src/plugins/control.ts",
    "apps/app/aosp/control-bridge/Android.bp",
    "apps/app/aosp/control-bridge/src/ai/alphacompute/control/AlphaControlBridgeService.java",
    "apps/app/aosp/sandboxed-play/Android.bp",
  ] as const;

  const artifacts = checkPaths.map((relativePath) => ({
    path: relativePath,
    present: fs.existsSync(path.join(ctx.rootDir, relativePath)),
  }));
  const tokenSync = runSyncTokens({
    check: true,
    write: false,
    withFonts: false,
    target: undefined,
    out: flags.out,
    tokens: flags.tokens,
  }, ctx);
  const tokensInSync = tokenSync.ok;

  const manifestResult = runManifest({ check: false, suite: flags.suite }, ctx);
  const manifestReport: SuiteManifestReport = manifestResult.data ?? {
    subcommand: "manifest",
    status: "invalid",
    suitePath: DEFAULT_SUITE_PATH,
    present: false,
    corePackage: null,
    appsCount: 0,
    viewsCovered: [],
    missingViews: [...KNOWN_VIEWS].sort(),
    issues: [manifestResult.ok ? "unknown manifest error" : manifestResult.message],
  };
  const manifestValid = manifestReport.status === "valid";
  const security = scanSecurityInvariants(ctx.rootDir);
  const securityPassed = security.every((item) => item.passed);

  const resBase = flags.out ? path.resolve(ctx.cwd, flags.out) : ctx.rootDir;
  const aapt2 = flags.aapt2
    ? runAapt2CompileCheck(path.join(resBase, LAUNCHER3_RES_ROOT), resBase)
    : undefined;
  const aapt2Passed = aapt2 === undefined || aapt2.passed;

  const presentCount = artifacts.filter((item) => item.present).length;
  const allPresent = presentCount === artifacts.length;
  const hardFailure = !securityPassed || manifestReport.status === "invalid" || !aapt2Passed;
  const status: ValidateReport["status"] = hardFailure
    ? "fail"
    : allPresent && tokensInSync && manifestValid
      ? "pass"
      : "incomplete";

  const data: ValidateReport = {
    subcommand: "validate",
    status,
    tokensInSync,
    manifestValid,
    securityPassed,
    presentCount,
    totalCount: artifacts.length,
    artifacts,
    security,
    manifest: manifestReport,
    ...(aapt2 !== undefined ? { aapt2 } : {}),
  };

  const lines = [
    `alpha-next validate (${status}): artifacts ${String(presentCount)}/${String(artifacts.length)}, tokens ${tokensInSync ? "in-sync" : "drift/missing"}, manifest ${manifestReport.status}, security ${securityPassed ? "pass" : "FAIL"}`,
    ...artifacts.map((item) => `  [${item.present ? "ok" : "missing"}] ${item.path}`),
    ...security.map((item) => `  [${item.passed ? "ok" : "FAIL"}] ${item.id}: ${item.detail}`),
    ...(aapt2 ? [`  [${aapt2.passed ? "ok" : "FAIL"}] aapt2: ${aapt2.detail}`] : []),
  ];

  if (hardFailure || (flags.check && status !== "pass")) {
    return {
      ok: false,
      message: hardFailure
        ? "Alpha NEXT static validation failed on security, manifest, or aapt2 checks."
        : "Alpha NEXT validation found missing or out-of-sync artifacts.",
      data,
    };
  }
  return { ok: true, data, lines };
}
