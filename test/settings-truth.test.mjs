import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
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
 // The OS update-channel check is registered off; only the Developer gate (both About pages)
 // shows its state, and the production bundle audit denies the row.
 assert.match(readFileSync('apps/app/src/build-flags.ts','utf8'),/export const updateChannelCheckEnabled = false as boolean;/);
 assert.equal((source.match(/\.\.\.\(developerTools\?\[info\('Update channel \(development\)',updateChannelCheckEnabled\?'Read-only check on · never downloads or installs':'Off'\)\]:\[\]\)/g)??[]).length,2);
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
 // Their notices stay as toasts only, so no state is kept for a row.
 assert.doesNotMatch(source,/gmailNotice|roleNotice/);
});
test('the Google accounts sheet has no Gmail notification settings button: Android lists Gmail with Alpha\'s other channels',()=>{
 assert.doesNotMatch(readFileSync('apps/app/src/runtime/google-connection-ui.tsx','utf8'),/Gmail notification settings|gmailNotificationSettings/);
 assert.doesNotMatch(readFileSync('apps/app/src/runtime/gmail-background.ts','utf8'),/gmailNotificationSettings/);
});
test('Scheduled digests has one Settings entry, the top-level row',()=>{
 assert.equal((source.match(/label:'Scheduled digests'/g)??[]).length,1);
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

test('Cloud privacy facts describe AI and speech without model-navigation claims',()=>{
 assert.deepEqual(m.cloudPrivacyRow('Leaves this device'),['Shared with Cloud','Messages and selected content when you use AI']);
 assert.deepEqual(m.cloudPrivacyRow('On-device model'),['Voice','Recordings for transcription and text for playback, when used']);
 assert.equal(m.cloudPrivacyRow('Manage Alpha permissions'),null);
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

// Exercise the policy used by the real adapter for both stale routes and navigation rows.
test('production Settings refuses Developer routes and preserves real About diagnostics',()=>{
 const rows=[{label:'Models'},{label:'Developer'},{label:'About'}, {lbl:'Developer'}];
 assert.deepEqual(m.settingsNavigationRows(rows,false),[{label:'Models'},{label:'About'}]);
 assert.equal(rows.length,4,'filtering must not mutate the reference model');
 assert.equal(m.settingsPage('developer',false),null);
 for(const page of ['about','problems','licenses','models',null,undefined])assert.equal(m.settingsPage(page,false),page);
 assert.match(source,/page: settingsPage\(state\.page, developerTools\)/);
 assert.match(source,/rows: settingsNavigationRows\(group\.rows, developerTools\)/);
});
test('one Developer gate: a development server build opened with ?tools=1, never the product',()=>{
 const profile=readFileSync('apps/app/src/browser/dev-profile.ts','utf8');
 assert.match(profile,/export const developerTools=devSurfacesEnabled&&new URLSearchParams\(location\.search\)\.get\('tools'\)==='1';/);
 assert.match(profile,/const devSurfacesEnabled:boolean=import\.meta\.env!==undefined&&import\.meta\.env\.DEV===true&&/);
 // Every developer-only Settings row reads the same gate, not a test-mocks or dev-surface flag alone.
 for(const row of ["if(developerTools&&!Capacitor.isNativePlatform())groups.push({...group([{kNav:true,label:'Calendar backups'","if(developerTools)page.groups.push(group([{kNav:true,label:'Try mock mode'","if(developerTools&&recovery.length)page.groups.push(group([info('Saved data needs recovery'","if(developerTools)agentRows.push(action('Details',","if(native&&developerTools&&state.page==='agent-recovery-details')"])assert.ok(source.includes(row),row);
 assert.doesNotMatch(source,/(testMocksEnabled|devSurfacesEnabled)[^;\n]{0,40}(Calendar backups|Try mock mode|Saved data needs recovery|Update channel)/);
});
test('explicit developer surfaces retain Developer navigation and route',()=>{
 const rows=[{label:'Developer'},{label:'About'}];
 assert.equal(m.settingsNavigationRows(rows,true),rows);
 assert.equal(m.settingsPage('developer',true),'developer');
});
