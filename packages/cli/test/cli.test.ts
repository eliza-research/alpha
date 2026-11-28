import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  REQUIRED_CORE_COMPONENTS,
  WALKTHROUGH_VIEWS,
  assertSafeEmulatorSerial,
  buildPixelDeploySteps,
  buildStoryboardHtml,
  buildWalkthroughStoryboard,
  commands,
  cssLengthToDp,
  defineCommand,
  evaluatePixelCompatibility,
  extractPackageUid,
  inspectAccessibilityDump,
  inspectControlTelemetry,
  inspectCorePackageDump,
  inspectCrossAppIpcLog,
  inspectLauncherActivities,
  inspectThinAppLaunchLog,
  inspectVoiceAndOverlayDump,
  oklchToHex,
  parsePixelPackageSummary,
  renderGcpBootstrapScript,
  resolveAndroidAvdHome,
  resolveInstalledBlockedGuards,
  runCli,
  scanSecurityInvariants,
  sortApksCoreFirst,
  validateSuiteManifest,
  type CliIo,
  type EmulatorE2eReport,
  type GcpAospReport,
  type PixelDeployReport,
  type SyncFontsReport,
  type SyncTokensReport,
  type ValidateReport,
  type WalkthroughReport,
} from "../src/index.ts";

const templateRoot = path.resolve(import.meta.dirname, "../../..");
const mainPath = path.resolve(import.meta.dirname, "../src/main.ts");

const ALL_18_VIEWS = [
  "Phone",
  "Messages",
  "Contacts",
  "Browser",
  "Inbox",
  "Telegram",
  "Slack",
  "Calendar",
  "Clock",
  "Reminders",
  "Camera",
  "Photos",
  "Maps",
  "Notes",
  "Files",
  "Workflows",
  "Wallet",
  "Settings",
] as const;

function createRecorder(): { readonly io: CliIo; readonly out: () => string; readonly err: () => string } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      writeOut: (text) => {
        stdout.push(text);
      },
      writeErr: (text) => {
        stderr.push(text);
      },
    },
    out: () => stdout.join(""),
    err: () => stderr.join(""),
  };
}

