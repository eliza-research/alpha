import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readUpdateChannel,apkUpdateChannel,apkUpdateChannelOrLegacy,assertProvisioningUpdateChannel,recordedProvisioningUpdateChannel,validateUpdateChannel,UPDATE_CHANNEL_META,UPDATE_DIGEST_META} from '../scripts/update-channel.ts';
import {consumerBuildOptions} from '../scripts/build-android.ts';
import {parseXmlTree} from '../scripts/apk.ts';

const publicUrl='https://example.test/public-update.json';
const hash=text=>createHash('sha256').update(text).digest('hex');
const privateUrl='https://storage.googleapis.com/alpha-aosp-lab-20261024-private-apks/update-qa/'+ 'a'.repeat(32)+'/alpha-update.json?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=21600&X-Goog-Signature=synthetic';
function input(t,url=privateUrl){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-update-input-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'manifest-url');fs.writeFileSync(file,url,{mode:0o600});
 return {file,env:{ALPHA_UPDATE_CHANNEL:'private-qa',ALPHA_PRIVATE_UPDATE_MANIFEST_FILE:file,ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256:hash(url)}};
}
test('public builds retain their source URL and refuse undeclared private input',t=>{
 assert.deepEqual(readUpdateChannel({},publicUrl),{kind:'public',manifestUrlSha256:hash(publicUrl)});
 const {env}=input(t);assert.throws(()=>readUpdateChannel({...env,ALPHA_UPDATE_CHANNEL:'public'},publicUrl),/input refused/);
 assert.throws(()=>readUpdateChannel({ALPHA_UPDATE_CHANNEL:'unknown'},publicUrl),/input refused/);
});
test('protected input yields digest-only evidence and requires a complete packaged build with test mocks off',t=>{
 const {env}=input(t),record=readUpdateChannel(env,publicUrl);
 assert.deepEqual(record,{kind:'private-qa',manifestUrlSha256:hash(privateUrl)});
 const options=consumerBuildOptions({testMocks:false},env,process.cwd());
 assert.deepEqual(options.record.metadata.updateChannel,record);
 assert.ok(!JSON.stringify(options.record).includes(privateUrl));
 // The private channel does not depend on a runtime profile (there is one); mocks and unpackaged builds are refused.
 for(const refused of [{testMocks:true},{testMocks:false,allowUnpackagedRuntime:true}])assert.throws(()=>consumerBuildOptions(refused,env,process.cwd()),/complete packaged build with test mocks off/);
});
test('wrong digest, readable permissions, symlinks, oversized bytes and absent files are refused without echoing capability',t=>{
 const {file,env}=input(t);
 const check=override=>assert.throws(()=>readUpdateChannel({...env,...override},publicUrl),error=>error.message==='Update channel input refused'&&!error.message.includes('Signature'));
 check({ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256:'f'.repeat(64)});
 fs.chmodSync(file,0o644);check({});fs.chmodSync(file,0o600);
 const link=file+'-link';fs.symlinkSync(file,link);check({ALPHA_PRIVATE_UPDATE_MANIFEST_FILE:link});
 fs.writeFileSync(file,'x'.repeat(2049));check({});fs.unlinkSync(file);check({});
});
test('private capability input cannot be placed inside the source checkout',t=>{
 const dir=fs.mkdtempSync(path.join(process.cwd(),'.qa-channel-fixture-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'url');fs.writeFileSync(file,privateUrl,{mode:0o600});
 assert.throws(()=>readUpdateChannel({ALPHA_UPDATE_CHANNEL:'private-qa',ALPHA_PRIVATE_UPDATE_MANIFEST_FILE:file,ALPHA_PRIVATE_UPDATE_MANIFEST_SHA256:hash(privateUrl)},publicUrl),/input refused/);
});
for(const [name,url] of Object.entries({wrongHost:privateUrl.replace('storage.googleapis.com','example.test'),wrongPrefix:privateUrl.replace('update-qa/','public/'),fragment:privateUrl+'#x',userinfo:privateUrl.replace('https://','https://user@'),longExpiry:privateUrl.replace('21600','86401'),newline:privateUrl+'\n',duplicate:privateUrl+'&X-Goog-Expires=300'})){
 test(`private channel refuses ${name}`,t=>{const {env}=input(t,url);assert.throws(()=>readUpdateChannel(env,publicUrl),/input refused/);});
}
test('compiled metadata has one channel and digest; substituted or secret-bearing records are rejected',()=>{
 const meta=(name,value)=>`    E: meta-data\n      A: android:name="${name}"\n      A: android:value="${value}"\n`;
 const xml='E: manifest\n  E: application\n'+meta(UPDATE_CHANNEL_META,'private-qa')+meta(UPDATE_DIGEST_META,'sha256:'+hash(privateUrl));
 assert.deepEqual(apkUpdateChannel(parseXmlTree(xml)),{kind:'private-qa',manifestUrlSha256:hash(privateUrl)});
 assert.throws(()=>apkUpdateChannel(parseXmlTree(xml+meta(UPDATE_CHANNEL_META,'public'))));
 assert.throws(()=>validateUpdateChannel({kind:'private-qa',manifestUrlSha256:hash(privateUrl),url:privateUrl}));
});

test('production provisioning checks compiled channel against release evidence with a legacy absence rule',()=>{
 const meta=(name,value)=>`    E: meta-data\n      A: android:name="${name}"\n      A: android:value="${value}"\n`;
 const manifest='E: manifest\n  E: application\n';
 const channel=kind=>meta(UPDATE_CHANNEL_META,kind);
 const digest=value=>meta(UPDATE_DIGEST_META,'sha256:'+value);
 const publicRecord={kind:'public',manifestUrlSha256:hash(publicUrl)};
 const privateRecord={kind:'private-qa',manifestUrlSha256:hash(privateUrl)};
 const compiled=(...metadata)=>apkUpdateChannelOrLegacy(parseXmlTree(manifest+metadata.join('')));
 assert.equal(compiled(),null);
 assert.equal(recordedProvisioningUpdateChannel(undefined,undefined),null);
 assert.doesNotThrow(()=>assertProvisioningUpdateChannel(compiled(),null));
 assert.deepEqual(recordedProvisioningUpdateChannel(publicRecord,publicRecord),publicRecord);
 assert.doesNotThrow(()=>assertProvisioningUpdateChannel(compiled(channel('public'),digest(hash(publicUrl))),publicRecord));
 assert.throws(()=>assertProvisioningUpdateChannel(compiled(),publicRecord),/differs from the reviewed release/);
 assert.throws(()=>assertProvisioningUpdateChannel(compiled(channel('public'),digest(hash(privateUrl))),publicRecord),/differs from the reviewed release/);
 assert.throws(()=>assertProvisioningUpdateChannel(compiled(channel('private-qa'),digest(hash(privateUrl))),null),/Private QA/);
 assert.throws(()=>recordedProvisioningUpdateChannel(publicRecord,privateRecord),/Private QA/);
 assert.throws(()=>recordedProvisioningUpdateChannel(publicRecord,{...publicRecord,manifestUrlSha256:hash(privateUrl)}),/differs from the reviewed release/);
 for(const fields of [[channel('public')],[digest(hash(publicUrl))],[channel('public'),channel('public'),digest(hash(publicUrl))]])
  assert.throws(()=>compiled(...fields),/missing or duplicated/);
 assert.throws(()=>apkUpdateChannelOrLegacy(parseXmlTree('E: manifest\n')),/application manifest/);
});

test('current gcloud lowercase signing fields retain exact bytes and reject case aliases',t=>{
 const gcloud=privateUrl.replaceAll('X-Goog-','x-goog-');
 const {env}=input(t,gcloud);
 assert.deepEqual(readUpdateChannel(env,publicUrl),{kind:'private-qa',manifestUrlSha256:hash(gcloud)});
 const duplicate=input(t,gcloud+'&X-Goog-Expires=300');
 assert.throws(()=>readUpdateChannel(duplicate.env,publicUrl),/input refused/);
});
