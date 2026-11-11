import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
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

test('the launcher disables staged components if runtime image admission is lost', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-role-admission-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const fixtures = {
    'PackageManager.java': `package android.content.pm;
import android.content.ComponentName;
import java.util.ArrayList;
import java.util.List;
public class PackageManager {
 public static final int COMPONENT_ENABLED_STATE_DEFAULT = 0, COMPONENT_ENABLED_STATE_ENABLED = 1,
     COMPONENT_ENABLED_STATE_DISABLED = 2, DONT_KILL_APP = 1;
 public boolean image, staged, unreadable;
 public final List<Integer> writes = new ArrayList<>();
 public boolean hasSystemFeature(String name, int version) {
  if (!name.equals("${pkg}.feature.INITIAL_TELEPHONY_ROLES") || version != 1) throw new AssertionError(name);
  if (unreadable) throw new IllegalStateException("feature unavailable");
  return staged;
 }
 public int getComponentEnabledSetting(ComponentName name) { return -1; }
 public void setComponentEnabledSetting(ComponentName name, int wanted, int flags) { writes.add(wanted); }
}`,
    'Context.java': `package android.content;
import android.content.pm.PackageManager;
public class Context {
 public final PackageManager packages = new PackageManager();
 public PackageManager getPackageManager() { return packages; }
 public String getPackageName() { return "${pkg}"; }
}`,
    'ComponentName.java': 'package android.content; public record ComponentName(Context context, Class<?> component) {}',
    'Log.java': 'package android.util; public class Log { public static int w(String tag, String message) { return 0; } }',
    'MmsFileProvider.java': 'package ai.eliza.plugins.messages; public class MmsFileProvider {}',
    'RoleAdmissionFixture.java': `package ${pkg};
import android.content.Context;
import java.util.Collections;
class AlphaImageCapability { static boolean verified(Context context) { return context.packages.image; } }
class AlphaInCallService {} class AlphaCallActivity {} class AlphaDialPadActivity {}
class AlphaSmsDeliverReceiver {} class AlphaMmsWapPushReceiver {} class AlphaMmsResultReceiver {}
class AlphaRespondViaMessageService {} class AlphaSmsComposeActivity {}
public class RoleAdmissionFixture {
 private static void check(boolean image, boolean staged, boolean unreadable, int expected) {
  Context context = new Context();
  context.packages.image = image;
  context.packages.staged = staged;
  context.packages.unreadable = unreadable;
  AlphaTelephonyRoles.sync(context);
  if (!context.packages.writes.equals(Collections.nCopies(9, expected)))
   throw new AssertionError("component state was " + context.packages.writes + ", expected " + expected);
 }
 public static void main(String[] args) {
  check(true, true, false, 1);
  check(false, false, false, 0);
  check(false, true, false, 2);
  check(false, false, true, 2);
 }
}`,
  };
  const sources = Object.entries(fixtures).map(([name, source]) => {
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, source);
    return filename;
  });
  const roles = 'android/app/src/launcher/java/ai/alphacompute/alphaphone/AlphaTelephonyRoles.java';
  const jdk = name => process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', name) : name;
  execFileSync(jdk('javac'), ['-d', directory, ...sources, roles], {encoding: 'utf8'});
  execFileSync(jdk('java'), ['-cp', directory, `${pkg}.RoleAdmissionFixture`], {encoding: 'utf8'});
});

test('production image staging reads role declarations from the privately staged launcher', () => {
  const source = fs.readFileSync('scripts/stage-aosp.ts', 'utf8');
  assert.match(source, /if \(production\) \{\n[^}]+writeProvisioningOverlay\(output, identity\.appId, components\);\n  const stagedTree = aaptManifestTree\(path\.join\(output, "Launcher\.apk"\), \{ aapt: tool\("aapt"\), env \}\);\n  writeAospTelephonyRoles\(output, stagedTree, identity\.appId\);/);
});
