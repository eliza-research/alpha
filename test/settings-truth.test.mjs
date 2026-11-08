import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from './support/strip-types.mjs';
// Dependency-free Settings wording, evaluated without the renderer.
const source=readFileSync('apps/app/src/prototype/settings-adapter.ts','utf8');
const region=source.slice(source.indexOf('// settings-facts:begin'),source.indexOf('// settings-facts:end'));
assert.ok(region.length>100,'settings-facts region is present');
const m=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(region,{mode:'strip'})).toString('base64'));
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
 // The OS update-channel check is registered off; only the Developer gate (the one About page, native
 // and browser) shows its state, and the production bundle audit denies the row.
 assert.match(readFileSync('apps/app/src/build-flags.ts','utf8'),/export const updateChannelCheckEnabled = false as boolean;/);
 assert.equal((source.match(/\.\.\.\(developerTools\?\[info\('Update channel \(development\)',updateChannelCheckEnabled\?'Read-only check on · never downloads or installs':'Off'\)\]:\[\]\)/g)??[]).length,1);
 assert.equal((source.match(/Update channel \(development\)/g)??[]).length,1);
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

// Exercise the routing used by the real adapter for stale, removed and developer routes (docs/settings.md).
test('production Settings refuses Developer and removed pages, and keeps its own pages',()=>{
 assert.equal(m.settingsPage('developer',false),null);
 for(const page of ['cloud-plan','agent-connection','history','listening','calendar','calendar-google','password-provider','password-entry','cross','about','problems','licenses'])assert.equal(m.settingsPage(page,false),page);
 // Pages that only repeated Android facts or another flow route to the top level.
 for(const page of ['wifi','bluetooth','mobile','battery','sound','display','models','privacy','character','accounts','connections','notifications','photos','default-apps',null,undefined,'',7])assert.equal(m.settingsPage(page,false),null,String(page));
 assert.match(source,/const current = settingsPage\(state\.page, developerTools\);/);
 // The reference renderer draws only the frame: its prototype pages are never rendered.
 assert.match(source,/const out = render\(\{ \.\.\.state, page: current === 'developer' \? 'developer' : null,/);
 assert.match(source,/const developerRow = developerTools \? row\('Developer', go\('developer'\)\) : null;/);
});
test('Android Back pops one level, to the same parent as each page\'s own back control',()=>{
 assert.deepEqual({...m.SETTINGS_PARENT},{history:'agent-connection','agent-recovery-details':'agent-connection',problems:'about',licenses:'about','password-entry':'password-provider'});
 for(const [page,parent] of Object.entries(m.SETTINGS_PARENT)){assert.ok(m.SETTINGS_PAGES.includes(page),page);assert.ok(m.SETTINGS_PAGES.includes(parent),parent);}
 assert.match(source,/const parent = state\.sheet \? undefined : SETTINGS_PARENT\[state\.page\];\n    if \(parent\) \{ api\.set\(\{ page: parent \}\); return true; \}\n    return back \? back\(state, api\) : false;/);
 // Each child's own back control returns to the same parent.
 assert.match(source,/subpage\('Earlier conversations',\[group\(rows\)\],\{z:6,back:go\('agent-connection'\)/);
 assert.match(source,/const toAbout = \{ z: 6, back: go\('about'\), backLabel: 'Back to About' \};/);
 assert.match(source,/passwordEntryPage\(helpers, \(\) => api\.set\(\{ page: 'password-provider' \}\)\)/);
});
test('the top level has no Android facts, mirror pages or explanatory subtitles',()=>{
 const body=source.slice(source.indexOf('  definition.render = (state: Bag, api: Bag) => {'));
 for(const label of ["'Wi-Fi'","'Bluetooth'","'Mobile data'","'Battery'","'Sound & vibration'","'Models'","'Privacy & data'","'Accounts'","'Connections'","'Display'","'Character'","'Home app'","'Assistant app'","'Default apps in Android'","'Inference model'","'Security patch'","Manage brightness"])assert.ok(!body.includes(label),label);
 const top=body.slice(body.indexOf('    top.groups = ['),body.indexOf('].filter(g => g.rows.length);'));
 for(const cap of ['Account','Assistant','Apps','Appearance','Notifications','Privacy','System'])assert.match(top,new RegExp(`'${cap}'\\)`),cap);
 assert.doesNotMatch(body.slice(0,body.indexOf('    // Eliza Cloud.')),/hasSub:true,sub:|sub:'[A-Z]/,'no subtitle under a top-level row');
});
test('Eliza Cloud page: plan facts, Approve again only when expiring, Redeem always, confirmed Sign out',()=>{
 const calls=[];const actions=Object.fromEntries(['cancel','approve','redeem','manage','signOut','recheck','signIn'].map(name=>[name,()=>calls.push(name)]));
 const plan={signedIn:true,offline:false,account:'owner@example.invalid',plan:'Alpha plan',status:'active',endsAt:1,allowance:'1,000 requests a month',limit:'Limited · retry in 5 minutes',keyExpiresAt:2,keyExpiring:false,inference:'Nebula'};
 const page=(changes={},options={})=>m.cloudAccountPage({plan:{...plan,...changes},busy:false,message:'',serviceName:'Nebula',runtimeLocation:'On this device',day:at=>'day '+at,confirm:()=>true,actions,...options});
 const p=page();
 assert.deepEqual(p.rows.map(r=>[r.label,r.value]),[['Account','owner@example.invalid'],['Plan','Alpha plan'],['Agent execution','On this device'],['AI replies','Nebula'],['Plan runs until','day 1'],['Plan allowance','1,000 requests a month'],['AI requests','Limited · retry in 5 minutes'],['Sign-in expires','day 2']]);
 assert.deepEqual(p.actions.map(a=>a.label),['Redeem code','Manage plan','Sign out']);
 assert.equal(p.actions.at(-1).aria,'Sign out of Nebula');
 assert.deepEqual(page({keyExpiring:true}).actions.map(a=>a.label),['Approve this phone again','Redeem code','Manage plan','Sign out']);
 assert.equal(page({status:'canceled'}).rows[4].label,'Plan ended');
 assert.deepEqual(page({allowance:null,limit:null,endsAt:null,keyExpiresAt:null}).rows.map(r=>r.label),['Account','Plan','Agent execution','AI replies']);
 // Sign out asks first; a decline changes nothing.
 let asked='';page({},{confirm:text=>{asked=text;return false;}}).actions.at(-1).go();assert.deepEqual(calls,[]);assert.match(asked,/^Sign out of Nebula\?/);
 page().actions.at(-1).go();assert.deepEqual(calls,['signOut']);
 const busy=page({}, {busy:true,message:'Signing out…'});assert.deepEqual(busy.actions.map(a=>a.label),['Cancel']);assert.deepEqual(busy.rows.at(-1),{label:'Status',value:'Signing out…'});
 busy.actions[0].go();assert.deepEqual(calls,['signOut','cancel']);
 assert.deepEqual(page({signedIn:false,offline:true,account:null}).actions.map(a=>a.label),['Check plan again']);
 assert.equal(page({signedIn:false,offline:true,account:null}).rows[0].value,'Nebula unreachable');
 assert.deepEqual(page({signedIn:false,account:null}).actions.map(a=>a.label),['Sign in with Nebula']);
 // The adapter wires each action to the connection controller's real operation.
 assert.match(source,/redeem: \(\) => connectionController\.openPlan\(\{ codeEntry: true \}\)/);
 assert.match(source,/signOut: \(\) => void connectionController\.cloudSignOut\(\)/);
 assert.match(source,/confirm: text => window\.confirm\(text\)/);
});
test('App permissions shows only how many grants Android reports off',()=>{
 assert.equal(m.permissionSummary({Microphone:true,Location:false,Camera:false,Calendar:true}),'2 not allowed');
 assert.equal(m.permissionSummary({Microphone:true,Location:true}),'All allowed');
 for(const value of [null,undefined,{},{Microphone:'true'}])assert.equal(m.permissionSummary(value),'');
});
test('one Developer gate: a development server build opened with ?tools=1, never the product',()=>{
 const profile=readFileSync('apps/app/src/browser/dev-profile.ts','utf8');
 assert.match(profile,/export const developerTools=devSurfacesEnabled&&new URLSearchParams\(location\.search\)\.get\('tools'\)==='1';/);
 assert.match(profile,/const devSurfacesEnabled:boolean=import\.meta\.env!==undefined&&import\.meta\.env\.DEV===true&&/);
 // Every developer-only Settings row reads the same gate, not a test-mocks or dev-surface flag alone.
 for(const row of ["if(developerTools&&!Capacitor.isNativePlatform())groups.push({...group([{kNav:true,label:'Calendar backups'","if(developerTools)page.groups.push(group([{kNav:true,label:'Try mock mode'","if(developerTools&&recovery.length)page.groups.push(group([info('Saved data needs recovery'","if(developerTools)agentRows.push(action('Details',","if(native&&developerTools&&state.page==='agent-recovery-details')"])assert.ok(source.includes(row),row);
 assert.doesNotMatch(source,/(testMocksEnabled|devSurfacesEnabled)[^;\n]{0,40}(Calendar backups|Try mock mode|Saved data needs recovery|Update channel)/);
});
test('explicit developer surfaces retain the Developer route',()=>{
 assert.equal(m.settingsPage('developer',true),'developer');
});
