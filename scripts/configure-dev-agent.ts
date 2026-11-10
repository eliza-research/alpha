#!/usr/bin/env node
/** Install only the per-run loopback bearer into an emulator's debug app sandbox. */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
const serial = process.env.ANDROID_SERIAL ?? '';
const path = process.env.ALPHA_DEV_TOKEN_FILE;
if (!/^emulator-\d+$/.test(serial))
  throw new Error(
    "Set ANDROID_SERIAL to the disposable emulator ID. Physical devices are not supported.",
  );
if (!path)
  throw new Error("Set ALPHA_DEV_TOKEN_FILE to the host server token file.");
const token = (await readFile(path, "utf8")).trim();
if (!/^[A-Za-z0-9_-]{32,256}$/.test(token))
  throw new Error("Invalid loopback bearer format.");
const adb = process.env.ADB || "adb";
function run(args: string[], input?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(adb, ["-s", serial, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.resume();
    child.stderr.resume(); // Never echo input or subprocess output.
    child.on("error", () =>
      reject(new Error("Could not start adb. Set ADB to the SDK adb path.")),
    );
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Emulator configuration failed. Check the debug APK and adb connection.",
            ),
          ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
await run(["reverse", "tcp:47831", "tcp:47831"]);
await run(
  [
    "shell",
    "run-as ai.elizaresearch.alphaphone sh -c 'umask 077; mkdir -p files && cat > files/development-agent-token'",
  ],
  token,
);
await run([
  "shell",
  "run-as ai.elizaresearch.alphaphone chmod 600 files/development-agent-token",
]);
console.log(
  "Development bearer installed in the emulator debug app; loopback port forwarding configured. No production account was connected.",
);
