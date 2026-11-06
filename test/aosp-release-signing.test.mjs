// Pixel 10a production staging inputs, release image signing, OTA and the compatibility record
// (issues #399, #400). The AOSP releasetools are mocked and every key is a throwaway value made
// in a temporary directory: these tests establish refusals, command construction and record
// contents. They are not a signed image, an image boot, an applied OTA, or a rollback or
// recovery drill.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { PIXEL10A_PRODUCT, pixel10aOptions, pixel10aProductProblems } from "../scripts/aosp-pixel10a.mjs";
import { AVB_SIGNABLE_PARTITIONS, channelDistributionProblems, channelSigningProblems, gitWorkTreeProblem, isWithin, parseSigningArgs, PKCS11_JAVA_ARGS, signingCommands, signRelease, X509_KEYS } from "../scripts/sign-aosp-release.mjs";
import { chainedPartitionsFromMiscInfo, compatibilityRecord, parseProperties } from "../scripts/aosp-release-record.mjs";
import { releaseBlockers } from "../scripts/release-blockers.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = rel => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const CHANNEL = "android/aosp/pixel10a-ota-channel.json";
const FINGERPRINT = "Alpha/alpha_stallion_phone/stallion:17/CP2A.261005.001/42:user/release-keys";

/** Write a zip; object values become nested zips (APKs and APEXes inside target-files). */
function zip(file, entries) {
  execFileSync("python3", ["-c", "import io,json,sys,zipfile\ndef build(e):\n b=io.BytesIO()\n with zipfile.ZipFile(b,'w') as z:\n  for k,v in e.items(): z.writestr(k, build(v) if isinstance(v,dict) else v)\n return b.getvalue()\nopen(sys.argv[1],'wb').write(build(json.loads(sys.argv[2])))", file, JSON.stringify(entries)]);
}
function temporary(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function certificate(dir, name) {
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-subj", `/CN=alpha-test-${name}`, "-days", "1",
    "-keyout", path.join(dir, `${name}.key.tmp`), "-out", path.join(dir, `${name}.x509.pem`)], { stdio: "ignore" });
  fs.rmSync(path.join(dir, `${name}.key.tmp`));
  fs.chmodSync(path.join(dir, `${name}.x509.pem`), 0o600);
  const der = Buffer.from(fs.readFileSync(path.join(dir, `${name}.x509.pem`), "utf8").replace(/-----[^-]+-----|\s/g, ""), "base64");
  return sha256(der);
}
const TEST_KEY_DIGEST = "0".repeat(64);
const DEV = "build/make/target/product/security";

/** A throwaway key directory in the upstream decrypted layout. Private files hold a marker, never a key. */
function keyDirectory(t) {
  const keys = temporary(t, "alpha-test-keys-");
  fs.chmodSync(keys, 0o700);
  const platform = certificate(keys, "platform"), releasekey = certificate(keys, "releasekey"), apex = certificate(keys, "apex");
  const write = (name, value) => { fs.writeFileSync(path.join(keys, name), value); fs.chmodSync(path.join(keys, name), 0o600); };
  for (const name of X509_KEYS) {
    if (!["platform", "releasekey"].includes(name)) write(`${name}.x509.pem`, fs.readFileSync(path.join(keys, "releasekey.x509.pem")));
    write(`${name}.pk8`, "TEST-ONLY-PRIVATE-MARKER");
  }
  write("apex.pk8", "TEST-ONLY-PRIVATE-MARKER");
  write("apex_payload.pem", "TEST-ONLY-PRIVATE-MARKER");
  write("apex_payload.avbpubkey", "release apex payload public key");
  write("avb.pem", "TEST-ONLY-PRIVATE-MARKER");
  const pkmd = Buffer.from("test avb public key metadata");
  write("avb_pkmd.bin", pkmd);
  return { keys, platform, releasekey, apex, avb: sha256(pkmd) };
}

/** Reviewed digests for every non-platform certificate; the fixture copies releasekey's certificate to each. */
function releaseCertificates({ releasekey, apex }) {
  return { ...Object.fromEntries(X509_KEYS.filter(name => !["platform", "releasekey"].includes(name)).map(name => [name, releasekey])), apex };
}

/** A repository copy whose production descriptors are complete for the given keys. */
function completeRoot(t, { platform, releasekey, apex, avb }) {
  const dir = temporary(t, "alpha-release-root-");
  const write = (rel, value) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), typeof value === "string" ? value : JSON.stringify(value, null, 2)); };
  const lock = JSON.stringify({ schema: 1, target: "pixel10a", device: { codename: "stallion", androidRelease: "17" }, developmentOnly: false, releaseQualified: false });
  write("android/aosp/pixel10a-source.json", lock);
  const product = read(PIXEL10A_PRODUCT);
  write(PIXEL10A_PRODUCT, { ...product, sourceLock: { ...product.sourceLock, sha256: sha256(lock) }, signer: { ...product.signer, platformCertificateSha256: platform, releaseCertificates: releaseCertificates({ releasekey, apex }) }, avb: { ...product.avb, publicKeySha256: avb } });
  write(CHANNEL, { ...read(CHANNEL), otaCertificateSha256: releasekey, avbPublicKeySha256: avb });
  write("android/release-signer.json", { ...read("android/release-signer.json"), signerSha256: "d".repeat(64) });
  return { dir, write, product: read(PIXEL10A_PRODUCT) };
}

/**
 * Mock otatools bin: records each invocation and writes outputs shaped like the real tools'.
 * The mock signer re-signs nested APKs/APEXes (a CERT entry holding the certificate digest) with
 * the key each -d/-k/--extra_apks mapping selects; mock.json can make it skip a package or keep
 * an APEX's test payload key. The mock apksigner prints a package's CERT entry as its signer.
 */
