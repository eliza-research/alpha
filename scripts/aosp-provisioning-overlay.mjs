/** Alpha requires its existing Autofill surface and Files all-files access; shared image composition is upstream. */
import fs from 'node:fs';
import path from 'node:path';
import {provisioningComponents as sharedComponents, renderProvisioningOverlay as sharedRender} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';
export {manifestComponents} from '../vendor/eliza/packages/os/scripts/android/launcher-provisioning.mjs';

/**
 * Files all-files access (decision F1). MANAGE_EXTERNAL_STORAGE is signature|appop|preinstalled:
 * Android grants it to an app installed on the system image, and with the app-op left at its
 * default Environment.isExternalStorageManager() reads that grant. The launcher must request it.
 */
export function requestsAllFilesAccess(xmltree) {
  return /E: uses-permission[^\n]*\n(?:\s+A: [^\n]*\n)*?\s+A: android:name\([^)]*\)="android\.permission\.MANAGE_EXTERNAL_STORAGE"/.test(xmltree + '\n');
}

export function provisioningComponents(xmltree, packageName) {
  const components = sharedComponents(xmltree, packageName);
  if (!components.autofill) throw new Error('The Alpha APK must declare exactly one BIND_AUTOFILL_SERVICE AutofillService');
  if (!requestsAllFilesAccess(xmltree)) throw new Error('The Alpha APK must request android.permission.MANAGE_EXTERNAL_STORAGE for Files');
  return components;
}

export function renderProvisioningOverlay(packageName, components) {
  const files = sharedRender(packageName, components);
  const readme = files['provisioning/README.md'], tail = '\nThe stock launcher is not removed.';
  if (!readme.includes(tail)) throw new Error('Unexpected shared provisioning README');
  files['provisioning/README.md'] = readme.replace(tail, `- All files access: \`MANAGE_EXTERNAL_STORAGE\` (signature|appop|preinstalled) is granted to the
  preinstalled launcher; the app-op stays at its default, which reads that grant.
${tail}`);
  return files;
}

export function writeProvisioningOverlay(output, packageName, components) {
  const files = renderProvisioningOverlay(packageName, components);
  for (const [name, content] of Object.entries(files)) {
    if (name === 'productMakefile') continue;
    const file = path.join(output, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, content, {flag: 'wx'});
  }
  fs.appendFileSync(path.join(output, 'product.mk'), files.productMakefile);
  return files;
}
