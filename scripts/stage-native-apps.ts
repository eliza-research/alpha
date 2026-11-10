import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { androidEnv, tool } from "./toolchain.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options: Record<string, string | undefined> = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!["--apk-dir", "--output"].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith("--"))
    throw new Error("Use --apk-dir APPROVED_APK_DIRECTORY --output NEW_DIRECTORY (existing parent required).");
  options[key] = args[i + 1];
}
if (!options["--apk-dir"] || !options["--output"])
  throw new Error("Supply both --apk-dir and --output. No downloads are performed.");
const input = fs.realpathSync(options["--apk-dir"]);
const requested = path.resolve(options["--output"]);
const output = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
const upstream = fs.realpathSync(path.join(root, "vendor/eliza"));
if (output === upstream || output.startsWith(upstream + path.sep))
  throw new Error("Output must be outside the pinned upstream checkout.");
if (fs.existsSync(output)) throw new Error("Output already exists; choose a new directory.");
type NativeApp = {
  moduleName: string;
  filename: string;
  developmentOnly?: boolean;
  sha256: string;
  certificateSha256: string;
  packageName: string;
  versionCode: string;
  versionName: string;
};
const manifest: {schemaVersion: number; apps: NativeApp[]} = JSON.parse(fs.readFileSync(path.join(root, "config/native-apps.json"), "utf8"));
if (manifest.schemaVersion !== 1 || manifest.apps.length !== 3)
  throw new Error("Unexpected native distribution manifest.");
const env = androidEnv();
const staging = fs.mkdtempSync(path.join(path.dirname(output), ".alpha-native-apps-"));
try {
  fs.mkdirSync(path.join(staging, "prebuilts"));
  fs.mkdirSync(path.join(staging, "verification"));
  for (const app of manifest.apps) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(app.moduleName) || path.basename(app.filename) !== app.filename || app.developmentOnly)
      throw new Error("Invalid or development-only app in distribution manifest.");
    const dest = path.join(staging, "prebuilts", `${app.moduleName}.apk`);
    fs.copyFileSync(path.join(input, app.filename), dest, fs.constants.COPYFILE_EXCL);
    const hash = createHash("sha256").update(fs.readFileSync(dest)).digest("hex");
    if (hash !== app.sha256) throw new Error(`${app.moduleName}: APK SHA-256 mismatch.`);
    const certs = execFileSync(tool("apksigner"), ["verify", "--verbose", "--print-certs", dest], { encoding: "utf8", env });
    const signers = [...certs.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]+)/g)].map(m => m[1].toLowerCase());
    if (signers.length !== 1 || signers[0] !== app.certificateSha256)
      throw new Error(`${app.moduleName}: verified signing certificate mismatch.`);
    const badging = execFileSync(tool("aapt"), ["dump", "badging", dest], { encoding: "utf8", env });
    const actual = /package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/.exec(badging);
    if (!actual || actual[1] !== app.packageName || actual[2] !== app.versionCode || actual[3] !== app.versionName)
      throw new Error(`${app.moduleName}: package/version mismatch.`);
    if (/^application-debuggable/m.test(badging)) throw new Error(`${app.moduleName}: debuggable APK rejected.`);
    fs.writeFileSync(path.join(staging, "verification", `${app.moduleName}.signature.txt`), certs);
    fs.writeFileSync(path.join(staging, "verification", `${app.moduleName}.badging.txt`), badging);
  }
  fs.writeFileSync(path.join(staging, "Android.bp"), "// Pinned, unmodified third-party APKs. No privileged permissions.\n" + manifest.apps.map(app => `android_app_import {\n    name: "${app.moduleName}",\n    apk: "prebuilts/${app.moduleName}.apk",\n    presigned: true,\n    preprocessed: true,\n    product_specific: true,\n    dex_preopt: { enabled: false },\n}\n`).join("\n"));
  fs.writeFileSync(path.join(staging, "product.mk"), "# Additive native apps; roles, accounts and permissions remain explicit provisioning.\nPRODUCT_PACKAGES += \\\n" + manifest.apps.map((app, index) => `    ${app.moduleName}${index < manifest.apps.length - 1 ? " \\" : ""}`).join("\n") + "\n");
  fs.writeFileSync(path.join(staging, "distribution-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(staging, "README.md"), "# Alpha native app candidates\n\nPlace this directory at vendor/alphaphone/native-apps in the selected AOSP checkout, then add `$(call inherit-product, vendor/alphaphone/native-apps/product.mk)` to its product definition.\n\nAll APK hashes, versions and single signing certificates were verified before this directory was published. Original signatures and APK bytes are preserved. This is staging evidence, not an AOSP build, boot, licensing clearance, security review or account integration result. Complete the release gates in distribution-manifest.json before redistribution. License URLs are provenance records, not a substitute for required license texts, notices or corresponding source.\n");
  // Do not overwrite a directory created concurrently after our initial check.
  if (fs.existsSync(output)) throw new Error("Output appeared during staging; refusing to replace it.");
  fs.renameSync(staging, output);
  console.log(`Verified and staged ${manifest.apps.length} native app candidates at ${output}. No image build or boot performed.`);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  throw error;
}
