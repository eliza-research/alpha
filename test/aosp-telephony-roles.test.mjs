import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {aospTelephonyRoleComponents, writeAospTelephonyRoles} from '../scripts/aosp-telephony-roles.ts';

const pkg = 'ai.alphacompute.alphaphone';
const enabled = '(type 0x12)0xffffffff';
const disabled = '(type 0x12)0x0';
const element = (depth, name, attrs) => [
  `${' '.repeat(depth)}E: ${name} (line=1)`,
  ...Object.entries(attrs).map(([key, value]) =>
    `${' '.repeat(depth + 2)}A: android:${key}(0x01010003)=${value.startsWith('(type') ? value : JSON.stringify(value)}`),
];
const component = (tag, name, publicEntry, permission, attrs = {}) =>
  element(6, tag, {name, enabled: disabled, exported: publicEntry ? enabled : disabled, ...(permission && {permission}), ...attrs});
const filter = (action, data, defaultCategory = false) => [
  ...element(8, 'intent-filter', {}),
  ...element(10, 'action', {name: action}),
  ...(defaultCategory ? element(10, 'category', {name: 'android.intent.category.DEFAULT'}) : []),
  ...(data ? element(10, 'data', data) : []),
];
const apkTree = [
  '  E: manifest (line=1)', `    A: package="${pkg}"`, '    E: application (line=2)',
  ...component('activity', '.MainActivity', true),
  ...component('service', '.AlphaInCallService', true, 'android.permission.BIND_INCALL_SERVICE'),
  ...element(8, 'meta-data', {name: 'android.telecom.IN_CALL_SERVICE_UI', value: enabled}),
  ...filter('android.telecom.InCallService'),
  ...component('activity', '.AlphaCallActivity', false),
  ...component('activity', `${pkg}.AlphaDialPadActivity`, true),
  ...filter('android.intent.action.DIAL', null, true),
  ...filter('android.intent.action.DIAL', {scheme: 'tel'}, true),
  ...component('receiver', '.AlphaSmsDeliverReceiver', true, 'android.permission.BROADCAST_SMS'),
  ...filter('android.provider.Telephony.SMS_DELIVER'),
  ...component('receiver', '.AlphaMmsWapPushReceiver', true, 'android.permission.BROADCAST_WAP_PUSH'),
  ...filter('android.provider.Telephony.WAP_PUSH_DELIVER', {mimeType: 'application/vnd.wap.mms-message'}),
  ...component('receiver', '.AlphaMmsResultReceiver', false),
  ...component('service', '.AlphaRespondViaMessageService', true, 'android.permission.SEND_RESPOND_VIA_MESSAGE'),
  ...filter('android.intent.action.RESPOND_VIA_MESSAGE', {scheme: 'smsto'}, true),
  ...component('activity', '.AlphaSmsComposeActivity', true),
  ...filter('android.intent.action.SENDTO', {scheme: 'smsto'}, true),
  ...component('provider', 'ai.eliza.plugins.messages.MmsFileProvider', false, null, {
    authorities: `${pkg}.mms`, grantUriPermissions: enabled,
  }),
].join('\n');

test('the exact disabled launcher components become available to first-run role qualification on the image', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-aosp-telephony-'));
  t.after(() => fs.rmSync(out, {recursive: true, force: true}));
  fs.mkdirSync(path.join(out, 'provisioning'));
  fs.writeFileSync(path.join(out, 'product.mk'), 'PRODUCT_PACKAGES += AlphaPhone\n');
  writeAospTelephonyRoles(out, apkTree, pkg);
  const xml = fs.readFileSync(path.join(out, 'provisioning/alpha-telephony-components.xml'), 'utf8');
  assert.match(xml, /<feature name="ai\.alphacompute\.alphaphone\.feature\.INITIAL_TELEPHONY_ROLES" version="1" \/>/);
  assert.match(xml, /<component-override package="ai\.alphacompute\.alphaphone">/);
  const enabledComponents = Array.from(xml.matchAll(/class="([^"]+)" enabled="true"/g), match => match[1]);
  const sync = fs.readFileSync('android/app/src/launcher/java/ai/alphacompute/alphaphone/AlphaTelephonyRoles.java', 'utf8');
  const runtimeClasses = [...sync.matchAll(/\b(?:DIALER|SMS) = \{ ([^}]+) \}/g)].flatMap(([, classes]) =>
    classes.split(', ').map(name => name.replace(/\.class$/, '')));
  assert.equal(runtimeClasses.length, 9);
  assert.deepEqual(enabledComponents, runtimeClasses.map(name => name.includes('.') ? name : `${pkg}.${name}`));
  assert.doesNotMatch(xml, /MainActivity|role-holder/);
  const makefile = fs.readFileSync(path.join(out, 'product.mk'), 'utf8');
  assert.match(makefile, /\$\(launcher_provisioning_dir\)\/alpha-telephony-components\.xml:\$\(TARGET_COPY_OUT_SYSTEM_EXT\)\/etc\/sysconfig\/alpha-telephony-components\.xml/);
});