function releasetools(t, { postBuild = FINGERPRINT, fileHash = null } = {}) {
  const bin = path.join(temporary(t, "alpha-otatools-"), "bin");
  fs.mkdirSync(bin);
  const common = `#!/usr/bin/env python3\nimport sys, json, os, zipfile, hashlib, base64, io, re\nhere = os.path.dirname(os.path.abspath(__file__))\nwith open(os.path.join(here, 'calls.jsonl'), 'a') as log: log.write(json.dumps([os.path.basename(__file__)] + sys.argv[1:]) + '\\n')\nsrc, dst = sys.argv[-2], sys.argv[-1]\nargs = sys.argv[1:-2]\n`;
  const sign = `cfg = json.load(open(os.path.join(here, 'mock.json'))) if os.path.exists(os.path.join(here, 'mock.json')) else {}
keys = args[args.index('-d') + 1]
pairs = lambda flag: dict(args[i + 1].split('=', 1) for i in range(len(args)) if args[i] == flag)
kmap = {s: os.path.basename(d) for s, d in pairs('-k').items()}
payload, containers = pairs('--extra_apex_payload_key'), pairs('--extra_apks')
DEFAULT = {'testkey': 'releasekey', 'devkey': 'releasekey', 'platform': 'platform', 'shared': 'shared', 'media': 'media', 'networkstack': 'networkstack', 'sdk_sandbox': 'sdk_sandbox'}
def digest(name):
    pem = open(os.path.join(keys, name + '.x509.pem')).read()
    return hashlib.sha256(base64.b64decode(''.join(l for l in pem.splitlines() if not l.startswith('-----')))).hexdigest()
def key_for(cert):
    source = cert[:-len('.x509.pem')]
    return kmap.get(source) or (DEFAULT.get(os.path.basename(source)) if os.path.dirname(source) == '${DEV}' else None)
def rows(text): return [dict(re.findall(r'(\\w+)="([^"]*)"', l)) for l in text.splitlines() if l.strip()]
def repack(data, changes):
    i = zipfile.ZipFile(io.BytesIO(data)); b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as o:
        for n in i.namelist(): o.writestr(n, changes.get(n, i.read(n)))
    return b.getvalue()
with zipfile.ZipFile(src) as i, zipfile.ZipFile(dst, 'w') as o:
    certs = {r['name']: r for r in rows(i.read('META/apkcerts.txt').decode())}
    misc = dict(l.split('=', 1) for l in i.read('META/misc_info.txt').decode().splitlines() if '=' in l)
    for n in i.namelist():
        data, base = i.read(n), os.path.basename(n)
        if n == 'META/apkcerts.txt':
            out = []
            for r in rows(data.decode()):
                k = key_for(r['certificate']) if r['certificate'] not in ('PRESIGNED', 'EXTERNAL') else None
                if k: r['certificate'], r['private_key'] = os.path.join(keys, k + '.x509.pem'), os.path.join(keys, k + '.pk8')
                out.append(' '.join('%s="%s"' % kv for kv in r.items()))
            data = ('\\n'.join(out) + '\\n').encode()
        elif n.endswith('.apk') and base not in cfg.get('skip', []) and base in certs and key_for(certs[base]['certificate']):
            data = repack(data, {'CERT': digest(key_for(certs[base]['certificate']))})
        elif n.endswith('.apex') and base in containers and base not in cfg.get('skip', []):
            changes = {'CERT': digest(os.path.basename(containers[base]))}
            if not cfg.get('keepApexKey'): changes['apex_pubkey'] = open(payload[base][:-4] + '.avbpubkey', 'rb').read()
            data = repack(data, changes)
        o.writestr(n, data)
    for p in ['vbmeta'] + [k[4:-9] for k in misc if k.startswith('avb_') and k.endswith('_key_path') and k != 'avb_vbmeta_key_path']:
        o.writestr('IMAGES/%s.img' % p, b'signed ' + p.encode())
`;
  fs.writeFileSync(path.join(bin, "sign_target_files_apks"), common + sign);
  fs.writeFileSync(path.join(bin, "ota_from_target_files"), common + `payload = b'payload bytes'\nfh = ${fileHash ? JSON.stringify(fileHash) : "None"} or base64.b64encode(hashlib.sha256(payload).digest()).decode()\npre = 'pre-build=previous/fingerprint\\n' if '-i' in args else ''\nwith zipfile.ZipFile(dst, 'w') as o:\n    o.writestr('payload.bin', payload)\n    o.writestr('payload_properties.txt', 'FILE_HASH=%s\\nFILE_SIZE=%d\\n' % (fh, len(payload)))\n    o.writestr('META-INF/com/android/metadata', 'ota-type=AB\\npost-build=${postBuild}\\npre-device=stallion\\n' + pre)\n`);
  fs.writeFileSync(path.join(bin, "apksigner"), `#!/usr/bin/env python3\nimport sys, zipfile\ntry: cert = zipfile.ZipFile(sys.argv[-1]).read('CERT').decode()\nexcept Exception: sys.exit(1)\nprint('Signer #1 certificate SHA-256 digest: ' + cert)\n`);
  for (const name of ["sign_target_files_apks", "ota_from_target_files", "apksigner"]) fs.chmodSync(path.join(bin, name), 0o755);
  return { bin, configure: value => fs.writeFileSync(path.join(bin, "mock.json"), JSON.stringify(value)),
    calls: () => fs.existsSync(path.join(bin, "calls.jsonl")) ? fs.readFileSync(path.join(bin, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [] };
}

const MISC_INFO = ["avb_enable=true", "avb_vbmeta_key_path=external/avb/test/data/testkey_rsa4096.pem", "avb_vbmeta_algorithm=SHA256_RSA4096",
  "avb_vbmeta_system=system system_ext", "avb_vbmeta_system_key_path=external/avb/test/data/testkey_rsa4096.pem", "avb_vbmeta_system_rollback_index_location=1",
  "avb_vbmeta_vendor=vendor", "avb_vbmeta_vendor_key_path=external/avb/test/data/testkey_rsa4096.pem", "avb_vbmeta_vendor_rollback_index_location=2"];
const apkcert = (name, cert) => `name="${name}" certificate="${cert}" private_key="${cert === "PRESIGNED" ? "" : cert.replace(/\.x509\.pem$/, ".pk8")}"`;
const APKCERTS = [apkcert("Launcher.apk", `${DEV}/testkey.x509.pem`), apkcert("Settings.apk", `${DEV}/platform.x509.pem`), apkcert("Bluetooth.apk", `${DEV}/bluetooth.x509.pem`), apkcert("Vendor.apk", "PRESIGNED")];
const APEXKEYS = ['name="com.android.foo.apex" public_key="system/apex/foo.avbpubkey" private_key="system/apex/foo.pem" container_certificate="system/apex/foo.x509.pem" container_private_key="system/apex/foo.pk8" partition="system"',
  'name="com.google.bar.apex" public_key="PRESIGNED" private_key="PRESIGNED" container_certificate="PRESIGNED" container_private_key="PRESIGNED" partition="system"'];

function targetFiles(t, { misc = MISC_INFO, apkcerts = APKCERTS, apexkeys = APEXKEYS, files = {} } = {}) {
  const file = path.join(temporary(t, "alpha-target-files-"), "unsigned-target_files.zip");
  zip(file, { "SYSTEM/build.prop": `# test\nro.system.build.fingerprint=${FINGERPRINT}\nro.build.id=CP2A.261005.001\nro.build.version.incremental=42\nro.build.version.release=17\nro.build.version.sdk=37\nro.build.version.security_patch=2026-10-05\n`,
    "VENDOR/build.prop": "ro.vendor.build.fingerprint=google/stallion/stallion:17/CP3A.261005.005/1:user/release-keys\nro.vendor.build.security_patch=2026-10-05\n",
    "META/misc_info.txt": misc.join("\n") + "\n", "META/apkcerts.txt": apkcerts.join("\n") + "\n", "META/apexkeys.txt": apexkeys.join("\n") + "\n",
    "SYSTEM/app/Launcher/Launcher.apk": { CERT: TEST_KEY_DIGEST }, "SYSTEM/priv-app/Settings/Settings.apk": { CERT: TEST_KEY_DIGEST },
    "SYSTEM/app/Bluetooth/Bluetooth.apk": { CERT: TEST_KEY_DIGEST }, "VENDOR/app/Vendor/Vendor.apk": { CERT: "f".repeat(64) },
    "SYSTEM/apex/com.android.foo.apex": { CERT: TEST_KEY_DIGEST, apex_pubkey: "aosp test apex payload key" }, "SYSTEM/apex/com.google.bar.apex": { CERT: "e".repeat(64), apex_pubkey: "vendor key" },
    ...files });
  return { file, sha256: sha256(fs.readFileSync(file)) };
}

function setup(t, tools = {}, tf = {}) {
  const key = keyDirectory(t), repo = completeRoot(t, key), target = targetFiles(t, tf), ota = releasetools(t, tools);
  const out = path.join(temporary(t, "alpha-release-out-"), "release");
  return { key, repo, tf: target, ota, out, options: { root: repo.dir, targetFiles: target.file, targetFilesSha256: target.sha256, keysDir: key.keys, releasetools: ota.bin, out } };
}

test("the committed Pixel 10a production descriptor and channel name every unset release input and never claim qualification", () => {
  const product = read(PIXEL10A_PRODUCT), channel = read(CHANNEL);
  assert.equal(product.product, "alpha_stallion_phone");
  assert.deepEqual(product.device, { codename: "stallion", androidRelease: "17" });
  assert.equal(product.releaseQualified, false);
  assert.equal(product.deviceAcceptanceVerified, false);
  assert.equal(product.ota.channel, CHANNEL);
  assert.equal(channel.recovery.stockFactoryImage.sha256, read("android/aosp/pixel10a-source.json").factory.sha256, "stock recovery is the locked factory archive");
  const problems = pixel10aProductProblems(root);
  for (const expected of [/sourceLock\.sha256 is unset/, /still marked developmentOnly/, /signerSha256 is "unset"/, /platformCertificateSha256 must be a SHA-256/])
    assert.ok(problems.some(problem => expected.test(problem)), `${expected}\n${problems.join("\n")}`);
  assert.ok(channelSigningProblems(channel, product).some(problem => /otaCertificateSha256 is unset/.test(problem)));
  const distribution = channelDistributionProblems(channel);
  for (const drill of ["signedUpdate", "interruptedUpdate", "compatibleRollback", "stockRecovery"]) assert.ok(distribution.some(problem => problem.includes(`${drill} drill is "not run"`)), drill);
  assert.ok(distribution.some(problem => /knownGoodRelease\.otaSha256 is unset/.test(problem)));
});

test("distribution requires every recovery identity and every update/recovery drill", () => {
  const complete = {
    recovery: { knownGoodRelease: { buildFingerprint: FINGERPRINT, otaSha256: "a".repeat(64), recordFile: "releases/42/release-record.json" } },
    drills: { signedUpdate: "passed", interruptedUpdate: "passed", compatibleRollback: "passed", stockRecovery: "passed" },
  };
  assert.deepEqual(channelDistributionProblems(complete), []);
  const additionalDrill = structuredClone(complete);
  additionalDrill.drills.additionalRecovery = "failed";
  assert.ok(channelDistributionProblems(additionalDrill).some(problem => /additionalRecovery drill/.test(problem)));
  for (const field of Object.keys(complete.recovery.knownGoodRelease)) {
    for (const value of [undefined, null, "", "  ", "UNSET", 42, {}]) {
      const candidate = structuredClone(complete);
      if (value === undefined) delete candidate.recovery.knownGoodRelease[field];
      else candidate.recovery.knownGoodRelease[field] = value;
      assert.ok(channelDistributionProblems(candidate).some(problem => problem.includes(`knownGoodRelease.${field}`)), field);
    }
  }
  const malformedHash = structuredClone(complete);
  malformedHash.recovery.knownGoodRelease.otaSha256 = "not-a-hash";
  assert.ok(channelDistributionProblems(malformedHash).some(problem => /must be a SHA-256/.test(problem)));
  for (const drill of Object.keys(complete.drills)) {
    const candidate = structuredClone(complete);
    delete candidate.drills[drill];
    assert.ok(channelDistributionProblems(candidate).some(problem => problem.includes(`${drill} drill`)), drill);
  }
  for (const candidate of [null, {}, { recovery: {} }, { recovery: { knownGoodRelease: {} }, drills: { signedUpdate: "passed" } }])
    assert.ok(channelDistributionProblems(candidate).length >= 6);
});

test("a complete fixture descriptor admits Pixel 10a production staging inputs; each gap is refused", t => {
  const { repo } = setup(t);
  assert.deepEqual(pixel10aProductProblems(repo.dir), []);
  const refuse = (rel, change, pattern) => {
    const original = fs.readFileSync(path.join(repo.dir, rel), "utf8");
    repo.write(rel, change(JSON.parse(original)));
    assert.ok(pixel10aProductProblems(repo.dir).some(problem => pattern.test(problem)), `${pattern}\n${pixel10aProductProblems(repo.dir).join("\n")}`);
    fs.writeFileSync(path.join(repo.dir, rel), original);
  };
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, releaseQualified: true }), /releaseQualified must stay false/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, deviceAcceptanceVerified: true }), /deviceAcceptanceVerified must stay false/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, signer: { ...p.signer, platformCertificateSha256: "UNSET" } }), /platformCertificateSha256/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, sourceLock: { ...p.sourceLock, sha256: "0".repeat(64) } }), /differs from the pinned sourceLock\.sha256/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, device: { codename: "frankel", androidRelease: "17" } }), /must be stallion on Android 17/);
  refuse(PIXEL10A_PRODUCT, p => ({ ...p, lunch: { ...p.lunch, production: "alpha_stallion_phone-cp2a-userdebug" } }), /user build/);
  refuse("android/release-signer.json", s => ({ ...s, signerSha256: "unset" }), /signerSha256 is "unset"/);
  refuse("android/aosp/pixel10a-source.json", l => ({ ...l, developmentOnly: true }), /still marked developmentOnly|differs from the pinned/);
});

