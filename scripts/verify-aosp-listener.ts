// Read-only check of the always-on listener on a booted Alpha image (issue #424).
// Usage: node scripts/verify-aosp-listener.ts --serial SERIAL --user USER_ID [--launcher-descriptor FILE]
// Reports package-manager and SELinux observations. Indicator, invocation and device acceptance
// require separate evidence.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { androidEnv } from "./toolchain.ts";
import { verifyAospListener } from "./aosp-listener.ts";
import { LAUNCHER_PRIVILEGED_PERMISSIONS } from "./stage-aosp.ts";

type ReadAdb = (...command: string[]) => string;

export function verifyListenerBoot(run: ReadAdb, user: string, appId: string, launcherPrivileged = false) {
  const verified = verifyAospListener(run, user, appId, {launcherPrivileged});
  const {packageName} = verified;
  const packages = run("shell", "pm", "list", "packages", "-s", "-U", "--user", user, packageName);
  const uidEntries = packages.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .filter(([name]) => name === `package:${packageName}`);
  const uid = uidEntries.length === 1 && uidEntries[0].length === 2
    ? /^uid:(\d+)$/.exec(uidEntries[0][1])?.[1] : undefined;
  if (!uid) throw Error(`Cannot read the exact UID for ${packageName} in user ${user}`);

  let processTable: string;
  try {
    processTable = run("shell", "toybox", "ps", "-u", uid, "-n", "-w", "-o", "LABEL,UID,PID,NAME");
  } catch (error) {
    // Toybox exits 1 with only the header when no processes match the UID.
    if (!(error instanceof Error) || !("status" in error) || error.status !== 1 ||
        !("stdout" in error) || typeof error.stdout !== "string" ||
        !/^LABEL\s+UID\s+PID\s+NAME$/.test(error.stdout.trim()) ||
        !("stderr" in error) || typeof error.stderr !== "string" || error.stderr.trim()) throw error;
    processTable = error.stdout;
  }
  const processes = processTable.split(/\r?\n/).flatMap(line => {
      const [context, processUid, pid, name] = line.trim().split(/\s+/);
      if (processUid !== uid || !/^[1-9]\d*$/.test(pid ?? "") ||
          !(name === packageName || name?.startsWith(`${packageName}:`))) return [];
      const domain = /^u:r:([a-zA-Z0-9_]+):s0(?::c\d+(?:[,.]c\d+)*)?$/.exec(context)?.[1] ?? null;
      return [{pid: Number(pid), name, domain}];
    });
  return {
    ...verified,
    privappPermissionsEnforced: run("shell", "getprop", "ro.control_privapp_permissions").trim() === "enforce",
    selinuxEnforcing: run("shell", "getenforce").trim() === "Enforcing",
    listenerProcesses: processes,
    dedicatedDomainObserved: processes.some(process => process.name === packageName) &&
      processes.every(process => process.domain === "alpha_sense_app"),
  };
}

function main(args: string[]) {
  const allowed = new Set(["--serial", "--user", "--launcher-descriptor"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!allowed.has(key) || seen.has(key) || !value || value.startsWith("--"))
      throw Error("Use --serial SERIAL --user USER_ID [--launcher-descriptor FILE]");
    seen.add(key);
  }
  const get = (key: string) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
  const serial = get("--serial"), user = get("--user"), descriptorPath = get("--launcher-descriptor");
  if (!serial || !/^[A-Za-z0-9_.:-]+$/.test(serial)) throw Error("Explicit --serial required");
  if (!user || !/^(0|[1-9]\d*)$/.test(user)) throw Error("Explicit Android user required");
  const {appId} = JSON.parse(fs.readFileSync("app.config.json", "utf8"));
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) throw Error("Invalid Alpha package name");
  let launcherPrivileged = false;
  if (descriptorPath) {
    const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
    if (descriptor.packageName !== appId) throw Error("Launcher descriptor names another product");
    if (descriptor.privilegedPermissions !== undefined) {
      if (JSON.stringify(descriptor.privilegedPermissions) !== JSON.stringify(LAUNCHER_PRIVILEGED_PERMISSIONS))
        throw Error("Launcher descriptor requests an unreviewed privileged permission set");
      launcherPrivileged = true;
    }
  }
  const env = androidEnv();
  const adb = path.join(env.ANDROID_HOME, "platform-tools/adb");
  const run: ReadAdb = (...command) => execFileSync(adb, ["-s", serial, ...command], {encoding: "utf8", env, timeout: 10_000, maxBuffer: 4 << 20});
  console.log(JSON.stringify(verifyListenerBoot(run, user, appId, launcherPrivileged), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
