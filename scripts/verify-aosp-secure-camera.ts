import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifySecureCameraImage, verifySecureCameraSource } from "./aosp-secure-camera-contract.ts";
const args = process.argv.slice(2);
if (args.length === 2 && args[0] === "--aosp-source") {
  console.log(JSON.stringify(verifySecureCameraSource(args[1]), null, 2));
} else {
  if (args.length) throw Error("Use --aosp-source PATH, or no arguments for explicitly selected image checks");
  const serial = process.env.ANDROID_SERIAL;
  if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw Error("Explicit ANDROID_SERIAL required");
  const { androidEnv } = await import("./toolchain.ts");
  const env = androidEnv();
  const run = (...command: any[]) => execFileSync(path.join(env.ANDROID_HOME, "platform-tools/adb"), ["-s", serial, ...command], { encoding: "utf8", env, timeout: 10_000, maxBuffer: 128 << 10 });
  console.log(JSON.stringify(verifySecureCameraImage(run, process.env.ALPHA_ANDROID_USER, process.env.ALPHA_EXPECTED_FINGERPRINT), null, 2));
}
