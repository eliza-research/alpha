import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash, X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {admitUpdateApkIdentity, admitPublicUpdateChannel, verifiedUpdateSigning} from '../scripts/update-apk-admission.ts';
import {inspectApk} from '../scripts/apk.ts';
import {PACKAGE} from '../scripts/provision-unit.ts';
import {androidEnv, tool} from '../scripts/toolchain.ts';
import {UPDATE_CHANNEL_META, UPDATE_DIGEST_META} from '../scripts/update-channel.ts';

const old = 'a'.repeat(64), active = 'b'.repeat(64), lineageHash = 'c'.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const publicUrl = 'https://github.com/example/alpha/releases/download/app-stable/alpha-update-stable.json';
const row = {build:'release',variant:'launcher',versionCode:45};
const archive = {packageName:PACKAGE,home:true,launcher:true,xml:'android.permission.READ_CONTACTS'};
const signature = {verified:true,packageName:PACKAGE,versionCode:45,activeSignerSha256:active,signerRootSha256:active,lineageSize:0,lineageSha256:null};
const rotated = {...signature,signerRootSha256:old,lineageSize:2,lineageSha256:lineageHash};
const descriptor = {signerSha256:active,apkSigningRotation:{schema:1,approval:'approved',fromVersionCode:44,versionCode:45,previousSignerSha256:old,lineageSha256:lineageHash}};

test('only the exact compiled public channel can be published', () => {
  const meta = (name,value) => `    E: meta-data\n      A: android:name="${name}"\n      A: android:value="${value}"\n`;
  const xml = (kind='public',digest=sha(publicUrl)) => 'E: manifest\n  E: application\n'+
    meta(UPDATE_CHANNEL_META,kind)+meta(UPDATE_DIGEST_META,'sha256:'+digest);
  assert.deepEqual(admitPublicUpdateChannel(xml(),publicUrl), {kind:'public',manifestUrlSha256:sha(publicUrl)});
  assert.throws(()=>admitPublicUpdateChannel(xml('other'),publicUrl), /input refused/);
  assert.throws(()=>admitPublicUpdateChannel(xml('public','0'.repeat(64)),publicUrl), /compiled channel/);
  assert.throws(()=>admitPublicUpdateChannel('E: manifest\n  E: application\n',publicUrl), /metadata missing/);
  assert.throws(()=>admitPublicUpdateChannel(xml()+meta(UPDATE_CHANNEL_META,'public'),publicUrl), /metadata missing or duplicated/);
});

test('a manifest cannot substitute package, version, flavor or signing-family assertions', () => {
  assert.deepEqual(admitUpdateApkIdentity(row,descriptor,archive,signature), {signerRootSha256:active});
  assert.throws(()=>admitUpdateApkIdentity({...row,variant:'standalone'},descriptor,{...archive,home:false,xml:''},signature), /a release distribution is required/);
  for (const [name,changedRow,changedArchive,changedSignature] of [
    ['version',{...row,versionCode:46},archive,signature],
    ['flavor',{...row,variant:'standalone'},archive,signature],
    ['HOME',row,{...archive,home:false},signature],
    ['missing launcher',row,{...archive,launcher:false},signature],
    ['Contacts marker',row,{...archive,xml:''},signature],
    ['package',row,{...archive,packageName:'org.other'},signature],
    ['verified package',row,archive,{...signature,packageName:'org.other'}],
    ['active signer',row,archive,{...signature,activeSignerSha256:old}],
    ['unverified signer',row,archive,{...signature,verified:false}],
  ]) assert.throws(() => admitUpdateApkIdentity(changedRow,descriptor,changedArchive,changedSignature), undefined,name);
});

test('only the exact approved rotation selects its original installed signing family', () => {
  assert.deepEqual(admitUpdateApkIdentity(row,descriptor,archive,rotated), {signerRootSha256:old});
  for (const change of [{approval:'pending'},{approval:undefined},{previousSignerSha256:active},
    {lineageSha256:old},{versionCode:46},{fromVersionCode:45},{schema:2}]) {
    assert.throws(() => admitUpdateApkIdentity(row,{...descriptor,apkSigningRotation:{...descriptor.apkSigningRotation,...change}},archive,rotated), /exact approved/);
  }
  assert.throws(() => admitUpdateApkIdentity(row,{signerSha256:active},archive,rotated), /exact approved/);
  assert.throws(() => admitUpdateApkIdentity(row,descriptor,archive,{...rotated,lineageSize:3}), /exact approved/);
  assert.deepEqual(admitUpdateApkIdentity({...row,versionCode:46},descriptor,archive,{...rotated,versionCode:46}), {signerRootSha256:old}, 'later updates retain the approved original family');
});

