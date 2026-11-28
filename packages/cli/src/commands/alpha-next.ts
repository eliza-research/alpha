import { defineCommand, type CliContext, type CommandResult } from "../runner.ts";
import { runEmulatorE2e } from "./alpha-next-emulator.ts";
import { isGcpAospAction, runGcpAosp, type GcpAospAction } from "./alpha-next-gcp-aosp.ts";
import { runPixelDeploy } from "./alpha-next-pixel-deploy.ts";
import { runSyncFonts, runSyncTokens } from "./alpha-next-tokens.ts";
import { runManifest, runValidate } from "./alpha-next-validate.ts";
import { isWalkthroughAction, runWalkthrough, type WalkthroughAction } from "./alpha-next-walkthrough.ts";

/** Validated subcommands supported under `pnpm cli alpha-next`. */
export type AlphaNextSubcommand =
  | "sync-tokens"
  | "sync-fonts"
  | "manifest"
  | "validate"
  | "emulator-e2e"
  | "walkthrough"
  | "gcp-aosp"
  | "pixel-deploy";

interface AlphaNextFlags {
  readonly check: boolean;
  readonly write: boolean;
  readonly "with-fonts": boolean;
  readonly aapt2: boolean;
  readonly "dry-run": boolean;
  readonly spot: boolean;
  readonly execute: boolean;
  readonly target: string | undefined;
  readonly out: string | undefined;
  readonly url: string | undefined;
  readonly tokens: string | undefined;
  readonly suite: string | undefined;
  readonly "apk-dir": string | undefined;
  readonly avd: string | undefined;
  readonly serial: string | undefined;
  readonly timeout: string | undefined;
  readonly project: string | undefined;
  readonly zone: string | undefined;
  readonly machine: string | undefined;
  readonly bucket: string | undefined;
}

interface SubcommandSlot {
  readonly name: AlphaNextSubcommand;
  readonly summary: string;
  readonly run: (
    flags: AlphaNextFlags,
    positionals: readonly string[],
    ctx: CliContext,
  ) => CommandResult | Promise<CommandResult>;
}

const SUBCOMMANDS: Readonly<Record<AlphaNextSubcommand, SubcommandSlot>> = {
  "sync-tokens": {
    name: "sync-tokens",
    summary: "Generate or check Android colors/dimens XML from packages/design-system/tokens.json",
    run: (flags, _positionals, ctx) => runSyncTokens({
      check: flags.check,
      write: flags.write,
      withFonts: flags["with-fonts"],
      target: flags.target,
      out: flags.out,
      tokens: flags.tokens,
    }, ctx),
  },
  "sync-fonts": {
    name: "sync-fonts",
    summary: "Derive Android .ttf fonts and alpha_fonts.xml for Launcher3 without mutating packages/design-system/fonts/",
    run: (flags, _positionals, ctx) => runSyncFonts({
      check: flags.check,
      write: flags.write,
      out: flags.out,
    }, ctx),
  },
  manifest: {
    name: "manifest",
    summary: "Validate the Alpha NEXT suite app registry (apps/app/android/suite/apps.json)",
    run: (flags, _positionals, ctx) => runManifest({
      check: flags.check,
      suite: flags.suite,
    }, ctx),
  },
  validate: {
    name: "validate",
    summary: "Verify Alpha NEXT token sync, suite manifest, artifacts, security invariants, and optional aapt2 compile",
    run: (flags, _positionals, ctx) => runValidate({
      check: flags.check,
      aapt2: flags.aapt2,
      suite: flags.suite,
      tokens: flags.tokens,
      out: flags.out,
    }, ctx),
  },
  "emulator-e2e": {
    name: "emulator-e2e",
    summary: "Run or plan Tier-1 headless Android emulator end-to-end verification",
    run: (flags, _positionals, ctx) => runEmulatorE2e({
      dryRun: flags["dry-run"],
      apkDir: flags["apk-dir"],
      avd: flags.avd,
      serial: flags.serial,
      timeout: flags.timeout,
    }, ctx),
  },
  walkthrough: {
    name: "walkthrough",
    summary: "Capture all 18 views & Android emulator footage and render the 1080p Alpha NEXT walkthrough video",
    run: (flags, positionals, ctx) => {
      const rawAction = positionals[1] ?? "all";
      if (!isWalkthroughAction(rawAction)) {
        return {
          ok: false,
          message: `Unknown walkthrough action "${rawAction}". Expected: capture-web, capture-android, render, or all.`,
          exitCode: 2,
        };
      }
      const action: WalkthroughAction = rawAction;
      return runWalkthrough({
        action,
        dryRun: flags["dry-run"],
        out: flags.out,
        url: flags.url,
        apkDir: flags["apk-dir"],
        avd: flags.avd,
        serial: flags.serial,
        timeout: flags.timeout,
      }, ctx);
    },
  },
  "gcp-aosp": {
    name: "gcp-aosp",
    summary: "Plan, generate bootstrap scripts, provision, fetch, or tear down a GCP AOSP Pixel 10a build VM",
    run: (flags, positionals, ctx) => {
      const rawAction = positionals[1] ?? "plan";
      if (!isGcpAospAction(rawAction)) {
        return {
          ok: false,
          message: `Unknown gcp-aosp action "${rawAction}". Expected: plan, bootstrap-script, provision, fetch, or teardown.`,
          exitCode: 2,
        };
      }
      const action: GcpAospAction = rawAction;
      return runGcpAosp({
        action,
        project: flags.project,
        zone: flags.zone,
        machine: flags.machine,
        bucket: flags.bucket,
        spot: flags.spot,
        dryRun: flags["dry-run"],
        out: flags.out,
      }, ctx);
    },
  },
  "pixel-deploy": {
    name: "pixel-deploy",
    summary: "Read-only preflight and deployment plan for installing Alpha NEXT onto a userdebug Pixel 10a",
    run: (flags, _positionals, ctx) => runPixelDeploy({
      serial: flags.serial,
      apkDir: flags["apk-dir"],
      dryRun: flags["dry-run"],
      execute: flags.execute,
    }, ctx),
  },
};