test("Pixel 10a staging options: development or production, never both, always with exact source inputs", () => {
  const base = { target: "pixel10a", source: "/source", factory: "/factory" };
  assert.equal(pixel10aOptions({ ...base, development: true }), true);
  assert.equal(pixel10aOptions({ ...base, production: true }), true);
  assert.throws(() => pixel10aOptions({ ...base, development: true, production: true }), /exclusive/);
  assert.throws(() => pixel10aOptions(base), /--development or --production/);
  assert.throws(() => pixel10aOptions({ ...base, production: true, factory: null }), /--aosp-source and --factory-image/);
});

test("stage-aosp --target pixel10a --production refuses the committed descriptor before reading source or APK", () => {
  const out = spawnSync(process.execPath, [path.join(root, "scripts/stage-aosp.mjs"), "--target", "pixel10a", "--production", "--descriptor", "reviewed.json",
    "--apk", "absent.apk", "--aosp-source", "/absent/source", "--factory-image", "/absent/factory.zip"], { cwd: root, encoding: "utf8" });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /Refusing production staging: the Pixel 10a production product \(android\/aosp\/pixel10a-product\.json\) is incomplete\.[\s\S]*platformCertificateSha256/);
  assert.doesNotMatch(out.stderr, /absent/);
});

test("the stallion product sets no board AVB variables; signing carries the AVB keys and algorithm", () => {
  assert.equal(fs.existsSync(path.join(root, "android/aosp/stallion/release-avb.mk")), false);
  for (const name of fs.readdirSync(path.join(root, "android/aosp/stallion")).filter(name => name.endsWith(".mk")))
    assert.doesNotMatch(fs.readFileSync(path.join(root, "android/aosp/stallion", name), "utf8"), /^\s*BOARD_AVB_/m, name);
  assert.equal(read(PIXEL10A_PRODUCT).avb.makefile, undefined);
  assert.match(fs.readFileSync(path.join(root, "scripts/aosp-pixel10a.mjs"), "utf8"), /No BOARD_AVB_\* here/);
  assert.match(fs.readFileSync(path.join(root, "android/aosp/stallion/AndroidProducts.mk"), "utf8"), /alpha_stallion_phone-cp2a-user\b/);
  // No key material is committed with the AOSP product.
  const files = execFileSync("git", ["-C", root, "ls-files", "android/aosp"], { encoding: "utf8" }).split("\n");
  assert.deepEqual(files.filter(name => /\.(pk8|pem|key|p12|jks|keystore)$|avb_pkmd/.test(name)), []);
});

