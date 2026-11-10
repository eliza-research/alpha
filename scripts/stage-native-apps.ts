import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { androidEnv, tool } from "./toolchain.ts";

// Reviewed candidates and their publisher/provenance record for the generated staging receipt.
const manifest = {
  schemaVersion: 1,
  product: "alphaphone",
  recordedOn: "2026-09-29",
  status: "Pinned official binary candidates; production release gates remain open",
  releaseGates: [
    "Review current security and release status before production",
    "Complete license, trademark, notices and corresponding-source requirements for exact distributed versions",
    "Choose publisher-compatible update and rollback policy",
    "Build and boot the selected AOSP image and test phone flows, accounts and native providers"
  ],
  excluded: [
    "Chromium development snapshot: owned production browser signing and bridge must be built separately"
  ],
  apps: [
    {
      moduleName: "AlphaOrganicMaps",
      packageName: "app.organicmaps.web",
      versionName: "2026.09.29-32-Web",
      versionCode: "26092932",
      filename: "OrganicMaps-26092932-web-release.apk",
      sha256: "d7dbdfc3cbfdbcce6d437f11147f2cd15384c03052d2b4594fd8c1c7777dd497",
      certificateSha256: "b9c7ae79a5a90270df08a132e536b9c666f5bef1f59b304fcecf8687865e4b5b",
      releaseUrl: "https://github.com/organicmaps/organicmaps/releases/tag/2026.09.29-32-android",
      downloadProvenance: "https://github.com/organicmaps/organicmaps/releases/download/2026.09.29-32-android/OrganicMaps-26092932-web-release.apk",
      license: "Apache-2.0; map data separately licensed",
      licenseUrl: "https://github.com/organicmaps/organicmaps/blob/master/LICENSE",
      sourceRepository: "https://github.com/organicmaps/organicmaps/tree/2026.09.29-32-android",
      updateAuthority: "Original publisher signing key; new version requires explicit manifest review",
      developmentOnly: false
    },
    {
      moduleName: "AlphaThunderbird",
      packageName: "net.thunderbird.android",
      versionName: "23.1",
      versionCode: "32",
      filename: "thunderbird-23.1.apk",
      sha256: "9f503a2e35d4764b1f614efcb666b07fde8f12b69f42c692e417439a31c5a434",
      certificateSha256: "b6524779b3dbbc5ac17a5ac271ddb29dcfbf723578c238e03c3c217811356dd1",
      releaseUrl: "https://github.com/thunderbird/thunderbird-android/releases/tag/THUNDERBIRD_23_1",
      downloadProvenance: "https://github.com/thunderbird/thunderbird-android/releases/download/THUNDERBIRD_23_1/thunderbird-23.1.apk",
      license: "Apache-2.0 with third-party notices",
      licenseUrl: "https://github.com/thunderbird/thunderbird-android/blob/main/LICENSE",
      sourceRepository: "https://github.com/thunderbird/thunderbird-android/tree/THUNDERBIRD_23_1",
      updateAuthority: "Original publisher signing key; new version requires explicit manifest review",
      developmentOnly: false
    },
    {
      moduleName: "AlphaProtonPass",
      packageName: "proton.android.pass",
      versionName: "1.40.3",
      versionCode: "14003373",
      filename: "ProtonPass-Android.apk",
      sha256: "4d82ed1101af49085908733a392acb5d13d1f9dac5e58849fa7519b95045a297",
      certificateSha256: "dcc9439ec1a6c6a8d0203f3423ee42bcc8b970628e53cb73a0393f398dd5b853",
      releaseUrl: "https://protonapps.com/protonpass-android",
      downloadProvenance: "https://proton.me/download/PassAndroid/ProtonPass-Android.apk",
      license: "GPL-3.0-or-later; corresponding-source distribution obligations",
      licenseUrl: "https://github.com/protonpass/android-pass/blob/main/LICENSE",
      sourceRepository: "https://github.com/protonpass/android-pass",
      updateAuthority: "Original publisher signing key; new version requires explicit manifest review",
      developmentOnly: false
    }
  ]
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options: Record<string, any> = {};
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
    const signers = [...certs.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]+)/g)].map((m: any) => m[1].toLowerCase());
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
  fs.writeFileSync(path.join(staging, "Android.bp"), "// Pinned, unmodified third-party APKs. No privileged permissions.\n" + manifest.apps.map((app: any) => `android_app_import {\n    name: "${app.moduleName}",\n    apk: "prebuilts/${app.moduleName}.apk",\n    presigned: true,\n    preprocessed: true,\n    product_specific: true,\n    dex_preopt: { enabled: false },\n}\n`).join("\n"));
  fs.writeFileSync(path.join(staging, "product.mk"), "# Additive native apps; roles, accounts and permissions remain explicit provisioning.\nPRODUCT_PACKAGES += \\\n" + manifest.apps.map((app: any, index: any) => `    ${app.moduleName}${index < manifest.apps.length - 1 ? " \\" : ""}`).join("\n") + "\n");
  fs.writeFileSync(path.join(staging, "distribution-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(staging, "README.md"), "# Alpha native app candidates\n\nPlace this directory at vendor/alphaphone/native-apps in the selected AOSP checkout, then add `$(call inherit-product, vendor/alphaphone/native-apps/product.mk)` to its product definition.\n\nAll APK hashes, versions and single signing certificates were verified before this directory was published. Original signatures and APK bytes are preserved. This is staging evidence, not an AOSP build, boot, licensing clearance, security review or account integration result. Complete the release gates in distribution-manifest.json before redistribution. License URLs are provenance records, not a substitute for required license texts, notices or corresponding source.\n");
  // Do not overwrite a directory created concurrently after our initial check.
  if (fs.existsSync(output)) throw new Error("Output appeared during staging; refusing to replace it.");
  fs.renameSync(staging, output);
  console.log(`Verified and staged ${manifest.apps.length} native app candidates at ${output}. No image build or boot performed.`);
} catch (error: any) {
  fs.rmSync(staging, { recursive: true, force: true });
  throw error;
}
