#!/usr/bin/env node
/**
 * Sign Alpha's unsigned release APKs with the application key held outside Gradle
 * (docs/human-actions.md H-10).
 *
 *   node scripts/sign-release-apks.mjs --keys-dir DIR [--key-name alphaphone_app] [OPTIONS]
 *   node scripts/sign-release-apks.mjs --pkcs11-config FILE --key-label LABEL [OPTIONS]
 *   OPTIONS: [--apk UNSIGNED.apk --out SIGNED.apk] [--apksigner PATH] [--no-verify] [--dry-run]
 *
 * Gradle signs a release only from a keystore file (ELIZAOS_KEYSTORE_*). Alpha's application key
 * instead comes from the upstream offline ceremony (android/signing/alpha-key-manifest.json) as
 * <name>.pk8 + <name>.x509.pem, decrypted into tmpfs for one signing job by
 * vendor/eliza/packages/os/scripts/android/decrypt-release-keys.ts, or is held in an HSM or managed
 * key service that exposes PKCS#11 (decision P-16). Build without the ELIZAOS_KEYSTORE_* variables
 * (ELIZAOS_VERSION_CODE and ELIZAOS_VERSION_NAME still set), then run this. By default it signs
 * artifacts/standalone-release-unsigned.apk and artifacts/launcher-release-unsigned.apk into
 * <variant>-release.apk, removes the unsigned files (verify-apks admits exactly one release name per
 * variant), and re-runs scripts/verify-apks.mjs (with the runtime profile artifacts/build-config.json
 * records) and the SBOM so apk-manifest.json records the signed bytes. `--apk`/`--out` signs one other APK the same way, for example the preprocessed Sense
 * listener APK that must carry the launcher's certificate (docs/adr/0001-privileged-listener.md).
 *
 * Every signed APK must verify against android/release-signer.json signerSha256, so enrollment
 * (H-09) comes first; a mismatch leaves no signed file behind. Key files are passed to apksigner by
 * path and never read here: the key directory must be absolute, outside every Git working tree,
 * owner-only (no group or other permission) and not a symbolic link, and both files regular files;
 * the private <name>.pk8 must have mode 0600 or stricter. The public <name>.x509.pem may keep the
 * default mode decrypt-release-keys.ts gives it: a substituted certificate cannot pass the signer
 * check above. In PKCS#11 mode apksigner loads the key labelled --key-label
 * through SunPKCS11 with the --pkcs11-config file; a token PIN is read by apksigner from the
 * environment variable ELIZAOS_PKCS11_PIN when it is set and never appears on a command line.
 * --dry-run prints the apksigner command lines and changes nothing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_KEY_NAME = "alphaphone_app";
export const PIN_ENV = "ELIZAOS_PKCS11_PIN";
export const VARIANTS = Object.freeze(["standalone", "launcher"]);
/**
 * JDK 9+ keeps sun.security.pkcs11 unexported, so apksigner cannot construct SunPKCS11 from
 * --provider-class without this export. apksigner's launcher script forwards "-J<x>" to java as
 * "-<x>", so the JVM option --add-exports is written with one dash after -J.
 */
export const PKCS11_JVM_OPTION = "-J-add-exports=jdk.crypto.cryptoki/sun.security.pkcs11=ALL-UNNAMED";
const PLAIN = /^[A-Za-z0-9._/@:+=-]+$/;
const USAGE = [
  "Usage: node scripts/sign-release-apks.mjs --keys-dir DIR [--key-name alphaphone_app] [OPTIONS]",
  "       node scripts/sign-release-apks.mjs --pkcs11-config FILE --key-label LABEL [OPTIONS]",
  "OPTIONS: [--apk UNSIGNED.apk --out SIGNED.apk] [--apksigner PATH] [--no-verify] [--dry-run]",
].join("\n");

