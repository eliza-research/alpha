// Alpha Cloud is described by data: the app's Cloud policy rows plus the operator's resource ids
// (scripts/cloud-worker.ts), with the app's native client registered as database rows
// (scripts/cloud-registration.ts). The app and its Cloud share one identity.
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {workerDeployment,deployResources,databaseAuthority,reportDatabaseIdentity,migrate,edgeConfig,prepare,preparedTree,completeSecrets,secretProblems,componentSecrets,readEnvFile,smoke,
 WORKER_SECRETS,LOGIN_SECRETS,OPERATOR_SECRETS,GENERATED_SECRETS} from '../scripts/cloud-worker.ts';
import {registrationRows,registrationFor,registrationAppId,colonFingerprint,releaseSignerFingerprints,seedRegistration} from '../scripts/cloud-registration.ts';
import {edgeRoute} from '../cloud/edge/worker.ts';
import {validateCloudDeployment,storageFingerprint,STORAGE_NAMESPACES} from '../scripts/cloud-deployment.ts';
import {leakedElizaHost} from '../scripts/local-cloud.ts';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const example={policy:read('cloud/policy.example.json'),resources:read('cloud/resources.example.json')};
const alpha={policy:read('cloud/policy.json'),resources:read('cloud/resources.json')};
const identity=read('app.config.json');
const reviewedDatabaseReceipts={
 DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256:'a'.repeat(64),
 DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256:'b'.repeat(64),
};
const legalDocument=title=>({title,revision:'synthetic-1',sections:[{title:'Fixture',paragraphs:['Only synthetic text.']}]});

test('the committed Alpha Cloud policy is ai.alphacompute.alphaphone on alphacompute.ai',()=>{
 validateCloudDeployment(alpha.policy);
 assert.equal(identity.appId,'ai.alphacompute.alphaphone');
 for(const environment of ['production','staging']){
  const row=alpha.policy[environment];
  for(const origin of [row.api,row.web,row.services])assert.match(new URL(origin).hostname,/(^|\.)alphacompute\.ai$/);
  assert.equal(row.entitlementAudience,identity.appId);
  assert.match(row.tenant,/^alphacompute/);
  const ids=alpha.resources[environment];
  assert.equal(ids.zone,'alphacompute.ai');
  for(const host of [ids.blobHost,new URL(ids.loginApiUrl).hostname])assert.match(host,/\.alphacompute\.ai$/);
 }
 assert.equal(leakedElizaHost(alpha),null);
});

for(const [name,{policy,resources}] of Object.entries({example,alpha}))test(`the ${name} deployment takes every authority from the policy and every id from the operator`,()=>{
 const deployment=workerDeployment(policy,resources);
 assert.equal(deployment.id,identity.slug+'-cloud');
 assert.deepEqual(Object.keys(deployment.environments).sort(),['production','staging']);
 for(const environment of ['production','staging']){
  const row=policy[environment],ids=resources[environment],worker=deployment.environments[environment];
  assert.deepEqual(worker.origins,{web:row.web,app:row.services,api:row.api});
  assert.equal(worker.tenantId,row.tenant);
  assert.equal(worker.serviceName,row.name);
  assert.deepEqual(worker.entitlement,{issuer:row.api,audience:row.entitlementAudience});
  assert.deepEqual(worker.routes,[{pattern:new URL(row.api).host+'/*',zone:ids.zone},{pattern:ids.blobHost+'/*',zone:ids.zone}]);
  assert.equal(worker.accountId,ids.accountId);
  assert.equal(worker.resources.hyperdriveId,ids.hyperdriveId);
  assert.deepEqual(worker.secrets,[...WORKER_SECRETS]);
  assert.equal(worker.vars.ELIZA_MOBILE_APP_AUTH_ENABLED,'true');
  assert.equal(worker.vars.DIRECT_REDIS_BACKEND,'redis-rest');
  // Only Steward is an upstream component: Pages, speech and admission are not deployed, and the
  // removed per-app registration setting is never a secret.
  assert.deepEqual(Object.keys(worker.components),['login']);
  assert.equal(worker.durableObjectTransfers,undefined);
  assert.ok(!worker.secrets.includes('ELIZA_MOBILE_APP_AUTH_CLIENTS_JSON'));
  const {login}=worker.components;
  assert.equal(login.host,new URL(ids.loginApiUrl).host);
  assert.ok(login.workerName.startsWith(ids.workerName+'-'));
  assert.deepEqual([login.vars.APP_URL,login.vars.PASSKEY_ORIGIN,login.vars.PASSKEY_RP_ID,login.vars.STEWARD_DEFAULT_TENANT_ID,login.vars.EMAIL_FROM],[ids.loginApiUrl,row.web,new URL(row.web).hostname,row.tenant,ids.mailFrom]);
  assert.equal(login.vars.STEWARD_OAUTH_ALLOWED_REDIRECTS,row.web+'/alphaphone/auth/callback');
  assert.deepEqual(login.secrets,[...LOGIN_SECRETS]);
  // The web host is Alpha's edge Worker bound to this deployment's API.
  const edge=edgeConfig(policy,resources,environment,os.tmpdir());
  assert.equal(edge.name,ids.workerName+'-edge');
  assert.deepEqual(edge.routes,[{pattern:new URL(row.web).host,custom_domain:true}]);
  assert.deepEqual(edge.services,[{binding:'API',service:ids.workerName}]);
  assert.ok(path.resolve(os.tmpdir(),edge.main).endsWith('cloud/edge/worker.ts'));
 }
 assert.equal(leakedElizaHost(deployment),null);
});

