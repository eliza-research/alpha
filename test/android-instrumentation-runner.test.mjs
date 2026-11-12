// Runner policy and result parsing on synthetic `am instrument` output. Not emulator evidence.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { instrumentationClassResults, listedInstrumentationTests, writeInstrumentationRecord } from "../scripts/instrumentation-result.ts";
import { admitApks, admitHome, CLASS_REGISTRY, DEFAULT_CLASSES, instrumentArgs, parseInstrumentationArgs, PACKAGE, readHome, restoreHome, runLeased, selectAlphaHome } from "../scripts/android-instrumentation.ts";

const C = name => `${PACKAGE}.${name}InstrumentedTest`;
const block = (cls, method, code, numtests = 1) =>
  `INSTRUMENTATION_STATUS: class=${cls}\nINSTRUMENTATION_STATUS: current=1\nINSTRUMENTATION_STATUS: id=AndroidJUnitRunner\nINSTRUMENTATION_STATUS: numtests=${numtests}\nINSTRUMENTATION_STATUS: test=${method}\nINSTRUMENTATION_STATUS_CODE: ${code}\n`;
const done = (summary = "OK (1 test)") => `INSTRUMENTATION_RESULT: stream=\n\nTime: 1\n\n${summary}\n\nINSTRUMENTATION_CODE: -1\n`;

test("per-class results keep going past a failing class and never count skips as passes", () => {
  const output = block(C("Shell"), "a", 1, 4) + block(C("Shell"), "a", 0, 4)
    + block(C("NoMockProduct"), "b", 1, 4) + block(C("NoMockProduct"), "b", -2, 4)
    + block(C("TextScale"), "c", 1, 4) + block(C("TextScale"), "c", 0, 4)
    + block(C("TextScale"), "d", 1, 4) + block(C("TextScale"), "d", -4, 4)
    + block(C("BrowserFlow"), "e", 1, 4) + block(C("BrowserFlow"), "e", -4, 4)
    + done("FAILURES!!!\nTests run: 4,  Failures: 1");
  const { results, runFailure } = instrumentationClassResults(output, [C("Shell"), C("NoMockProduct"), C("TextScale"), C("BrowserFlow"), C("Rotation")]);
  assert.equal(runFailure, false);
  const status = Object.fromEntries(results.map(row => [row.class.split(".").pop(), row.status]));
  assert.deepEqual(status, {
    BrowserFlowInstrumentedTest: "skipped", NoMockProductInstrumentedTest: "failed", RotationInstrumentedTest: "missing",
    ShellInstrumentedTest: "passed", TextScaleInstrumentedTest: "passed",
  });
  assert.deepEqual(results.find(row => row.class === C("TextScale")).ignored, ["d"]);
});

test("a crash or missing terminal result fails the class that was running", () => {
  const crashed = block(C("Shell"), "a", 1) + "INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n";
  const { results, crashedIn } = instrumentationClassResults(crashed, [C("Shell")]);
  assert.equal(crashedIn, C("Shell"));
  assert.equal(results[0].status, "failed");
  assert.equal(instrumentationClassResults(block(C("Shell"), "a", 1) + block(C("Shell"), "a", 0), [C("Shell")]).results[0].status, "failed", "no INSTRUMENTATION_CODE");
  assert.throws(() => instrumentationClassResults("", ["bad class"]));
});

test("log-only listing enumerates tests without executing them", () => {
  const listed = listedInstrumentationTests(block(C("Shell"), "a", 1) + block(C("Shell"), "a", 0) + block(C("Shell"), "b", 1) + block(C("Shell"), "b", 0) + done());
  assert.deepEqual(listed, [`${C("Shell")}#a`, `${C("Shell")}#b`]);
});

