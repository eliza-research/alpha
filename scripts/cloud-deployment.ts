export interface CloudDeploymentRow {api:string;web:string;services:string;tenant:string;name?:string;entitlementAudience?:string}
export type CloudDeploymentConfig = Record<'production'|'staging',CloudDeploymentRow>;
export interface CloudDeploymentCheckOptions {
  config?: CloudDeploymentConfig;
  sdkBases?: Readonly<Record<'production'|'staging',string>>;
  namespaces?: readonly string[];
}
export interface NativeAuthCallbackRegistration {redirectUri:string;androidPackage:string;appName:string;browserSignIn:{startPath:string;returnPath:string;storageKey:string;apiOrigin:string;tenant:string}}
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {CLOUD_DEPLOYMENT,CLOUD_SIGN_IN_REGISTRATION} from './cloud-deployment-policy.ts';
import {CLOUD_SDK_BASES,cloudSdkBases} from './cloud-sdk-authority.ts';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const productIdentity=JSON.parse(fs.readFileSync(path.join(root,'app.config.json'),'utf8'));
/** Reviewed credential namespaces, oldest first. The last is the one installed phones hold now. */
export const STORAGE_NAMESPACES=['897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874'];
/** Deployment-owned public authorities, never credentials or values supplied by a login response. */
export function validateCloudDeployment(input: unknown): CloudDeploymentConfig{
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='production,staging')throw Error('Expected production and staging Cloud configuration');
 const config=input as CloudDeploymentConfig;
 for(const environment of ['production','staging'] as const){
  const row=config[environment];
  if(!row||Object.keys(row).filter((key: any)=>!['name','entitlementAudience'].includes(key)).sort().join(',')!=='api,services,tenant,web')throw Error('Invalid Cloud configuration fields');
  if(row.entitlementAudience!==undefined&&(typeof row.entitlementAudience!=='string'||! /^[A-Za-z0-9._-]{1,128}$/.test(row.entitlementAudience)))throw Error('Invalid entitlement audience');
  // The shared native sign-in client (CloudSignInEnvironment) refuses these at class initialisation,
  // so a configuration it cannot register fails here, at build time, rather than on the phone.
  if(row.name!==undefined&&(typeof row.name!=='string'||!row.name.trim()||row.name!==row.name.trim()||row.name.length>80||/[\p{Cc}\p{Cf}]/u.test(row.name)))throw Error('Invalid Cloud service name');
  for(const field of ['api','web','services'] as const){
   const value=row[field];let url;try{url=new URL(value);}catch{throw Error('Invalid Cloud origin');}
   if(typeof value!=='string'||url.protocol!=='https:'||url.origin!==value||url.username||url.password||url.port||!url.hostname.includes('.')||url.hostname.endsWith('.'))throw Error('Cloud origins must be canonical HTTPS origins on the default port');
   if(field!=='services'&&!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(url.hostname))throw Error('Cloud API and web origins must be DNS host names');
  }
  // Steward tenant ids are at most 64 characters.
  if(typeof row.tenant!=='string'||! /^[a-zA-Z0-9_-]{1,64}$/.test(row.tenant))throw Error('Invalid Cloud tenant');
 }
 if(config.production.api===config.staging.api)throw Error('Cloud environments must use distinct API origins');
 return config;
}
/** Both environments feed one namespace, so a staging-only change also moves production credentials. */
export function storageFingerprint(config: CloudDeploymentConfig){
 return createHash('sha256').update(JSON.stringify((['production','staging'] as const).map((env)=>[...(['api','web','services','tenant'] as const).map((key)=>config[env][key]),config[env].entitlementAudience??'cloud-subscription']))).digest('hex');
}
/** Public operator data for the protected Pages callback registry; no deployment mutation. */
export function nativeAuthCallbackRegistration(config: CloudDeploymentConfig,identity: {appId:string;appName:string},environment: keyof CloudDeploymentConfig): NativeAuthCallbackRegistration{
 const row=validateCloudDeployment(config)[environment];
 if(!row)throw Error('Unknown Cloud environment '+environment);
 return {
  redirectUri:row.web+CLOUD_SIGN_IN_REGISTRATION.callbackPath,
  androidPackage:identity.appId,
  appName:identity.appName,
  browserSignIn:{...CLOUD_SIGN_IN_REGISTRATION.browserSignIn,apiOrigin:row.api,tenant:row.tenant},
 };
}
export function deploymentOutputs(config: CloudDeploymentConfig): Record<string,string>{
 validateCloudDeployment(config);
 const fingerprint=storageFingerprint(config);
 const generated='Generated from scripts/cloud-deployment-policy.ts. Run node scripts/cloud-deployment.ts.';
 const java=['package ai.alphacompute.alphaphone;','','/** '+generated+' */','final class CloudDeployment {',' private CloudDeployment() {}'];
 const ts=['// '+generated];
 const gradle=['// '+generated,'ext.alphaCloudWebHosts = ['];
 for(const env of ['production','staging'] as const){
  const row=config[env];
  const webHost=new URL(row.web).host;
  gradle.push(` ${env}: ${JSON.stringify(webHost)},`);
  ts.push(`export const ${env}Cloud = ${JSON.stringify({name:row.name??new URL(row.api).hostname,entitlementAudience:row.entitlementAudience??'cloud-subscription',api:row.api,web:row.web,agents:new URL(row.services).host,tenant:row.tenant})} as const;`);
  for(const [key,value] of Object.entries({...row,name:row.name??new URL(row.api).hostname,apiHost:new URL(row.api).host,webHost,servicesHost:new URL(row.services).host}))java.push(` static final String ${env.toUpperCase()}_${key.replace(/[A-Z]/g,(c: any)=>'_'+c).toUpperCase()} = ${JSON.stringify(value)};`);
 }
 java.push(` static final String STORAGE_NAMESPACE = "cloud-deployment:${fingerprint}:";`,
  ' static String storageSlot(String name) {',
  '  return name != null && (name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name.equals("local-agent-provider:v1")) ? STORAGE_NAMESPACE + name : name;',
  ' }','}');
 ts.push(`export const cloudStorageNamespace = "cloud-deployment:${fingerprint}:";`,
  'export function cloudStorageSlot(name:string):string { return name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name === "local-agent-provider:v1" ? cloudStorageNamespace + name : name; }');
 gradle.push(']');
 return {
  'apps/app/src/runtime/cloud-deployment.generated.ts':ts.join('\n')+'\n',
  'android/app/src/main/java/ai/alphacompute/alphaphone/CloudDeployment.java':java.join('\n')+'\n',
  'android/app/cloud-deployment.generated.gradle':gradle.join('\n')+'\n',
 };
}
export function checkCloudDeployment(directory: any=root,{config=CLOUD_DEPLOYMENT,sdkBases=CLOUD_SDK_BASES,namespaces=STORAGE_NAMESPACES}: CloudDeploymentCheckOptions={}){
 const outputs=deploymentOutputs(config);
 for(const [name,contents] of Object.entries(outputs)){
  const file=path.join(directory,name);
  if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents)throw Error('Stale Cloud deployment output: '+name+'; run node scripts/cloud-deployment.ts');
 }
 if(storageFingerprint(config)!==namespaces.at(-1))throw Error('Cloud storage namespace would change: every installed phone loses its production credential; add a tested migration (LegacyCloudRecovery) and append the new namespace to STORAGE_NAMESPACES in scripts/cloud-deployment.ts');
 // The resident agent's inference base (ELIZAOS_CLOUD_BASE_URL) must be the configured API, never a second authority.
 if(JSON.stringify(sdkBases)!==JSON.stringify(cloudSdkBases(config)))throw Error('Cloud SDK bases (scripts/cloud-sdk-authority.ts) disagree with the Cloud deployment policy');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.includes('--pages-registration'))console.log(JSON.stringify(Object.fromEntries((['production','staging'] as const).map(environment=>[environment,[nativeAuthCallbackRegistration(CLOUD_DEPLOYMENT,productIdentity,environment)]])),null,2));
 else if(process.argv.includes('--check'))checkCloudDeployment();
 else for(const [name,contents] of Object.entries(deploymentOutputs(CLOUD_DEPLOYMENT))){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),contents);}
}