function insideGitWorkTree(target) {
  let current = target;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Problems with a decrypted key directory and its key pair; empty when apksigner may read them. */
export function keyFileProblems(directory, name) {
  const problems = [];
  if (!path.isAbsolute(directory)) return [`--keys-dir ${directory} must be an absolute path`];
  let stat;
  try { stat = fs.lstatSync(directory); } catch { return [`--keys-dir ${directory} does not exist`]; }
  if (stat.isSymbolicLink()) return [`--keys-dir ${directory} is a symbolic link`];
  if (!stat.isDirectory()) return [`--keys-dir ${directory} is not a directory`];
  const real = fs.realpathSync(directory);
  const tree = insideGitWorkTree(real);
  if (tree) problems.push(`--keys-dir ${real} is inside the Git working tree ${tree}`);
  if ((stat.mode & 0o077) !== 0) problems.push(`--keys-dir ${real} must be owner-only (mode 0700)`);
  for (const [file, secret] of [[`${name}.pk8`, true], [`${name}.x509.pem`, false]]) {
    const full = path.join(real, file);
    let entry;
    try { entry = fs.lstatSync(full); } catch { problems.push(`${full} is missing`); continue; }
    if (!entry.isFile()) problems.push(`${full} is not a regular file`);
    // Only the private key is secret; the certificate is public and checked by its digest after signing.
    else if (secret && (entry.mode & 0o077) !== 0) problems.push(`${full} must have mode 0600 or stricter`);
  }
  return problems;
}

/** The apksigner argument vector for one APK. Private key material is referenced by path or label only. */
export function signArguments({ mode, keysDir, keyName = DEFAULT_KEY_NAME, pkcs11Config, keyLabel, pin = false, input, output }) {
  const tail = ["--v4-signing-enabled", "false", "--out", output, input];
  if (mode === "key-files")
    return ["sign", "--key", path.join(keysDir, `${keyName}.pk8`), "--cert", path.join(keysDir, `${keyName}.x509.pem`), ...tail];
  return [PKCS11_JVM_OPTION, "sign",
    "--provider-class", "sun.security.pkcs11.SunPKCS11", "--provider-arg", pkcs11Config,
    "--ks", "NONE", "--ks-type", "PKCS11", "--ks-key-alias", keyLabel, "--ks-pass", pin ? `env:${PIN_ENV}` : "pass:", ...tail];
}

/** apksigner's own message: the last lines that are not Java stack frames (an exception keeps its first line). */
export function toolMessage({ stderr, stdout, error }) {
  const lines = String(stderr || stdout || error?.message || "").trim().split("\n").filter(line => !/^\s+at |^\s*\.\.\. \d+ more$/.test(line));
  return lines.slice(-3).join(" ") || "no output";
}

/** The APKs to sign: the two unsigned releases in the artifacts directory, or one explicit pair. */
export function signingTargets({ artifacts = "artifacts", apk, out }) {
  if (apk || out) {
    if (!apk || !out) throw new Error("--apk and --out go together");
    if (!fs.existsSync(apk)) throw new Error(`${apk} does not exist`);
    if (fs.existsSync(out)) throw new Error(`${out} already exists; choose a new output file`);
    return [{ input: apk, output: out, removeInput: false }];
  }
  return VARIANTS.map(variant => {
    const input = path.join(artifacts, `${variant}-release-unsigned.apk`), output = path.join(artifacts, `${variant}-release.apk`);
    if (fs.existsSync(output)) throw new Error(`${output} already exists: that release is already signed (Gradle signing or an earlier run)`);
    if (!fs.existsSync(input)) throw new Error(`${input} is missing; build the releases without ELIZAOS_KEYSTORE_* first (npm run android:build:local)`);
    return { input, output, removeInput: true };
  });
}

function parseArgs(argv) {
  const options = { verify: true, dryRun: false };
  const valued = ["--keys-dir", "--key-name", "--pkcs11-config", "--key-label", "--apk", "--out", "--apksigner"];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-verify") options.verify = false;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (valued.includes(arg) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) options[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else return null;
  }
  const keyFiles = options.keysDir !== undefined, pkcs11 = options.pkcs11Config !== undefined || options.keyLabel !== undefined;
  if (keyFiles === pkcs11) return null;
  if (pkcs11 && (!options.pkcs11Config || !options.keyLabel || options.keyName)) return null;
  options.mode = keyFiles ? "key-files" : "pkcs11";
  options.keyName ??= DEFAULT_KEY_NAME;
  return options;
}

/**
 * Sign every target, check each result against the recorded release signer before it replaces
 * anything, then refresh apk-manifest.json and the SBOM. Returns an exit code.
 */