test('real SDK signatures bind binary identity and the verified original rotation certificate', {timeout:120_000}, t => {
  let env;
  try {env = androidEnv();} catch {t.skip('Android SDK and JDK 21 are required');return;}
  const aapt2=tool('aapt2'), apksigner=tool('apksigner'), androidJar=path.join(env.ANDROID_HOME,'platforms/android-36/android.jar');
  if (![aapt2,apksigner,androidJar].every(file=>fs.existsSync(file))) {t.skip('build-tools 36.0.0 and android-36 are required');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-update-identity-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const run=(command,args)=>execFileSync(command,args,{env,stdio:'pipe',timeout:30_000,maxBuffer:2**20});
  const key=name=>{
    const pem=path.join(dir,name+'.pem'), pk8=path.join(dir,name+'.pk8'), cert=path.join(dir,name+'.x509.pem');
    run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-subj',`/CN=Alpha OTA fixture ${name}`,'-days','1','-keyout',pem,'-out',cert]);
    run('openssl',['pkcs8','-topk8','-nocrypt','-outform','DER','-in',pem,'-out',pk8]);
    return {pk8,cert,digest:sha(new X509Certificate(fs.readFileSync(cert)).raw)};
  };
  const first=key('old'), second=key('new');
  const manifest=path.join(dir,'AndroidManifest.xml'), unsigned=path.join(dir,'unsigned.apk');
  fs.writeFileSync(manifest,`<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${PACKAGE}" android:versionCode="45"><uses-sdk android:minSdkVersion="29" android:targetSdkVersion="36"/><uses-permission android:name="android.permission.READ_CONTACTS"/><application android:hasCode="false"><meta-data android:name="${UPDATE_CHANNEL_META}" android:value="public"/><meta-data android:name="${UPDATE_DIGEST_META}" android:value="sha256:${sha(publicUrl)}"/><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.HOME"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`);
  run(aapt2,['link','-o',unsigned,'-I',androidJar,'--manifest',manifest]);
  assert.throws(()=>verifiedUpdateSigning({file:unsigned,sha256:sha(fs.readFileSync(unsigned))}), /Command failed/, 'an unsigned binary manifest has no update authority');
  const sign=(name,signer,extra=[],input=unsigned)=>{
    const file=path.join(dir,name+'.apk');
    run(apksigner,['sign','--key',signer.pk8,'--cert',signer.cert,'--min-sdk-version','29',
      '--v1-signing-enabled','false','--v2-signing-enabled','false','--v3-signing-enabled','true','--v4-signing-enabled','false',...extra,'--out',file,input]);
    return {file,sha256:sha(fs.readFileSync(file)),...row};
  };
  const original=sign('original',first), actualOriginal=verifiedUpdateSigning(original), binary=inspectApk(original.file);
  assert.equal(admitPublicUpdateChannel(binary.xml,publicUrl).kind,'public', 'channel admission consumes actual binary-manifest output');
  assert.equal(actualOriginal.activeSignerSha256,first.digest);
  assert.equal(actualOriginal.signerRootSha256,first.digest);
  assert.equal(actualOriginal.versionCode,45);
  assert.equal(actualOriginal.targetSdkVersion,36);
  assert.deepEqual(admitUpdateApkIdentity(original,{signerSha256:first.digest},binary,actualOriginal), {signerRootSha256:first.digest});
  const originalManifest=fs.readFileSync(manifest,'utf8');
  for (const target of [34,35]) {
    const targetUnsigned=path.join(dir,`target-${target}-unsigned.apk`);
    fs.writeFileSync(manifest,originalManifest.replace('targetSdkVersion="36"',`targetSdkVersion="${target}"`));
    run(aapt2,['link','-o',targetUnsigned,'-I',androidJar,'--manifest',manifest]);
    const targetApk=sign(`target-${target}`,first,[],targetUnsigned);
    if(target<35) assert.throws(()=>verifiedUpdateSigning(targetApk),
      failed=>/targetSdkVersion must be at least 35/.test(String(failed.stderr)),
      'a valid same-signer APK with an older target cannot be advertised for unattended API 37 updates');
    else assert.equal(verifiedUpdateSigning(targetApk).targetSdkVersion,35,'the exact Android API 37 target boundary is admitted');
  }
  const lineage=path.join(dir,'rotation.lineage');
  run(apksigner,['rotate','--out',lineage,'--old-signer','--key',first.pk8,'--cert',first.cert,'--new-signer','--key',second.pk8,'--cert',second.cert]);
  const replacement=sign('rotated',second,['--lineage',lineage,'--rotation-min-sdk-version','28']);
  const actualRotation=verifiedUpdateSigning(replacement);
  assert.equal(actualRotation.activeSignerSha256,second.digest);
  assert.equal(actualRotation.signerRootSha256,first.digest);
  assert.equal(actualRotation.lineageSha256,sha(fs.readFileSync(lineage)), 'the verified embedded lineage matches exact public file bytes');
  const approved={signerSha256:second.digest,apkSigningRotation:{schema:1,approval:'approved',fromVersionCode:44,versionCode:45,previousSignerSha256:first.digest,lineageSha256:sha(fs.readFileSync(lineage))}};
  assert.deepEqual(admitUpdateApkIdentity(replacement,approved,inspectApk(replacement.file),actualRotation), {signerRootSha256:first.digest});
  assert.throws(()=>admitUpdateApkIdentity(replacement,{...approved,apkSigningRotation:{...approved.apkSigningRotation,approval:'pending'}},binary,actualRotation), /exact approved/);
  assert.throws(()=>verifiedUpdateSigning({...replacement,sha256:'0'.repeat(64)}), /Command failed/);
  fs.appendFileSync(replacement.file,'tampered');
  assert.throws(()=>verifiedUpdateSigning({...replacement,sha256:sha(fs.readFileSync(replacement.file))}), /Command failed/,'rehashing modified signed bytes does not grant signing authority');
});