test("signing commands follow the upstream releasetools job with keys only as runtime paths", () => {
  const product = read(PIXEL10A_PRODUCT);
  const { commands } = signingCommands({ targetFiles: "/in/tf.zip", keysDir: "/dev/shm/keys", releasetools: "/otatools/bin", out: "/out", product, incrementalFrom: "/prev/tf.zip" });
  assert.deepEqual(commands.map(command => path.basename(command.tool)), ["sign_target_files_apks", "ota_from_target_files"]);
  assert.deepEqual(commands[0].args.slice(0, 5), ["-p", "/otatools", "-o", "-d", "/dev/shm/keys"]);
  for (const partition of ["vbmeta", ...product.avb.chainedPartitions]) {
    const at = commands[0].args.indexOf(`--avb_${partition}_key`);
    assert.equal(commands[0].args[at + 1], "/dev/shm/keys/avb.pem", partition);
    assert.equal(commands[0].args[commands[0].args.indexOf(`--avb_${partition}_algorithm`) + 1], "SHA256_RSA4096");
  }
  assert.deepEqual(commands[1].args.slice(2), ["-k", "/dev/shm/keys/releasekey", "-i", "/prev/tf.zip", "/out/signed-target_files.zip", "/out/incremental-ota.zip"]);
  // bluetooth and nfc are not in -d's default map: each gets an explicit -k.
  for (const name of ["bluetooth", "nfc"]) assert.ok(commands[0].args.includes(`build/make/target/product/security/${name}=/dev/shm/keys/${name}`), name);
  const withApex = signingCommands({ targetFiles: "/in/tf.zip", keysDir: "/dev/shm/keys", releasetools: "/otatools/bin", out: "/out", product,
    keyMap: { "vendor/certs/camera": "camera" }, inspection: { apexkeys: [{ name: "com.android.foo.apex", private_key: "a.pem", container_private_key: "a.pk8" }, { name: "com.google.bar.apex", private_key: "PRESIGNED", container_private_key: "PRESIGNED" }] } }).commands[0].args;
  assert.ok(withApex.includes("vendor/certs/camera=/dev/shm/keys/camera"));
  assert.equal(withApex[withApex.indexOf("--extra_apex_payload_key") + 1], "com.android.foo.apex=/dev/shm/keys/apex_payload.pem");
  assert.equal(withApex[withApex.indexOf("--extra_apks") + 1], "com.android.foo.apex=/dev/shm/keys/apex");
  assert.ok(!withApex.some(arg => arg.startsWith("com.google.bar.apex")), "presigned APEXes are left alone");
  assert.deepEqual(parseSigningArgs(["--map-key", "vendor/certs/camera=camera", "--map-key", "vendor/certs/nfc2=nfc2"]).keyMap, { "vendor/certs/camera": "camera", "vendor/certs/nfc2": "nfc2" });
  assert.throws(() => parseSigningArgs(["--keys-dir"]), /Use --target-files/);
  assert.deepEqual(parseSigningArgs(["--dry-run", "--keys-dir", "/k"]), { dryRun: true, keysDir: "/k" });
});

test("a complete fixture signs with mocked releasetools and writes the compatibility record", async t => {
  const { key, ota, out, options, tf } = setup(t);
  const apkManifest = path.join(path.dirname(out), "apk-manifest.json");
  fs.writeFileSync(apkManifest, JSON.stringify({ results: [{ file: "launcher-release.apk", mode: "release", sha256: "a".repeat(64), signerSha256: "d".repeat(64), versionCode: 7, distributable: false }, { file: "launcher-debug.apk", mode: "debug" }] }));
  const result = await signRelease({ ...options, apkManifest });
  assert.equal(result.ran, true);
  const calls = ota.calls();
  assert.deepEqual(calls.map(call => call[0]), ["sign_target_files_apks", "ota_from_target_files"]);
  assert.ok(calls[0].includes("-o") && calls[0].includes(key.keys));
  assert.equal(calls[1][calls[1].indexOf("-k") + 1], path.join(key.keys, "releasekey"));
  assert.ok(calls[0].includes(`${DEV}/bluetooth=${path.join(key.keys, "bluetooth")}`) && calls[0].includes(`${DEV}/nfc=${path.join(key.keys, "nfc")}`));
  assert.ok(calls[0].includes(`com.android.foo.apex=${path.join(key.keys, "apex_payload.pem")}`) && calls[0].includes(`com.android.foo.apex=${path.join(key.keys, "apex")}`));
  assert.ok(!calls[0].some(arg => arg.startsWith("com.google.bar.apex")));
  assert.equal(fs.statSync(out).mode & 0o777, 0o700);
  assert.deepEqual(fs.readFileSync(path.join(out, "avb_pkmd.bin")), fs.readFileSync(path.join(key.keys, "avb_pkmd.bin")));
  const text = fs.readFileSync(result.record, "utf8"), record = JSON.parse(text);
  assert.doesNotMatch(text, /TEST-ONLY-PRIVATE-MARKER/, "private key files are never read into the record");
  assert.equal(record.kind, "alpha-aosp-release-compatibility");
  assert.equal(record.build.fingerprint, FINGERPRINT);
  assert.equal(record.build.androidRelease, "17");
  assert.equal(record.build.securityPatch, "2026-10-05");
  assert.match(record.build.vendorFingerprint, /^google\/stallion/);
  assert.equal(record.inputs.unsignedTargetFilesSha256, tf.sha256);
  assert.equal(record.verifiedBoot.publicKeySha256, key.avb);
  assert.equal(record.verifiedBoot.images.vbmeta, sha256(Buffer.from("signed vbmeta")));
  assert.equal(record.verifiedBoot.images.vbmeta_vendor, sha256(Buffer.from("signed vbmeta_vendor")));
  assert.deepEqual(record.verifiedBoot.chainedPartitions, ["vbmeta_system", "vbmeta_vendor"]);
  assert.equal(record.payload.sha256, sha256(Buffer.from("payload bytes")));
  assert.equal(record.payload.metadata["post-build"], FINGERPRINT);
  assert.equal(record.certificates.platform, key.platform);
  assert.equal(record.certificates.releasekey, key.releasekey);
  assert.deepEqual(record.apks, [{ file: "launcher-release.apk", sha256: "a".repeat(64), signerSha256: "d".repeat(64), versionCode: 7, distributable: false }]);
  assert.equal(record.artifacts.ota.type, "full");
  assert.equal(record.artifacts.ota.sha256, sha256(fs.readFileSync(path.join(out, "ota.zip"))));
  assert.deepEqual(record.problems, []);
  for (const flag of ["imageBooted", "signedUpdateApplied", "releaseQualified", "deviceAcceptanceVerified"]) assert.equal(record[flag], false, flag);
  assert.equal(record.downgradeAllowed, false);
  assert.ok(result.distributionProblems.some(problem => /signedUpdate drill is "not run"/.test(problem)), "drills still block distribution");
});