export async function main(argv, { root = process.cwd(), env = process.env, log = console.log, error = console.error, digest, run } = {}) {
  const options = parseArgs(argv);
  if (!options) { error(USAGE); return 2; }
  const signer = JSON.parse(fs.readFileSync(path.join(root, "android/release-signer.json"), "utf8")).signerSha256;
  if (!/^[0-9a-f]{64}$/.test(signer ?? "")) { error(`android/release-signer.json signerSha256 is ${JSON.stringify(signer)}; enroll the release certificate first (docs/human-actions.md H-09)`); return 1; }
  const problems = options.mode === "key-files" ? keyFileProblems(options.keysDir, options.keyName) : [];
  if (options.mode === "pkcs11") {
    if (!path.isAbsolute(options.pkcs11Config) || !fs.existsSync(options.pkcs11Config) || !fs.statSync(options.pkcs11Config).isFile()) problems.push(`--pkcs11-config ${options.pkcs11Config} must be an absolute path to the SunPKCS11 configuration file`);
    if (!PLAIN.test(options.keyLabel)) problems.push("--key-label must be a plain label");
  }
  if (options.keyName && !/^[a-z][a-z0-9_]{0,62}$/.test(options.keyName)) problems.push(`--key-name ${options.keyName} is not a key name`);
  let targets = [];
  const artifacts = path.join(root, "artifacts");
  const build = !options.apk && fs.existsSync(path.join(artifacts, "build-config.json")) ? JSON.parse(fs.readFileSync(path.join(artifacts, "build-config.json"), "utf8")) : {};
  if (build.localEmbeddings === true) {
    const {verifyEmbeddingHost}=await import('./stage-embedding-host.mjs');
    verifyEmbeddingHost(root);
  }
  if (build.testMocks === true) problems.push("artifacts/build-config.json records a test-mocks build, which is never distributable");
  try { targets = signingTargets({ artifacts, apk: options.apk && path.resolve(root, options.apk), out: options.out && path.resolve(root, options.out) }); }
  catch (problem) { problems.push(problem.message); }
  if (problems.length) { error(`Refusing to sign:\n  - ${problems.join("\n  - ")}`); return 1; }

  const toolchain = options.apksigner ? null : await import("./toolchain.mjs");
  const apksigner = options.apksigner ?? toolchain.tool("apksigner");
  const toolEnv = { ...(toolchain ? toolchain.androidEnv() : env) };
  // The apksigner launcher runs `java` from PATH; use the JDK the toolchain checked (Java 8 has no --add-exports).
  if (toolEnv.JAVA_HOME) toolEnv.PATH = [path.join(toolEnv.JAVA_HOME, "bin"), toolEnv.PATH].filter(Boolean).join(path.delimiter);
  const keysDir = options.mode === "key-files" ? fs.realpathSync(options.keysDir) : null;
  const pin = options.mode === "pkcs11" && typeof env[PIN_ENV] === "string" && env[PIN_ENV] !== "";
  if (pin) toolEnv[PIN_ENV] = env[PIN_ENV];
  const signerOf = digest ?? (async file => (await import("./apk.mjs")).signerDigest(file));
  const commands = targets.map(target => ({ target, args: signArguments({ ...options, keysDir, pin, input: target.input, output: `${target.output}.partial` }) }));
  if (options.dryRun) {
    for (const { args } of commands) log([apksigner, ...args].join(" "));
    log("Dry run: nothing signed.");
    return 0;
  }
  const signed = [];
  try {
    for (const { target, args } of commands) {
      const partial = `${target.output}.partial`;
      fs.rmSync(partial, { force: true });
      const result = spawnSync(apksigner, args, { env: toolEnv, encoding: "utf8" });
      if (result.status !== 0) throw new Error(`apksigner could not sign ${target.input}: ${toolMessage(result)}`);
      const actual = await signerOf(partial);
      if (actual !== signer) throw new Error(`${target.input} was signed by ${actual}, not the recorded release certificate ${signer}; check the key or token label`);
      signed.push({ target, partial });
    }
  } catch (problem) {
    for (const { target } of commands) fs.rmSync(`${target.output}.partial`, { force: true });
    error(problem.message);
    return 1;
  }
  for (const { target, partial } of signed) {
    fs.renameSync(partial, target.output);
    if (target.removeInput) fs.rmSync(target.input);
    log(`Signed ${path.relative(root, target.output)} with the release certificate ${signer}.`);
  }
  if (!options.verify || options.apk) {
    if (!options.apk) log("Skipped verify-apks: apk-manifest.json still describes the unsigned build. Run node scripts/verify-apks.mjs before using these APKs.");
    return 0;
  }
  const runner = run ?? ((command, args) => execFileSync(command, args, { cwd: root, stdio: "inherit" }));
  const { sbomArgs } = await import("./build-android.mjs");
  runner(process.execPath, ["scripts/verify-apks.mjs", ...(build.runtimeProfile === "cloud" ? ["--runtime-profile=cloud"] : []), ...(build.localEmbeddings ? ["--local-embeddings"] : [])]);
  runner(process.execPath, ["scripts/generate-sbom.mjs", ...sbomArgs("artifacts", root)]);
  log("apk-manifest.json and the SBOM now describe the signed releases. A signed release is distributable only when verify-apks says so; it is not installation, image or device evidence.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
