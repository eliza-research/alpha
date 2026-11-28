import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CliContext, CommandResult } from "../runner.ts";
import { buildEmulatorPlan } from "./alpha-next-emulator.ts";

/** CLI flags for `pnpm cli alpha-next pixel-deploy`. */
export interface PixelDeployFlags {
  readonly serial: string | undefined;
  readonly apkDir: string | undefined;
  readonly dryRun: boolean;
  readonly execute: boolean;
}

/** Parsed summary of an installed AlphaCore package on a Pixel device. */
export interface InstalledCoreSummary {
  readonly installed: boolean;
  readonly versionCode: number | null;
  readonly versionName: string | null;
  readonly codePath: string | null;
  readonly isSystemPrivApp: boolean;
  readonly certSha256: string | null;
}

/** Parsed summary of local AlphaCore and thin APKs built in the workspace. */
export interface LocalSuiteApkSummary {
  readonly coreApkPath: string | null;
  readonly coreVersionCode: number | null;
  readonly coreCertSha256: string | null;
  readonly thinApkPaths: readonly string[];
}

/** Read-only hardware and software state of a connected Pixel 10a (`stallion`). */
export interface PixelDeviceInspection {
  readonly serial: string;
  readonly connected: boolean;
  readonly deviceCodename: string | null;
  readonly displayId: string | null;
  readonly buildType: string | null;
  readonly isUserdebug: boolean;
  readonly bootloaderUnlocked: boolean;
  readonly verityMode: string | null;
  readonly installedCore: InstalledCoreSummary;
}

/** Compatibility analysis between installed Pixel 10a `AlphaPhone` and local Alpha NEXT APKs. */
export interface PixelCompatibilityReport {
  readonly directAdbInstallPossible: boolean;
  readonly overlayfsRemountAvailable: boolean;
  readonly certMismatch: boolean;
  readonly versionDowngrade: boolean;
  readonly systemPrivAppBlock: boolean;
  readonly minRequiredVersionCode: number | null;
  readonly warnings: readonly string[];
}

/** Structured report returned by `pnpm cli alpha-next pixel-deploy`. */
export interface PixelDeployReport {
  readonly subcommand: "pixel-deploy";
  readonly mode: "dry-run" | "execute";
  readonly executed: boolean;
  readonly device: PixelDeviceInspection;
  readonly localApks: LocalSuiteApkSummary;
  readonly compatibility: PixelCompatibilityReport;
  readonly steps: readonly string[];
}

const DEFAULT_PIXEL_SERIAL = "67091JEA313850";
const CORE_PACKAGE = "ai.alphacompute.alphaphone";