function parseJson(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function makeValidSuiteManifest() {
  return {
    schemaVersion: 1,
    corePackage: "ai.alphacompute.alphaphone",
    ipcPermission: "ai.alphacompute.permission.AGENT_IPC",
    apps: [
      {
        id: "core",
        view: null,
        surface: "overlay",
        applicationId: "ai.alphacompute.alphaphone",
        label: "Alpha",
        defaultRoles: ["ROLE_ASSISTANT"],
        permissions: ["android.permission.INSTALL_SELF_UPDATES"],
        allowedAgentRoutePrefixes: ["*"],
        allowedCloudRoutePrefixes: ["*"],
        allowedSecureStoreSlots: ["*"],
        assetsProfile: "core",
      },
      ...ALL_18_VIEWS.map((view) => ({
        id: view.toLowerCase(),
        view,
        surface: "app",
        applicationId: `ai.alphacompute.${view.toLowerCase()}`,
        label: view,
        defaultRoles: view === "Phone" ? ["ROLE_DIALER"] : view === "Messages" ? ["ROLE_SMS"] : [],
        permissions: ["ai.alphacompute.permission.AGENT_IPC"],
        allowedAgentRoutePrefixes: ["/api/health", "/api/status"],
        allowedCloudRoutePrefixes: [],
        allowedSecureStoreSlots: [],
        assetsProfile: view === "Camera" || view === "Files" ? "ocr" : "thin",
      })),
    ],
  };
}

describe("project CLI", () => {
  test("lists registered commands in human and JSON help output", async () => {
    const human = createRecorder();
    expect(await runCli({ argv: ["--help"], commands, rootDir: templateRoot, cwd: templateRoot, io: human.io })).toBe(0);
    expect(human.out()).toContain("Usage: pnpm cli <command> [options]");
    expect(human.out()).toContain("status");
    expect(human.out()).toContain("alpha-next");

    const structured = createRecorder();
    expect(await runCli({ argv: ["help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: structured.io })).toBe(0);
    const helpPayload = parseJson(structured.out()) as {
      ok: boolean;
      command: string;
      data: {
        commands: Array<{
          name: string;
          summary: string;
          usage: string;
          flags: Record<string, { kind: string; short?: string; description: string }>;
        }>;
      };
    };
    expect(helpPayload.ok).toBe(true);
    expect(helpPayload.command).toBe("help");
    expect(helpPayload.data.commands.map((entry) => entry.name)).toEqual(["status", "alpha-next"]);
    expect(helpPayload.data.commands[0]).toEqual({
      name: "status",
      summary: "Inspect workspace packages, specs, and generated outputs",
      usage: "pnpm cli status [--package <name|path>] [--json]",
      flags: {
        package: {
          kind: "string",
          short: "p",
          description: "Filter to one workspace package by name or relative path",
        },
      },
    });
    const alphaNextHelp = helpPayload.data.commands[1];
    expect(alphaNextHelp).toBeDefined();
    expect(alphaNextHelp.usage).toContain("sync-tokens|sync-fonts|manifest|validate|emulator-e2e|walkthrough|gcp-aosp|pixel-deploy");
    expect(Object.keys(alphaNextHelp.flags).sort()).toEqual([
      "aapt2", "apk-dir", "avd", "bucket", "check", "dry-run", "execute",
      "machine", "out", "project", "serial", "spot",
      "suite", "target", "timeout", "tokens", "url", "with-fonts", "write", "zone",
    ]);
    expect(alphaNextHelp.flags.target?.short).toBe("t");
    expect(alphaNextHelp.flags.out?.short).toBe("o");
    expect(alphaNextHelp.flags.check?.kind).toBe("boolean");
    expect(alphaNextHelp.flags.timeout?.kind).toBe("string");
    for (const flag of Object.values(alphaNextHelp.flags)) {
      expect(["boolean", "string"]).toContain(flag.kind);
      expect(flag.description.length).toBeGreaterThan(0);
    }

    const single = createRecorder();
    expect(await runCli({ argv: ["status", "--help", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: single.io })).toBe(0);
    expect(parseJson(single.out())).toEqual({
      ok: true,
      command: "help",
      data: {
        name: "status",
        summary: "Inspect workspace packages, specs, and generated outputs",
        usage: "pnpm cli status [--package <name|path>] [--json]",
        flags: {
          package: {
            kind: "string",
            short: "p",
            description: "Filter to one workspace package by name or relative path",
          },
        },
      },
    });
  });

  test("status inspects workspace packages and specs and supports filtering", async () => {
    const all = createRecorder();
    expect(await runCli({ argv: ["status", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: all.io })).toBe(0);
    const parsed = parseJson(all.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly project: string;
        readonly specs: readonly string[];
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.specs).toContain("spec/index.md");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toEqual(expect.arrayContaining(["@repo/app", "@repo/cli", "@repo/design-system", "@repo/ui"]));

    const filtered = createRecorder();
    expect(await runCli({ argv: ["status", "-p", "@repo/app", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: filtered.io })).toBe(0);
    const filteredParsed = parseJson(filtered.out()) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string; readonly path: string }[];
      };
    };
    expect(filteredParsed.ok).toBe(true);
    expect(filteredParsed.command).toBe("status");
    expect(filteredParsed.data.packages.map((pkg) => ({ name: pkg.name, path: pkg.path }))).toEqual([
      { name: "@repo/app", path: "apps/app" },
    ]);

    const missing = createRecorder();
    expect(await runCli({ argv: ["status", "--package", "@repo/missing", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: missing.io })).toBe(1);
    const missingParsed = parseJson(missing.out()) as { readonly ok: boolean; readonly command: string; readonly error: string };
    expect(missingParsed.ok).toBe(false);
    expect(missingParsed.command).toBe("status");
    expect(missingParsed.error).toContain("@repo/missing");
  });

  test("returns exit code 2 on unknown commands and unknown flags", async () => {
    const unknownCmd = createRecorder();
    expect(await runCli({ argv: ["nope"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownCmd.io })).toBe(2);
    expect(unknownCmd.err()).toContain('Unknown command "nope"');

    const unknownFlag = createRecorder();
    expect(await runCli({ argv: ["status", "--bogus", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: unknownFlag.io })).toBe(2);
    expect(parseJson(unknownFlag.out())).toMatchObject({
      ok: false,
      command: "status",
    });

    const failing = defineCommand({
      name: "boom",
      summary: "Throws at runtime",
      run: () => {
        throw new Error("corrupt state");
      },
    });

    const textFailure = createRecorder();
    expect(await runCli({ argv: ["boom"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: textFailure.io })).toBe(1);
    expect(textFailure.err()).toBe("error: corrupt state\n");

    const jsonFailure = createRecorder();
    expect(await runCli({ argv: ["boom", "--json"], commands: [failing], rootDir: templateRoot, cwd: templateRoot, io: jsonFailure.io })).toBe(1);
    expect(parseJson(jsonFailure.out())).toEqual({
      ok: false,
      command: "boom",
      error: "corrupt state",
    });
  });

  test("defineCommand parses typed flags and positionals for custom levers", async () => {
    const custom = defineCommand({
      name: "echo",
      summary: "Echo input",
      flags: {
        upper: { kind: "boolean", short: "u", description: "Uppercase output" },
        prefix: { kind: "string", description: "Prefix text" },
      },
      run: ({ flags, positionals }) => {
        const joined = positionals.join(" ");
        const body = flags.upper ? joined.toUpperCase() : joined;
        const text = flags.prefix ? `${flags.prefix}:${body}` : body;
        return { ok: true, data: { text }, lines: [text] };
      },
    });

    const recorded = createRecorder();
    expect(await runCli({
      argv: ["echo", "-u", "--prefix", "ok", "hello", "world"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: recorded.io,
    })).toBe(0);
    expect(recorded.out()).toBe("ok:HELLO WORLD\n");

    const flagValue = createRecorder();
    expect(await runCli({
      argv: ["echo", "--prefix=--help", "hi"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: flagValue.io,
    })).toBe(0);
    expect(flagValue.out()).toBe("--help:hi\n");

    const ambiguousFlagValue = createRecorder();
    expect(await runCli({
      argv: ["echo", "--prefix", "--help", "hi"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: ambiguousFlagValue.io,
    })).toBe(2);
    expect(ambiguousFlagValue.out()).toBe("");

    const bundledHelp = createRecorder();
    expect(await runCli({
      argv: ["echo", "-uh"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: bundledHelp.io,
    })).toBe(0);
    expect(bundledHelp.out()).toContain("Usage: pnpm cli echo [options]");

    const passthrough = createRecorder();
    expect(await runCli({
      argv: ["echo", "--", "--help"],
      commands: [custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: passthrough.io,
    })).toBe(0);
    expect(passthrough.out()).toBe("--help\n");

    expect(() => defineCommand({ name: "help", summary: "Reserved", run: () => ({ ok: true, data: null }) })).toThrow();
    expect(() => defineCommand({
      name: "bad",
      summary: "Reserved flag",
      flags: { json: { kind: "boolean", description: "Reserved" } },
      run: () => ({ ok: true, data: null }),
    })).toThrow();
    expect(() => defineCommand({
      name: "bad-short",
      summary: "Reserved short",
      flags: { header: { kind: "string", short: "h", description: "Reserved" } },
      run: () => ({ ok: true, data: null }),
    })).toThrow();
    await expect(runCli({
      argv: ["echo"],
      commands: [custom, custom],
      rootDir: templateRoot,
      cwd: templateRoot,
      io: createRecorder().io,
    })).rejects.toThrow(/Duplicate CLI command/);
  });

  test("executes directly on Node 26 via src/main.ts", () => {
    const stdout = execFileSync(process.execPath, [mainPath, "status", "--json"], {
      cwd: templateRoot,
      encoding: "utf8",
    });
    const parsed = parseJson(stdout) as {
      readonly ok: boolean;
      readonly command: string;
      readonly data: {
        readonly packages: readonly { readonly name: string }[];
      };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("status");
    expect(parsed.data.packages.map((pkg) => pkg.name)).toContain("@repo/cli");
  });

  test("converts OKLCH colors and CSS lengths accurately for Android resources", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#FFFFFF");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    expect(oklchToHex("oklch(0.45201372 0.31321437 264.05202064)")).toBe("#0000FF");
    expect(oklchToHex("oklch(0.98510365 0 0)")).toBe("#FAFAFA");
    expect(oklchToHex("oklch(0.70366126 0.15682550 277.95756294)")).toMatch(/^#[0-9A-F]{6}$/);
    expect(() => oklchToHex("rgb(0, 0, 255)")).toThrow("Invalid oklch color value");

    expect(cssLengthToDp("1rem")).toBe("16dp");
    expect(cssLengthToDp("1.375rem")).toBe("22dp");
    expect(cssLengthToDp("1.125rem")).toBe("18dp");
    expect(cssLengthToDp("1.9375rem")).toBe("31dp");
    expect(cssLengthToDp("1.875rem")).toBe("30dp");
    expect(cssLengthToDp("2px")).toBe("2dp");
    expect(() => cssLengthToDp("10em")).toThrow("Invalid CSS length value");
  });

  test("alpha-next sync-tokens, sync-fonts, and aapt2 compile work end-to-end without touching design-system fonts", async () => {
    const fontsBefore = fs.readdirSync(path.join(templateRoot, "packages/design-system/fonts")).sort();
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-next-tokens-"));
    try {
      const writeRun = createRecorder();
      expect(await runCli({
        argv: ["alpha-next", "sync-tokens", "--write", "--with-fonts", "--out", tmpOut, "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: writeRun.io,
      })).toBe(0);

      const report = parseJson(writeRun.out()) as { readonly ok: boolean; readonly data: SyncTokensReport };
      expect(report.ok).toBe(true);
      expect(report.data.mode).toBe("write");
      expect(report.data.colorCounts).toEqual({ light: 41, dark: 28 });
      expect(report.data.fontSync?.files.map((item) => item.relativePath)).toEqual([
        "apps/app/aosp/launcher3/overlay/res/font/alpha_public_sans.ttf",
        "apps/app/aosp/launcher3/overlay/res/font/fraunces_italic_400.ttf",
        "apps/app/aosp/launcher3/overlay/res/xml/alpha_fonts.xml",
      ]);
      expect(report.data.fontSync?.files[0]?.sha256).toBe("bbf4e1f31aec30b8e0b06825f411666a8f7d7c6954c3ac61779bbaf789df1611");

      const checkTokens = createRecorder();
      expect(await runCli({
        argv: ["alpha-next", "sync-tokens", "--check", "--with-fonts", "--out", tmpOut, "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: checkTokens.io,
      })).toBe(0);

      const checkFonts = createRecorder();
      expect(await runCli({
        argv: ["alpha-next", "sync-fonts", "--check", "--out", tmpOut, "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: checkFonts.io,
      })).toBe(0);
      const fontsParsed = parseJson(checkFonts.out()) as { readonly ok: boolean; readonly data: SyncFontsReport };
      expect(fontsParsed.ok).toBe(true);
      expect(fontsParsed.data.files).toHaveLength(3);

      const validateAapt2 = createRecorder();
      expect(await runCli({
        argv: ["alpha-next", "validate", "--aapt2", "--out", tmpOut, "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: validateAapt2.io,
      })).toBe(0);
      const validated = parseJson(validateAapt2.out()) as { readonly ok: boolean; readonly data: ValidateReport };
      expect(validated.ok).toBe(true);
      expect(validated.data.tokensInSync).toBe(true);
      expect(validated.data.securityPassed).toBe(true);
      expect(validated.data.aapt2?.ran).toBe(true);
      expect(validated.data.aapt2?.passed).toBe(true);

      const dimensPath = path.join(tmpOut, "apps/app/aosp/launcher3/overlay/res/values/dimens.xml");
      fs.writeFileSync(dimensPath, "<resources/>\n", "utf8");
      const staleCheck = createRecorder();
      expect(await runCli({
        argv: ["alpha-next", "sync-tokens", "--check", "--out", tmpOut, "--json"],
        commands,
        rootDir: templateRoot,
        cwd: templateRoot,
        io: staleCheck.io,
      })).toBe(1);
      const staleParsed = parseJson(staleCheck.out()) as { readonly ok: boolean; readonly data: SyncTokensReport };
      expect(staleParsed.ok).toBe(false);
      expect(staleParsed.data.stale).toEqual(["apps/app/aosp/launcher3/overlay/res/values/dimens.xml"]);
    } finally {
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }

    const fontsAfter = fs.readdirSync(path.join(templateRoot, "packages/design-system/fonts")).sort();
    expect(fontsAfter).toEqual(fontsBefore);
  });

  test("validates suite apps.json strictly and catches privilege, role, and uniqueness violations", () => {
    const valid = validateSuiteManifest(makeValidSuiteManifest(), "apps/app/android/suite/apps.json");
    expect(valid.status).toBe("valid");
    expect(valid.appsCount).toBe(19);
    expect(valid.viewsCovered).toHaveLength(18);
    expect(valid.missingViews).toEqual([]);

    const broken = makeValidSuiteManifest();
    broken.apps[1] = {
      ...broken.apps[1],
      defaultRoles: ["ROLE_ASSISTANT"],
      permissions: ["android.permission.INSTALL_SELF_UPDATES"],
      allowedAgentRoutePrefixes: ["*"],
    };
    const invalid = validateSuiteManifest(broken, "apps/app/android/suite/apps.json");
    expect(invalid.status).toBe("invalid");
    expect(invalid.issues.some((issue) => issue.includes("overlaps"))).toBe(true);
    expect(invalid.issues.some((issue) => issue.includes("INSTALL_SELF_UPDATES"))).toBe(true);
    expect(invalid.issues.some((issue) => issue.includes('wildcard "*"'))).toBe(true);
  });

  test("scans security invariants and flags sharedUserId, proprietary APKs, loopback IPC, and captureSecureLayers", () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-next-sec-"));
    try {
      const manifestFile = path.join(tmpRoot, "apps/app/android/alpha-ipc/src/main/AndroidManifest.xml");
      const playApk = path.join(tmpRoot, "apps/app/aosp/sandboxed-play/gms.apk");
      const ipcJava = path.join(tmpRoot, "apps/app/android/alpha-ipc/src/main/java/Bad.java");
      const bridgeJava = path.join(tmpRoot, "apps/app/aosp/control-bridge/src/ai/alphacompute/control/AlphaControlBridgeService.java");
      for (const file of [manifestFile, playApk, ipcJava, bridgeJava]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
      }
      fs.writeFileSync(manifestFile, '<manifest android:sharedUserId="ai.alphacompute.shared" />', "utf8");
      fs.writeFileSync(playApk, "fake-apk", "utf8");
      fs.writeFileSync(ipcJava, 'String url = "http://127.0.0.1:8080";', "utf8");
      fs.writeFileSync(bridgeJava, "boolean captureSecureLayers = true;", "utf8");

      const findings = scanSecurityInvariants(tmpRoot);
      expect(findings.every((item) => !item.passed)).toBe(true);

      fs.writeFileSync(bridgeJava, "boolean captureSecureLayers = false;", "utf8");
      const afterBridgeFix = scanSecurityInvariants(tmpRoot).find((item) => item.id === "capture-secure-layers-disabled");
      expect(afterBridgeFix?.passed).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("emulator-e2e --dry-run inspects SDK plan cleanly without launching an emulator", async () => {
    const dryRun = createRecorder();
    const exitCode = await runCli({ argv: ["alpha-next", "emulator-e2e", "--dry-run", "--json"], commands, rootDir: templateRoot, cwd: templateRoot, io: dryRun.io });
    expect(exitCode).toBe(0);
    const parsed = parseJson(dryRun.out()) as { readonly ok: boolean; readonly data: EmulatorE2eReport };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.mode).toBe("dry-run");
    expect(parsed.data.plan.avdName).toBe("alpha_next_api35");
    expect(parsed.data.plan.apkDirs).toEqual(["apps/app/artifacts", "apps/app/android/suite/out"]);
    expect(parsed.data.plan.emulatorArgs).toContain("-no-window");
    expect(parsed.data.plan.emulatorArgs).toContain("swiftshader_indirect");
    expect(parsed.data.stages.map((stage) => stage.stage)).toEqual([
      "ensure-avd",
      "boot-emulator",
      "install-apks",
      "verify-launcher-activities",
      "verify-ipc-and-provider",
      "verify-voice-interaction",
      "verify-cross-app-ipc",
      "verify-all-thin-apps",
      "verify-accessibility-and-browser-control",
      "teardown",
    ]);

    const attached = createRecorder();
    const sdk = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-adb-sdk-"));
    try {
      fs.mkdirSync(path.join(sdk, "platform-tools"));
      fs.writeFileSync(path.join(sdk, "platform-tools", "adb"), "");
      vi.stubEnv("ANDROID_HOME", sdk);
      expect(await runCli({ argv: ["alpha-next", "emulator-e2e", "--dry-run", "--serial", "emulator-5586", "--json"],
        commands, rootDir: templateRoot, cwd: templateRoot, io: attached.io })).toBe(0);
      const result = parseJson(attached.out()) as { readonly data: EmulatorE2eReport };
      expect(result.data.ready).toBe(true);
      expect(result.data.plan.missingTools).toEqual([]);
      expect(result.data.plan.systemImagePresent).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(sdk, { recursive: true, force: true });
    }

    const missingSub = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: missingSub.io,
    })).toBe(2);
  });

  test("verifies emulator dumps, APK install order, cross-APK IPC logs, and accessibility binding strictly", () => {
    expect(sortApksCoreFirst([
      "apps/app/android/suite/out/notes-debug.apk",
      "apps/app/artifacts/launcher-debug.apk",
      "apps/app/artifacts/alpha-launcher-debug.apk",
      "apps/app/artifacts/ai.alphacompute.alphaphone-debug.apk",
      "apps/app/android/suite/out/browser-debug.apk",
      "apps/app/android/suite/out/settings-debug.apk",
    ])).toEqual([
      "apps/app/artifacts/ai.alphacompute.alphaphone-debug.apk",
      "apps/app/artifacts/alpha-launcher-debug.apk",
      "apps/app/artifacts/launcher-debug.apk",
      "apps/app/android/suite/out/browser-debug.apk",
      "apps/app/android/suite/out/notes-debug.apk",
      "apps/app/android/suite/out/settings-debug.apk",
    ]);

    const launcher = inspectLauncherActivities([
      "priority=0 preferredOrder=0 match=0x108000",
      "  ai.alphacompute.alphaphone/.MainActivity",
      "  ai.alphacompute.notes/.NotesActivity",
      "  ai.alphacompute.browser/.BrowserActivity",
      "  org.mozilla.firefox/.App",
      "  com.android.chrome/com.google.android.apps.chrome.Main",
    ].join("\n"));
    expect(launcher.passed).toBe(true);
    expect(launcher.coreActivities).toEqual(["ai.alphacompute.alphaphone/.MainActivity"]);
    expect(launcher.thinAlphaActivities).toEqual([
      "ai.alphacompute.notes/.NotesActivity",
      "ai.alphacompute.browser/.BrowserActivity",
    ]);
    expect(launcher.thirdPartyActivities).toHaveLength(2);
    expect(inspectLauncherActivities("  ai.alphacompute.alphaphone/.MainActivity\n  com.android.chrome/.Main").passed).toBe(false);

    const fullCoreDump = [
      "  userId=10201",
      "  declared permissions:",
      "    ai.alphacompute.permission.AGENT_IPC: prot=signature, INSTALLED",
      "  Provider{ai.alphacompute.alphaphone/.ipc.AlphaPreferencesProvider}",
      "  authority=ai.alphacompute.alphaphone.preferences",
      ...REQUIRED_CORE_COMPONENTS.map((name) => `  component=${name}`),
    ].join("\n");
    const coreOk = inspectCorePackageDump(fullCoreDump);
    expect(coreOk.passed).toBe(true);
    expect(coreOk.missingComponents).toEqual([]);
    expect(extractPackageUid(fullCoreDump)).toBe(10201);

    const weakenedPerm = inspectCorePackageDump(fullCoreDump.replace("prot=signature", "prot=normal"));
    expect(weakenedPerm.passed).toBe(false);
    expect(weakenedPerm.ipcPermissionIsSignature).toBe(false);

    const missingAccessibility = inspectCorePackageDump(
      fullCoreDump.replace("ai.alphacompute.control.AlphaAccessibilityService", ""),
    );
    expect(missingAccessibility.passed).toBe(false);
    expect(missingAccessibility.missingComponents).toEqual(["ai.alphacompute.control.AlphaAccessibilityService"]);

    const ipcOk = inspectCrossAppIpcLog(
      "11-27 00:40:01.120 4120 4120 I AlphaThinApp: event=launch app=notes view=Notes coreSignatureMatch=true prefsConnected=true prefsKeys=2 agentBrokerBound=true agentState=running",
      10201,
      10209,
    );
    expect(ipcOk.passed).toBe(true);
    expect(ipcOk.distinctUids).toBe(true);
    expect(inspectCrossAppIpcLog("I AlphaThinApp: coreSignatureMatch=true prefsConnected=true agentBrokerBound=true", 10201, 10201).passed).toBe(false);
    expect(inspectCrossAppIpcLog("I AlphaThinApp: coreSignatureMatch=false prefsConnected=true agentBrokerBound=true", 10201, 10209).passed).toBe(false);
    expect(inspectCrossAppIpcLog("I AlphaThinApp: coreSignatureMatch=true prefsConnected=false agentBrokerBound=true", 10201, 10209).passed).toBe(false);
    expect(inspectCrossAppIpcLog("I AlphaThinApp: coreSignatureMatch=true prefsConnected=true agentBrokerBound=false", 10201, 10209).passed).toBe(false);

    const enabledSetting = "ai.alphacompute.alphaphone/ai.alphacompute.control.AlphaAccessibilityService";
    const boundDump = [
      `Enabled services:{${enabledSetting}}`,
      `services:{Service[label=Alpha Control, component=${enabledSetting}]}`,
    ].join("\n");
    const android35BoundDump = [
      `Enabled services:{${enabledSetting}}`,
      "Bound services:{Service[label=Alpha Device Control, feedbackType[FEEDBACK_GENERIC], capabilities=161]}",
    ].join("\n");
    expect(inspectAccessibilityDump(boundDump, enabledSetting).passed).toBe(true);
    expect(inspectAccessibilityDump(android35BoundDump, enabledSetting).passed).toBe(true);
    expect(inspectAccessibilityDump(`Enabled services:{${enabledSetting}}\nservices:{}`, enabledSetting).passed).toBe(false);

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-next-avd-home-"));
    try {
      const xdgConfig = path.join(tmpHome, ".config");
      const xdgAvdDir = path.join(xdgConfig, ".android/avd");
      fs.mkdirSync(xdgAvdDir, { recursive: true });
      fs.writeFileSync(path.join(xdgAvdDir, "alpha_next_api35.ini"), "path=/tmp/fake\n", "utf8");
      expect(resolveAndroidAvdHome({ XDG_CONFIG_HOME: xdgConfig }, "alpha_next_api35", tmpHome)).toBe(xdgAvdDir);
      expect(resolveAndroidAvdHome({ ANDROID_AVD_HOME: "/custom/avd", XDG_CONFIG_HOME: xdgConfig }, "alpha_next_api35", tmpHome)).toBe("/custom/avd");
      expect(resolveAndroidAvdHome({ XDG_CONFIG_HOME: xdgConfig }, "other_avd", tmpHome)).toBe(path.join(tmpHome, ".android/avd"));
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }

    const controlLogs = [
      "11-27 01:10:00.100 1000 1000 I AlphaAccessibilityService: event=connected tier=TierAccessibility",
      "11-27 01:10:02.200 1000 1000 I AlphaAccessibilityService: event=observe pkg=com.android.chrome targetKind=AllowedApp protection=ScreenClear nodes=19 snapId=1",
      "11-27 01:10:04.300 1000 1000 I AlphaControlPolicy: event=refuse pkg=com.android.settings targetKind=BlockedApp protection=ScreenClear",
      "11-27 01:10:04.301 1000 1000 I AlphaAccessibilityService: event=observe pkg=com.android.settings targetKind=BlockedApp protection=ScreenClear nodes=0 snapId=2",
    ].join("\n");
    const telemetryOk = inspectControlTelemetry(controlLogs, "com.android.chrome");
    expect(telemetryOk.passed).toBe(true);
    expect(telemetryOk.observedPackage).toBe("com.android.chrome");
    expect(telemetryOk.observedNodes).toBe(19);
    expect(telemetryOk.refusedSettings).toBe(true);
    expect(inspectControlTelemetry(controlLogs.replace("nodes=19", "nodes=0"), "com.android.chrome").passed).toBe(false);
    expect(inspectControlTelemetry(controlLogs.replace("event=refuse pkg=com.android.settings", "event=allow"), "com.android.chrome").passed).toBe(false);

    expect(resolveInstalledBlockedGuards("package:com.android.settings\npackage:com.google.android.permissioncontroller\n")).toEqual({
      present: true,
      packages: ["com.android.settings", "com.google.android.permissioncontroller"],
    });
    expect(resolveInstalledBlockedGuards("package:com.android.settings\npackage:com.android.permissioncontroller\n")).toEqual({
      present: true,
      packages: ["com.android.settings", "com.android.permissioncontroller"],
    });
    expect(resolveInstalledBlockedGuards("package:com.android.settings\n").present).toBe(false);

    expect(assertSafeEmulatorSerial("emulator-5554")).toBe("emulator-5554");
    expect(() => assertSafeEmulatorSerial("67091JEA313850")).toThrow(/non-emulator device/);
    expect(assertSafeEmulatorSerial("67091JEA313850", true)).toBe("67091JEA313850");
    expect(() => assertSafeEmulatorSerial("   ")).toThrow(/without an explicit target serial/);

    expect(inspectVoiceAndOverlayDump(
      "ai.alphacompute.alphaphone/.overlay.AlphaVoiceInteractionService",
      "AlphaVoiceInteractionSessionService\nAlphaOverlayIntakeActivity",
    ).passed).toBe(true);
    expect(inspectVoiceAndOverlayDump(
      "ai.alphacompute.alphaphone/.overlay.AlphaVoiceInteractionService",
      "AlphaOverlayIntakeActivity",
      'A: android:name="ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionSessionService"',
    ).passed).toBe(true);
    expect(inspectVoiceAndOverlayDump(
      "ai.alphacompute.alphaphone/.overlay.AlphaVoiceInteractionService",
      "AlphaOverlayIntakeActivity",
      "",
    ).passed).toBe(false);

    const healthyThinLog = "11-27 15:00:01.000 500 500 I AlphaThinApp: event=launch app=notes coreSignatureMatch=true prefsConnected=true agentBrokerBound=true";
    expect(inspectThinAppLaunchLog(healthyThinLog, "ai.alphacompute.notes", 10201, 10211).passed).toBe(true);
    expect(inspectThinAppLaunchLog(`${healthyThinLog}\nFATAL EXCEPTION: main\nProcess: ai.alphacompute.notes, PID: 500`, "ai.alphacompute.notes", 10201, 10211).passed).toBe(false);
    expect(inspectThinAppLaunchLog(`${healthyThinLog}\nE ActivityManager: ANR in ai.alphacompute.notes`, "ai.alphacompute.notes", 10201, 10211).passed).toBe(false);
  });

  test("alpha-next walkthrough --dry-run plans all 18 views and generates deterministic Alpha Compute storyboard HTML", async () => {
    expect(WALKTHROUGH_VIEWS.map((entry) => entry.view).sort()).toEqual([...ALL_18_VIEWS].sort());

    const dryRun = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "walkthrough", "all", "--dry-run", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: dryRun.io,
    })).toBe(0);
    const parsed = parseJson(dryRun.out()) as { readonly ok: boolean; readonly data: WalkthroughReport };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.mode).toBe("dry-run");
    expect(parsed.data.action).toBe("all");
    expect(parsed.data.plan.viewsCount).toBe(18);
    expect(parsed.data.plan.chapterCount).toBe(8);
    expect(parsed.data.plan.brandAssetsReady).toBe(true);
    expect(parsed.data.plan.playwrightReady).toBe(true);
    expect(parsed.data.plan.ffmpegPath).not.toBeNull();

    const badAction = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "walkthrough", "bogus", "--dry-run", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: badAction.io,
    })).toBe(2);

    const chapters = buildWalkthroughStoryboard(path.join(os.tmpdir(), "alpha-next-walkthrough-nonexistent"));
    expect(chapters).toHaveLength(8);
    const introChapter = chapters[0];
    const overlayChapter = chapters[5];
    expect(introChapter).toBeDefined();
    expect(overlayChapter).toBeDefined();
    const introHtml = buildStoryboardHtml(introChapter, templateRoot);
    expect(introHtml).toContain("Public Sans");
    expect(introHtml).toContain("Fraunces");
    expect(introHtml).toContain("#0000FF");
    expect(introHtml).toContain("window.__seek");
    const overlayHtml = buildStoryboardHtml(overlayChapter, templateRoot);
    expect(overlayHtml).toContain("AGENT_IPC Binder");
  });

  test("alpha-next validate --check --aapt2 passes against the live repository artifacts", async () => {
    const liveValidate = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "validate", "--check", "--aapt2", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: liveValidate.io,
    })).toBe(0);
    const report = parseJson(liveValidate.out()) as { readonly ok: boolean; readonly data: ValidateReport };
    expect(report.ok).toBe(true);
    expect(report.data.status).toBe("pass");
    expect(report.data.presentCount).toBe(report.data.totalCount);
    expect(report.data.totalCount).toBe(30);
    expect(report.data.tokensInSync).toBe(true);
    expect(report.data.manifestValid).toBe(true);
    expect(report.data.securityPassed).toBe(true);
    expect(report.data.aapt2?.passed).toBe(true);
  });

  test("alpha-next gcp-aosp plan and bootstrap-script generate deterministic Pixel 10a build artifacts", async () => {
    const planRec = createRecorder();
    expect(await runCli({
      argv: [
        "alpha-next",
        "gcp-aosp",
        "plan",
        "--project",
        "alpha-demo",
        "--zone",
        "us-central1-a",
        "--machine",
        "c3-standard-44",
        "--bucket",
        "gs://alpha-demo-aosp",
        "--spot",
        "--json",
      ],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: planRec.io,
    })).toBe(0);
    const planPayload = parseJson(planRec.out()) as { readonly ok: boolean; readonly data: GcpAospReport };
    expect(planPayload.ok).toBe(true);
    expect(planPayload.data.plan.aospTag).toBe("android-17.0.0_r1");
    expect(planPayload.data.plan.deviceCodename).toBe("stallion");
    expect(planPayload.data.plan.lunchTarget).toBe("alpha_stallion_phone-cp2a-userdebug");
    expect(planPayload.data.plan.spot).toBe(true);
    expect(planPayload.data.plan.gmsCompatRepos).toHaveLength(3);
    expect(planPayload.data.plan.commands.provision).toContain("--provisioning-model=SPOT");

    const script = renderGcpBootstrapScript(planPayload.data.plan);
    expect(script).toContain("fetch-gmscompat.py");
    expect(script).toContain("suite stage");
    expect(script).toContain("alpha_stallion_phone-cp2a-userdebug");
    expect(script).toContain("sudo shutdown -h now");

    const scriptRec = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "gcp-aosp", "bootstrap-script", "--dry-run", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: scriptRec.io,
    })).toBe(0);
    const scriptPayload = parseJson(scriptRec.out()) as { readonly ok: boolean; readonly data: GcpAospReport };
    expect(scriptPayload.ok).toBe(true);
    expect(scriptPayload.data.bootstrapScript).toContain("android-17.0.0_r1");

    const badAction = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "gcp-aosp", "invalid", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: badAction.io,
    })).toBe(2);
  });

  test("alpha-next pixel-deploy parses installed Pixel state, flags cert/version mismatches, and stays read-only", async () => {
    const parsedCore = parsePixelPackageSummary([
      "Package [ai.alphacompute.alphaphone] (abc):",
      "  codePath=/product/priv-app/AlphaPhone",
      "  versionCode=703 minSdk=29 targetSdk=36",
      "  versionName=0.1.0",
      "  privateFlags=[ PRIVILEGED PRODUCT ]",
      "  Signatures: [22:42:99:4D:2D:23:7F:98:D0:19:27:99:91:57:06:7D:F4:E2:49:5A:8F:98:04:51:AC:3D:E5:D4:06:42:58:4A]",
    ].join("\n"));
    expect(parsedCore.installed).toBe(true);
    expect(parsedCore.versionCode).toBe(703);
    expect(parsedCore.isSystemPrivApp).toBe(true);
    expect(parsedCore.certSha256).toBe("2242994d2d237f98d01927999157067df4e2495a8f980451ac3de5d40642584a");

    const device = {
      serial: "67091JEA313850",
      connected: true,
      deviceCodename: "stallion",
      displayId: "alpha_stallion_phone-userdebug 17 CP2A.260605.016 alpha.v703 test-keys",
      buildType: "userdebug",
      isUserdebug: true,
      bootloaderUnlocked: true,
      verityMode: "enforcing",
      installedCore: parsedCore,
    };
    const localApks = {
      coreApkPath: "apps/app/artifacts/launcher-debug.apk",
      coreVersionCode: 121,
      coreCertSha256: "227ddd0bf51116a69fb6f8f8ceb32ee2df9ed086471bceec4f9a26f48f31d5d5",
      thinApkPaths: ["apps/app/android/suite/out/notes-debug.apk"],
    };
    const compat = evaluatePixelCompatibility(device, localApks);
    expect(compat.directAdbInstallPossible).toBe(false);
    expect(compat.overlayfsRemountAvailable).toBe(true);
    expect(compat.certMismatch).toBe(true);
    expect(compat.versionDowngrade).toBe(true);
    expect(compat.minRequiredVersionCode).toBe(704);

    const steps = buildPixelDeploySteps("67091JEA313850", localApks, compat);
    expect(steps.some((step) => step.includes("disable-verity"))).toBe(true);
    expect(steps.some((step) => step.includes("android.app.role.HOME com.android.launcher3"))).toBe(true);

    const dryRun = createRecorder();
    expect(await runCli({
      argv: ["alpha-next", "pixel-deploy", "--serial", "nonexistent-device-000", "--dry-run", "--json"],
      commands,
      rootDir: templateRoot,
      cwd: templateRoot,
      io: dryRun.io,
    })).toBe(0);
    const payload = parseJson(dryRun.out()) as { readonly ok: boolean; readonly data: PixelDeployReport };
    expect(payload.ok).toBe(true);
    expect(payload.data.mode).toBe("dry-run");
    expect(payload.data.executed).toBe(false);
  });
});
