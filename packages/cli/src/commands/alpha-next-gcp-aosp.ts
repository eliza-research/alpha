import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CliContext, CommandResult } from "../runner.ts";
import { findBinary } from "./alpha-next-walkthrough.ts";

/** Validated action modes for `pnpm cli alpha-next gcp-aosp`. */
export type GcpAospAction = "plan" | "bootstrap-script" | "provision" | "fetch" | "teardown";

/** CLI flags for `pnpm cli alpha-next gcp-aosp`. */
export interface GcpAospFlags {
  readonly action: GcpAospAction;
  readonly project: string | undefined;
  readonly zone: string | undefined;
  readonly machine: string | undefined;
  readonly bucket: string | undefined;
  readonly spot: boolean;
  readonly dryRun: boolean;
  readonly out: string | undefined;
}

/** Sizing and cost profile for a GCP AOSP build machine type. */
export interface GcpMachineProfile {
  readonly machineType: string;
  readonly vcpus: number;
  readonly ramGb: number;
  readonly diskGb: number;
  readonly estimatedBuildMinutes: number;
  readonly hourlySpotUsd: number;
  readonly hourlyOnDemandUsd: number;
  readonly estimatedBuildUsd: number;
}

/** Deterministic GCP AOSP build plan for Pixel 10a (`alpha_stallion_phone`). */
export interface GcpAospPlan {
  readonly action: GcpAospAction;
  readonly instanceName: string;
  readonly project: string;
  readonly zone: string;
  readonly bucket: string;
  readonly spot: boolean;
  readonly lunchTarget: string;
  readonly aospTag: string;
  readonly deviceCodename: string;
  readonly factoryImageFilename: string;
  readonly factoryImageSha256: string;
  readonly gmsCompatRepos: readonly {
    readonly name: string;
    readonly commit: string;
    readonly targetPath: string;
  }[];
  readonly machine: GcpMachineProfile;
  readonly gcloudPath: string | null;
  readonly gcloudAvailable: boolean;
  readonly commands: {
    readonly provision: readonly string[];
    readonly fetch: readonly string[];
    readonly flashLocal: readonly string[];
    readonly teardown: readonly string[];
  };
}

/** Structured report returned by `pnpm cli alpha-next gcp-aosp`. */
export interface GcpAospReport {
  readonly subcommand: "gcp-aosp";
  readonly action: GcpAospAction;
  readonly mode: "dry-run" | "live";
  readonly executed: boolean;
  readonly plan: GcpAospPlan;
  readonly bootstrapScript?: string;
  readonly scriptPath?: string;
}

const DEFAULT_PROJECT = "alpha-aosp-build";
const DEFAULT_ZONE = "us-central1-a";
const DEFAULT_MACHINE = "c3-standard-44";
const DEFAULT_BUCKET = "gs://alpha-next-aosp-artifacts";
const DEFAULT_INSTANCE_NAME = "alpha-next-stallion-builder";
const DEFAULT_LUNCH_TARGET = "alpha_stallion_phone-cp2a-userdebug";

const MACHINE_PROFILES: Readonly<Record<string, Omit<GcpMachineProfile, "estimatedBuildUsd">>> = {
  "c3-standard-44": {
    machineType: "c3-standard-44",
    vcpus: 44,
    ramGb: 176,
    diskGb: 1000,
    estimatedBuildMinutes: 65,
    hourlySpotUsd: 0.65,
    hourlyOnDemandUsd: 2.1,
  },
  "c3-standard-88": {
    machineType: "c3-standard-88",
    vcpus: 88,
    ramGb: 352,
    diskGb: 1000,
    estimatedBuildMinutes: 42,
    hourlySpotUsd: 1.3,
    hourlyOnDemandUsd: 4.2,
  },
  "n2-standard-64": {
    machineType: "n2-standard-64",
    vcpus: 64,
    ramGb: 256,
    diskGb: 1000,
    estimatedBuildMinutes: 55,
    hourlySpotUsd: 0.9,
    hourlyOnDemandUsd: 3.1,
  },
};