test("signing refuses unsafe keys, mismatched digests, changed inputs and unset descriptors without running a tool", async t => {
  const refuse = async (change, pattern) => {
    const fixture = setup(t);
    const options = change(fixture) ?? fixture.options;
    const existed = fs.existsSync(fixture.out);
    await assert.rejects(signRelease(options), pattern);
    assert.deepEqual(fixture.ota.calls(), [], `${pattern}: no releasetool ran`);
    if (!existed) assert.equal(fs.existsSync(fixture.out), false, "no output is created");
    const dry = await signRelease({ ...options, dryRun: true });
    assert.equal(dry.ran, false);
    assert.ok(dry.problems.some(problem => pattern.test(problem)), `${pattern}\n${dry.problems.join("\n")}`);
  };
  await refuse(({ key }) => { fs.chmodSync(key.keys, 0o755); }, /mode 0700/);
  await refuse(({ key }) => { fs.rmSync(path.join(key.keys, "platform.pk8")); }, /lacks platform\.pk8/);
  await refuse(({ key }) => { fs.writeFileSync(path.join(key.keys, "avb_pkmd.bin"), "other"); }, /avb_pkmd\.bin is not the product's avb\.publicKeySha256/);
  await refuse(({ key }) => { certificate(key.keys, "platform"); }, /platform\.x509\.pem is [0-9a-f]{64}, not the product's/);
  await refuse(({ key }) => { certificate(key.keys, "releasekey"); }, /not the channel's otaCertificateSha256/);
  // A public AOSP test key (or any unreviewed certificate) under another release name is refused.
  await refuse(({ key }) => { certificate(key.keys, "shared"); }, /shared\.x509\.pem is [0-9a-f]{64}, not the product's signer\.releaseCertificates\.shared/);
  await refuse(({ key }) => { certificate(key.keys, "apex"); }, /apex\.x509\.pem is [0-9a-f]{64}, not the product's signer\.releaseCertificates\.apex/);
  await refuse(({ repo }) => { const p = JSON.parse(fs.readFileSync(path.join(repo.dir, PIXEL10A_PRODUCT), "utf8")); repo.write(PIXEL10A_PRODUCT, { ...p, signer: { ...p.signer, releaseCertificates: { ...p.signer.releaseCertificates, media: "UNSET" } } }); }, /signer\.releaseCertificates\.media must be the reviewed certificate SHA-256/);
  await refuse(({ options }) => ({ ...options, targetFilesSha256: "0".repeat(64) }), /differs from --target-files-sha256/);
  await refuse(({ options }) => ({ ...options, keysDir: path.relative(process.cwd(), options.keysDir) }), /absolute path/);
  await refuse(({ options }) => { fs.mkdirSync(options.out); fs.chmodSync(options.out, 0o700); }, /already exists/);
  await refuse(({ repo }) => { repo.write(CHANNEL, { ...read(CHANNEL), avbPublicKeySha256: "UNSET" }); }, /avbPublicKeySha256 is unset/);
  await refuse(({ repo }) => { repo.write(CHANNEL, { ...JSON.parse(fs.readFileSync(path.join(repo.dir, CHANNEL), "utf8")), downgradeAllowed: true }); }, /downgradeAllowed must be false/);
  await refuse(({ repo }) => { repo.write("android/release-signer.json", read("android/release-signer.json")); }, /signerSha256 is "unset"/);
  // Keys inside a Git working tree (for example this repository) are refused.
  await refuse(({ options, key }) => {
    const inside = fs.mkdtempSync(path.join(options.root, "keys-"));
    execFileSync("git", ["init", "-q", options.root]);
    for (const name of fs.readdirSync(key.keys)) fs.copyFileSync(path.join(key.keys, name), path.join(inside, name));
    fs.chmodSync(inside, 0o700);
    return { ...options, keysDir: inside };
  }, /inside this repository|inside a Git working tree/);
});

test("the compatibility record names mismatched OTA metadata and payload hashes", async t => {
  const { options, out } = setup(t, { postBuild: "other/fingerprint", fileHash: "AAAA" });
  await assert.rejects(signRelease(options), /Signed outputs are inconsistent[\s\S]*post-build other\/fingerprint[\s\S]*FILE_HASH/);
  const record = JSON.parse(fs.readFileSync(path.join(out, "release-record.json"), "utf8"));
  assert.equal(record.releaseQualified, false);
  assert.equal(record.problems.length, 2);
  // A target-files without vbmeta images or build properties is recorded as such, never filled in.
  const empty = path.join(path.dirname(out), "empty.zip"), otaZip = path.join(path.dirname(out), "empty-ota.zip");
  zip(empty, { "META/misc_info.txt": "" });
  zip(otaZip, { "other.txt": "" });
  const bare = await compatibilityRecord({ signedTargetFiles: empty, ota: otaZip, product: read(PIXEL10A_PRODUCT), channel: read(CHANNEL) });
  for (const expected of [/SYSTEM\/build\.prop is missing/, /IMAGES\/vbmeta\.img is missing/, /payload\.bin is missing/, /no build fingerprint/]) assert.ok(bare.problems.some(problem => expected.test(problem)), String(expected));
  assert.deepEqual(parseProperties("# c\na=b\nc = d=e\n"), { a: "b", c: "d=e" });
});

test("release blockers judge a recorded release against the current signer and the image platform certificate", () => {
  const row = { mode: "release", distributable: true, testMocks: false, bundleAudit: "passed", signed: true, signerSha256: "d".repeat(64), versionCode: 2, runtime: "PACKAGED", runtimeNotices: true,
    releaseAdmission: { failures: [], blockers: [], signerMatches: true }, voiceHost: { packaged: true, asr: true, differences: [], qualified: true }, licenceBlockers: [] };
  const signer = signerSha256 => ({ schema: 1, signerSha256, lastRelease: { versionCode: null, versionName: null, recordedAt: null } });
  assert.deepEqual(releaseBlockers(row), [], "the recorded admission alone");
  assert.ok(releaseBlockers(row, { releaseSigner: signer("unset") }).includes("release signer is unset in android/release-signer.json"));
  assert.ok(releaseBlockers(row, { releaseSigner: read("android/release-signer.json") }).some(item => /release signer is unset/.test(item)), "the committed signer is unset");
  assert.ok(releaseBlockers(row, { releaseSigner: signer("e".repeat(64)) }).some(item => /does not match android\/release-signer\.json/.test(item)));
  assert.deepEqual(releaseBlockers(row, { releaseSigner: signer("d".repeat(64)) }), []);
  assert.deepEqual(releaseBlockers(row, { releaseSigner: signer("d".repeat(64)), image: { platformCertificateSha256: "c".repeat(64) } }), []);
  for (const value of ["UNSET", undefined, "C".repeat(64)])
    assert.ok(releaseBlockers(row, { image: { platformCertificateSha256: value } }).some(item => /image platform certificate is .*not a reviewed release certificate/.test(item)), String(value));
  assert.ok(releaseBlockers(row, { releaseSigner: { schema: 2 } }).some(item => /release-signer\.json is invalid/.test(item)));
});

/** Run a refused signing: no tool runs, no output appears, and the dry run names the same problem. */
async function refusedBeforeSigning(fixture, options, pattern) {
  await assert.rejects(signRelease(options), pattern);
  assert.deepEqual(fixture.ota.calls(), [], `${pattern}: no releasetool ran`);
  assert.equal(fs.existsSync(fixture.out), false);
  const dry = await signRelease({ ...options, dryRun: true });
  assert.ok(dry.problems.some(problem => pattern.test(problem)), `${pattern}\n${dry.problems.join("\n")}`);
}

test("APK certificates without a release key mapping are refused before signing; --map-key admits them", async t => {
  const camera = apkcert("Camera.apk", "vendor/google/certs/camera.x509.pem");
  let fixture = setup(t, {}, { apkcerts: [...APKCERTS, camera], files: { "PRODUCT/app/Camera/Camera.apk": { CERT: TEST_KEY_DIGEST } } });
  await refusedBeforeSigning(fixture, fixture.options, /APK Camera\.apk is signed with vendor\/google\/certs\/camera\.x509\.pem, which no release key mapping covers/);
  // Mapped to a key in the key directory, the same build signs, and Camera.apk carries that key.
  fixture = setup(t, {}, { apkcerts: [...APKCERTS, camera], files: { "PRODUCT/app/Camera/Camera.apk": { CERT: TEST_KEY_DIGEST } } });
  const cameraDigest = certificate(fixture.key.keys, "camera");
  // A mapped certificate needs its own reviewed digest in the product descriptor.
  const pinned = JSON.parse(fs.readFileSync(path.join(fixture.repo.dir, PIXEL10A_PRODUCT), "utf8"));
  fixture.repo.write(PIXEL10A_PRODUCT, { ...pinned, signer: { ...pinned.signer, releaseCertificates: { ...pinned.signer.releaseCertificates, camera: cameraDigest } } });
  fs.writeFileSync(path.join(fixture.key.keys, "camera.pk8"), "TEST-ONLY-PRIVATE-MARKER");
  fs.chmodSync(path.join(fixture.key.keys, "camera.pk8"), 0o600);
  const options = { ...fixture.options, keyMap: { "vendor/google/certs/camera": "camera" } };
  const result = await signRelease(options);
  assert.ok(fixture.ota.calls()[0].includes(`vendor/google/certs/camera=${path.join(fixture.key.keys, "camera")}`));
  assert.equal(JSON.parse(fs.readFileSync(result.record, "utf8")).certificates.camera, cameraDigest);
  // External signing and a partly presigned APEX are refused.
  fixture = setup(t, {}, { apkcerts: [...APKCERTS, apkcert("Ext.apk", "EXTERNAL")] });
  await refusedBeforeSigning(fixture, fixture.options, /APK Ext\.apk is EXTERNAL/);
  fixture = setup(t, {}, { apexkeys: [...APEXKEYS, 'name="com.x.apex" public_key="PRESIGNED" private_key="PRESIGNED" container_certificate="x.x509.pem" container_private_key="x.pk8"'] });
  await refusedBeforeSigning(fixture, fixture.options, /APEX com\.x\.apex is only partly presigned/);
});

test("APEX keys are required when the build re-signs an APEX, and not otherwise", async t => {
  let fixture = setup(t);
  fs.rmSync(path.join(fixture.key.keys, "apex_payload.pem"));
  await refusedBeforeSigning(fixture, fixture.options, /lacks apex_payload\.pem/);
  fixture = setup(t);
  fs.rmSync(path.join(fixture.key.keys, "apex.pk8"));
  await refusedBeforeSigning(fixture, fixture.options, /lacks apex\.pk8/);
  // Only presigned APEXes: no APEX key is needed and no APEX mapping is passed.
  fixture = setup(t, {}, { apexkeys: [APEXKEYS[1]], files: { "SYSTEM/apex/com.android.foo.apex": "" } });
  for (const name of ["apex.pk8", "apex_payload.pem"]) fs.rmSync(path.join(fixture.key.keys, name));
  const dry = await signRelease({ ...fixture.options, dryRun: true });
  assert.ok(!dry.problems.some(problem => /apex/.test(problem)), dry.problems.join("\n"));
  assert.ok(!dry.commands[0].args.includes("--extra_apex_payload_key"));
});

test("a test, development or unknown certificate left after signing is refused before any OTA is built", async t => {
  for (const [config, pattern] of [
    [{ skip: ["Launcher.apk"] }, new RegExp(`Launcher\\.apk is signed with ${TEST_KEY_DIGEST}, which is not a release certificate`)],
    [{ skip: ["com.android.foo.apex"] }, /com\.android\.foo\.apex is signed with 0{64}, which is not a release certificate[\s\S]*does not carry the release APEX payload key/],
    [{ keepApexKey: true }, /com\.android\.foo\.apex does not carry the release APEX payload key/],
  ]) {
    const fixture = setup(t);
    fixture.ota.configure(config);
    await assert.rejects(signRelease(fixture.options), pattern);
    assert.deepEqual(fixture.ota.calls().map(call => call[0]), ["sign_target_files_apks"], "no OTA from a test-signed build");
    assert.equal(fs.existsSync(path.join(fixture.out, "ota.zip")), false);
    assert.equal(fs.existsSync(path.join(fixture.out, "release-record.json")), false);
  }
  // A package in neither apkcerts.txt nor apexkeys.txt is not silently trusted.
  const fixture = setup(t, {}, { files: { "SYSTEM/app/Stray/Stray.apk": { CERT: TEST_KEY_DIGEST } } });
  await assert.rejects(signRelease(fixture.options), /Stray\.apk is in neither apkcerts\.txt nor apexkeys\.txt/);
  // The verifier must exist before anything runs.
  const missing = setup(t);
  fs.rmSync(path.join(missing.ota.bin, "apksigner"));
  await refusedBeforeSigning(missing, missing.options, /an executable apksigner is required/);
});

test("chained AVB partitions come from the target-files and each needs a mapped key before signing", async t => {
  assert.deepEqual(chainedPartitionsFromMiscInfo(parseProperties([...MISC_INFO, "avb_boot_key_path=k.pem", "avb_init_boot_key_path=k.pem", "avb_vendor_boot_key_path=", "avb_system_hashtree_enable=true"].join("\n"))),
    ["boot", "init_boot", "vbmeta_system", "vbmeta_vendor"]);
  let fixture = setup(t, {}, { misc: [...MISC_INFO, "avb_boot_key_path=external/avb/test/data/testkey_rsa4096.pem", "avb_init_boot_key_path=external/avb/test/data/testkey_rsa4096.pem"] });
  await refusedBeforeSigning(fixture, fixture.options, /chained AVB partition boot has no mapped --avb_boot_key/);
  assert.ok((await signRelease({ ...fixture.options, dryRun: true })).problems.some(problem => /chained AVB partition init_boot has no mapped --avb_init_boot_key/.test(problem)));
  fixture = setup(t, {}, { misc: MISC_INFO.filter(line => !line.startsWith("avb_vbmeta_vendor")) });
  await refusedBeforeSigning(fixture, fixture.options, /maps --avb_vbmeta_vendor_key, but the target-files does not chain vbmeta_vendor/);
  fixture = setup(t, {}, { misc: MISC_INFO.map(line => line === "avb_enable=true" ? "avb_enable=false" : line) });
  await refusedBeforeSigning(fixture, fixture.options, /built without AVB/);
  // Mapped in the descriptor, boot is signed with the release avb key and recorded.
  fixture = setup(t, {}, { misc: [...MISC_INFO, "avb_boot_key_path=external/avb/test/data/testkey_rsa4096.pem"] });
  const product = JSON.parse(fs.readFileSync(path.join(fixture.repo.dir, PIXEL10A_PRODUCT), "utf8"));
  fixture.repo.write(PIXEL10A_PRODUCT, { ...product, avb: { ...product.avb, chainedPartitions: [...product.avb.chainedPartitions, "boot"] } });
  const result = await signRelease(fixture.options);
  const sign = fixture.ota.calls()[0];
  assert.equal(sign[sign.indexOf("--avb_boot_key") + 1], path.join(fixture.key.keys, "avb.pem"));
  const record = JSON.parse(fs.readFileSync(result.record, "utf8"));
  assert.deepEqual(Object.keys(record.verifiedBoot.images), ["vbmeta", "boot", "vbmeta_system", "vbmeta_vendor"]);
  assert.equal(record.verifiedBoot.images.boot, sha256(Buffer.from("signed boot")));
  // The record's required images follow the signed build's list: a chained image that is absent is named.
  const signedWithoutBoot = path.join(path.dirname(fixture.out), "no-boot.zip");
  zip(signedWithoutBoot, { "META/misc_info.txt": [...MISC_INFO, "avb_boot_key_path=k.pem"].join("\n"), "IMAGES/vbmeta.img": "v", "IMAGES/vbmeta_system.img": "s", "IMAGES/vbmeta_vendor.img": "x" });
  const bare = await compatibilityRecord({ signedTargetFiles: signedWithoutBoot, ota: path.join(fixture.out, "ota.zip"), product, channel: read(CHANNEL) });
  assert.ok(bare.problems.includes("IMAGES/boot.img is missing from the signed target-files"), bare.problems.join("\n"));
  assert.ok(!bare.problems.some(problem => /vbmeta_vendor\.img/.test(problem)));
});

test("key files must be private regular files, and commands receive the key directory's real path", async t => {
  let fixture = setup(t);
  fs.rmSync(path.join(fixture.key.keys, "platform.pk8"));
  fs.writeFileSync(path.join(path.dirname(fixture.out), "elsewhere.pk8"), "TEST-ONLY-PRIVATE-MARKER");
  fs.symlinkSync(path.join(path.dirname(fixture.out), "elsewhere.pk8"), path.join(fixture.key.keys, "platform.pk8"));
  await refusedBeforeSigning(fixture, fixture.options, /platform\.pk8 is a symbolic link/);
  fixture = setup(t);
  fs.chmodSync(path.join(fixture.key.keys, "avb.pem"), 0o644);
  await refusedBeforeSigning(fixture, fixture.options, /avb\.pem must not be readable or writable by group or others/);
  fixture = setup(t);
  fs.chmodSync(path.join(fixture.key.keys, "releasekey.x509.pem"), 0o660);
  await refusedBeforeSigning(fixture, fixture.options, /releasekey\.x509\.pem must not be readable or writable/);
  // A symlinked key directory is resolved: every key argument names the real directory.
  fixture = setup(t);
  const link = path.join(path.dirname(fixture.out), "keys-link");
  fs.symlinkSync(fixture.key.keys, link);
  const dry = await signRelease({ ...fixture.options, keysDir: link, dryRun: true });
  assert.deepEqual(dry.problems, []);
  const args = dry.commands.flatMap(command => command.args);
  assert.ok(args.some(arg => arg === fixture.key.keys));
  assert.ok(!args.some(arg => arg.includes("keys-link")), args.filter(arg => arg.includes("keys-link")).join("\n"));
});

test("git that cannot run is not proof the key directory is outside a working tree", () => {
  assert.match(gitWorkTreeProblem("/k", () => ({ error: new Error("spawn git ENOENT"), status: null })), /could not be confirmed/);
  assert.match(gitWorkTreeProblem("/k", () => ({ status: null, signal: "SIGKILL" })), /could not be confirmed/);
  assert.match(gitWorkTreeProblem("/k", () => ({ status: 128, stderr: "fatal: detected dubious ownership" })), /could not be confirmed/);
  assert.match(gitWorkTreeProblem("/k", () => ({ status: 0, stdout: "true\n" })), /inside a Git working tree/);
  assert.equal(gitWorkTreeProblem("/k", () => ({ status: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" })), null);
});

test("a child folder named ..keys is inside the repository; parents and unrelated paths are outside", () => {
  assert.equal(isWithin("/repo", "/repo/..keys"), true, "a child folder named ..keys is inside");
  assert.equal(isWithin("/repo/sub", "/repo/..keys"), false);
  assert.equal(isWithin("/repo", "/repo"), true);
  assert.equal(isWithin("/repo", "/repo/keys/a"), true);
  assert.equal(isWithin("/repo", "/other"), false);
  assert.equal(isWithin("/repo", "/"), false);
});

test("an incremental OTA records its predecessor by file and SHA-256 on the signing and the standalone record paths", async t => {
  const previous = setup(t);
  await signRelease(previous.options);
  const prior = path.join(previous.out, "signed-target_files.zip"), priorSha = sha256(fs.readFileSync(prior));
  const fixture = setup(t);
  const result = await signRelease({ ...fixture.options, incrementalFrom: prior });
  const record = JSON.parse(fs.readFileSync(result.record, "utf8"));
  assert.equal(record.artifacts.ota.type, "incremental");
  assert.deepEqual(record.artifacts.ota.incrementalFrom, { file: "signed-target_files.zip", sha256: priorSha });
  const file = path.join(path.dirname(fixture.out), "standalone-record.json");
  const out = spawnSync(process.execPath, [path.join(root, "scripts/aosp-release-record.mjs"), "--signed-target-files", path.join(fixture.out, "signed-target_files.zip"),
    "--ota", path.join(fixture.out, "incremental-ota.zip"), "--incremental-from", prior, "--out", file], { cwd: fixture.repo.dir, encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).artifacts.ota.incrementalFrom, record.artifacts.ota.incrementalFrom);
  const loose = await compatibilityRecord({ signedTargetFiles: path.join(fixture.out, "signed-target_files.zip"), ota: path.join(fixture.out, "incremental-ota.zip"), product: read(PIXEL10A_PRODUCT), channel: read(CHANNEL), incrementalFrom: "signed-target_files.zip" });
  assert.ok(loose.problems.some(problem => /incrementalFrom must identify the previous signed target-files by file and SHA-256/.test(problem)));
});

/**
 * Managed (hardware-backed) signing: the key directory holds only certificates and public keys, and
 * the token, AVB helper and payload signer are throwaway files. These establish the releasetools
 * arguments and refusals, not that any real token, HSM or managed service signed anything.
 */
function managedSetup(t, tf = {}) {
  const fixture = setup(t, {}, tf);
  const { keys } = fixture.key;
  for (const name of fs.readdirSync(keys).filter(name => name.endsWith(".pk8"))) fs.rmSync(path.join(keys, name));
  for (const name of ["avb.pem", "apex_payload.pem"]) {
    fs.writeFileSync(path.join(keys, name), "-----BEGIN PUBLIC KEY-----\nTEST-ONLY-PUBLIC-MARKER\n-----END PUBLIC KEY-----\n");
    fs.chmodSync(path.join(keys, name), 0o600);
  }
  const tools = temporary(t, "alpha-managed-signing-");
  const pkcs11Config = path.join(tools, "token.cfg"), avbSigningHelper = path.join(tools, "avb-helper"), payloadSigner = path.join(tools, "payload-signer");
  fs.writeFileSync(pkcs11Config, "name = AlphaRelease\nlibrary = /usr/lib/pkcs11/token.so\n");
  for (const file of [avbSigningHelper, payloadSigner]) { fs.writeFileSync(file, "#!/bin/sh\nexit 1\n"); fs.chmodSync(file, 0o755); }
  const managed = { pkcs11Config, avbSigningHelper, payloadSigner, payloadSignerArgs: ["-key", "alpha-release-ota"], payloadSignerSignatureSize: "512" };
  return { ...fixture, managed, options: { ...fixture.options, ...managed } };
}

test("managed signing keeps private keys in the token and passes the helper, keystore and payload signer to the releasetools", async t => {
  const fixture = managedSetup(t);
  const { keys } = fixture.key, { managed } = fixture;
  const dry = await signRelease({ ...fixture.options, dryRun: true });
  assert.deepEqual(dry.problems, []);
  assert.equal(dry.signingMode, "managed");
  assert.equal(dry.tokenLabels.platform, path.join(keys, "platform.pk8"), "signapk looks up the private-key path as the token label");
  assert.equal(dry.tokenLabels.apex, path.join(keys, "apex.pk8"));
  const result = await signRelease(fixture.options);
  const [sign, ota] = fixture.ota.calls();
  const value = (call, flag) => call[call.indexOf(flag) + 1];
  const keystore = `-providerClass sun.security.pkcs11.SunPKCS11 -providerArg ${managed.pkcs11Config} -loadPrivateKeysFromKeyStore PKCS11`;
  for (const call of [sign, ota]) {
    assert.equal(value(call, "--extra_signapk_args"), keystore);
    assert.equal(value(call, "--java_args"), PKCS11_JAVA_ARGS.join(" "));
  }
  for (const partition of ["vbmeta", ...fixture.repo.product.avb.chainedPartitions, "apex"])
    assert.equal(value(sign, `--avb_${partition}_extra_args`), `--signing_helper_with_files ${managed.avbSigningHelper}`, partition);
  assert.equal(value(sign, "--avb_vbmeta_key"), path.join(keys, "avb.pem"), "avbtool receives the public key; the helper signs");
  assert.equal(value(ota, "-k"), path.join(keys, "releasekey"));
  assert.equal(value(ota, "--payload_signer"), managed.payloadSigner);
  assert.equal(value(ota, "--payload_signer_args"), "-key alpha-release-ota");
  assert.equal(value(ota, "--payload_signer_maximum_signature_size"), "512");
  const text = fs.readFileSync(result.record, "utf8");
  assert.equal(JSON.parse(text).inputs.signingMode, "managed");
  assert.doesNotMatch(text, /TEST-ONLY/);
  // The default job passes none of it, and records key-file signing.
  const plain = setup(t);
  const record = JSON.parse(fs.readFileSync((await signRelease(plain.options)).record, "utf8"));
  assert.equal(record.inputs.signingMode, "key-files");
  assert.ok(!plain.ota.calls().flat().some(arg => /signing_helper|payload_signer|extra_signapk_args|java_args/.test(arg)));
});

test("managed signing refuses mixed or unsafe inputs before any tool runs", async t => {
  const refuse = async (change, pattern) => {
    const fixture = managedSetup(t);
    await refusedBeforeSigning(fixture, change(fixture) ?? fixture.options, pattern);
  };
  await refuse(({ options }) => ({ ...options, payloadSigner: undefined }), /managed signing needs .* together; missing --payload-signer/);
  await refuse(({ options }) => ({ ...options, payloadSignerSignatureSize: undefined }), /missing --payload-signer-signature-size/);
  await refuse(({ key }) => { fs.writeFileSync(path.join(key.keys, "platform.pk8"), "TEST-ONLY-PRIVATE-MARKER"); fs.chmodSync(path.join(key.keys, "platform.pk8"), 0o600); }, /holds platform\.pk8; managed signing keeps private keys in the PKCS#11 token/);
  await refuse(({ key }) => { fs.writeFileSync(path.join(key.keys, "avb.pem"), "TEST-ONLY-PRIVATE-MARKER"); }, /avb\.pem must be the public key/);
  await refuse(({ key }) => { fs.writeFileSync(path.join(key.keys, "apex_payload.pem"), "-----BEGIN PRIVATE KEY-----\n"); }, /apex_payload\.pem must be the public key/);
  await refuse(({ key }) => { fs.rmSync(path.join(key.keys, "media.x509.pem")); }, /lacks media\.x509\.pem \(managed signing needs every release certificate and public key\)/);
  await refuse(({ options }) => ({ ...options, pkcs11Config: "token.cfg" }), /--pkcs11-config must be an absolute path/);
  await refuse(({ options }) => { const spaced = path.join(path.dirname(options.avbSigningHelper), "avb helper"); fs.copyFileSync(options.avbSigningHelper, spaced); fs.chmodSync(spaced, 0o755); return { ...options, avbSigningHelper: spaced }; }, /--avb-signing-helper must be a path without spaces/);
  await refuse(({ options }) => { fs.chmodSync(options.payloadSigner, 0o644); }, /--payload-signer .* is not executable/);
  await refuse(({ options }) => ({ ...options, pkcs11Config: path.join(path.dirname(options.pkcs11Config), "absent.cfg") }), /--pkcs11-config .* is not a regular file/);
  await refuse(({ options }) => ({ ...options, payloadSignerSignatureSize: "0" }), /maximum signature size in bytes/);
  await refuse(({ options }) => ({ ...options, payloadSignerArgs: ["-pin", "1234 5678"] }), /--payload-signer-arg "1234 5678" must be a plain word/);
});

test("only chained partitions sign_target_files_apks can re-sign are admitted", async t => {
  assert.deepEqual([...AVB_SIGNABLE_PARTITIONS].sort(), ["boot", "dtbo", "init_boot", "recovery", "system", "system_other", "vbmeta_system", "vbmeta_vendor", "vendor"]);
  const fixture = setup(t, {}, { misc: [...MISC_INFO, "avb_vendor_boot_key_path=external/avb/test/data/testkey_rsa4096.pem"] });
  const product = JSON.parse(fs.readFileSync(path.join(fixture.repo.dir, PIXEL10A_PRODUCT), "utf8"));
  fixture.repo.write(PIXEL10A_PRODUCT, { ...product, avb: { ...product.avb, chainedPartitions: [...product.avb.chainedPartitions, "vendor_boot"] } });
  await refusedBeforeSigning(fixture, fixture.options, /chained partition vendor_boot has no --avb_vendor_boot_key in sign_target_files_apks/);
});

test("managed signing options parse from the command line; a signer argument may start with dashes", () => {
  assert.deepEqual(parseSigningArgs(["--pkcs11-config", "/t.cfg", "--avb-signing-helper", "/h", "--payload-signer", "/s", "--payload-signer-arg", "--key", "--payload-signer-arg", "ota", "--payload-signer-signature-size", "512"]),
    { dryRun: false, pkcs11Config: "/t.cfg", avbSigningHelper: "/h", payloadSigner: "/s", payloadSignerArgs: ["--key", "ota"], payloadSignerSignatureSize: "512" });
  assert.throws(() => parseSigningArgs(["--payload-signer-arg"]), /Use --target-files/);
  assert.throws(() => parseSigningArgs(["--pkcs11-config", "/a", "--pkcs11-config", "/b"]), /Use --target-files/);
});
