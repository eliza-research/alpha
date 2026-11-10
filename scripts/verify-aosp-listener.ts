// Read-only check of the always-on listener on a booted Alpha image (issue #424).
// Usage: node scripts/verify-aosp-listener.ts --serial SERIAL --user USER_ID
// Reports package-manager facts only; the indicator, invocation and lock-screen behaviour are
// manual device acceptance (docs/adr/0001-privileged-listener.md).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { androidEnv } from "./toolchain.ts";
import { verifyAospListener } from "./aosp-listener.ts";

const args = process.argv.slice(2);
const get = (key: string) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const serial = get("--serial");
if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw Error("Explicit --serial required");
const env = androidEnv();
const adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
const run = (...command: string[]) => execFileSync(adb, ["-s", serial, ...command], { encoding: "utf8", env, timeout: 10_000, maxBuffer: 4 << 20 });
const { appId } = JSON.parse(fs.readFileSync("app.config.json", "utf8"));
console.log(JSON.stringify(verifyAospListener(run, get("--user"), appId), null, 2));
