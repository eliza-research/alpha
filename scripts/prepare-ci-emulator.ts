import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { androidEnv } from "./toolchain.ts";
import { requireHostedFixtureEnvironment, assertFixtureIdentity, prepareFixtureDisplay } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/ci-emulator-display.mjs";

import { captureFixtureDisplayEvidence } from "../vendor/eliza/packages/app/scripts/mobile/android/hosted-fixture/ci-emulator-diagnostics.mjs";

const serial = process.env.ANDROID_SERIAL;
requireHostedFixtureEnvironment(process.env, serial);
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
const run = (...args: any[]) =>
  execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", env, timeout: 20000 });
const identity = JSON.parse(fs.readFileSync("app.config.json",'utf8'));
let booted = false;
for (let attempt = 0; attempt < 120; attempt++) {
  if (run("shell", "getprop", "sys.boot_completed").trim() === "1") {
    booted = true;
    break;
  }
  await new Promise((resolve: any) => setTimeout(resolve, 500));
}
if (!booted) throw new Error("Disposable emulator did not finish booting");
assertFixtureIdentity(run, { fresh: true });
const displayEvidence: unknown[] = [];
const recordDisplay = (state?: unknown) => {
  displayEvidence.push(state);
  fs.mkdirSync("test-results/android-fixture", { recursive: true });
  fs.writeFileSync("test-results/android-fixture/display-admission.json", JSON.stringify({ serial, observations: displayEvidence }, null, 2) + "\n");
};
const recordRawDisplay = (phase: any) => {
  // Diagnostics must never replace the original admission failure.
  try {
    const boundedRun = (args: any, timeout: any) => execFileSync(adb, ["-s", serial, ...args], {
      encoding: "utf8",
      env,
      timeout,
      maxBuffer: 128 * 1024,
    });
    const evidence = captureFixtureDisplayEvidence(boundedRun);
    fs.mkdirSync("test-results/android-fixture", { recursive: true });
    fs.writeFileSync(
      `test-results/android-fixture/display-${phase}.json`,
      JSON.stringify({ serial, ...evidence }, null, 2) + "\n",
    );
  } catch {
    // Existing safety refusal remains authoritative.
  }
};
recordRawDisplay("before-admission");
try {
  const displayOptions = { serial, record: recordDisplay };
  await prepareFixtureDisplay(run, displayOptions);
} catch (error: any) {
  recordRawDisplay("admission-failure");
  throw error;
}

// SDK images initially assign HOME to the temporary SDK setup app. Complete the
// disposable fixture before measuring our app's HOME behavior; this is not a
// production provisioning or device-owner implementation.
run("shell", "settings", "put", "global", "device_provisioned", "1");
run("shell", "settings", "put", "secure", "user_setup_complete", "1");
run("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
const tablet = identity.orientation === "landscape";
run("shell", "wm", "size", tablet ? "1280x800" : "1080x2400");
run("shell", "wm", "density", tablet ? "160" : "420");
const homes = run(
  "shell",
  "cmd",
  "package",
  "query-activities",
  "--brief",
  "-a",
  "android.intent.action.MAIN",
  "-c",
  "android.intent.category.HOME",
);
const stock = homes
  .split("\n")
  .map((line: any) => line.trim())
  .find((line: any) => /^com\.android\.launcher3\//.test(line));
if (!stock)
  throw new Error(`AOSP stock launcher missing from fixture: ${homes}`);
run("shell", "cmd", "package", "set-home-activity", stock);
const holder = run(
  "shell",
  "cmd",
  "role",
  "get-role-holders",
  "android.app.role.HOME",
).trim();
if (holder !== "com.android.launcher3")
  throw new Error(`Fixture HOME is not ready: ${holder}`);
// A booted headless emulator may still be asleep; IME requests then have no
// served window even though the WebView can execute JavaScript.
// This entire AVD is a disposable CI fixture. A plugged-only stay-awake flag
// does not establish that Android currently considers the emulator charging.
// Pin its current user's idle timeout for this bounded emulator session.
const fixtureUser = run("shell", "am", "get-current-user").trim();
if (!/^\d+$/.test(fixtureUser)) throw new Error("Unknown CI fixture user");
const priorTimeout = run("shell", "settings", "--user", fixtureUser, "get", "system", "screen_off_timeout").trim();
if (run("shell", "am", "get-current-user").trim() !== fixtureUser)
  throw new Error("CI fixture user changed before idle configuration");
run("shell", "settings", "--user", fixtureUser, "put", "system", "screen_off_timeout", "2400000");
const installedTimeout = run("shell", "settings", "--user", fixtureUser, "get", "system", "screen_off_timeout").trim();
if (installedTimeout !== "2400000" || run("shell", "am", "get-current-user").trim() !== fixtureUser)
  throw new Error("CI fixture idle configuration not confirmed");
fs.mkdirSync("test-results/android-fixture", { recursive: true });
fs.writeFileSync("test-results/android-fixture/idle-policy.json", JSON.stringify({
  serial, fixtureUser, priorTimeout, installedTimeout, disposableGithubActionsAvd: true,
}, null, 2) + "\n");
console.log(
  `Prepared disposable ${tablet ? "tablet" : "phone"} fixture; original HOME: ${holder}`,
);
