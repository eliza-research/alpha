import {productionCloud,stagingCloud} from '../apps/app/src/runtime/cloud-deployment.generated.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

/**
 * The development browser bridge's adapter for Eliza Cloud's in-app email sign-in code. Routes and
 * body shapes come only from config/cloud-email-code.json, which the shared native client's
 * CloudEmailCode.java (vendor/eliza packages/auth/android) mirrors (test/cloud-sign-in-flow.test.mjs
 * pins both). Tenant identity comes from the deployment.
 * No magic link, no hosted page.
 */
export const CLOUD_EMAIL_CODE=JSON.parse(readFileSync(new URL('../config/cloud-email-code.json',import.meta.url),'utf8')) as {sendPath:string;verifyPath:string;client:string};
export function emailCodeSendBody(environment:'production'|'staging',email:string,verifier:string){
 return {email,tenantId:(environment==='production'?productionCloud:stagingCloud).tenant,client:CLOUD_EMAIL_CODE.client,pkce:{codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256'}};
}
export function emailCodeVerifyBody(environment:'production'|'staging',email:string,code:string,verifier:string){
 return {email,code,tenantId:(environment==='production'?productionCloud:stagingCloud).tenant,client:CLOUD_EMAIL_CODE.client,pkce:{codeVerifier:verifier}};
}
/** The server's expiresAt when present, never later than 15 minutes; 10 minutes when absent. */
export function emailCodeExpiresAt(reported:unknown,now=Date.now()){
 const value=typeof reported==='number'?reported:typeof reported==='string'?Date.parse(reported):NaN;
 return Number.isFinite(value)&&value>0?Math.min(value,now+15*60*1000):now+10*60*1000;
}
/** Match the native minimum while retaining a longer server timestamp or Retry-After. */
export function emailCodeResendAt(reported:unknown,retryAfter:string|null,now=Date.now()){
 const timestamp=typeof reported==='number'?reported:typeof reported==='string'?Date.parse(reported):NaN;
 const value=retryAfter?.trim();
 const retry=value&&/^[0-9]{1,9}$/.test(value)?now+Number(value)*1000:value?Date.parse(value):NaN;
 return Math.max(now+30000,Number.isFinite(timestamp)?timestamp:0,Number.isFinite(retry)?retry:0);
}