test('refuses unqualified role handlers before enabling anything on the image', () => {
  for (const [broken, error] of [
    [apkTree.replace(pkg, 'example.wrong.package'), /package manifest/],
    [apkTree.replace('BIND_INCALL_SERVICE', 'UNRELATED'), /AlphaInCallService/],
    [apkTree.replace('IN_CALL_SERVICE_UI', 'UNKNOWN_UI'), /InCallService UI/],
    [apkTree.replace('="tel"', '="other"'), /AlphaDialPadActivity/],
    [apkTree.replace('vnd.wap.mms-message', 'text'), /AlphaMmsWapPushReceiver/],
    [apkTree.replace('="smsto"', '="sms"'), /AlphaRespondViaMessageService/],
    [apkTree.replace('AlphaSmsComposeActivity', 'OtherComposeActivity'), /AlphaSmsComposeActivity/],
    [apkTree.replace('AlphaMmsResultReceiver', 'AlphaSmsDeliverReceiver'), /AlphaSmsDeliverReceiver/],
    [apkTree.replace(`AlphaInCallService"\n        A: android:enabled(0x01010003)=${disabled}`,
      `AlphaInCallService"\n        A: android:enabled(0x01010003)=${enabled}`), /AlphaInCallService/],
  ]) {
    assert.notEqual(broken, apkTree);
    assert.throws(() => aospTelephonyRoleComponents(broken, pkg), error);
  }
});

test('rejects role filters that narrow the required Android intents to specific URIs', () => {
  const tel = element(10, 'data', {scheme: 'tel'}).join('\n');
  for (const restriction of [{host: 'phone.example'}, {pathPrefix: '/extension'}, {sspPrefix: '012'}]) {
    const narrowed = apkTree.replace(tel, element(10, 'data', {scheme: 'tel', ...restriction}).join('\n'));
    assert.throws(() => aospTelephonyRoleComponents(narrowed, pkg), /AlphaDialPadActivity/);
  }
  const group = [
    ...element(10, 'uri-relative-filter-group', {allow: enabled}),
    ...element(12, 'data', {pathPrefix: '/extension'}),
  ].join('\n');
  assert.throws(() => aospTelephonyRoleComponents(apkTree.replace(tel, `${tel}\n${group}`), pkg), /AlphaDialPadActivity/);
});

test('requires the private MMS provider to serve the application authority and grant URI access', () => {
  const badAuthority = apkTree.replace(`${pkg}.mms`, `${pkg}.other`);
  const noGrant = apkTree.replace(`grantUriPermissions(0x01010003)=${enabled}`, `grantUriPermissions(0x01010003)=${disabled}`);
  for (const manifest of [badAuthority, noGrant])
    assert.throws(() => aospTelephonyRoleComponents(manifest, pkg), /MmsFileProvider/);
});

test('production image staging reads role declarations from the privately staged launcher', () => {
  const source = fs.readFileSync('scripts/stage-aosp.ts', 'utf8');
  assert.match(source, /if \(production\) \{\n[^}]+writeProvisioningOverlay\(output, identity\.appId, components\);\n  const stagedTree = aaptManifestTree\(path\.join\(output, "Launcher\.apk"\), \{ aapt: tool\("aapt"\), env \}\);\n  writeAospTelephonyRoles\(output, stagedTree, identity\.appId\);/);
});
