import fs from 'node:fs';
/** Cloud SDK bases: each configured API origin plus Cloud's versioned prefix. Service origins are not SDK bases. */
export function cloudSdkBases(config){
 return Object.freeze(Object.fromEntries(['production','staging'].map(environment=>{
  const api=config?.[environment]?.api;
  // Provider keys are sent to this base: only an exact https origin is accepted.
  if(typeof api!=='string'||!URL.canParse(api)||new URL(api).protocol!=='https:'||new URL(api).origin!==api)throw Error('Invalid Cloud API origin');
  return [environment,api+'/api/v1'];
 })));
}
/** The deployment's bases, read from config/cloud-deployment.json (checked by scripts/cloud-deployment.mjs --check). */
export const CLOUD_SDK_BASES=cloudSdkBases(JSON.parse(fs.readFileSync(new URL('../config/cloud-deployment.json',import.meta.url),'utf8')));
