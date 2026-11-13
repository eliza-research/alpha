/** Stage the product-owned OTA enrollment. Never installs, reboots or marks a device qualified. */
import fs from 'node:fs';
import path from 'node:path';
import {X509Certificate} from 'node:crypto';
import {sha256 as sha} from './sha256.ts';
import {admitSystemUpdater} from '../vendor/eliza/packages/os/scripts/android/system-updater-staging.mjs';

interface PilotEnrollment {
 schema:number; purpose:string; product:string; device:string; manifestUrl:string; hosts:string[];
 legacyBuildFingerprint:string; legacyPlatformCertificateSha256:string; legacyOTACertificateSha256:string;
 otaCertificateSha256:string; rotatePlatformOrAVBKeys:boolean; wipeData:boolean;
}
interface Custody {osCertificateSha256:Record<string,string>}
const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),allowed=new Set(['--source-root','--public-identities','--expected-product-mk-sha256','--receipt','--execute']);
const options:Record<string,string|true|undefined>={};
for(let i=0;i<args.length;i++){
 const arg=args[i];if(!allowed.has(arg)||Object.hasOwn(options,arg))throw Error('Unknown or repeated enrollment option');
 options[arg]=arg==='--execute'?true:args[++i];
}
const require=(condition:unknown,message:string)=>{if(!condition)throw Error(message);};
const file=(relative:string)=>path.join(root,relative);
const profileBytes=fs.readFileSync(file('android/aosp/pilot-system-update-enrollment.json'));
const profile:PilotEnrollment=JSON.parse(profileBytes.toString('utf8'));
require(profile.schema===1&&profile.purpose==='preserving-pilot-qualification'&&profile.product==='alpha_stallion_phone'&&profile.device==='stallion','Unexpected pilot enrollment');
require(profile.rotatePlatformOrAVBKeys===false&&profile.wipeData===false,'This enrollment cannot authorize a key rotation or wipe');
// Preserve the enrolled pilot URL, which GitHub redirects to the canonical repository.
require(profile.manifestUrl==='https://github.com/eliza-research/alphaphone/releases/download/os-pilot/alpha-os-update.json','Unexpected OS discovery channel');
require(JSON.stringify(profile.hosts)===JSON.stringify(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','storage.googleapis.com']),'Unexpected OS download hosts');
const custody:Custody=JSON.parse(fs.readFileSync(file('android/signing/os-custody-expected.json'),'utf8'));
require(profile.otaCertificateSha256===custody.osCertificateSha256.releasekey,'OTA enrollment must use the verified release identity');
require(options['--source-root']&&options['--public-identities']&&options['--receipt']&&/^[a-f0-9]{64}$/.test(String(options['--expected-product-mk-sha256']||'')),'Source, public identities, exact product preimage and new receipt are required');
const value=(name:string):string=>{const found=options[name];if(typeof found!=='string'||!found)throw Error('Missing enrollment option '+name);return found;};
const receipt=value('--receipt'),publicIdentities=value('--public-identities');
const source=fs.realpathSync(value('--source-root'));
const product=path.join(source,'vendor/alphaphone/product.mk'),before=fs.readFileSync(product);
require(sha(before)===options['--expected-product-mk-sha256'],'Existing product source changed; preserve it');
require(before.toString().includes('$(call inherit-product, vendor/eliza/system-updater/product.mk)'),'The reviewed inactive updater must already be in the product');
const admitted=admitSystemUpdater({systemUpdater:true,vendorDirectory:'eliza'});
if(!admitted)throw Error('The reviewed inactive updater is required');
for(const row of admitted.files){
 const candidate=path.join(source,'vendor/eliza',row.path);
 require(fs.lstatSync(candidate).isFile()&&!fs.lstatSync(candidate).isSymbolicLink()&&sha(fs.readFileSync(candidate))===row.sha256,'Staged updater source differs: '+row.path);
}
const certificate=fs.readFileSync(path.join(publicIdentities,'releasekey.x509.pem'));
const actual=new X509Certificate(certificate).fingerprint256.replaceAll(':','').toLowerCase();
require(actual===profile.otaCertificateSha256,'Public OTA certificate differs from verified enrollment');
const destination=path.join(source,'vendor/alphaphone/system-update-enrollment');
require(!fs.existsSync(destination),'Existing enrollment must be preserved');
require(!fs.existsSync(receipt),'Existing enrollment receipt must be preserved');
const escape=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const config=`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <bool name="os_update_enabled">true</bool>\n    <string name="os_update_manifest" translatable="false">${escape(profile.manifestUrl)}</string>\n    <string-array name="os_update_hosts" translatable="false">${profile.hosts.map(host=>`<item>${escape(host)}</item>`).join('')}</string-array>\n    <string name="os_update_product" translatable="false">${profile.product}</string>\n    <string name="os_update_device" translatable="false">${profile.device}</string>\n    <string name="os_update_ota_certificate" translatable="false">${actual}</string>\n</resources>\n`;
const relative='vendor/alphaphone/system-update-enrollment';
const make=`# Product-owned preserving pilot enrollment; no platform/AVB key replacement.\nPRODUCT_PACKAGE_OVERLAYS += ${relative}/overlay\nPRODUCT_ENFORCE_RRO_EXCLUDED_OVERLAYS += ${relative}/overlay\nPRODUCT_OTA_PUBLIC_KEYS += ${relative}/releasekey.x509.pem\nPRODUCT_EXTRA_OTA_KEYS += ${relative}/releasekey\nPRODUCT_EXTRA_RECOVERY_KEYS += ${relative}/releasekey\n`;
const overlay='overlay/vendor/eliza/system-updater/res/values/config.xml';
const outputs:Record<string,Buffer>={'releasekey.x509.pem':certificate,'enrollment.mk':Buffer.from(make),[overlay]:Buffer.from(config)};
const updated=Buffer.concat([before,Buffer.from(`\n# Alpha preserving wireless-update enrollment.\n$(call inherit-product, ${relative}/enrollment.mk)\n`)]);
const record={schema:1,purpose:profile.purpose,sourceRoot:source,profileSha256:sha(profileBytes),legacyBuildFingerprint:profile.legacyBuildFingerprint,legacyPlatformCertificateSha256:profile.legacyPlatformCertificateSha256,otaCertificateSha256:actual,productBeforeSha256:sha(before),productAfterSha256:sha(updated),files:Object.fromEntries(Object.entries(outputs).map(([name,bytes])=>[name,sha(bytes)])),runtimeActivationConfigured:true,platformOrAVBKeysRotated:false,wipeData:false,signedImageProduced:false,deviceQualified:false,executed:options['--execute']===true};
if(options['--execute']){
 require(sha(fs.readFileSync(product))===record.productBeforeSha256,'Product changed before enrollment write');
 fs.mkdirSync(path.dirname(receipt),{recursive:true});
 fs.writeFileSync(receipt+'.product-before.mk',before,{flag:'wx',mode:0o600});
 fs.mkdirSync(destination);
 for(const [name,bytes] of Object.entries(outputs)){const target=path.join(destination,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});}
 fs.writeFileSync(product,updated);
 for(const [name,digest] of Object.entries(record.files))require(sha(fs.readFileSync(path.join(destination,name)))===digest,'Enrollment output changed');
 fs.writeFileSync(receipt,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify(record));