test("records bind commit and APK hashes, are emulator class E and refuse overwrite", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-instr-"));
  try {
    const file = path.join(dir, "results.json");
    const apks = [{ variant: "standalone", role: "app", sha256: "a".repeat(64) }, { variant: "standalone", role: "test", sha256: "b".repeat(64) }];
    const classes = [{ variant: "standalone", class: C("Shell"), status: "passed" }, { variant: "standalone", class: C("BrowserFlow"), status: "skipped" }];
    assert.throws(() => writeInstrumentationRecord(file, { commit: "abc", apks, classes }), /commit/);
    assert.throws(() => writeInstrumentationRecord(file, { commit: "c".repeat(40), apks: [{ variant: "x", role: "app", sha256: "z" }], classes }), /SHA-256/);
    const body = writeInstrumentationRecord(file, { commit: "c".repeat(40), apks, classes });
    assert.equal(body.evidenceClass, "E");
    assert.ok(body.notEvidenceFor.includes("physical-device acceptance"));
    assert.equal(body.passed, false, "a skipped class is not a pass");
    assert.throws(() => writeInstrumentationRecord(file, { commit: "c".repeat(40), apks, classes }), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("argument policy: short names, campaigns refused with their runner, clock and test-mocks gates", () => {
  const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "a", "--classes", "NoMockProduct,Shell,StartupReadiness"]);
  assert.deepEqual(options.classes, [C("NoMockProduct"), C("Shell"), C("StartupReadiness")]);
  assert.equal(options.apkDir, "artifacts");
  assert.deepEqual(options.variants, ["standalone", "launcher"]);
  assert.equal(parseInstrumentationArgs([]).classes.length, DEFAULT_CLASSES.length);
  assert.equal(parseInstrumentationArgs(["--test-mocks"]).apkDir, "artifacts/test-mocks");
  for (const name of ["ResidentEgressRedaction", "ReminderTapProcessDeath", "WorkflowNoticeProcessDeath", "NotificationChannels", "VoicePermissionDenied", "VoicePermissionRevoke", "LocalVoiceRecordingLimit"])
    assert.throws(() => parseInstrumentationArgs(["--classes", name]), /own campaign/);
  // Classes that assume a test-mocks app build are refused without it instead of reporting "skipped".
  assert.throws(() => parseInstrumentationArgs(["--classes", "ConnectionChooser"]), /test-mocks app build/);
  assert.equal(parseInstrumentationArgs(["--test-mocks", "--classes", "ConnectionChooser"]).classes[0], C("ConnectionChooser"));
  // HOME-role classes never run (and so never skip) outside the opt-in phase.
  for (const name of ["LauncherHome", "SettingsRoles"]) assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--classes", name]), /--home-role/);
  assert.deepEqual(parseInstrumentationArgs(["--owned-emulator", "--home-role", "--classes", "SettingsRoles,LauncherHome"]).classes, [C("SettingsRoles"), C("LauncherHome")]);
  assert.throws(() => parseInstrumentationArgs(["--home-role", "--classes", "LauncherHome"]), /requires --owned-emulator/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--variants", "standalone", "--classes", "LauncherHome"]), /launcher variant/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--classes", "Shell"]), /no requested class uses the HOME role/);
  assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--home-role", "--all"]), /cannot be combined with --all/);
  assert.deepEqual(instrumentArgs(C("BrowserPageQuestion")).slice(-6, -1), ["browserPageQuestion", "1", "-e", "class", C("BrowserPageQuestion")]);
  assert.throws(() => parseInstrumentationArgs(["--classes", "RealClock"]), /clock-exclusive/);
  assert.equal(parseInstrumentationArgs(["--classes", "RealClock", "--clock-exclusive"]).classes[0], C("RealClock"));
  assert.throws(() => parseInstrumentationArgs(["--classes", "BrowserAutofill"]), /test-mocks/);
  assert.throws(() => parseInstrumentationArgs(["--all", "--classes", "Shell"]));
  assert.throws(() => parseInstrumentationArgs(["--variants", "standalone,standalone"]));
  assert.throws(() => parseInstrumentationArgs(["--classes", "Shell;id"]));
  assert.throws(() => parseInstrumentationArgs(["--bogus"]));
  const args = instrumentArgs(C("StartupReadiness"));
  assert.deepEqual(args.slice(-6, -1), ["startupReadiness", "1", "-e", "class", C("StartupReadiness")]);
  assert.ok(args.includes("startupReadiness") && args.at(-1) === `${PACKAGE}.test/androidx.test.runner.AndroidJUnitRunner`);
  assert.deepEqual(CLASS_REGISTRY.HostedProcessRestart.phases.length, 3);
});