test('the same Alpha Cloud configuration remains deployable after application cutover',()=>{
 const before=workerDeployment(alpha.policy,alpha.resources);
 STORAGE_NAMESPACES.push(storageFingerprint(alpha.policy));
 try { assert.deepEqual(workerDeployment(alpha.policy,alpha.resources),before); }
 finally { STORAGE_NAMESPACES.pop(); }
});

test('only the selected environment needs provisioned resources before deployment writes',()=>{
 const resources=structuredClone(alpha.resources);
 const auth={CLOUDFLARE_API_TOKEN:'synthetic-token'};
 assert.throws(()=>deployResources(alpha.policy,resources,'staging',auth),/resources\.staging\.accountId is not provisioned/);
 resources.staging.accountId='a'.repeat(32);
 assert.throws(()=>deployResources(alpha.policy,resources,'staging',auth),/resources\.staging\.hyperdriveId is not provisioned/);
 resources.staging.hyperdriveId='b'.repeat(32);
 assert.throws(()=>deployResources(alpha.policy,resources,'staging',auth),/resources\.staging\.kvNamespaceId is not provisioned/);
 resources.staging.kvNamespaceId='c'.repeat(32);
 assert.throws(()=>deployResources(alpha.policy,resources,'staging',{}),/CLOUDFLARE_API_TOKEN is required/);
 assert.throws(()=>deployResources(alpha.policy,resources,'staging',{...auth,CLOUDFLARE_ACCOUNT_ID:'d'.repeat(32)}),/does not match the selected resources/);
 assert.equal(deployResources(alpha.policy,resources,'staging',auth),resources.staging);
 assert.throws(()=>deployResources(alpha.policy,resources,'production',auth),/resources\.production\.accountId is not provisioned/);
});

test('shared Eliza, foreign services or incomplete input is refused',()=>{
 const {policy,resources}=example;
 for(const name of [...WORKER_SECRETS,...LOGIN_SECRETS])assert.match(name,/^[A-Z][A-Z0-9_]+$/);
 const shared=structuredClone(policy);shared.production.api='https://api.eliza.app';
 assert.throws(()=>workerDeployment(shared,resources),/must not name api\.eliza\.app/);
 const naming=structuredClone(resources);naming.production.loginApiUrl='https://login.eliza.app';
 assert.throws(()=>workerDeployment(policy,naming),/must not name login\.eliza\.app/);
 const missing=structuredClone(resources);delete missing.staging.hyperdriveId;
 assert.throws(()=>workerDeployment(policy,missing),/resources\.staging\.hyperdriveId is required/);
 const otherZone=structuredClone(resources);otherZone.production.zone='example.net';
 assert.throws(()=>workerDeployment(policy,otherZone),/is not in zone example\.net/);
 const otherServices=structuredClone(policy);otherServices.production.services='https://services.example.net';
 assert.throws(()=>workerDeployment(otherServices,resources),/services\.example\.net is not in zone/);
 const insecure=structuredClone(policy);insecure.production.api='http://api.cloud.example.org';
 assert.throws(()=>workerDeployment(insecure,resources),/canonical HTTPS origins/);
});

