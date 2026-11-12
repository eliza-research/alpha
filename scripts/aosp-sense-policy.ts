import { createHash, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const policySource = 'android/aosp/branding/sense-policy';
const publicCertificate = 'android/signing/public/alphaphone_app.x509.pem';
const launcherPackage = 'ai.alphacompute.alphaphone';
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

interface AlphaSensePolicyOptions {
  root: string;
  output: string;
  appId: string;
  certificateSha256: string;
}

/** Stage the private policy for the already admitted, same-signer image listener. */
export function stageAlphaSensePolicy({root, output, appId, certificateSha256}: AlphaSensePolicyOptions) {
  if (appId !== launcherPackage) throw Error('Alpha Sense SELinux policy requires the Alpha launcher package');
  const certificate = new X509Certificate(fs.readFileSync(path.join(root, publicCertificate))).raw;
  if (sha256(certificate) !== certificateSha256)
    throw Error('Alpha Sense SELinux policy certificate differs from the admitted APK signer');

  const macPermissions = `<?xml version="1.0" encoding="utf-8"?>
<policy>
  <signer signature="${certificate.toString('hex')}">
    <package name="${launcherPackage}.sense">
      <seinfo value="alpha_sense" />
    </package>
  </signer>
</policy>
`;
  const files = [
    {name: 'alpha_sense_app.te', bytes: fs.readFileSync(path.join(root, policySource, 'alpha_sense_app.te'))},
    {name: 'mac_permissions.xml', bytes: Buffer.from(macPermissions)},
    {name: 'seapp_contexts', bytes: fs.readFileSync(path.join(root, policySource, 'seapp_contexts'))},
  ];
  const listener = path.join(output, 'listener');
  if (!fs.lstatSync(listener, {throwIfNoEntry: false})?.isDirectory() ||
      !fs.lstatSync(path.join(listener, 'AlphaSense.apk'), {throwIfNoEntry: false})?.isFile())
    throw Error('Alpha Sense SELinux policy requires the staged listener APK');
  const directory = path.join(listener, 'sepolicy');
  fs.mkdirSync(directory);
  for (const {name, bytes} of files) fs.writeFileSync(path.join(directory, name), bytes, {flag: 'wx'});
  return sha256(JSON.stringify(files.map(({name, bytes}) => ({name, sha256: sha256(bytes)}))));
}
