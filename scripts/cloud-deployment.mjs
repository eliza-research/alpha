import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLOUD_SDK_BASES,cloudSdkBases} from './cloud-sdk-authority.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
/** Reviewed credential namespaces, oldest first. The last is the one installed phones hold now. */
export const STORAGE_NAMESPACES=['897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874'];
/** Deployment-owned public authorities, never credentials or values supplied by a login response. */
export function validateCloudDeployment(input){
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='production,staging')throw Error('Expected production and staging Cloud configuration');
 for(const environment of ['production','staging']){
  const row=input[environment];
  if(!row||Object.keys(row).filter(key=>!['name','entitlementAudience'].includes(key)).sort().join(',')!=='api,services,tenant,web')throw Error('Invalid Cloud configuration fields');
  if(row.entitlementAudience!==undefined&&(typeof row.entitlementAudience!=='string'||! /^[A-Za-z0-9._-]{1,128}$/.test(row.entitlementAudience)))throw Error('Invalid entitlement audience');
  // The shared native sign-in client (CloudSignInEnvironment) refuses these at class initialisation,
  // so a configuration it cannot register fails here, at build time, rather than on the phone.
  if(row.name!==undefined&&(typeof row.name!=='string'||!row.name.trim()||row.name!==row.name.trim()||row.name.length>80||/[\p{Cc}\p{Cf}]/u.test(row.name)))throw Error('Invalid Cloud service name');
  for(const field of ['api','web','services']){
   const value=row[field];let url;try{url=new URL(value);}catch{throw Error('Invalid Cloud origin');}
   if(typeof value!=='string'||url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname.endsWith('.'))throw Error('Cloud origins must be canonical HTTPS origins on the default port');
   if(field!=='services'&&!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(url.hostname))throw Error('Cloud API and web origins must be DNS host names');
  }
  // Steward tenant ids are at most 64 characters.
  if(typeof row.tenant!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(row.tenant))throw Error('Invalid Cloud tenant');
 }
 if(input.production.api===input.staging.api)throw Error('Cloud environments must use distinct API origins');
 return input;
}
/** Both environments feed one namespace, so a staging-only change also moves production credentials. */
export function storageFingerprint(config){
 return createHash('sha256').update(JSON.stringify(['production','staging'].map(env=>[...['api','web','services','tenant'].map(key=>config[env][key]),config[env].entitlementAudience??'cloud-subscription']))).digest('hex');
}
export function deploymentOutputs(config){
 validateCloudDeployment(config);
 const fingerprint=storageFingerprint(config);
 const java=['package ai.elizaresearch.alphaphone;','','/** Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.mjs. */','final class CloudDeployment {',' private CloudDeployment() {}'];
 const ts=['// Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.mjs.'];
 for(const env of ['production','staging']){
  const row=config[env];
  ts.push(`export const ${env}Cloud = ${JSON.stringify({name:row.name??new URL(row.api).hostname,entitlementAudience:row.entitlementAudience??'cloud-subscription',api:row.api,web:row.web,agents:new URL(row.services).host,tenant:row.tenant})} as const;`);
  for(const [key,value] of Object.entries({...row,name:row.name??new URL(row.api).hostname,apiHost:new URL(row.api).host,webHost:new URL(row.web).host,servicesHost:new URL(row.services).host}))java.push(` static final String ${env.toUpperCase()}_${key.replace(/[A-Z]/g,c=>'_'+c).toUpperCase()} = ${JSON.stringify(value)};`);
 }
 java.push(` static final String STORAGE_NAMESPACE = "cloud-deployment:${fingerprint}:";`,
  ' static String storageSlot(String name) {',
  '  return name != null && (name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name.equals("local-agent-provider:v1")) ? STORAGE_NAMESPACE + name : name;',
  ' }','}');
 ts.push(`export const cloudStorageNamespace = "cloud-deployment:${fingerprint}:";`,
  'export function cloudStorageSlot(name:string):string { return name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name === "local-agent-provider:v1" ? cloudStorageNamespace + name : name; }');
 return {'apps/app/src/runtime/cloud-deployment.generated.ts':ts.join('\n')+'\n','android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java':java.join('\n')+'\n'};
}
export function checkCloudDeployment(directory=root,sdkBases=CLOUD_SDK_BASES,namespaces=STORAGE_NAMESPACES){
 const config=JSON.parse(fs.readFileSync(path.join(directory,'config/cloud-deployment.json'),'utf8'));
 const outputs=deploymentOutputs(config);
 for(const [name,contents] of Object.entries(outputs)){
  const file=path.join(directory,name);
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents)throw Error('Stale Cloud deployment output: '+name+'; run node scripts/cloud-deployment.mjs');
 }
 if(storageFingerprint(config)!==namespaces.at(-1))throw Error('Cloud storage namespace would change: every installed phone loses its production credential; add a tested migration (LegacyCloudRecovery) and append the new namespace to STORAGE_NAMESPACES in scripts/cloud-deployment.mjs');
 // The resident agent's inference base (ELIZAOS_CLOUD_BASE_URL) must be the configured API, never a second authority.
 if(JSON.stringify(sdkBases)!==JSON.stringify(cloudSdkBases(config)))throw Error('Cloud SDK bases (scripts/cloud-sdk-authority.mjs) disagree with config/cloud-deployment.json');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--check'))checkCloudDeployment();
 else for(const [name,contents] of Object.entries(deploymentOutputs(JSON.parse(fs.readFileSync(path.join(root,'config/cloud-deployment.json'),'utf8')))))fs.writeFileSync(path.join(root,name),contents);
}
