import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {admitSystemUpdater} from '../vendor/eliza/packages/os/scripts/android/system-updater-staging.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(fs.readFileSync(path.join(root,'android/aosp/pilot-system-update-enrollment.json'),'utf8'));
function fixture(t){
 const source=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-enrollment-cli-'));
 t.after(()=>fs.rmSync(source,{recursive:true,force:true}));
 const before=Buffer.from('# Retained product configuration\n$(call inherit-product, vendor/eliza/system-updater/product.mk)\n');
 const product=path.join(source,'vendor/alphaphone/product.mk');fs.mkdirSync(path.dirname(product),{recursive:true});fs.writeFileSync(product,before);
 const admitted=admitSystemUpdater({systemUpdater:true,vendorDirectory:'eliza'});assert(admitted);
 for(const row of admitted.files){const file=path.join(source,'vendor/eliza',row.path);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,row.bytes);}
 const publicIdentities=path.join(source,'public');fs.mkdirSync(publicIdentities);
 fs.copyFileSync(path.join(root,'android/signing/public/releasekey.x509.pem'),path.join(publicIdentities,'releasekey.x509.pem'));
 const receipt=path.join(source,'receipt.json'),destination=path.join(source,'vendor/alphaphone/system-update-enrollment');
 const args=['--source-root',source,'--public-identities',publicIdentities,'--expected-product-mk-sha256',sha(before),'--receipt',receipt];
 const run=(extra=[],replace=args)=>spawnSync(process.execPath,[path.join(root,'scripts/stage-os-update-enrollment.ts'),...replace,...extra],{cwd:root,encoding:'utf8'});
 const unchanged=()=>{assert.deepEqual(fs.readFileSync(product),before);assert(!fs.existsSync(destination));assert(!fs.existsSync(receipt));assert(!fs.existsSync(receipt+'.product-before.mk'));};
 return{source,before,product,receipt,destination,publicIdentities,args,admitted,run,unchanged};
}

test('enrollment defaults to a public exact-input plan without writes',t=>{
 const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
 f.unchanged();assert.equal(plan.executed,false);assert.equal(plan.otaCertificateSha256,profile.otaCertificateSha256);
 assert.equal(plan.platformOrAVBKeysRotated,false);assert.equal(plan.wipeData,false);assert.equal(plan.signedImageProduced,false);assert.equal(plan.deviceQualified,false);
 assert.equal(plan.productBeforeSha256,sha(f.before));assert.equal(Object.keys(plan.files).length,3);
});

test('explicit execution stages only the reviewed overlay and public key in a disposable source',t=>{
 const f=fixture(t),result=f.run(['--execute']);assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
 assert.equal(plan.executed,true);assert.deepEqual(fs.readFileSync(f.receipt+'.product-before.mk'),f.before);
 assert.equal(sha(fs.readFileSync(f.product)),plan.productAfterSha256);
 assert(fs.readFileSync(f.product).subarray(0,f.before.length).equals(f.before));
 for(const [name,digest]of Object.entries(plan.files))assert.equal(sha(fs.readFileSync(path.join(f.destination,name))),digest);
 const config=fs.readFileSync(path.join(f.destination,'overlay/vendor/eliza/system-updater/res/values/config.xml'),'utf8');
 assert(config.includes('<bool name="os_update_enabled">true</bool>'));
 assert(config.includes('<string name="os_update_manifest" translatable="false">https://github.com/eliza-research/alphaphone/releases/download/os-pilot/alpha-os-update.json</string>'));
 assert(config.includes(profile.otaCertificateSha256));
 for(const host of profile.hosts)assert(config.includes(`<item>${host}</item>`));
 const second=f.run(['--execute']);assert.notEqual(second.status,0);assert.equal(sha(fs.readFileSync(f.product)),plan.productAfterSha256);
});

test('changed product, updater bytes, symlink or public certificate refuses before enrollment writes',t=>{
 for(const mode of ['preimage','updater','symlink','certificate']){
  const f=fixture(t);
  if(mode==='preimage')f.args[f.args.indexOf('--expected-product-mk-sha256')+1]='0'.repeat(64);
  if(mode==='updater')fs.appendFileSync(path.join(f.source,'vendor/eliza',f.admitted.files[0].path),'changed');
  if(mode==='symlink'){const file=path.join(f.source,'vendor/eliza',f.admitted.files[0].path);fs.renameSync(file,file+'.original');fs.symlinkSync(file+'.original',file);}
  if(mode==='certificate')fs.copyFileSync(path.join(root,'android/signing/public/platform.x509.pem'),path.join(f.publicIdentities,'releasekey.x509.pem'));
  const result=f.run(['--execute']);assert.notEqual(result.status,0,mode);f.unchanged();
 }
});

test('unknown and repeated options cannot authorize enrollment writes',t=>{
 const f=fixture(t);
 for(const extra of [['--unknown'],['--receipt',f.receipt],['--execute','--execute']]){assert.notEqual(f.run(extra).status,0);f.unchanged();}
});