function isAlphaNextSubcommand(value: string): value is AlphaNextSubcommand {
  return Object.hasOwn(SUBCOMMANDS, value);
}

/** Project CLI command group for Alpha NEXT generators and verification levers. */
export const alphaNextCommand = defineCommand({
  name: "alpha-next",
  summary: "Alpha NEXT Android token/font sync, manifest, validation, emulator, walkthrough, GCP AOSP, and Pixel deploy levers",
  usage: "pnpm cli alpha-next <sync-tokens|sync-fonts|manifest|validate|emulator-e2e|walkthrough|gcp-aosp|pixel-deploy> [options]",
  flags: {
    check: {
      kind: "boolean",
      description: "Verify generated resources or validation gates without writing",
    },
    write: {
      kind: "boolean",
      description: "Write generated Android resources or fonts to target directories",
    },
    "with-fonts": {
      kind: "boolean",
      description: "Also derive Launcher3 .ttf fonts and alpha_fonts.xml during sync-tokens",
    },
    aapt2: {
      kind: "boolean",
      description: "Run Android SDK aapt2 compile on Launcher3 overlay resources during validate",
    },
    "dry-run": {
      kind: "boolean",
      description: "Inspect toolchain and plan without booting an AVD, provisioning cloud VMs, or mutating devices",
    },
    spot: {
      kind: "boolean",
      description: "Use a GCP Spot/preemptible VM for gcp-aosp builds",
    },
    execute: {
      kind: "boolean",
      description: "Explicit opt-in required before pixel-deploy performs any mutating device action",
    },
    target: {
      kind: "string",
      short: "t",
      description: "Token sync target: all, launcher3, or ipc",
    },
    out: {
      kind: "string",
      short: "o",
      description: "Override output path for generated resources, walkthrough artifacts, or GCP bootstrap script",
    },
    url: {
      kind: "string",
      description: "Existing Alpha app URL for walkthrough capture-web (skips launching Vite)",
    },
    tokens: {
      kind: "string",
      description: "Override path to design-system tokens.json",
    },
    suite: {
      kind: "string",
      description: "Override path to Android suite apps.json registry",
    },
    "apk-dir": {
      kind: "string",
      description: "Directory containing built AlphaCore and thin Alpha APKs for emulator-e2e, walkthrough, or pixel-deploy",
    },
    avd: {
      kind: "string",
      description: "Android Virtual Device name for emulator-e2e or walkthrough (default: alpha_next_api35)",
    },
    serial: {
      kind: "string",
      description: "Target ADB device serial for emulator-e2e, walkthrough, or pixel-deploy",
    },
    timeout: {
      kind: "string",
      description: "Boot timeout in seconds for emulator-e2e or walkthrough (default: 180)",
    },
    project: {
      kind: "string",
      description: "GCP project ID for gcp-aosp VM provisioning",
    },
    zone: {
      kind: "string",
      description: "GCP compute zone for gcp-aosp (default: us-central1-a)",
    },
    machine: {
      kind: "string",
      description: "GCP machine type for gcp-aosp (default: c3-standard-44)",
    },
    bucket: {
      kind: "string",
      description: "GCS bucket URI (gs://...) for uploading built Pixel 10a AOSP artifacts",
    },
  },
  run: ({ flags, positionals }, ctx) => {
    const subcommand = positionals[0];
    const available = Object.keys(SUBCOMMANDS).join(", ");
    if (!subcommand) {
      return {
        ok: false,
        message: `Missing alpha-next subcommand. Available: ${available}.`,
        exitCode: 2,
      };
    }
    if (!isAlphaNextSubcommand(subcommand)) {
      return {
        ok: false,
        message: `Unknown alpha-next subcommand "${subcommand}". Available: ${available}.`,
        exitCode: 2,
      };
    }
    return SUBCOMMANDS[subcommand].run(flags, positionals, ctx);
  },
});
