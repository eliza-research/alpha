import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
// Dependency-free Settings wording, evaluated without the renderer.
const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const region=source.slice(source.indexOf('// settings-facts:begin'),source.indexOf('// settings-facts:end'));
assert.ok(region.length>100,'settings-facts region is present');
const m=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'transform'})).toString('base64'));
const java=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java','utf8');

test('the version row shows only what the build and Android report',()=>{
 assert.equal(m.versionLabel('0.1.0',7),'0.1.0 (7)');
 assert.equal(m.versionLabel('0.1.0',undefined),'0.1.0');
 for(const code of [0,-1,1.5,'7',null,NaN])assert.equal(m.versionLabel('0.1.0',code),'0.1.0');
 for(const version of ['',undefined,null,7])assert.equal(m.versionLabel(version,7),'Unavailable');
});
test('About shows only the install time Android recorded and never claims the app is current',()=>{
 const format=at=>'day '+at;
 assert.deepEqual(m.installedRows(1760000000000,format),[['Installed or last updated','day 1760000000000']]);
 for(const at of [undefined,null,0,-5,'1760000000000',1.5])assert.deepEqual(m.installedRows(at,format),[]);
 // The update-channel implementation remains disabled and the revised About page has no update status row.
 assert.match(readFileSync('apps/app/src/build-flags.ts','utf8'),/export const updateChannelCheckEnabled = false as boolean;/);
 assert.doesNotMatch(source,/Update channel \(development\)/);
 assert.match(readFileSync('scripts/audit-production-bundle.mjs','utf8'),/'Update channel \(development\)'/);
 // Nothing claims the app is current or that an update failed; Software update has no notice text at all.
 assert.doesNotMatch(source,/Up to date|Update available|Update failed/);
 assert.doesNotMatch(java,/Up to date|Update available/);
});
// Software update (settings-adapter.ts, AlphaDevicePlugin): the renderer's manifest policy and check cadence.
// The rendered rows, the check wiring and the install payload are in test/browser/settings-device-facts.spec.ts.
const installed={versionCode:7,launcher:true,signerSha256:'5c'.repeat(32)};
const manifest={schema:'alpha-update/v1',versionCode:8,versionName:'0.1.1',variant:'launcher',signerSha256:'5c'.repeat(32),apkUrl:'https://github.com/eliza-research/alphaphone/releases/download/app-8/alpha-phone-8.apk',sha256:'0a'.repeat(32),sizeBytes:400_000_000,notes:'Faster Home'};
test('Software update offers only a complete, newer manifest for this flavor and signer, with an HTTPS APK, a SHA-256 and a bounded size',()=>{
 assert.equal(m.UPDATE_SCHEMA,'alpha-update/v1');
 const {schema,variant,signerSha256,...offered}=manifest;
 assert.deepEqual(m.parseUpdateManifest(manifest,installed),offered);
 assert.deepEqual(m.parseUpdateManifest({...manifest,notes:undefined},installed),{...offered,notes:''},'notes are optional');
 // Notes are only shown: a string of at most 500 characters is, anything else is left out and never refuses the update.
 assert.equal(m.parseUpdateManifest({...manifest,notes:'x'.repeat(500)},installed)?.notes,'x'.repeat(500));
 for(const notes of ['x'.repeat(501),7,null,{text:'Faster Home'}])assert.deepEqual(m.parseUpdateManifest({...manifest,notes},installed),{...offered,notes:''},String(notes).slice(0,20));
 // So is versionName: 1 to 64 characters without control characters are, anything else is left out and never refuses the update.
 assert.equal(m.parseUpdateManifest({...manifest,versionName:'x'.repeat(64)},installed)?.versionName,'x'.repeat(64));
 for(const versionName of [undefined,null,7,'','x'.repeat(65),'0.1\n1'])assert.deepEqual(m.parseUpdateManifest({...manifest,versionName},installed),{...offered,versionName:''},String(versionName).slice(0,20));
 assert.equal(m.parseUpdateManifest({...manifest,sizeBytes:m.UPDATE_MAX_BYTES},installed)?.sizeBytes,m.UPDATE_MAX_BYTES);
 // Newer only, against the versionCode Android reports; an unknown installed version offers nothing.
 for(const versionCode of [8,9,undefined,null,'7',0.5,Number.NaN])assert.equal(m.parseUpdateManifest(manifest,{...installed,versionCode}),null,String(versionCode));
 // This flavor only: the standalone APK over the launcher would drop HOME, Phone and SMS admission, and an unknown flavor offers nothing.
 assert.equal(m.parseUpdateManifest({...manifest,variant:'standalone'},installed),null);
 assert.deepEqual(m.parseUpdateManifest({...manifest,variant:'standalone'},{...installed,launcher:false}),offered);
 for(const launcher of [null,undefined,'true'])assert.equal(m.parseUpdateManifest(manifest,{...installed,launcher}),null,String(launcher));
 for(const variant of [undefined,'Launcher','both'])assert.equal(m.parseUpdateManifest({...manifest,variant},installed),null,String(variant));
 // Signed like this install: Android refuses any other signer only after the whole download. An unreported signer offers nothing.
 // appSigner is the lineage's original certificate, so an APK Signature Scheme v3 rotation never changes what a manifest names.
 for(const signer of ['6d'.repeat(32),'5C'.repeat(32),undefined])assert.equal(m.parseUpdateManifest({...manifest,signerSha256:signer},installed),null,String(signer));
 for(const signer of [undefined,null,''])assert.equal(m.parseUpdateManifest({...manifest,signerSha256:signer},{...installed,signerSha256:signer}),null,'unreported '+signer);
 // HTTPS only, without credentials in the URL.
 for(const apkUrl of ['http://example.com/a.apk','file:///sdcard/a.apk','content://downloads/a.apk','https://user:secret@example.com/a.apk','example.com/a.apk','','https://'+'a'.repeat(2048)+'.apk',7])
  assert.equal(m.parseUpdateManifest({...manifest,apkUrl},installed),null,String(apkUrl).slice(0,40));
 // SHA-256 as 64 lowercase hex characters, and a positive whole size within the bound the native download enforces.
 for(const sha256 of ['0A'.repeat(32),'0a'.repeat(31),'0a'.repeat(33),'g'.repeat(64),'',undefined])assert.equal(m.parseUpdateManifest({...manifest,sha256},installed),null,String(sha256));
 for(const sizeBytes of [0,-1,1.5,m.UPDATE_MAX_BYTES+1,'400000000',undefined])assert.equal(m.parseUpdateManifest({...manifest,sizeBytes},installed),null,String(sizeBytes));
 assert.equal(m.UPDATE_MAX_BYTES,2**30);assert.match(java,/static final long UPDATE_MAX_BYTES=1L<<30;/,'renderer and native bounds agree');
 for(const change of [{schema:'alpha-update/v2'},{schema:undefined},{versionCode:'8'},{versionCode:8.5}])
  assert.equal(m.parseUpdateManifest({...manifest,...change},installed),null,JSON.stringify(change));
 for(const value of [null,undefined,[],'{}',7])assert.equal(m.parseUpdateManifest(value,installed),null);
});
test('the automatic update check is due a day after the last answered check',()=>{
 const day=m.UPDATE_CHECK_INTERVAL_MS,at=1_760_000_000_000;
 assert.equal(day,86_400_000);
 assert.equal(m.updateCheckDue(Number.NaN,at),true,'never answered');
 assert.equal(m.updateCheckDue(at,at),false);
 assert.equal(m.updateCheckDue(at,at+day-1),false);
 assert.equal(m.updateCheckDue(at,at+day),true);
 assert.equal(m.updateCheckDue(at+60_000,at),true,'a clock set back does not postpone checks');
});
test('dead-end and negative Settings rows are gone from the adapter',()=>{
 for(const row of ["info('Other connectors'","info('Personality settings'","info('Runtime'","info('Display only'","info('Delivery timing'","'Last change'"])assert.ok(!source.includes(row),row);
 // The revised groups expose controls and diagnostics, without a device-facts summary page.
 assert.doesNotMatch(source,/row\('(?:Security patch|Do Not Disturb|Delivery timing)'/);
});
test('the Google accounts sheet has no Gmail notification settings button: Android lists Gmail with Alpha\'s other channels',()=>{
 assert.doesNotMatch(readFileSync('apps/app/src/runtime/google-connection-ui.tsx','utf8'),/Gmail notification settings|gmailNotificationSettings/);
 assert.doesNotMatch(readFileSync('apps/app/src/runtime/gmail-background.ts','utf8'),/gmailNotificationSettings/);
});
test('Scheduled digests has one Settings entry, the top-level row',()=>{
 assert.equal((source.match(/row\('Scheduled digests'/g)??[]).length,1);
 assert.doesNotMatch(source,/\bdigests\b *=|hosted\(\)\.available/);
});
test('prototype-only sheets (memory wipe, Wi-Fi password, forget network) never reach the renderer',()=>{
 const line=source.split('\n').find(row=>row.includes('const out = render({ ...state'));
 for(const kind of ['wipe','wifiPw','forget','conn','voice'])assert.match(line,new RegExp(`'${kind}'`));
 assert.doesNotMatch(source,/Memory wiped|memWiped/);
});
test('native system facts are read without new permissions and are omitted when unreadable',()=>{
 // Switch facts come from the shared reader at the pin (plugin-native-system SystemFacts, tested there);
 // Alpha adds only its own build facts, through the same omit-on-failure helper.
 const shared=readFileSync('vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemFacts.java','utf8');
 for(const key of ['wifiEnabled','bluetoothEnabled','airplaneMode','locationEnabled','mobileDataEnabled','interruptionFilter','adaptiveBrightness'])assert.match(shared,new RegExp(`fact\\(out, "${key}"`));
 assert.match(java,/SystemFacts\.read\(getContext\(\)\)/);
 const app=java.slice(java.indexOf('static void appFacts('),java.indexOf('@PluginMethod public void openPasswordProvider('));
 for(const key of ['appVersionCode','appUpdatedAt'])assert.match(app,new RegExp(`SystemFacts\\.fact\\(facts,"${key}"`));
 // Reads only: neither the shared reader nor the plugin has a setter for a system switch.
 for(const source of [java,shared])assert.doesNotMatch(source,/Settings\.(Global|System|Secure)\.put|setWifiEnabled|\.enable\(\)|\.disable\(\)|setInterruptionFilter/);
 const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
 for(const permission of ['ACCESS_WIFI_STATE','CHANGE_WIFI_STATE','BLUETOOTH_CONNECT','READ_PHONE_STATE','WRITE_SECURE_SETTINGS','ACCESS_NOTIFICATION_POLICY'])assert.doesNotMatch(manifest,new RegExp(`<uses-permission[^>]*android\\.permission\\.${permission}"(?![^>]*tools:node="remove")`),permission);
});

test('the Privacy group contains permission and setup actions',()=>{
 assert.match(source,/group\(present\(\[permissionsRow, setupRow\]\), 'Privacy'\)/);
 assert.match(source,/const permissionsRow = native \? row\('App permissions', manage\('privacy'\), permissionsValue\) : null/);
 assert.match(source,/const setupRow = api\.reopenStartupAccess && missing \? row\('Finish setup', api\.reopenStartupAccess\) : null/);
});

test('Cloud privacy hero includes speech while retaining native and offline/startup truth',async()=>{
 const nativeSource=readFileSync('apps/app/src/prototype/native-adapter.ts','utf8');
 const wording=nativeSource.slice(nativeSource.indexOf('export function egressPrivacy('),nativeSource.indexOf('/** Only a verified resident session'));
 const load=async cloud=>import('data:text/javascript;base64,'+Buffer.from(`const cloudRuntimeEnabled=${cloud};const testMocksEnabled=false;const Capacitor={isNativePlatform:()=>true};const cloudServiceName=environment=>environment==='staging'?'Nebula':'Cloud Test';`+stripTypeScriptTypes(wording,{mode:'transform'})).toString('base64'));
 const cloud=await load(true),native=await load(false);
 const connected={kind:'resident',session:{sessionId:'qa'},cloudAccount:{environment:'staging'}};
 for(const isNative of [true,false]){
  const fact=cloud.egressPrivacy(connected,isNative);
  assert.equal(fact.big,'Uses Nebula');assert.ok(fact.sub.includes('go to Nebula for AI'));
  for(const content of ['When used','messages','selected content','Voice recordings','text for playback'])assert.ok(fact.sub.includes(content),content);
 }
 assert.equal(native.egressPrivacy(connected,true).big,'Identifier swap only');
 for(const [kind,label]of [['starting','Agent starting'],['recovering','Agent not running'],['none','Offline']])assert.equal(cloud.egressPrivacy({kind,session:null,cloudAccount:null},true).big,label);
});

// Exercise the current route policy directly, including stale persisted routes.
test('removed Settings routes open the top level and production refuses Developer',()=>{
 for(const page of ['wifi','bluetooth','mobile','battery','sound','display','models','privacy','character','accounts','connections','photos','notifications','developer','nonsense',null,undefined])assert.equal(m.settingsPage(page,false),null,String(page));
 for(const page of ['account','agent-connection','history','listening','calendar','password-provider','password-entry','cross','about','problems','licenses'])assert.equal(m.settingsPage(page,false),page);
 assert.equal(m.settingsPage('cloud-plan',false),'account');
 assert.match(source,/const current = settingsPage\(state\.page, developerTools\)/);
});
test('one Developer gate requires a development-server build and tools=1',()=>{
 const profile=readFileSync('apps/app/src/browser/dev-profile.ts','utf8');
 assert.match(profile,/export const developerTools=devSurfacesEnabled&&new URLSearchParams\(location\.search\)\.get\('tools'\)==='1';/);
 assert.match(profile,/const devSurfacesEnabled:boolean=import\.meta\.env!==undefined&&import\.meta\.env\.DEV===true&&/);
 assert.match(source,/const developerRow = developerTools \? row\('Developer', go\('developer'\)\) : null/);
 assert.match(source,/developerTools && !native && recovery\.length/);
});
test('explicit developer surfaces retain the Developer route',()=>{
 assert.equal(m.settingsPage('developer',true),'developer');
});
test('Settings groups retain account, assistant, app, appearance, notification, privacy and system controls',()=>{
 const groups=source.slice(source.indexOf('    top.groups = ['),source.indexOf('    // ---- Pages'));
 let cursor=-1;
 for(const name of ['Account','Assistant','Apps','Appearance','Notifications','Privacy']){
  const next=groups.indexOf("'"+name+"'",cursor+1);assert.ok(next>cursor,name);cursor=next;
 }
 assert.match(groups,/group\(present\(\[androidRow, aboutRow, developerRow\]\), '', 'system'\)/);
 assert.match(groups,/group\(present\(\[resetRow\]\), '', 'reset'\)/);
});
test('permission summary counts only reported grants',()=>{
 assert.equal(m.permissionSummary({Microphone:true,Camera:true}),'All allowed');
 assert.equal(m.permissionSummary({Microphone:false,Camera:true,Location:false}),'2 not allowed');
 for(const values of [{},null,{Camera:'yes'}])assert.equal(m.permissionSummary(values),'');
});

test('active temporary account access reports its end without claiming a renewal', () => {
 const row=m.cloudAccountPage({plan:{signedIn:true,offline:false,offerRedeem:false,account:'Owner',plan:'Temporary access',status:'active',endsAt:1800000000000,keyExpiresAt:null,keyExpiring:false},busy:false,message:'',serviceName:'Cloud',day:()=> 'Jan 15',confirm:()=>false,actions:{cancel(){},approve(){},redeem(){},manage(){},signOut(){},recheck(){},signIn(){}}});
 assert.equal(row.status,'Temporary access · Access until Jan 15');
 assert.doesNotMatch(row.status,/renew/i);
});


test('every signed-in account offers explicit code entry without opening it automatically',()=>{
 for(const offerRedeem of [false,true]){
  let opened=0;
  const row=m.cloudAccountPage({plan:{signedIn:true,offline:false,offerRedeem,account:'Owner',plan:'Plus',status:'active',endsAt:null,keyExpiresAt:null,keyExpiring:false},busy:false,message:'',serviceName:'Cloud',day:()=>'',confirm:()=>false,actions:{cancel(){},approve(){},redeem(){opened++;},manage(){},signOut(){},recheck(){},signIn(){}}});
  assert.equal(opened,0);
  row.actions.find(action=>action.label==='Redeem code').go();
  assert.equal(opened,1);
  assert.equal(row.status,'Plus');
 }
});


test('Settings groups and actions keep identities when async rows are inserted',()=>{
 const start=source.indexOf('    const info ='),end=source.indexOf('    const back =',start);
 assert.ok(start>=0&&end>start);
 const helpers=new Function(stripTypeScriptTypes(source.slice(start,end),{mode:'strip'})+';return {row,group};')();
 const about=helpers.row('About',()=>{});
 const before=helpers.group([about],'','system');
 const after=helpers.group([helpers.row('Finish setup',()=>{}),about],'','system');
 assert.equal(before.id,after.id);
 assert.equal(before.rows[0].id,after.rows[1].id);
 assert.notEqual(after.rows[0].id,after.rows[1].id);
});


test('identically labelled Settings actions preserve their source identity',()=>{
 const start=source.indexOf('    const info ='),end=source.indexOf('    const back =',start);
 const helpers=new Function(stripTypeScriptTypes(source.slice(start,end),{mode:'strip'})+';return {row,group};')();
 const calls=[];
 const a=helpers.row('Same title',()=>calls.push('a'),'',{id:'conversation:a'});
 const b=helpers.row('Same title',()=>calls.push('b'),'',{id:'conversation:b'});
 const before=helpers.group([a,b],'','conversations'),after=helpers.group([b,a],'','conversations');
 assert.equal(before.id,after.id);
 assert.notEqual(a.id,b.id);
 const obligations=helpers.group([{time:'Obligation',text:'First'},{time:'Obligation',text:'Second'},{time:'Obligation',text:'First'}]);
 assert.equal(new Set(obligations.rows.map(row=>row.id)).size,3);
 const suffixes=helpers.group([{id:'a'},{id:'a'},{id:'a:1'}]);
 assert.equal(new Set(suffixes.rows.map(row=>row.id)).size,3);
 after.rows.find(row=>row.id===JSON.stringify(['conversation:a',0])).go();
 assert.deepEqual(calls,['a']);
});