function normalizeSha256(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replaceAll(":", "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : null;
}

/** Parse versionCode, codePath, system/priv-app status, and SHA-256 cert from `dumpsys package`. */
export function parsePixelPackageSummary(dumpOutput: string): InstalledCoreSummary {
  if (!dumpOutput.includes(`Package [${CORE_PACKAGE}]`) && !dumpOutput.includes("versionCode=")) {
    return {
      installed: false,
      versionCode: null,
      versionName: null,
      codePath: null,
      isSystemPrivApp: false,
      certSha256: null,
    };
  }
  const versionMatch = /versionCode=(\d+)/.exec(dumpOutput);
  const versionNameMatch = /versionName=([^\s]+)/.exec(dumpOutput);
  const codePathMatch = /codePath=([^\s]+)/.exec(dumpOutput);
  const sigMatch = /Signatures:\s*\[([0-9A-Fa-f:]{95})\]/.exec(dumpOutput);
  const codePath = codePathMatch?.[1] ?? null;
  const isSystemPrivApp = Boolean(
    (codePath && (codePath.includes("/priv-app/") || codePath.startsWith("/product/") || codePath.startsWith("/system")))
    || dumpOutput.includes("PRIVILEGED"),
  );
  return {
    installed: true,
    versionCode: versionMatch?.[1] ? Number(versionMatch[1]) : null,
    versionName: versionNameMatch?.[1] ?? null,
    codePath,
    isSystemPrivApp,
    certSha256: normalizeSha256(sigMatch?.[1] ?? null),
  };
}

/** Evaluate whether local Alpha NEXT APKs can install directly or require `userdebug` overlayfs remount. */
export function evaluatePixelCompatibility(
  device: PixelDeviceInspection,
  localApks: LocalSuiteApkSummary,
): PixelCompatibilityReport {
  const warnings: string[] = [];
  const installed = device.installedCore;
  const certMismatch = Boolean(
    installed.certSha256 && localApks.coreCertSha256 && installed.certSha256 !== localApks.coreCertSha256,
  );
  const versionDowngrade = Boolean(
    installed.versionCode !== null
    && localApks.coreVersionCode !== null
    && localApks.coreVersionCode <= installed.versionCode,
  );
  const systemPrivAppBlock = installed.installed && installed.isSystemPrivApp && certMismatch;
  const minRequiredVersionCode = installed.versionCode !== null ? installed.versionCode + 1 : null;

  if (!device.connected) {
    warnings.push(`Pixel device ${device.serial} is not connected over ADB; showing static deployment plan.`);
  }
  if (certMismatch) {
    warnings.push(
      `Signing cert mismatch: installed ${CORE_PACKAGE} uses ${installed.certSha256?.slice(0, 12) ?? "unknown"} while local APK uses ${localApks.coreCertSha256?.slice(0, 12) ?? "unknown"} (breaks adb install -r and signature AGENT_IPC unless replaced or re-signed with matching key).`,
    );
  }
  if (versionDowngrade && installed.versionCode !== null && localApks.coreVersionCode !== null) {
    warnings.push(
      `Version downgrade blocked: local AlphaCore versionCode (${String(localApks.coreVersionCode)}) <= installed versionCode (${String(installed.versionCode)}). Rebuild with versionCode >= ${String(installed.versionCode + 1)}.`,
    );
  }
  if (systemPrivAppBlock) {
    warnings.push(
      `Preinstalled privileged system package at ${installed.codePath ?? "/product/priv-app/AlphaPhone"} cannot be uninstalled via pm; userdebug overlayfs remount or full AOSP flash is required.`,
    );
  }
  if (localApks.thinApkPaths.length < 18) {
    warnings.push(`Only ${String(localApks.thinApkPaths.length)}/18 thin APKs discovered locally; build the full 18-app suite before deploying.`);
  }

  const directAdbInstallPossible = !certMismatch && !versionDowngrade && localApks.coreApkPath !== null;
  const overlayfsRemountAvailable = device.isUserdebug && device.bootloaderUnlocked;

  return {
    directAdbInstallPossible,
    overlayfsRemountAvailable,
    certMismatch,
    versionDowngrade,
    systemPrivAppBlock,
    minRequiredVersionCode,
    warnings,
  };
}

/** Build the ordered, explicit command sequence to deploy Alpha NEXT onto a `userdebug` Pixel 10a. */
export function buildPixelDeploySteps(
  serial: string,
  localApks: LocalSuiteApkSummary,
  compatibility: PixelCompatibilityReport,
): readonly string[] {
  const adb = `adb -s ${serial}`;
  const coreApk = localApks.coreApkPath ?? "apps/app/artifacts/launcher-debug.apk";
  const minVc = compatibility.minRequiredVersionCode ?? 704;
  const steps: string[] = [];

  if (compatibility.versionDowngrade) {
    steps.push(`# Bump AlphaCore & thin suite versionCode >= ${String(minVc)} and rebuild signed with one shared keystore`);
  }
  if (compatibility.systemPrivAppBlock || compatibility.certMismatch) {
    steps.push(
      `${adb} root`,
      `${adb} disable-verity`,
      `${adb} reboot`,
      `${adb} wait-for-device`,
      `${adb} root`,
      `${adb} remount`,
      `${adb} push ${coreApk} /product/priv-app/AlphaPhone/AlphaPhone.apk`,
      `${adb} shell chmod 0644 /product/priv-app/AlphaPhone/AlphaPhone.apk`,
      `${adb} reboot`,
      `${adb} wait-for-device`,
    );
  } else {
    steps.push(`${adb} install -r -g ${coreApk}`);
  }

  for (const thinApk of localApks.thinApkPaths) {
    steps.push(`${adb} install -r -g ${thinApk}`);
  }

  steps.push(
    `${adb} shell cmd role add-role-holder --user 0 android.app.role.HOME com.android.launcher3`,
    `${adb} shell cmd role add-role-holder --user 0 android.app.role.ASSISTANT ${CORE_PACKAGE}`,
    `${adb} shell cmd role add-role-holder --user 0 android.app.role.DIALER ai.alphacompute.phone`,
    `${adb} shell cmd role add-role-holder --user 0 android.app.role.SMS ai.alphacompute.messages`,
    `${adb} shell cmd role add-role-holder --user 0 android.app.role.BROWSER ai.alphacompute.browser`,
    `${adb} shell settings put secure voice_interaction_service ${CORE_PACKAGE}/${CORE_PACKAGE}.overlay.AlphaVoiceInteractionService`,
    `${adb} shell settings put secure enabled_accessibility_services ${CORE_PACKAGE}/ai.alphacompute.control.AlphaAccessibilityService`,
    `${adb} shell settings put secure accessibility_enabled 1`,
  );

  return steps;
}

function findBuildTool(sdkRoot: string | null, toolName: string): string | null {
  if (!sdkRoot) return null;
  const buildToolsDir = path.join(sdkRoot, "build-tools");
  if (!fs.existsSync(buildToolsDir)) return null;
  const versions = fs.readdirSync(buildToolsDir).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(buildToolsDir, version, toolName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function inspectLocalApks(rootDir: string, discoveredApks: readonly string[], sdkRoot: string | null): LocalSuiteApkSummary {
  const coreRel = discoveredApks.find((rel) => /launcher|alphaphone|core/i.test(path.basename(rel))) ?? null;
  const thinRel = discoveredApks.filter((rel) => rel !== coreRel);
  const aapt2 = findBuildTool(sdkRoot, "aapt2");
  const apksigner = findBuildTool(sdkRoot, "apksigner");

  let coreVersionCode: number | null = null;
  let coreCertSha256: string | null = null;
  if (coreRel) {
    const coreAbs = path.join(rootDir, coreRel);
    if (aapt2) {
      try {
        const badging = execFileSync(aapt2, ["dump", "badging", coreAbs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const vcMatch = /versionCode='(\d+)'/.exec(badging);
        coreVersionCode = vcMatch?.[1] ? Number(vcMatch[1]) : null;
      } catch {
        coreVersionCode = null;
      }
    }
    if (apksigner) {
      try {
        const certs = execFileSync(apksigner, ["verify", "--print-certs", coreAbs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const shaMatch = /SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(certs);
        coreCertSha256 = normalizeSha256(shaMatch?.[1] ?? null);
      } catch {
        coreCertSha256 = null;
      }
    }
  }

  return {
    coreApkPath: coreRel,
    coreVersionCode,
    coreCertSha256,
    thinApkPaths: thinRel,
  };
}

function inspectPixelDeviceReadOnly(adbPath: string | null, serial: string): PixelDeviceInspection {
  const emptyCore: InstalledCoreSummary = {
    installed: false,
    versionCode: null,
    versionName: null,
    codePath: null,
    isSystemPrivApp: false,
    certSha256: null,
  };
  if (!adbPath) {
    return {
      serial,
      connected: false,
      deviceCodename: null,
      displayId: null,
      buildType: null,
      isUserdebug: false,
      bootloaderUnlocked: false,
      verityMode: null,
      installedCore: emptyCore,
    };
  }
  try {
    const devices = execFileSync(adbPath, ["devices"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const connected = devices.split(/\r?\n/).some((line) => line.trim().startsWith(`${serial}\tdevice`) || line.trim().startsWith(`${serial} `));
    if (!connected) {
      return {
        serial,
        connected: false,
        deviceCodename: null,
        displayId: null,
        buildType: null,
        isUserdebug: false,
        bootloaderUnlocked: false,
        verityMode: null,
        installedCore: emptyCore,
      };
    }
    const readProp = (prop: string): string | null => {
      const value = execFileSync(adbPath, ["-s", serial, "shell", "getprop", prop], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return value !== "" ? value : null;
    };
    const deviceCodename = readProp("ro.product.device");
    const displayId = readProp("ro.build.display.id");
    const buildType = readProp("ro.build.type");
    const flashLocked = readProp("ro.boot.flash.locked");
    const verityMode = readProp("ro.boot.veritymode");
    const pkgDump = execFileSync(adbPath, ["-s", serial, "shell", "dumpsys", "package", CORE_PACKAGE], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      serial,
      connected: true,
      deviceCodename,
      displayId,
      buildType,
      isUserdebug: buildType === "userdebug" || buildType === "eng",
      bootloaderUnlocked: flashLocked === "0",
      verityMode,
      installedCore: parsePixelPackageSummary(pkgDump),
    };
  } catch {
    return {
      serial,
      connected: false,
      deviceCodename: null,
      displayId: null,
      buildType: null,
      isUserdebug: false,
      bootloaderUnlocked: false,
      verityMode: null,
      installedCore: emptyCore,
    };
  }
}

/** Execute `pnpm cli alpha-next pixel-deploy` (strictly read-only unless `--execute` is passed). */
export function runPixelDeploy(
  flags: PixelDeployFlags,
  ctx: CliContext,
): CommandResult<PixelDeployReport> {
  const serial = flags.serial ?? DEFAULT_PIXEL_SERIAL;
  const emuPlan = buildEmulatorPlan({
    dryRun: true,
    apkDir: flags.apkDir,
    avd: undefined,
    serial: undefined,
    timeout: undefined,
  }, ctx);
  const device = inspectPixelDeviceReadOnly(emuPlan.adbPath, serial);
  const localApks = inspectLocalApks(ctx.rootDir, emuPlan.discoveredApks, emuPlan.sdkRoot);
  const compatibility = evaluatePixelCompatibility(device, localApks);
  const steps = buildPixelDeploySteps(serial, localApks, compatibility);
  const isExecute = flags.execute && !flags.dryRun;

  if (isExecute) {
    const reasons: string[] = [];
    if (!device.connected) reasons.push(`Device ${serial} is not connected.`);
    if (!device.isUserdebug || !device.bootloaderUnlocked) {
      reasons.push("Refusing live deploy: device must be userdebug with unlocked bootloader.");
    }
    if (compatibility.versionDowngrade) {
      reasons.push(`Refusing live deploy: local versionCode (${String(localApks.coreVersionCode)}) <= installed (${String(device.installedCore.versionCode)}).`);
    }
    if (compatibility.systemPrivAppBlock) {
      reasons.push("Refusing automatic verity-disable/reboot on physical device: run the printed remount steps explicitly after reviewing.");
    }
    if (reasons.length > 0) {
      return {
        ok: false,
        message: reasons.join(" "),
        data: {
          subcommand: "pixel-deploy",
          mode: "execute",
          executed: false,
          device,
          localApks,
          compatibility,
          steps,
        },
      };
    }
  }

  const report: PixelDeployReport = {
    subcommand: "pixel-deploy",
    mode: isExecute ? "execute" : "dry-run",
    executed: false,
    device,
    localApks,
    compatibility,
    steps,
  };
  const lines = [
    `alpha-next pixel-deploy (${report.mode})  serial:${serial}  connected:${String(device.connected)}  device:${device.deviceCodename ?? "unknown"}  build:${device.buildType ?? "unknown"}`,
    `  installed: versionCode=${String(device.installedCore.versionCode)} cert=${device.installedCore.certSha256?.slice(0, 12) ?? "none"} path=${device.installedCore.codePath ?? "none"}`,
    `  local: coreVersionCode=${String(localApks.coreVersionCode)} cert=${localApks.coreCertSha256?.slice(0, 12) ?? "none"} thinApks=${String(localApks.thinApkPaths.length)}`,
    `  directInstall:${String(compatibility.directAdbInstallPossible)}  overlayfsRemount:${String(compatibility.overlayfsRemountAvailable)}`,
    ...compatibility.warnings.map((warning) => `  warning: ${warning}`),
    ...steps.map((step) => `  step: ${step}`),
  ];
  return { ok: true, data: report, lines };
}