test('prepare preserves unrelated directories and admits only its marked pinned export',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-prepare-test-'));
 try {
  const tree=path.join(directory,'tree');
  fs.mkdirSync(tree);
  const foreign=path.join(tree,'keep.txt');
  fs.writeFileSync(foreign,'keep');
  await assert.rejects(prepare(tree),/not an Alpha Cloud export/);
  assert.equal(fs.readFileSync(foreign,'utf8'),'keep');

  const record=path.join(tree,'.alpha-cloud-tree.json');
  fs.writeFileSync(record,'{}');
  await assert.rejects(prepare(tree),/not an Alpha Cloud export/);
  assert.equal(fs.readFileSync(foreign,'utf8'),'keep');

  fs.writeFileSync(record,JSON.stringify({commit:read('upstream.lock.json').commit,built:true}));
  assert.equal(await prepare(tree),fs.realpathSync(tree));
  assert.equal(preparedTree(tree),fs.realpathSync(tree));
  fs.writeFileSync(path.join(tree,'.git'),'gitdir: elsewhere');
  await assert.rejects(prepare(tree),/not an Alpha Cloud export/);
  assert.equal(fs.readFileSync(foreign,'utf8'),'keep');
  assert.throws(()=>preparedTree(path.resolve('vendor/eliza')), /outside the pinned vendor checkout/);
 } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('the app registration is the rows upstream admits: approved app, exact https callback, release signers',()=>{
 for(const environment of ['production','staging']){
  const rows=registrationRows(alpha.policy,environment),row=alpha.policy[environment];
  const callback=row.web+'/alphaphone/auth/callback';
  assert.equal(rows.client.client_id,'ai.alphacompute.alphaphone');
  assert.equal(rows.client.android_package_name,'ai.alphacompute.alphaphone');
  assert.equal(rows.client.callback_android_package,'ai.alphacompute.alphaphone');
  assert.equal(rows.client.redirect_uri,callback);
  assert.equal(rows.client.app_id,rows.app.id);
  assert.match(rows.app.id,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(rows.app.id,registrationAppId(identity,environment,row.api));
  assert.deepEqual(rows.app.allowed_origins,[callback]);
  assert.equal(rows.app.is_active&&rows.app.is_approved,true);
  assert.deepEqual(rows.client.browser_sign_in,{startPath:'/alphaphone/auth/browser-start',returnPath:'/__alpha-browser-cloud/signin-return',storageKey:'alpha-browser-sign-in:v1',apiOrigin:row.api,tenant:row.tenant});
  for(const fingerprint of rows.client.android_cert_fingerprints)assert.match(fingerprint,/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  assert.deepEqual(rows.client.android_cert_fingerprints,releaseSignerFingerprints());
 }
 assert.notEqual(registrationRows(alpha.policy,'production').app.id,registrationRows(alpha.policy,'staging').app.id);
 const signer=read('android/release-signer.json');
 assert.equal(releaseSignerFingerprints()[0],colonFingerprint(signer.signerSha256));
 assert.throws(()=>colonFingerprint('AB'),/64 lower-case hex/);
 // The loopback local Cloud uses the same rows with its port-bearing origin.
 const local=registrationFor({api:'https://127.0.0.1:8787',web:'https://127.0.0.1:8787',tenant:'alphacloud-local'},'staging');
 assert.equal(local.client.redirect_uri,'https://127.0.0.1:8787/alphaphone/auth/callback');
 assert.equal(local.owner.email,'apps@localhost.invalid');
});

test('secrets: operator names are named, internal ones are generated once and never rotated',()=>{
 const environment='staging';
 const first=completeSecrets({},environment);
 for(const name of GENERATED_SECRETS)assert.ok(first[name],name);
 assert.match(first.STEWARD_PLATFORM_KEYS,/^stw_platform_[0-9a-f]{64}$/);
 const scopes=JSON.parse(first.STEWARD_PLATFORM_KEY_SCOPES);
 assert.deepEqual(Object.keys(scopes),[crypto.createHash('sha256').update(first.STEWARD_PLATFORM_KEYS).digest('hex')]);
 assert.ok(!first.STEWARD_PLATFORM_KEY_SCOPES.includes(first.STEWARD_PLATFORM_KEYS));
 crypto.createPrivateKey({key:Buffer.from(first.ELIZA_ENTITLEMENT_SIGNING_KEY,'base64'),format:'der',type:'pkcs8'});
 assert.deepEqual(completeSecrets(first,environment),first);
 const missing=secretProblems(first,environment);
 for(const name of OPERATOR_SECRETS.required)assert.ok(missing.includes(`${name} is missing`),name);
 const operator={...reviewedDatabaseReceipts,DATABASE_URL:'postgresql://cloud@db.internal/alpha',STEWARD_DATABASE_URL:'postgresql://steward@db.internal/steward',KV_REST_API_URL:'https://kv.internal',
  KV_REST_API_TOKEN:'t',CEREBRAS_API_KEY:'c',RESEND_API_KEY:'r',GOOGLE_CLIENT_ID:'g.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'s',STRIPE_SECRET_KEY:'sk_test_x',
  STRIPE_WEBHOOK_SECRET:'w',STRIPE_PLUS_MONTHLY_PRICE_ID:'price_p',STRIPE_PLUS_PRODUCT_ID:'prod_p',STRIPE_PRO_MONTHLY_PRICE_ID:'price_q',STRIPE_PRO_PRODUCT_ID:'prod_q',
  CLOUD_PUBLIC_SERVICE_TERMS_JSON:JSON.stringify(legalDocument('Terms')),CLOUD_PUBLIC_SERVICE_PRIVACY_JSON:JSON.stringify(legalDocument('Privacy'))};
 const complete={...first,...operator};
 assert.deepEqual(secretProblems(complete,environment),[]);
 assert.deepEqual(secretProblems(complete,'production'),['STRIPE_SECRET_KEY must be a live key in production']);
 assert.ok(secretProblems({...complete,STEWARD_DATABASE_URL:complete.DATABASE_URL},environment).some(problem=>/separate database/.test(problem)));
 assert.ok(secretProblems({...complete,KV_REST_API_URL:'https://kv.eliza.app'},environment).some(problem=>/names kv\.eliza\.app/.test(problem)));
 assert.deepEqual(secretProblems({...complete,CLOUD_PUBLIC_SERVICE_TERMS_JSON:''},environment),['CLOUD_PUBLIC_SERVICE_TERMS_JSON is missing']);
 assert.deepEqual(secretProblems({...complete,CLOUD_PUBLIC_SERVICE_TERMS_JSON:'{"title":"Fixture"}'},environment),
  ['CLOUD_PUBLIC_SERVICE_TERMS_JSON must be a JSON document with a title, revision and plain-text sections']);
 const oversized=JSON.stringify({...legalDocument('Privacy'),sections:[{title:'Fixture',paragraphs:['é'.repeat(2600)]}]});
 assert.ok(oversized.length<5120&&Buffer.byteLength(oversized)>5120);
 assert.deepEqual(secretProblems({...complete,CLOUD_PUBLIC_SERVICE_PRIVACY_JSON:oversized},environment),
  ['CLOUD_PUBLIC_SERVICE_PRIVACY_JSON must be at most 5120 UTF-8 bytes']);
 // Steward gets its own database as DATABASE_URL; the API never sees Steward's vault secrets.
 const login=componentSecrets(complete,'login'),api=componentSecrets(complete,'api');
 assert.equal(login.DATABASE_URL,operator.STEWARD_DATABASE_URL);
 assert.equal(api.DATABASE_URL,operator.DATABASE_URL);
 for(const name of ['CLOUD_PUBLIC_SERVICE_TERMS_JSON','CLOUD_PUBLIC_SERVICE_PRIVACY_JSON']){
  assert.equal(api[name],operator[name]);
  assert.equal(login[name],undefined);
 }
 for(const name of ['STEWARD_MASTER_PASSWORD','STEWARD_KDF_SALT','STEWARD_AUDIT_HMAC_KEY'])assert.equal(api[name],undefined);
 for(const name of Object.keys(reviewedDatabaseReceipts))assert.equal(api[name]??login[name],undefined);
 assert.equal(api.STEWARD_JWT_SECRET,login.STEWARD_JWT_SECRET);
});

test('the operator reads a receipt without trusting it and enforces the reviewed pair during migration',()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-database-migrate-'));
 const originalBun=process.env.BUN, originalReceipt=process.env.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256;
 try {
  const shared=path.join(tree,'packages/cloud/shared');
  fs.mkdirSync(shared,{recursive:true});
  fs.writeFileSync(path.join(tree,'package.json'),JSON.stringify({packageManager:'bun@1.99.0'}));
  const bun=path.join(tree,'bun');
  fs.writeFileSync(bun,`#!/bin/sh
if [ "$1" = --version ]; then echo 1.99.0; exit; fi
printf '%s\\n' "$1" "$2" "$DATABASE_IDENTITY_ENVIRONMENT" "$DATABASE_IDENTITY_GATE_MODE" "\${DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256-unset}" "\${DATABASE_IDENTITY_EXPECTED_AUTHORITY_SHA256-unset}" > "${tree}/call"
if [ "$1" = run ] && [ ! -f "${tree}/hold" ]; then printf '%s\\n' '[db:migrate] migrations complete'; fi
`,{mode:0o700});
  process.env.BUN=bun;
  process.env.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256='ambient';
  const values={DATABASE_URL:'postgresql://fixture@db.example.invalid/cloud'};
  assert.throws(()=>migrate(tree,values,'staging'),/reviewed lowercase SHA-256/);
  assert.equal(fs.existsSync(path.join(tree,'call')),false);
  reportDatabaseIdentity(tree,{...values,...reviewedDatabaseReceipts},'staging');
  const invocation=()=>fs.readFileSync(path.join(tree,'call'),'utf8').trim().split('\n');
  assert.deepEqual(invocation(),['--conditions=eliza-source',path.join(tree,'packages/cloud/scripts/admin/preflight-database-identity.ts'),'staging','report','unset','unset']);
  migrate(tree,{...values,...reviewedDatabaseReceipts},'production');
  assert.deepEqual(invocation(),['run','--cwd','production','enforce',...Object.values(reviewedDatabaseReceipts)]);
  fs.writeFileSync(path.join(tree,'hold'),'');
  assert.throws(()=>migrate(tree,{...values,...reviewedDatabaseReceipts},'production'),/migrator did not confirm completion/);
 } finally {
  if(originalBun===undefined)delete process.env.BUN;else process.env.BUN=originalBun;
  if(originalReceipt===undefined)delete process.env.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256;else process.env.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256=originalReceipt;
  fs.rmSync(tree,{recursive:true,force:true});
 }
});

test('seeding checks the review receipt on its own transaction and refuses a mismatch before app writes',()=>{
 const tree=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-database-seed-'));
 try {
  const shared=path.join(tree,'packages/cloud/shared');
  const upstream=path.join(tree,'packages/cloud/scripts/admin');
  const trace=path.join(tree,'seed.log');
  fs.mkdirSync(shared,{recursive:true});
  fs.mkdirSync(upstream,{recursive:true});
  fs.writeFileSync(path.join(shared,'package.json'),'{}');
  fs.writeFileSync(path.join(upstream,'preflight-database-identity.ts'),`
   import {appendFileSync} from 'node:fs';
   const record=value=>appendFileSync(${JSON.stringify(trace)},value+'\\n');
   const client={connect:()=>record('connected'),end:()=>record('closed'),query:async text=>{
    record(text);
    if(text.startsWith('select column'))return {rows:['id','client_id','app_url','redirect_uri'].map(column_name=>({column_name}))};
    if(text.startsWith('select id'))return {rows:[{id:'fixture'}]};
    return {rows:[{inserted:true}]};
   }};
   export const readDatabaseIdentityConfig=authority=>authority;
   export const createRuntimePgClient=async ()=>client;
   export async function runDatabaseIdentityPreflight(authority,database){
    if(client!==database||authority.DATABASE_IDENTITY_GATE_MODE!=='enforce')throw Error('wrong database session');
    await database.query('identity');
    return {status:authority.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256===${JSON.stringify(reviewedDatabaseReceipts.DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256)}?'match':'mismatch'};
   }
  `);
  const databaseUrl='postgresql://fixture@db.example.invalid/cloud';
  const rows=[registrationRows(alpha.policy,'production')];
  const run=authority=>seedRegistration({tree,databaseUrl,rows,bun:process.execPath,authority});
  const rejected=spawnSync(process.execPath,['scripts/cloud-seed-registration.ts'],{encoding:'utf8',env:{...process.env,
   SEED_PACKAGE_JSON:path.join(shared,'package.json'),SEED_DATABASE_URL:databaseUrl,SEED_ROWS:JSON.stringify(rows),SEED_DATABASE_AUTHORITY:undefined}});
  assert.equal(rejected.status,1);
  assert.match(rejected.stderr,/requires reviewed database identity receipts/);
  assert.equal(fs.existsSync(trace),false);
  const authority=databaseAuthority(reviewedDatabaseReceipts,'production');
  assert.throws(()=>run({...authority,DATABASE_IDENTITY_EXPECTED_CLUSTER_SHA256:'c'.repeat(64)}),/Seeding the app registration failed/);
  assert.deepEqual(fs.readFileSync(trace,'utf8').trim().split('\n'),['connected','begin','identity','rollback','closed']);
  fs.writeFileSync(trace,'');
  assert.equal(run(authority).seeded[0].clientId,identity.appId);
  const calls=fs.readFileSync(trace,'utf8').trim().split('\n');
  assert.deepEqual(calls.slice(0,3),['connected','begin','identity']);
  assert.equal(calls.filter(line=>line.startsWith('insert into')).length,2);
  assert.deepEqual(calls.slice(-2),['commit','closed']);
 } finally { fs.rmSync(tree,{recursive:true,force:true}); }
});

test('the secrets file must be private and outside the checkout',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-secrets-'));
 const file=path.join(dir,'staging.env');
 fs.writeFileSync(file,'A_KEY=1\nQUOTED="two"\n# comment\n',{mode:0o644});
 assert.throws(()=>readEnvFile(file),/chmod 600/);
 fs.chmodSync(file,0o600);
 assert.deepEqual(readEnvFile(file),{A_KEY:'1',QUOTED:'two'});
 assert.throws(()=>readEnvFile('cloud/staging.env'),/outside the checkout/);
});

test('the edge Worker forwards only asset links and the registered native returns',()=>{
 const at=url=>edgeRoute(new URL(url));
 assert.equal(at('https://cloud.alphacompute.ai/.well-known/assetlinks.json'),'assetlinks');
 assert.equal(at('https://cloud.alphacompute.ai/alphaphone/auth/callback?code=x&state=y'),'hosted');
 assert.equal(at('https://cloud.alphacompute.ai/alphaphone/billing/return?session=x'),'hosted');
 assert.equal(at('https://cloud.alphacompute.ai/alphaphone/auth/browser-start'),'hosted');
 assert.equal(at('https://cloud.alphacompute.ai/health'),'health');
 for(const url of ['https://cloud.alphacompute.ai/','https://cloud.alphacompute.ai/cloud/billing','https://cloud.alphacompute.ai/api/v1/user',
  'https://cloud.alphacompute.ai/a/b/auth/callback','http://cloud.alphacompute.ai/alphaphone/auth/callback','https://cloud.alphacompute.ai/ALPHA/auth/callback'])assert.equal(at(url),null,url);
});

function smokeFixture(environment){
 const row=alpha.policy[environment],ids=alpha.resources[environment];
 const redirectUri=row.web+'/alphaphone/auth/callback';
 const config={success:true,clientId:identity.appId,environment,redirectUri,codeChallengeMethod:'S256'};
 const registration=`${row.api}/api/v1/app-auth/mobile/config?${new URLSearchParams({clientId:identity.appId,environment,redirectUri})}`;
 const service={success:true,version:1,service:{name:row.name,terms:legalDocument('Terms'),privacy:legalDocument('Privacy')}};
 const links=[{relation:['delegate_permission/common.handle_all_urls'],target:{namespace:'android_app',package_name:identity.appId,
  sha256_cert_fingerprints:releaseSignerFingerprints()}}];
 const {publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
 const keys=[{...publicKey.export({format:'jwk'}),kid:'synthetic-entitlement'}];
 const callback=`<a href="intent://${new URL(redirectUri).host}/alphaphone/auth/callback#Intent;scheme=https;package=${identity.appId};end">Return to Alpha</a>`;
 const answers={
  [`${row.api}/api/health`]:[200,{status:'ok',environment}],
  [`${row.api}/api/public/service`]:[200,service],
  [`${row.api}/api/v1/subscription/entitlement-keys`]:[200,{keys}],
  [registration]:[200,config],
  [`${row.api}/api/v1/subscriptions/plans`]:[200,{success:true,data:{plans:[
   {key:'plus_monthly',name:'Plus',amountCents:3000,allowance:{amountUsd:'25.000000'}},
   {key:'pro_monthly',name:'Pro',amountCents:10000,allowance:{amountUsd:'90.000000'}},
  ]}}],
  [`${ids.loginApiUrl}/auth/providers?tenantId=${row.tenant}`]:[200,{email:true,google:true}],
  [`${row.web}/.well-known/assetlinks.json`]:[200,links],
  [redirectUri]:[200,callback,'text/html'],
 };
 const fetcher=overrides=>async (url,options)=>{
  assert.equal(options.redirect,'manual');
  assert.ok(options.signal instanceof AbortSignal);
  const [status,body,type='application/json']=overrides[url]??answers[url]??[404,{}];
  return new Response(type==='application/json'?JSON.stringify(body):body,{status,headers:{'content-type':type}});
 };
 return {row,ids,redirectUri,config,registration,service,links,keys,callback,fetcher};
}

test('smoke uses the pinned native registration contract and checks the public callback for both environments',async()=>{
 for(const environment of ['staging','production']){
  const {fetcher}=smokeFixture(environment);
  const rows=await smoke(alpha.policy,alpha.resources,environment,fetcher({}));
  assert.equal(rows.length,8);
  assert.ok(rows.every(row=>row.passed),JSON.stringify(rows));
 }
});

test('smoke refuses incomplete, wrong-environment and wrong-authority HTTP 200 answers',async()=>{
 const {row,ids,redirectUri,config,registration,service,links,keys,callback,fetcher}=smokeFixture('staging');
 const regressions=[
  ['api health',`${row.api}/api/health`,[200,{status:'ok',environment:'production'}]],
  ['service document',`${row.api}/api/public/service`,[200,{name:row.name}]],
  ['service document',`${row.api}/api/public/service`,[200,{...service,service:{...service.service,name:'Unexpected service'}}]],
  ['entitlement keys',`${row.api}/api/v1/subscription/entitlement-keys`,[200,{keys:[]}]],
  ['entitlement keys',`${row.api}/api/v1/subscription/entitlement-keys`,[200,{keys:[...keys,{...keys[0],d:'synthetic-private-value'}]}]],
  ['entitlement keys',`${row.api}/api/v1/subscription/entitlement-keys`,[200,{keys:[{...keys[0],x:'A'.repeat(43),y:'A'.repeat(43)}]}]],
  ['app registration',registration,[200,{...config,redirectUri:redirectUri+'-other'}]],
  ['app registration',registration,[200,{...config,codeChallengeMethod:'plain'}]],
  ['plans',`${row.api}/api/v1/subscriptions/plans`,[200,{success:true,data:{plans:[]}}]],
  ['sign-in providers',`${ids.loginApiUrl}/auth/providers?tenantId=${row.tenant}`,[200,{google:true}]],
  ['asset links',`${row.web}/.well-known/assetlinks.json`,[200,[{target:{package_name:identity.appId}}]]],
  ['asset links',`${row.web}/.well-known/assetlinks.json`,[200,[{...links[0],target:{...links[0].target,sha256_cert_fingerprints:[colonFingerprint('a'.repeat(64))]}}]]],
  ['callback page',redirectUri,[302,'','text/html']],
  ['callback page',redirectUri,[200,callback.replace(identity.appId,'ai.example.other'),'text/html']],
 ];
 for(const [gate,url,answer] of regressions){
  const rows=await smoke(alpha.policy,alpha.resources,'staging',fetcher({[url]:answer}));
  assert.deepEqual(rows.filter(row=>!row.passed).map(row=>row.gate),[gate]);
 }
 const leaked=await smoke(alpha.policy,alpha.resources,'staging',fetcher({[redirectUri]:[200,callback+'https://cloud.eliza.app','text/html']}));
 assert.match(leaked.find(row=>row.gate==='callback page').detail,/names cloud\.eliza\.app/);
});

test('Cloud tool outputs under the pinned source are refused before invoking upstream',()=>{
 const result=spawnSync(process.execPath,['scripts/cloud-worker.ts','render','--out','vendor/eliza/cloud-output-fixture'],{encoding:'utf8'});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/outside the pinned vendor checkout/);
});