/** Validate whether a positional argument is a supported `gcp-aosp` action. */
export function isGcpAospAction(value: string): value is GcpAospAction {
  return value === "plan"
    || value === "bootstrap-script"
    || value === "provision"
    || value === "fetch"
    || value === "teardown";
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function resolveMachineProfile(machineType: string, spot: boolean): GcpMachineProfile {
  const base = MACHINE_PROFILES[machineType] ?? {
    machineType,
    vcpus: 44,
    ramGb: 176,
    diskGb: 1000,
    estimatedBuildMinutes: 65,
    hourlySpotUsd: 0.65,
    hourlyOnDemandUsd: 2.1,
  };
  const hours = base.estimatedBuildMinutes / 60;
  const diskCost = 0.25;
  const rate = spot ? base.hourlySpotUsd : base.hourlyOnDemandUsd;
  const estimatedBuildUsd = Math.round((hours * rate + diskCost) * 100) / 100;
  return { ...base, estimatedBuildUsd };
}

function normalizeBucket(raw: string | undefined): string {
  const trimmed = (raw ?? DEFAULT_BUCKET).trim().replace(/\/+$/, "");
  return trimmed.startsWith("gs://") ? trimmed : `gs://${trimmed}`;
}

function extractPinMetadata(rootDir: string): {
  readonly aospTag: string;
  readonly deviceCodename: string;
  readonly lunchTarget: string;
  readonly factoryImageFilename: string;
  readonly factoryImageSha256: string;
  readonly gmsCompatRepos: readonly { readonly name: string; readonly commit: string; readonly targetPath: string }[];
} {
  const aospLock = readJsonRecord(path.join(rootDir, ".eliza/packages/os/aosp/aosp.lock.json"));
  const profiles = (aospLock.profiles ?? {}) as Record<string, Record<string, unknown>>;
  const pixelProfile = profiles.pixel10a ?? {};
  const manifest = (pixelProfile.manifest ?? {}) as Record<string, unknown>;
  const release = readJsonRecord(path.join(rootDir, "apps/app/aosp/pixel10a-release.json"));
  const releaseDevice = (release.device ?? {}) as Record<string, unknown>;
  const releaseLunch = (release.lunch ?? {}) as Record<string, unknown>;
  const channel = readJsonRecord(path.join(rootDir, "apps/app/aosp/pixel10a-ota-channel.json"));
  const recovery = (channel.recovery ?? {}) as Record<string, Record<string, unknown>>;
  const factory = recovery.stockFactoryImage ?? {};
  const gmsPin = readJsonRecord(path.join(rootDir, "apps/app/aosp/sandboxed-play/gmscompat-pin.json"));
  const gmsReposRaw = (gmsPin.repositories ?? {}) as Record<string, Record<string, unknown>>;

  const gmsCompatRepos = ["GmsCompat", "GmsCompatConfig", "frameworksBaseGmsCompat"]
    .map((name) => {
      const entry = gmsReposRaw[name] ?? {};
      return {
        name,
        commit: typeof entry.commit === "string" ? entry.commit : "",
        targetPath: typeof entry.targetPath === "string" ? entry.targetPath : "",
      };
    })
    .filter((entry) => entry.commit !== "");

  return {
    aospTag: typeof manifest.tag === "string" ? manifest.tag : "android-17.0.0_r1",
    deviceCodename: typeof releaseDevice.codename === "string" ? releaseDevice.codename : "stallion",
    lunchTarget: typeof releaseLunch.development === "string" ? releaseLunch.development : DEFAULT_LUNCH_TARGET,
    factoryImageFilename: typeof factory.filename === "string" ? factory.filename : "stallion-cp3a.261005.005-factory-d1d25502.zip",
    factoryImageSha256: typeof factory.sha256 === "string" ? factory.sha256 : "",
    gmsCompatRepos,
  };
}

/** Build the deterministic GCP AOSP build plan for Pixel 10a (`alpha_stallion_phone`). */
export function buildGcpAospPlan(flags: GcpAospFlags, ctx: CliContext): GcpAospPlan {
  const project = flags.project ?? DEFAULT_PROJECT;
  const zone = flags.zone ?? DEFAULT_ZONE;
  const bucket = normalizeBucket(flags.bucket);
  const machineType = flags.machine ?? DEFAULT_MACHINE;
  const machine = resolveMachineProfile(machineType, flags.spot);
  const meta = extractPinMetadata(ctx.rootDir);
  const gcloudPath = findBinary("gcloud");
  const scriptPath = flags.out ? path.resolve(ctx.cwd, flags.out) : "/tmp/alpha-next-gcp-aosp-bootstrap.sh";

  const provision = [
    "gcloud",
    "compute",
    "instances",
    "create",
    DEFAULT_INSTANCE_NAME,
    `--project=${project}`,
    `--zone=${zone}`,
    `--machine-type=${machine.machineType}`,
    "--image-family=ubuntu-2404-lts-amd64",
    "--image-project=ubuntu-os-cloud",
    `--boot-disk-size=${String(machine.diskGb)}GB`,
    "--boot-disk-type=pd-ssd",
    "--scopes=cloud-platform",
    ...(flags.spot ? ["--provisioning-model=SPOT", "--instance-termination-action=STOP"] : []),
    `--metadata=ALPHA_BUCKET=${bucket},ALPHA_LUNCH=${meta.lunchTarget},ALPHA_AOSP_TAG=${meta.aospTag}`,
    `--metadata-from-file=startup-script=${scriptPath}`,
  ];

  const fetch = [
    "gcloud",
    "storage",
    "cp",
    `${bucket}/alpha-next-${meta.deviceCodename}-img.zip`,
    `${bucket}/alpha-next-${meta.deviceCodename}-build-manifest.json`,
    "./out-pixel10a/",
  ];

  const flashLocal = [
    "adb -s 67091JEA313850 reboot bootloader",
    `fastboot -s 67091JEA313850 update ./out-pixel10a/alpha-next-${meta.deviceCodename}-img.zip`,
  ];

  const teardown = [
    "gcloud",
    "compute",
    "instances",
    "delete",
    DEFAULT_INSTANCE_NAME,
    `--project=${project}`,
    `--zone=${zone}`,
    "--quiet",
  ];

  return {
    action: flags.action,
    instanceName: DEFAULT_INSTANCE_NAME,
    project,
    zone,
    bucket,
    spot: flags.spot,
    lunchTarget: meta.lunchTarget,
    aospTag: meta.aospTag,
    deviceCodename: meta.deviceCodename,
    factoryImageFilename: meta.factoryImageFilename,
    factoryImageSha256: meta.factoryImageSha256,
    gmsCompatRepos: meta.gmsCompatRepos,
    machine,
    gcloudPath,
    gcloudAvailable: gcloudPath !== null,
    commands: { provision, fetch, flashLocal, teardown },
  };
}

/** Render the self-contained Ubuntu 24.04 GCP VM startup script to build Alpha NEXT for Pixel 10a. */
export function renderGcpBootstrapScript(plan: GcpAospPlan): string {
  const jobs = String(plan.machine.vcpus);
  return [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    'exec > >(tee -a /var/log/alpha-next-aosp-build.log) 2>&1',
    "",
    'AOSP_ROOT="/mnt/aosp"',
    'REPO_DIR="/mnt/alphaphone"',
    `AOSP_TAG="${plan.aospTag}"`,
    `LUNCH_TARGET="${plan.lunchTarget}"`,
    `DEVICE_CODENAME="${plan.deviceCodename}"`,
    `FACTORY_ZIP="${plan.factoryImageFilename}"`,
    `FACTORY_SHA256="${plan.factoryImageSha256}"`,
    `OUTPUT_BUCKET="${plan.bucket}"`,
    'AUTO_SHUTDOWN="${ALPHA_AUTO_SHUTDOWN:-1}"',
    "",
    "cleanup_and_shutdown() {",
    '  local exit_code=$?',
    '  echo "[alpha-next] Build script exiting with code ${exit_code}"',
    '  if [ "${AUTO_SHUTDOWN}" = "1" ]; then',
    '    sudo shutdown -h now || true',
    "  fi",
    "}",
    "trap cleanup_and_shutdown EXIT",
    "",
    "export DEBIAN_FRONTEND=noninteractive",
    "sudo apt-get update -y",
    "sudo apt-get install -y git-core gnupg flex bison build-essential zip curl zlib1g-dev \\",
    "  libc6-dev-i386 x11proto-core-dev libx11-dev lib32z1-dev libgl1-mesa-dev \\",
    "  libxml2-utils xsltproc unzip fontconfig python3 python3-pip rsync ccache jq",
    "",
    "if ! command -v repo >/dev/null 2>&1; then",
    "  curl -fsSL https://storage.googleapis.com/git-repo-downloads/repo -o /tmp/repo",
    "  sudo install -m 0755 /tmp/repo /usr/local/bin/repo",
    "fi",
    "",
    "if ! command -v node >/dev/null 2>&1 || [ \"$(node -p 'process.versions.node.split(\".\")[0]')\" -lt 26 ]; then",
    "  curl -fsSL https://nodejs.org/dist/latest-v26.x/node-v26.0.0-linux-x64.tar.xz -o /tmp/node26.tar.xz || true",
    "fi",
    "",
    'sudo mkdir -p "${AOSP_ROOT}" "${REPO_DIR}"',
    'sudo chown -R "$(id -u):$(id -g)" "${AOSP_ROOT}" "${REPO_DIR}"',
    "",
    'if [ ! -d "${REPO_DIR}/.git" ]; then',
    '  git clone --branch alpha-next --depth 1 https://github.com/AlphaPhone/alpha.git "${REPO_DIR}"',
    "fi",
    "",
    'cd "${AOSP_ROOT}"',
    'repo init -u https://android.googlesource.com/platform/manifest -b "${AOSP_TAG}" --depth=1',
    `repo sync -c --no-tags --no-clone-bundle -j16`,
    "",
    'if [ -f "${REPO_DIR}/apps/app/aosp/build-host/soong-memory.patch" ]; then',
    '  git -C "${AOSP_ROOT}/build/soong" apply "${REPO_DIR}/apps/app/aosp/build-host/soong-memory.patch" || true',
    "fi",
    'if [ -f "${REPO_DIR}/apps/app/aosp/launcher3/patches/alpha-qsb-ask-bar.patch" ]; then',
    '  git -C "${AOSP_ROOT}/packages/apps/Launcher3" apply "${REPO_DIR}/apps/app/aosp/launcher3/patches/alpha-qsb-ask-bar.patch" || true',
    "fi",
    "",
    'python3 "${REPO_DIR}/apps/app/aosp/sandboxed-play/fetch-gmscompat.py" --aosp-root "${AOSP_ROOT}"',
    "",
    'mkdir -p "${AOSP_ROOT}/vendor/google_devices"',
    'if [ -f "/mnt/factory/${FACTORY_ZIP}" ]; then',
    '  echo "${FACTORY_SHA256}  /mnt/factory/${FACTORY_ZIP}" | sha256sum -c -',
    '  vendor/adevtool/bin/run generate-all -d "${DEVICE_CODENAME}" -s "/mnt/factory/${FACTORY_ZIP}"',
    "fi",
    "",
    'rm -rf "${AOSP_ROOT}/vendor/alphaphone"',
    'node "${REPO_DIR}/apps/app/scripts/aosp.ts" suite stage \\',
    '  --target pixel10a \\',
    '  --output "${AOSP_ROOT}/vendor/alphaphone" \\',
    '  --apks-dir "${REPO_DIR}/apps/app/android/suite/out" \\',
    "  --with-launcher3 \\",
    "  --with-control-bridge \\",
    "  --with-sandboxed-play",
    "",
    'export GOGC=100',
    `export GOMEMLIMIT="${String(Math.max(64, Math.floor(plan.machine.ramGb * 0.75)))}GiB"`,
    "set +u",
    "source build/envsetup.sh",
    'lunch "${LUNCH_TARGET}"',
    "set -u",
    `m -j${jobs} target-files-package dist`,
    "",
    'OUT_IMG="${AOSP_ROOT}/out/dist/alpha-next-${DEVICE_CODENAME}-img.zip"',
    'TARGET_FILES="$(ls -1 "${AOSP_ROOT}"/out/dist/*-target_files-*.zip | head -n 1)"',
    'img_from_target_files "${TARGET_FILES}" "${OUT_IMG}"',
    'jq -n --arg tag "${AOSP_TAG}" --arg lunch "${LUNCH_TARGET}" --arg sha "$(sha256sum "${OUT_IMG}" | awk \'{print $1}\')" \\',
    '  \'{aospTag:$tag, lunch:$lunch, imageSha256:$sha}\' > "${AOSP_ROOT}/out/dist/alpha-next-${DEVICE_CODENAME}-build-manifest.json"',
    "",
    'gcloud storage cp "${OUT_IMG}" "${OUTPUT_BUCKET}/alpha-next-${DEVICE_CODENAME}-img.zip"',
    'gcloud storage cp "${AOSP_ROOT}/out/dist/alpha-next-${DEVICE_CODENAME}-build-manifest.json" "${OUTPUT_BUCKET}/alpha-next-${DEVICE_CODENAME}-build-manifest.json"',
    "",
  ].join("\n");
}

function executeGcloud(gcloudPath: string, argv: readonly string[]): void {
  execFileSync(gcloudPath, [...argv.slice(1)], { stdio: "inherit" });
}

/** Execute `pnpm cli alpha-next gcp-aosp [plan|bootstrap-script|provision|fetch|teardown]`. */
export function runGcpAosp(
  flags: GcpAospFlags,
  ctx: CliContext,
): CommandResult<GcpAospReport> {
  const plan = buildGcpAospPlan(flags, ctx);
  const script = renderGcpBootstrapScript(plan);

  if (flags.action === "plan") {
    const report: GcpAospReport = {
      subcommand: "gcp-aosp",
      action: flags.action,
      mode: "dry-run",
      executed: false,
      plan,
    };
    const lines = [
      `alpha-next gcp-aosp plan  lunch:${plan.lunchTarget}  tag:${plan.aospTag}  machine:${plan.machine.machineType} (${String(plan.machine.vcpus)} vCPU / ${String(plan.machine.ramGb)} GB RAM / ${String(plan.machine.diskGb)} GB SSD)`,
      `  estimate: ~${String(plan.machine.estimatedBuildMinutes)} min, ~$${plan.machine.estimatedBuildUsd.toFixed(2)} (${plan.spot ? "Spot" : "On-Demand"})  gcloud:${String(plan.gcloudAvailable)}`,
      `  bucket: ${plan.bucket}  zone: ${plan.zone}  project: ${plan.project}`,
      `  provision: ${plan.commands.provision.join(" ")}`,
    ];
    return { ok: true, data: report, lines };
  }

  if (flags.action === "bootstrap-script") {
    let writtenPath: string | undefined;
    if (flags.out && !flags.dryRun) {
      writtenPath = path.resolve(ctx.cwd, flags.out);
      fs.mkdirSync(path.dirname(writtenPath), { recursive: true });
      fs.writeFileSync(writtenPath, script, { mode: 0o755, encoding: "utf8" });
    }
    const report: GcpAospReport = {
      subcommand: "gcp-aosp",
      action: flags.action,
      mode: flags.dryRun ? "dry-run" : "live",
      executed: writtenPath !== undefined,
      plan,
      bootstrapScript: script,
      ...(writtenPath !== undefined ? { scriptPath: writtenPath } : {}),
    };
    const lines = [
      `alpha-next gcp-aosp bootstrap-script (${writtenPath ? `wrote ${writtenPath}` : `${String(script.split("\n").length)} lines`})`,
      ...(!writtenPath ? [script] : []),
    ];
    return { ok: true, data: report, lines };
  }

  const commandArgv = flags.action === "provision"
    ? plan.commands.provision
    : flags.action === "fetch"
      ? plan.commands.fetch
      : plan.commands.teardown;

  if (flags.dryRun) {
    const report: GcpAospReport = {
      subcommand: "gcp-aosp",
      action: flags.action,
      mode: "dry-run",
      executed: false,
      plan,
      ...(flags.action === "provision" ? { bootstrapScript: script } : {}),
    };
    return {
      ok: true,
      data: report,
      lines: [
        `alpha-next gcp-aosp ${flags.action} (dry-run)  gcloud:${String(plan.gcloudAvailable)}`,
        `  command: ${commandArgv.join(" ")}`,
      ],
    };
  }

  if (!plan.gcloudPath) {
    return {
      ok: false,
      message: `gcloud CLI not found in PATH. Install Google Cloud SDK or rerun with --dry-run. Command: ${commandArgv.join(" ")}`,
      data: {
        subcommand: "gcp-aosp",
        action: flags.action,
        mode: "live",
        executed: false,
        plan,
      },
    };
  }

  if (flags.action === "provision") {
    const targetScript = flags.out ? path.resolve(ctx.cwd, flags.out) : "/tmp/alpha-next-gcp-aosp-bootstrap.sh";
    fs.mkdirSync(path.dirname(targetScript), { recursive: true });
    fs.writeFileSync(targetScript, script, { mode: 0o755, encoding: "utf8" });
  }
  executeGcloud(plan.gcloudPath, commandArgv);

  return {
    ok: true,
    data: {
      subcommand: "gcp-aosp",
      action: flags.action,
      mode: "live",
      executed: true,
      plan,
    },
    lines: [`alpha-next gcp-aosp ${flags.action} executed cleanly.`],
  };
}
