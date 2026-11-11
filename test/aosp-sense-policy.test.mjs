import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {stageAlphaSensePolicy} from '../scripts/aosp-sense-policy.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'android/aosp/branding/sense-policy');
const appId = 'ai.alphacompute.alphaphone';
const release = JSON.parse(fs.readFileSync(path.join(root, 'android/release-signer.json')));
const certificateSha256 = release.signerSha256;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileNames = ['alpha_sense_app.te', 'mac_permissions.xml', 'seapp_contexts'];

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sense-policy-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

function stagedListener(output) {
  const listener = path.join(output, 'listener');
  fs.mkdirSync(listener, {recursive: true});
  fs.writeFileSync(path.join(listener, 'AlphaSense.apk'), 'already admitted fixture');
  return path.join(listener, 'sepolicy');
}

test('Sense policy stages one package and one public certificate with a reproducible digest', t => {
  const output = temporary(t);
  const directory = stagedListener(output);
  const other = path.join(output, 'second');
  stagedListener(other);
  const options = {root, output, appId, certificateSha256};
  const digest = stageAlphaSensePolicy(options);
  assert.equal(digest, stageAlphaSensePolicy({...options, output: other}));
  assert.deepEqual(fs.readdirSync(directory).sort(), fileNames);
  assert.equal(digest, sha(JSON.stringify(fileNames.map(name => ({
    name, sha256: sha(fs.readFileSync(path.join(directory, name))),
  })))));

  const mac = path.join(directory, 'mac_permissions.xml');
  const certificate = new X509Certificate(fs.readFileSync(path.join(root, 'android/signing/public/alphaphone_app.x509.pem')));
  const result = execFileSync('python3', ['-c', `
import json, sys, xml.etree.ElementTree as ET
policy = ET.parse(sys.argv[1]).getroot()
assert policy.tag == 'policy'
assert [node.tag for node in policy] == ['signer']
signer, = policy
assert [node.tag for node in signer] == ['package']
package, = signer
assert [node.tag for node in package] == ['seinfo']
seinfo, = package
print(json.dumps([signer.attrib, package.attrib, seinfo.attrib]))
`, mac], {encoding: 'utf8'});
  assert.deepEqual(JSON.parse(result), [
    {signature: certificate.raw.toString('hex')}, {name: `${appId}.sense`}, {value: 'alpha_sense'},
  ]);
  const contexts = fs.readFileSync(path.join(directory, 'seapp_contexts'), 'utf8').trim();
  assert.deepEqual(Object.fromEntries(contexts.split(/\s+/).map(token => token.split('='))), {
    user: '_app', seinfo: 'alpha_sense', name: `${appId}.sense`, isPrivApp: 'true',
    domain: 'alpha_sense_app', type: 'alpha_sense_app_data_file', levelFrom: 'all',
  });
  const policy = fs.readFileSync(path.join(directory, 'alpha_sense_app.te'), 'utf8');
  assert.match(policy, /app_domain\(alpha_sense_app\)/);
  assert.match(policy, /neverallow alpha_sense_app self:\{ tcp_socket udp_socket rawip_socket icmp_socket packet_socket \}/);
  assert.doesNotMatch(policy, /net_domain\(|priv_app_domain\(|platform_app_domain\(|permissive\s|hal_client_domain\(/);
});

test('policy staging rejects wrong signer, wrong product, missing listener and existing output', t => {
  const output = temporary(t);
  const options = {root, output, appId, certificateSha256};
  assert.throws(() => stageAlphaSensePolicy(options), /requires the staged listener APK/);
  const directory = stagedListener(output);
  assert.throws(() => stageAlphaSensePolicy({...options, appId: `${appId}.other`}), /requires the Alpha launcher package/);
  assert.throws(() => stageAlphaSensePolicy({...options, certificateSha256: 'a'.repeat(64)}), /certificate differs/);
  assert.equal(fs.existsSync(directory), false);
  stageAlphaSensePolicy(options);
  assert.throws(() => stageAlphaSensePolicy(options), {code: 'EEXIST'});
});

test('pinned board patch selects complete Alpha listener policy without affecting other targets', t => {
  const dir = temporary(t);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  const patch = fs.readFileSync(path.join(source, manifest.patch), 'utf8');
  assert.equal(sha(patch), manifest.patchSha256);
  const inventory = fs.readFileSync(path.join(root, 'vendor/eliza/packages/os/android/sources/pixel10a-stallion.json'));
  assert.equal(sha(inventory), manifest.baselineLockSha256);
  assert.equal(JSON.parse(inventory).projects.find(project => project.path === manifest.project)?.commit, manifest.revision);

  // Execute the exact added Make fragment against isolated board and stage inputs.
  const fragment = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .map(line => line.slice(1)).join('\n');
  fs.writeFileSync(path.join(dir, 'Makefile'), `SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS := stock-policy\n${fragment}\nshow:\n\t@printf '%s\\n' '$(SYSTEM_EXT_PRIVATE_SEPOLICY_DIRS)'\n`);
  const evaluate = (product = 'alpha_stallion_phone', device = 'stallion') => execFileSync('make', [
    '-s', 'show', `TARGET_PRODUCT=${product}`, `TARGET_DEVICE=${device}`,
  ], {cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  assert.equal(evaluate(), 'stock-policy');
  const directory = stagedListener(path.join(dir, 'vendor/alphaphone'));
  assert.throws(() => evaluate(), /complete staged SELinux policy/);
  fs.mkdirSync(directory);
  for (const name of fileNames) fs.writeFileSync(path.join(directory, name), 'fixture');
  assert.equal(evaluate(), 'stock-policy vendor/alphaphone/listener/sepolicy');
  assert.equal(evaluate('aosp_stallion'), 'stock-policy');
  assert.equal(evaluate(undefined, 'cuttlefish'), 'stock-policy');
  for (const name of ['extra.te', '.extra.te']) {
    const extra = path.join(directory, name);
    fs.writeFileSync(extra, 'fixture');
    assert.throws(() => evaluate(), /complete staged SELinux policy/);
    fs.unlinkSync(extra);
  }
  fs.unlinkSync(path.join(dir, 'vendor/alphaphone/listener/AlphaSense.apk'));
  assert.throws(() => evaluate(), /requires the admitted AlphaSense APK/);
});
