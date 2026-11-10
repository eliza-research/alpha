import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pixel10aSourceLayout, pixel10aVendorApi, writePixel10aProduct} from '../scripts/aosp-pixel10a.mjs';

test('consumer composition retains installed product, vendor and Pixel provider identities',()=>{
  const product=JSON.parse(fs.readFileSync('android/aosp/pixel10a-composition.json','utf8'));
  assert.equal(product.vendorDirectory,'alphaphone');
  assert.equal(product.productName,'alpha_stallion_phone');
  assert.equal(product.launcher.packageName,'ai.alphacompute.alphaphone');
  assert.equal(product.sense.componentPackage,'ai.alphacompute.alphaphone.sense');
  assert.deepEqual(product.pixelConfig,{moduleName:'AlphaPixelConfig',packageName:'ai.elizaresearch.pixelconfig',mimeType:'vnd.android.cursor.dir/vnd.alpha.pixel-flags'});
  assert.equal(product.releaseQualified,false);
});

function assertSingleProductRegistration(output) {
  const staged = fs.readdirSync(output, {recursive:true});
  assert.deepEqual(staged.filter(file => path.basename(file) === 'AndroidProducts.mk'), ['AndroidProducts.mk']);
  assert.deepEqual(staged.filter(file => path.basename(file) === 'alpha_stallion_phone.mk'), ['alpha_stallion_phone.mk']);
  const source = path.resolve('vendor/eliza/packages/os/android/devices/pixel10a');
  const composition = JSON.parse(fs.readFileSync('android/aosp/pixel10a-composition.json', 'utf8'));
  const hardware = JSON.parse(fs.readFileSync(path.join(output, 'physical-product.json'), 'utf8')).hardwareComposition;
  assert.equal(hardware.vendorDirectory, composition.vendorDirectory);
  assert.deepEqual(hardware.pixelConfig, composition.pixelConfig);
  const sourceFiles = fs.readdirSync(source, {recursive:true}).filter(relative => fs.statSync(path.join(source, relative)).isFile()).sort();
  assert.deepEqual(hardware.files.map(file => file.sourcePath).sort(), sourceFiles, 'every hardware template input is recorded');
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const file of hardware.files) {
    const before = fs.readFileSync(path.join(source, file.sourcePath));
    const expectedPath = 'stallion/' + file.sourcePath.replace('src/ai/eliza/hardware/pixelconfig/', 'src/' + composition.pixelConfig.packageName.replaceAll('.', '/') + '/');
    assert.equal(file.path, expectedPath, 'only the installed provider package relocates source files');
    const after = fs.readFileSync(path.join(output, file.path));
    assert.equal(file.sourceSha256, sha256(before), file.sourcePath);
    assert.equal(file.sha256, sha256(after), file.path);
    assert.equal(file.mode, fs.statSync(path.join(source, file.sourcePath)).mode & 0o777, file.sourcePath);
    assert.equal(fs.statSync(path.join(output, file.path)).mode & 0o777, file.mode, file.path);
    let expected = before.toString('utf8')
      .replaceAll('@VENDOR_DIRECTORY@', composition.vendorDirectory)
      .replaceAll('@PIXEL_CONFIG_MODULE@', composition.pixelConfig.moduleName);
    if (file.sourcePath.startsWith('vendor-config/')) expected = expected
      .replaceAll('PixelConfig', composition.pixelConfig.moduleName)
      .replaceAll('ai.eliza.hardware.pixelconfig', composition.pixelConfig.packageName)
      .replaceAll('vnd.android.cursor.dir/vnd.eliza.pixel-flags', composition.pixelConfig.mimeType);
    assert.deepEqual(after, Buffer.from(expected), 'only declared product identities may change: ' + file.sourcePath);
    if (!before.includes('@VENDOR_DIRECTORY@') && !before.includes('@PIXEL_CONFIG_MODULE@') && !file.sourcePath.startsWith('vendor-config/')) {
      assert.deepEqual(after, before, 'other board, policy and patch inputs stay unchanged: ' + file.sourcePath);
    }
  }
}

// A staged overlay as stage-aosp leaves it before the Pixel step: an ARM64 launcher APK, its
// Android.bp import and an existing product.mk.
function pixelOverlay(temporary, product) {
  const apk = path.join(temporary, 'input.apk'), output = path.join(temporary, 'overlay');
  fs.mkdirSync(output);
  execFileSync('python3', ['-c', "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('lib/arm64-v8a/libcamera.so',b'\\x7fELF\\x02\\x01'+bytes(12)+b'\\xb7\\x00'+bytes(44)); z.close()", apk]);
  fs.writeFileSync(path.join(output, 'Android.bp'), '// Generated from a hash- and signer-verified downstream launcher.\nandroid_app_import {\n    name: "AlphaPhone",\n    apk: "Launcher.apk",\n    presigned: true,\n    preprocessed: true,\n    product_specific: true,\n    dex_preopt: { enabled: false },\n}\n');
  fs.copyFileSync(apk,path.join(output,'Launcher.apk'));
  fs.writeFileSync(path.join(output, 'product.mk'), product);
  return {apk, output};
}