test("APK admission binds the app to the verify-apks manifest and the test APK to its recorded hash", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-instr-apk-"));
  try {
    const sha = bytes => createHash("sha256").update(bytes).digest("hex");
    fs.mkdirSync(path.join(dir, "instrumentation"));
    fs.writeFileSync(path.join(dir, "standalone-debug.apk"), "app");
    fs.writeFileSync(path.join(dir, "instrumentation/standalone-androidTest.apk"), "test");
    const manifest = { testMocks: false, results: [{ variant: "standalone", mode: "debug", sha256: sha("app"), versionCode: 7 }], instrumentation: { standalone: { sha256: sha("test") } } };
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
    const [app, testApk] = admitApks(dir, "standalone", { testMocks: false });
    assert.equal(app.sha256, sha("app"));
    assert.equal(testApk.sha256, sha("test"));
    assert.throws(() => admitApks(dir, "standalone", { testMocks: true }), /testMocks/);
    // A test APK the manifest does not record is not bound to this app build.
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify({ ...manifest, instrumentation: {} }));
    assert.throws(() => admitApks(dir, "standalone", { testMocks: false }), /instrumentation APK recorded/);
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(dir, "standalone-debug.apk"), "changed");
    assert.throws(() => admitApks(dir, "standalone", { testMocks: false }), /does not match/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const javaFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? javaFiles(file) : file.endsWith(".java") ? [file] : [];
});

