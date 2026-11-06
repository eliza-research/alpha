import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
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
test('no update claim is shown or made',()=>{
 // Alpha has no update check; neither the adapter nor the native plugin says otherwise.
 assert.doesNotMatch(source,/Up to date|Update available|Check for updates|does not check for updates/);
 assert.doesNotMatch(java,/Up to date|Update available/);
});
test('prototype-only sheets (memory wipe, Wi-Fi password, forget network) never reach the renderer',()=>{
 const line=source.split('\n').find(row=>row.includes('const out = render({ ...state'));
 for(const kind of ['wipe','wifiPw','forget','conn','voice'])assert.match(line,new RegExp(`'${kind}'`));
 assert.doesNotMatch(source,/Memory wiped|memWiped/);
});
test('native system facts are read without new permissions and are omitted when unreadable',()=>{
 const facts=java.slice(java.indexOf('static void systemFacts('),java.indexOf('static String[] settingsActions('));
 for(const key of ['wifiEnabled','bluetoothEnabled','airplaneMode','locationEnabled','mobileDataEnabled','interruptionFilter','adaptiveBrightness','appVersionCode','appUpdatedAt'])assert.match(facts,new RegExp(`fact\\(out,"${key}"`));
 // Every fact goes through the omit-on-failure helper; none is put directly with a default.
 assert.doesNotMatch(facts,/out\.put\(/);
 // Reads only: the plugin has no setter for a system switch.
 assert.doesNotMatch(java,/Settings\.(Global|System|Secure)\.put|setWifiEnabled|\.enable\(\)|\.disable\(\)|setInterruptionFilter/);
 const manifest=readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
 for(const permission of ['ACCESS_WIFI_STATE','CHANGE_WIFI_STATE','BLUETOOTH_CONNECT','READ_PHONE_STATE','WRITE_SECURE_SETTINGS','ACCESS_NOTIFICATION_POLICY'])assert.doesNotMatch(manifest,new RegExp(`<uses-permission[^>]*android\\.permission\\.${permission}"(?![^>]*tools:node="remove")`),permission);
});

test('Cloud privacy hero includes speech while retaining native and offline/startup truth',async()=>{
 const nativeSource=readFileSync('apps/app/src/prototype/native-adapter.ts','utf8');
 const wording=nativeSource.slice(nativeSource.indexOf('export function egressPrivacy('),nativeSource.indexOf('/** Only a verified resident session'));
 const load=async cloud=>import('data:text/javascript;base64,'+Buffer.from(`const cloudRuntimeEnabled=${cloud};const testMocksEnabled=false;const Capacitor={isNativePlatform:()=>true};const cloudServiceName=environment=>environment==='staging'?'Nebula':'Cloud Test';`+stripTypeScriptTypes(wording,{mode:'strip'})).toString('base64'));
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

// Pages that only repeated Android facts or another flow are gone (docs/ui-refresh-2026-11).
test('stale or removed Settings routes open the top level; Developer only with developer surfaces',()=>{
 for(const page of ['wifi','bluetooth','mobile','battery','sound','display','models','privacy','character','accounts','connections','photos','notifications','developer','nonsense',null,undefined])assert.equal(m.settingsPage(page,false),null,String(page));
 for(const page of ['account','agent-connection','history','listening','calendar','password-provider','password-entry','cross','about','problems','licenses'])assert.equal(m.settingsPage(page,false),page);
 assert.equal(m.settingsPage('cloud-plan',false),'account');
 assert.equal(m.settingsPage('developer',true),'developer');
 assert.match(source,/const current = settingsPage\(state\.page, devSurfacesEnabled\)/);
});
test('Settings rows are controls: no device facts Alpha cannot change',()=>{
 const body=source.slice(source.indexOf('definition.render = (state: Bag, api: Bag) => {'));
 for(const gone of ["'Wi-Fi'","'Bluetooth'","'Mobile data'","'Battery'","'Sound & vibration'","'Models'","'Privacy & data'","'Inference model'","'Security patch'","'Do Not Disturb'","'Delivery timing'","'Personality settings'","'Home app'","'Assistant app'"])assert.ok(!body.includes(gone),gone);
 assert.match(body,/row\('Android settings', manage\('system'\)\)/);
 assert.match(java,/case "system":return new String\[\]\{Settings\.ACTION_SETTINGS\}/);
});
test('permission summary counts only reported grants',()=>{
 assert.equal(m.permissionSummary({Microphone:true,Camera:true}),'All allowed');
 assert.equal(m.permissionSummary({Microphone:false,Camera:true,Location:false}),'2 not allowed');
 assert.equal(m.permissionSummary({}),'');assert.equal(m.permissionSummary(null),'');assert.equal(m.permissionSummary({Camera:'yes'}),'');
});