test('physical overlay installs ARM64 JNI and development product without boot claims', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pixel-stage-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  const {apk, output} = pixelOverlay(temporary, '# existing camera, clock and image capability\n');
  writePixel10aProduct({root:process.cwd(), output, apk, identity:{moduleName:'AlphaPhone'}, launcher:{schemaVersion:1,brand:'alphaphone',moduleName:'AlphaPhone',packageName:'ai.alphacompute.alphaphone',apkSha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),certificateSha256:'b'.repeat(64)}, sourceEvidence:{fixture:true}});
  assertSingleProductRegistration(output);
  const product = fs.readFileSync(path.join(output, 'product.mk'), 'utf8');
  assert.match(product, /existing camera, clock and image capability/);
  assert.match(product, /TARGET_FS_CONFIG_GEN \+= vendor\/alphaphone\/config.fs/);
  assert.equal(product.match(/^PRODUCT_PACKAGES \+= DeskClock$/gm)?.length, 1, 'the shared composition keeps the system Clock once');
  assert.match(fs.readFileSync(path.join(output, 'AndroidProducts.mk'), 'utf8'), /alpha_stallion_phone/);
  assert.ok(fs.existsSync(path.join(output, 'stallion/vendor-config/Android.bp')));
  const report = JSON.parse(fs.readFileSync(path.join(output, 'physical-product.json')));
  assert.equal(report.developmentOnly, true);
  for (const key of ['imageBuilt','releaseQualified','deviceAcceptanceVerified']) assert.equal(report[key], false);
});

test('production physical overlay sets no board AVB variables and records no build, signing or acceptance', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-pixel-production-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  const {apk, output} = pixelOverlay(temporary, '# existing\n');
  writePixel10aProduct({root:process.cwd(), output, apk, identity:{moduleName:'AlphaPhone'}, launcher:{schemaVersion:1,brand:'alphaphone',moduleName:'AlphaPhone',packageName:'ai.alphacompute.alphaphone',apkSha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'),certificateSha256:'b'.repeat(64)}, sourceEvidence:{fixture:true}, production:true});
  assertSingleProductRegistration(output);
  const productMk = fs.readFileSync(path.join(output, 'product.mk'), 'utf8');
  assert.doesNotMatch(productMk, /BOARD_AVB_|release-avb/);
  assert.equal(fs.existsSync(path.join(output, 'stallion/release-avb.mk')), false);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'physical-product.json')));
  assert.equal(report.production, true);
  assert.equal(report.lunch, 'alpha_stallion_phone-cp2a-user');
  assert.equal(report.productDescriptor.file, 'android/aosp/pixel10a-product.json');
  for (const key of ['imageBuilt','imageSigned','releaseQualified','deviceAcceptanceVerified']) assert.equal(report[key], false, key);
});

test('native admission fixtures cover corrupt provenance, policy, ELF and overlay inputs', () => {
  execFileSync('python3', ['test/aosp-native-fixtures.py'], {stdio:'pipe'});
});

test('Pixel staging takes the shared stock stallion vendor API check before writing anything', t => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-stallion-api-'));
  t.after(() => fs.rmSync(source, {recursive:true, force:true}));
  const api = JSON.parse(fs.readFileSync('vendor/eliza/packages/os/android/aosp.lock.json', 'utf8')).profiles.pixel10a.device.vendorApiLevel;
  const release = JSON.parse(fs.readFileSync('android/aosp/pixel10a-composition.json', 'utf8')).releaseConfig;
  const flag = path.join(source, 'build/release/flag_values', release, 'RELEASE_BOARD_API_LEVEL.textproto');
  const manifest = path.join(source, 'vendor/google_devices/stallion/vintf/vendor/manifest.xml');
  for (const file of [flag, manifest]) fs.mkdirSync(path.dirname(file), {recursive:true});
  fs.writeFileSync(flag, `value: { string_value: "${api}" }\n`);
  fs.writeFileSync(manifest, `<manifest><sepolicy><version>${api}</version></sepolicy></manifest>\n`);
  const hardware = path.join(source, 'vendor/google_devices/stallion/stallion.mk');
  const include = '$(call inherit-product, vendor/alphaphone/stallion/device.mk)\n';
  fs.writeFileSync(hardware, include);
  assert.deepEqual(pixel10aSourceLayout({source}), {
    vendorDirectory:'alphaphone',path:'vendor/google_devices/stallion/stallion.mk',
    sha256:createHash('sha256').update(include).digest('hex'),
  });
  fs.writeFileSync(hardware, include.replace('vendor/alphaphone/', 'vendor/foreign/'));
  assert.throws(() => pixel10aSourceLayout({source}), /source layout differs/);
  assert.equal(fs.readFileSync(hardware,'utf8'),include.replace('vendor/alphaphone/','vendor/foreign/'),'layout mismatch is never rewritten');
  assert.deepEqual(pixel10aVendorApi({source}), {codename:'stallion', releaseConfig:release, vendorApiLevel:api});
  fs.writeFileSync(manifest, '<manifest><sepolicy><version>202504</version></sepolicy></manifest>\n');
  assert.throws(() => pixel10aVendorApi({source}), /must retain locked API/);
  const stage = fs.readFileSync('scripts/stage-aosp.mjs', 'utf8');
  const check = stage.indexOf('pixel10aVendorApi({root:process.cwd()');
  assert.ok(check > stage.indexOf('verifyPixel10aSource({') && check < stage.indexOf('fs.mkdtempSync('), 'checked after source admission, before any output');
  const layout = stage.indexOf('physicalSource.hardwareLayout = pixel10aSourceLayout(');
  assert.ok(layout > stage.indexOf('verifyPixel10aSource({') && layout < check, 'layout checked only after full source admission and before output');
});
