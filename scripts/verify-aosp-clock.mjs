import path from "node:path";
import { execFileSync } from "node:child_process";
import { androidEnv } from "./toolchain.mjs";
import { verifyAospClockHandlers } from "./aosp-clock-contract.mjs";

const serial = process.env.ANDROID_SERIAL;
if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw Error("Explicit ANDROID_SERIAL required");
// The shared admission refuses an unbound image; name the variable that binds it here.
if (!process.env.ALPHA_EXPECTED_IMAGE_FINGERPRINT?.trim()) throw Error("Explicit expected image fingerprint required (ALPHA_EXPECTED_IMAGE_FINGERPRINT)");
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
const run = (...args) => execFileSync(adb, ["-s", serial, ...args], {
  encoding: "utf8", env, timeout: 10_000, maxBuffer: 128 * 1024,
});
console.log(JSON.stringify(verifyAospClockHandlers(run, process.env.ALPHA_ANDROID_USER, process.env.ALPHA_EXPECTED_IMAGE_FINGERPRINT), null, 2));