/** A scripted emulator: role state, installs and instrumentation output, with every command recorded. */
function fakeEmulator({ stock = "com.android.launcher3", mode = "pass" } = {}) {
  const state = { holder: stock, activity: `${stock}/.Launcher`, installed: new Map(), users: new Map(), commands: [] };
  const sha = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const adb = args => {
    state.commands.push(args.join(" "));
    const text = args.join(" ");
    if (text === "emu avd name") return "fixture-avd\nOK\n";
    if (text.includes("getprop ro.product.cpu.abi")) return "arm64-v8a\n";
    if (text.includes("getprop ro.build.version.sdk")) return "35\n";
    if (text.includes("getprop")) return "1\n";
    // Packages made available to a secondary user, tracked per user.
    const perUser = /^shell (?:cmd package install-existing|pm uninstall|pm list packages) --user (\d+)(?: (\S+))?$/.exec(text);
    if (perUser && perUser[1] !== "0" && !text.includes("--user all")) {
      const held = state.users.get(perUser[1]) ?? state.users.set(perUser[1], new Set()).get(perUser[1]);
      if (text.includes("install-existing")) { held.add(perUser[2]); return `Package ${perUser[2]} installed for user: ${perUser[1]}\n`; }
      if (text.includes("pm uninstall")) { held.delete(perUser[2]); return "Success\n"; }
      return [...held].map(name => `package:${name}`).join("\n");
    }
    if (text.includes("pm list packages")) return [...state.installed.keys()].map(name => `package:${name}`).join("\n");
    if (text.includes("am get-current-user")) return mode === "secondary-user" ? "10\n" : "0\n";
    if (text.includes("get-role-holders")) return `${state.holder}\n`;
    if (text.includes("resolve-activity")) return `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${state.activity}\n`;
    if (args[0] === "install") { const file = args.at(-1); state.installed.set(file.includes("androidTest") ? `${PACKAGE}.test` : PACKAGE, sha(file)); return "Success\n"; }
    if (text.includes("pm path")) return `package:/data/app/${args.at(-1)}.apk\n`;
    if (text.includes("sha256sum")) return `${state.installed.get(path.basename(args.at(-1), ".apk"))}  ${args.at(-1)}\n`;
    if (args[0] === "uninstall") { state.installed.delete(args[1]); return "Success\n"; }
    if (text.includes("set-home-activity")) {
      const component = args.at(-1);
      if (mode === "select-fails" && component.startsWith(PACKAGE)) return "";
      if (mode === "restore-fails" && !component.startsWith(PACKAGE)) return "";
      state.activity = component; state.holder = component.split("/")[0]; return "Success\n";
    }
    if (text.includes("add-role-holder")) { if (mode !== "restore-fails") { state.holder = args.at(-1); state.activity = `${state.holder}/.Launcher`; } return ""; }
    if (text.includes("dumpsys activity activities")) return `  topResumedActivity=ActivityRecord{1 u0 ${mode === "home-not-resumed" ? `${stock}/.Launcher` : state.activity} t1}\n`;
    if (text.includes("am instrument")) {
      const cls = args[args.indexOf("class") + 1].split("#")[0]; // A phase names one method of the class.
      // A role-requesting class that forgets to restore leaves Alpha as HOME.
      if (mode === "requests-leaves-home" && cls === C("SettingsRoles") && !args.includes("log")) { state.holder = PACKAGE; state.activity = `${PACKAGE}/.MainActivity`; }
      // -3 is an assumption failure: every method of the class skipped by its own gate.
      if (mode === "all-skipped" && cls === C("BrowserDownload")) return block(cls, "m", 1) + block(cls, "m", -3) + done();
      return block(cls, "m", 1) + block(cls, "m", 0) + done();
    }
    return "";
  };
  return { state, adb };
}
function apkDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-home-role-"));
  const sha = bytes => createHash("sha256").update(bytes).digest("hex");
  fs.mkdirSync(path.join(dir, "instrumentation"));
  const manifest = { testMocks: false, results: [], instrumentation: {} };
  for (const variant of ["standalone", "launcher"]) {
    fs.writeFileSync(path.join(dir, `${variant}-debug.apk`), `${variant} app`);
    fs.writeFileSync(path.join(dir, `instrumentation/${variant}-androidTest.apk`), `${variant} test`);
    manifest.results.push({ variant, mode: "debug", sha256: sha(`${variant} app`), versionCode: 7 });
    manifest.instrumentation[variant] = { sha256: sha(`${variant} test`) };
  }
  fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify(manifest));
  return dir;
}
// Synthetic emulator evidence uses its own Git source, never the live checkout's
// aliases or dirty state. Production sourceCommit admission remains unchanged.
async function runFixture(dir, input) {
  execFileSync("git", ["init", "--quiet", dir]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Runner fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "Synthetic runner source"]);
  const previous = process.cwd();
  process.chdir(dir);
  try { return await runLeased(input); }
  finally { process.chdir(previous); }
}
const timing = { sleep: () => {}, attempts: 2 };
async function homeRun(mode, extra = []) {
  const dir = apkDir(), emulator = fakeEmulator({ mode });
  try {
    const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "fixture-avd", "--serial", "emulator-5554", "--home-role", "--classes", "Shell,LauncherHome,SettingsRoles", "--apk-dir", dir, "--output", path.join(dir, "out"), ...extra]);
    let result, error;
    try { result = await runFixture(dir, { options, serial: "emulator-5554", adb: emulator.adb, timing }); } catch (failure) { error = failure; }
    const recovery = path.join(dir, "out/home-role-recovery.json");
    return { result, error, ...emulator, recovery: fs.existsSync(recovery) ? JSON.parse(fs.readFileSync(recovery, "utf8")) : null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const stepsOf = commands => commands.flatMap(command => {
  if (command.startsWith("install")) return [`install ${/(standalone|launcher)-(debug|androidTest)/.exec(command)[0]}`];
  if (command.startsWith("uninstall")) return [command];
  if (command.includes("am instrument") && !command.includes("-e log true")) return [`run ${/alphaphone\.([A-Za-z]+)InstrumentedTest/.exec(command)[1]}`];
  if (command.includes("set-home-activity")) return [`home ${command.split(" ").at(-1)}`];
  if (command.includes("add-role-holder")) return [`role ${command.split(" ").at(-1)}`];
  if (command.includes("KEYCODE_HOME")) return ["HOME key"];
  if (command.includes("am force-stop")) return ["force-stop"];
  return [];
});

test("HOME role phase selects the launcher APK, runs the HOME classes and restores the original holder before uninstalling", async () => {
  const { result, error, state } = await homeRun("pass");
  assert.ifError(error);
  assert.deepEqual(stepsOf(state.commands), [
    // Standalone: only the classes that do not need HOME; LauncherHome and SettingsRoles are not run, so they cannot skip.
    "install standalone-debug", "install standalone-androidTest", "run Shell", `uninstall ${PACKAGE}.test`, `uninstall ${PACKAGE}`,
    // Launcher: ordinary classes, then the class that requests the role itself, then selection and a cold HOME start.
    "install launcher-debug", "install launcher-androidTest", "run Shell", "run SettingsRoles",
    `home ${PACKAGE}/.MainActivity`, "force-stop", "HOME key", "run LauncherHome",
    // The original holder is put back while Alpha is still installed, and only then is Alpha removed.
    "role com.android.launcher3", "home com.android.launcher3/.Launcher", `uninstall ${PACKAGE}.test`, `uninstall ${PACKAGE}`,
  ]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.homeRole, { user: "0", original: { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" }, selected: true,
    coldHome: { resumed: true }, restored: true, after: { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" } });
  assert.deepEqual(result.classes.map(row => `${row.variant}:${row.class.split(".").pop()}:${row.status}`), [
    "standalone:ShellInstrumentedTest:passed", "launcher:ShellInstrumentedTest:passed", "launcher:SettingsRolesInstrumentedTest:passed", "launcher:LauncherHomeInstrumentedTest:passed"]);
  assert.equal(state.holder, "com.android.launcher3");
  assert.equal(state.installed.size, 0);
});

test("HOME role phase fails and keeps the installation when the original holder cannot be proven restored", async () => {
  const { result, state, recovery } = await homeRun("restore-fails");
  assert.equal(result.passed, false, "every class passed, but the run is not a pass");
  assert.equal(result.homeRole.restored, false);
  assert.deepEqual(result.homeRole.after.holders, [PACKAGE]);
  assert.ok(!stepsOf(state.commands).slice(stepsOf(state.commands).indexOf("run LauncherHome")).some(step => step.startsWith("uninstall")), "nothing is uninstalled after an unproven restoration");
  assert.deepEqual([...state.installed.keys()].sort(), [PACKAGE, `${PACKAGE}.test`]);
  assert.deepEqual(recovery.retainedPackages.sort(), [PACKAGE, `${PACKAGE}.test`]);
  assert.equal(recovery.recover, "adb -s emulator-5554 shell cmd role add-role-holder --user 0 android.app.role.HOME com.android.launcher3");
  assert.deepEqual(recovery.original, { holders: ["com.android.launcher3"], activity: "com.android.launcher3/.Launcher" });
});

test("HOME role phase reports a failed selection or cold start as missing HOME classes and still restores", async () => {
  for (const mode of ["select-fails", "home-not-resumed"]) {
    const { result, state } = await homeRun(mode);
    assert.equal(result.passed, false, mode);
    const launcherHome = result.classes.find(row => row.class === C("LauncherHome"));
    assert.equal(launcherHome.status, "missing", mode);
    assert.match(launcherHome.note, /HOME role phase failed/);
    assert.ok(!stepsOf(state.commands).includes("run LauncherHome"), `${mode}: HOME classes must not run without Alpha as HOME`);
    assert.equal(result.homeRole.restored, true, mode);
    assert.equal(state.holder, "com.android.launcher3", mode);
    assert.equal(state.installed.size, 0, mode);
    assert.match(result.homeRole.error, mode === "select-fails" ? /not selected as HOME/ : /did not bring Alpha to the foreground/);
  }
  // A role-requesting class that leaves HOME changed stops the phase before selection; the original is restored.
  const left = await homeRun("requests-leaves-home");
  assert.equal(left.result.passed, false);
  assert.match(left.result.homeRole.error, /did not restore it/);
  assert.equal(left.result.homeRole.selected, false);
  assert.ok(!stepsOf(left.state.commands).includes("run LauncherHome"));
  assert.equal(left.result.homeRole.restored, true, "the runner puts the original holder back even though it never selected Alpha itself");
  assert.equal(left.state.holder, "com.android.launcher3");
  assert.equal(left.recovery, null);
  assert.equal(left.state.installed.size, 0);
});

test("HOME role admission refuses an emulator without one stock HOME holder, and a secondary foreground user", async () => {
  await assert.rejects(async () => { const { error } = await homeRun("secondary-user"); throw error; }, /primary user/);
  const none = fakeEmulator(); none.state.holder = ""; assert.throws(() => admitHome(none.adb), /one stock HOME app/);
  const alpha = fakeEmulator(); alpha.state.holder = PACKAGE; alpha.state.activity = `${PACKAGE}/.MainActivity`; assert.throws(() => admitHome(alpha.adb), /one stock HOME app/);
  const ready = fakeEmulator();
  const home = admitHome(ready.adb);
  assert.deepEqual(readHome(ready.adb, "0"), home.original);
  // Restoring a HOME that was never selected changes nothing and only reads it back.
  const before = ready.state.commands.length;
  assert.equal(restoreHome(ready.adb, home, timing).restored, true);
  assert.ok(ready.state.commands.slice(before).every(command => /get-role-holders|resolve-activity/.test(command)));
  selectAlphaHome(ready.adb, home, timing);
  assert.equal(ready.state.holder, PACKAGE);
  assert.equal(restoreHome(ready.adb, home, timing).restored, true);
  assert.equal(ready.state.holder, "com.android.launcher3");
});

test("classes that assert a secondary user run in a disposable user the runner creates and removes", async () => {
  // First run: HostedProcessRestart (then a default class) and HostedBackgroundWorker received their
  // gates in user 0 and failed on "Disposable secondary user required". Run in that user (round 7)
  // they answered "HTTPS required": their loopback HTTP fixture is admitted by a test-mocks app build only.
  for (const name of ["HostedProcessRestart", "HostedBackgroundWorker"]) {
    assert.equal(CLASS_REGISTRY[name].secondaryUser, true);
    assert.equal(CLASS_REGISTRY[name].requiresTestMocksBuild, true);
    assert.throws(() => parseInstrumentationArgs(["--owned-emulator", "--classes", name]), /needs a test-mocks app build/);
    assert.throws(() => parseInstrumentationArgs(["--test-mocks", "--classes", name]), /requires --owned-emulator/);
    assert.ok(!DEFAULT_CLASSES.includes(name), `${name} needs a test-mocks build, so it cannot be a default class`);
  }
  assert.doesNotThrow(() => parseInstrumentationArgs([]));
  const run = async ({ lifecycle, classes = "Shell,HostedProcessRestart,HostedBackgroundWorker" }) => {
    const dir = apkDir(), emulator = fakeEmulator();
    // A test-mocks archive keeps both APKs beside the manifest.
    for (const variant of ["standalone", "launcher"]) fs.copyFileSync(path.join(dir, `instrumentation/${variant}-androidTest.apk`), path.join(dir, `${variant}-androidTest.apk`));
    fs.writeFileSync(path.join(dir, "apk-manifest.json"), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, "apk-manifest.json"), "utf8")), testMocks: true }));
    try {
      const options = parseInstrumentationArgs(["--owned-emulator", "--avd", "fixture-avd", "--serial", "emulator-5554", "--test-mocks", "--variants", "standalone", "--classes", classes, "--apk-dir", dir, "--output", path.join(dir, "out")]);
      let result, error;
      try { result = await runFixture(dir, { options, serial: "emulator-5554", adb: emulator.adb, timing, withSecondaryUser: lifecycle }); } catch (failure) { error = failure; }
      return { result, error, commands: emulator.state.commands };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  // The lifecycle the upstream helper provides: a user, the callback, then removal only with cleanup proof.
  const created = [];
  const lifecycle = async ({ name, record, run: body }) => {
    created.push(name); record({ user: 10, ownerRestored: false, removed: false });
    const proof = await body({ user: 10 });
    assert.equal(proof.cleaned, true, "the phase proves the user holds none of this run's packages");
    return { user: 10, ownerRestored: true, removed: true };
  };
  const passed = await run({ lifecycle });
  assert.equal(passed.error, undefined);
  assert.equal(passed.result.passed, true, JSON.stringify([passed.result.secondaryUsers, passed.result.classes.map(row => [row.class, row.status, row.note])]));
  assert.deepEqual(passed.result.secondaryUsers, [{ variant: "standalone", user: 10, ownerRestored: true, removed: true }]);
  assert.match(created[0], /^instrumentation-standalone-\d+$/);
  const rows = Object.fromEntries(passed.result.classes.map(row => [row.class.split(".").at(-1), row.user]));
  assert.deepEqual(rows, { ShellInstrumentedTest: undefined, HostedProcessRestartInstrumentedTest: "secondary", HostedBackgroundWorkerInstrumentedTest: "secondary" });
  const inUser = passed.commands.filter(command => command.includes("--user 10"));
  assert.ok(inUser.indexOf(`shell cmd package install-existing --user 10 ${PACKAGE}`) < inUser.findIndex(command => command.includes("am instrument --user 10")), "packages reach the user before any class runs");
  assert.ok(inUser.includes(`shell cmd package install-existing --user 10 ${PACKAGE}.test`));
  assert.equal(inUser.filter(command => command.includes("am instrument --user 10") && !command.includes("-e log true") && command.includes("HostedProcessRestart")).length, 3, "each phase is its own instrumentation process in that user");
  assert.ok(inUser.includes(`shell pm clear --user 10 ${PACKAGE}`));
  assert.deepEqual(inUser.filter(command => command.startsWith("shell pm uninstall")), [`shell pm uninstall --user 10 ${PACKAGE}.test`, `shell pm uninstall --user 10 ${PACKAGE}`]);
  // The class that runs in user 0 never receives the user argument.
  assert.ok(passed.commands.filter(command => command.includes("Shell")).every(command => !command.includes("--user 10")));
  // A user that is not proven removed fails the run and names the classes that did not run.
  const kept = await run({ lifecycle: async ({ record }) => { record({ user: 11, ownerRestored: false, removed: false }); throw new Error("Owned user cleanup deferred; recover explicitly"); } });
  assert.equal(kept.result.passed, false);
  assert.equal(kept.result.secondaryUsers[0].removed, false);
  assert.match(kept.result.secondaryUsers[0].error, /cleanup deferred/);
  assert.ok(kept.result.classes.filter(row => row.user === "secondary").every(row => row.status === "missing" && /secondary user phase failed/.test(row.note)));
  // Without the lifecycle (a caller that holds no lease) nothing is installed.
  const none = await run({ lifecycle: undefined });
  assert.match(none.error?.message ?? "", /disposable user lifecycle/);
  assert.ok(!none.commands.some(command => command.startsWith("install")));
});

