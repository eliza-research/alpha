import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
// The tile region of the native adapter (Alpha's labels and theme) over the shared truthful
// presentation at the pin (@elizaos/capacitor-system/settings), evaluated without the renderer.
const source=readFileSync('apps/app/src/prototype/native-adapter.ts','utf8');
const region=source.slice(source.indexOf('// tile-facts:begin'),source.indexOf('// tile-facts:end'));
assert.ok(region.length>100,'tile-facts region is present');
const toModule=text=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(text,{mode:'transform'})).toString('base64');
const shared=toModule(readFileSync('vendor/eliza/plugins/plugin-native-system/src/settings.ts','utf8'));
const imported=source.match(/^import \{[^}]*\} from '@elizaos\/capacitor-system\/settings';$/m);
assert.ok(imported,'the adapter uses the shared presentation');
const m=await import(toModule(imported[0].replace('@elizaos/capacitor-system/settings',shared)+'\n'+region));
const labels=['Wi-Fi','Bluetooth','Do not disturb','Agent can listen','Location','Airplane mode','Enclave lock','Flashlight'];
// Model tiles may carry stale prototype state; only native facts may become on/off.
const modelTiles=()=>labels.map(label=>({label,on:true,css:'background:var(--acc);color:#fff',toggle:()=>{}}));
test('no tile shows on or off without a native fact',()=>{
 for(const snapshot of [null,{},{wifiActive:false},{wifiActive:'true'},{permissions:{Microphone:true,Location:true},locationAccess:'precise',bluetooth:true}]){
  const tiles=m.honestTiles(modelTiles(),m.tileFactsFromSnapshot(snapshot),{flashlight:true,act:()=>{}});
  for(const tile of tiles){assert.equal(tile.on,undefined,`${tile.label} has no native fact for ${JSON.stringify(snapshot)}`);assert.doesNotMatch(tile.css,/--acc/);}
 }
});
test('an active Wi-Fi transport is the only snapshot fact; it never reports off',()=>{
 assert.deepEqual(m.tileFactsFromSnapshot({wifiActive:true,cellularActive:true}),{wifi:true});
 assert.deepEqual(m.tileFactsFromSnapshot({wifiActive:false}),{});
 const tiles=m.honestTiles(modelTiles(),m.tileFactsFromSnapshot({wifiActive:true}),{flashlight:true,act:()=>{}});
 assert.deepEqual(tiles.filter(t=>t.on!==undefined).map(t=>[t.label,t.on]),[['Wi-Fi',true]]);
});
test('the flashlight shows only its confirmed native result and is hidden without a control',()=>{
 assert.deepEqual(m.honestTiles(modelTiles(),m.tileFactsFromSnapshot(null,false),{flashlight:true,act:()=>{}}).find(t=>t.label==='Flashlight').on,false);
 assert.equal(m.honestTiles(modelTiles(),{},{flashlight:true,act:()=>{}}).find(t=>t.label==='Flashlight').on,undefined);
 assert.equal(m.honestTiles(modelTiles(),{torch:true},{flashlight:false,act:()=>{}}).some(t=>t.label==='Flashlight'),false);
});
test('each tile hands off to its own settings page',()=>{
 const calls=[];const tiles=m.honestTiles(modelTiles(),{},{flashlight:true,act:(key)=>calls.push(key)});
 for(const tile of tiles)tile.toggle();
 assert.deepEqual(calls,['wifi','bt','dnd','mic','loc','plane',null,'torch']);
 assert.deepEqual([m.tileSettingsPages.wifi,m.tileSettingsPages.bt,m.tileSettingsPages.dnd],['wifi','bluetooth','dnd']);
 assert.equal(m.tileSettingsPages.torch,undefined);
});
test('a brightness change triggers at most one settings handoff',()=>{
 let now=1000;const gate=m.handoffGate(2000,()=>now);let handoffs=0;
 // One drag fires many change events while the first handoff is in flight and just after it.
 for(let i=0;i<25;i++){if(gate.begin())handoffs++;now+=10;}
 gate.end();for(let i=0;i<25;i++){if(gate.begin())handoffs++;now+=10;}
 assert.equal(handoffs,1);
 now+=5000;assert.equal(gate.begin(),true,'a later, separate gesture may hand off again');
});

test('system switches reported by Android become tile state; anything else stays unknown',()=>{
 const snapshot={wifiEnabled:false,wifiActive:false,bluetoothEnabled:true,airplaneMode:false,locationEnabled:true,interruptionFilter:'priority',permissions:{Microphone:true}};
 assert.deepEqual(m.tileFactsFromSnapshot(snapshot),{wifi:false,bt:true,plane:false,loc:true,dnd:true});
 assert.deepEqual(m.tileFactsFromSnapshot({interruptionFilter:'all'}),{dnd:false});
 // Wrong types, unknown filters and permission grants are never a switch state.
 assert.deepEqual(m.tileFactsFromSnapshot({wifiEnabled:1,bluetoothEnabled:'true',airplaneMode:null,locationEnabled:'on',interruptionFilter:'unknown',permissions:{Microphone:true,Location:true},locationAccess:'precise'}),{});
 // The Wi-Fi switch wins over the transport: on and disconnected is on, and off is off.
 assert.deepEqual(m.tileFactsFromSnapshot({wifiEnabled:true,wifiActive:false}),{wifi:true});
 const tiles=m.honestTiles(modelTiles(),m.tileFactsFromSnapshot(snapshot),{flashlight:true,act:()=>{}});
 assert.deepEqual(tiles.map(t=>[t.label,t.on,t.stateText]),[['Wi-Fi',false,'Off'],['Bluetooth',true,'On'],['Do not disturb',true,'On'],['Agent can listen',undefined,'Permissions'],['Location',true,'On'],['Airplane mode',false,'Off'],['Enclave lock',undefined,'Open settings'],['Flashlight',undefined,'Tap to switch']]);
});
test('an unread switch is labelled as a handoff, never as off',()=>{
 for(const tile of m.honestTiles(modelTiles(),{},{flashlight:true,act:()=>{}})){assert.notEqual(tile.stateText,'Off');assert.notEqual(tile.stateText,'On');assert.ok(tile.stateText.length>0);}
 assert.equal(m.switchValue(undefined,'Manage in Android'),'Manage in Android');
 assert.equal(m.switchValue('true','Not reported by Android'),'Not reported by Android');
 assert.equal(m.switchValue(true,'x',{on:'On · connected'}),'On · connected');
 assert.equal(m.switchValue(false,'x',{on:'On · connected'}),'Off');
});
test('every tile with a switch opens its own Android page, and the native allowlist has each one',()=>{
 assert.deepEqual(m.tileSettingsPages,{wifi:'wifi',bt:'bluetooth',dnd:'dnd',plane:'airplane',loc:'location',mic:'privacy'});
 // AlphaDevice.openSettings uses the shared allowlist at the pin (SystemSettingsPages).
 assert.match(readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDevicePlugin.java','utf8'),/SystemSettingsPages\.open\(page,getContext\(\)\.getPackageName\(\),/);
 const java=readFileSync('vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemSettingsPages.java','utf8');
 const body=java.slice(java.indexOf('public static String[] actions(String page)'),java.indexOf('public interface Launcher'));
 const pages=Object.fromEntries([...body.matchAll(/case "([a-z-]+)": return new String\[\] \{([^}]*)\}/g)].map(match=>[match[1],match[2].split(',').map(action=>action.trim())]));
 for(const page of Object.values(m.tileSettingsPages))assert.ok(pages[page]?.length,`${page} is allowlisted natively`);
 // No page resolves to the generic Settings home, and each first choice is distinct.
 for(const [page,actions] of Object.entries(pages))for(const action of actions)assert.notEqual(action.trim(),'Settings.ACTION_SETTINGS',page);
 const first=Object.values(pages).map(actions=>actions[0]);assert.equal(new Set(first).size,first.length);
 assert.deepEqual([pages.airplane[0],pages.location[0],pages.mobile[0]],['Settings.ACTION_AIRPLANE_MODE_SETTINGS','Settings.ACTION_LOCATION_SOURCE_SETTINGS','Settings.ACTION_DATA_ROAMING_SETTINGS']);
});
test('a broader Android page is named for what it is, and a specific page says nothing',()=>{
 for(const opened of [{status:'opened',specific:true},{status:'opened'},null,undefined,'opened'])for(const page of ['wifi','dnd','airplane'])assert.equal(m.broaderPageNotice(page,opened),null);
 const broad={status:'opened',specific:false};
 assert.match(m.broaderPageNotice('airplane',broad),/^Opened Android network settings\./);
 assert.match(m.broaderPageNotice('mobile',broad),/^Opened Android network settings\./);
 // Do Not Disturb falls back to the priority page, which is not a network page.
 assert.match(m.broaderPageNotice('dnd',broad),/^Opened Android priority settings\./);
 assert.doesNotMatch(m.broaderPageNotice('dnd',broad),/network/);
 assert.doesNotMatch(m.broaderPageNotice('battery',broad),/network|priority/);
});
test('the Bluetooth fact is the radio state on Android 12 and later, not the stored switch',()=>{
 const java=readFileSync('vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemFacts.java','utf8');
 const read=java.slice(java.indexOf('fact(out, "bluetoothEnabled"'),java.indexOf('fact(out, "airplaneMode"'));
 assert.match(read,/SDK_INT < Build\.VERSION_CODES\.S\) return binarySwitch\(Settings\.Global\.getInt\(resolver, Settings\.Global\.BLUETOOTH_ON\)\)/);
 assert.match(read,/adapter == null \? null : adapterSwitch\(adapter\.getState\(\)\)/);
});
test('closing Android\'s own shade reaches the tile watch through a native window-focus notice',()=>{
 // Measured on an API 36 emulator: while Android's shade holds window focus and after it returns,
 // the page gets no focus, blur, visibilitychange or appResumed, so only the activity can tell it.
 const activity=readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java','utf8');
 const hook=activity.slice(activity.indexOf('public void onWindowFocusChanged(boolean hasFocus)'));
 assert.ok(hook.length<activity.length&&hook.length>0,'MainActivity observes window focus');
 const body=hook.slice(0,hook.indexOf('\n }\n'));
 assert.match(body,/super\.onWindowFocusChanged\(hasFocus\)/);
 assert.match(body,/if\(hasFocus&&/,'only a regained focus is announced');
 assert.match(body,/window\.dispatchEvent\(new Event\('focus'\)\)/);
 // The renderer side: the watch listens for that event and the shell re-reads only an open shade.
 assert.match(source,/export function watchReturnToApp[\s\S]{0,400}window\.addEventListener\('focus', check\)/);
 const shell=readFileSync('apps/app/src/prototype/agent-adapter.ts','utf8');
 assert.match(shell,/watchReturnToApp\(\(\) => \{ if \(this\.live && this\.S\(\)\.shade\) this\.refreshTileFacts\(\); \}\)/);
});
test('handoff tiles are buttons named with their reported state; only the flashlight is a toggle',()=>{
 const snapshot={wifiEnabled:true,bluetoothEnabled:false,airplaneMode:false,locationEnabled:true,interruptionFilter:'priority'};
 const tiles=m.honestTiles(modelTiles(),m.tileFactsFromSnapshot(snapshot,true),{flashlight:true,act:()=>{}});
 assert.deepEqual(tiles.map(t=>[t.aria,t.pressed]),[['Wi-Fi, on, opens Android settings',undefined],['Bluetooth, off, opens Android settings',undefined],['Do not disturb, on, opens Android settings',undefined],
  ['Agent can listen, opens Android permission settings',undefined],['Location, on, opens Android settings',undefined],['Airplane mode, off, opens Android settings',undefined],['Enclave lock, opens Android settings',undefined],['Flashlight',true]]);
 // The visible label, colour and state text are unchanged; only the announced role and name differ.
 assert.deepEqual(tiles.slice(0,2).map(t=>[t.label,t.on,t.stateText]),[['Wi-Fi',true,'On'],['Bluetooth',false,'Off']]);
 // Unreported switches say what the tile does and claim no state; an unconfirmed flashlight has no pressed state.
 const unknown=m.honestTiles(modelTiles(),{},{flashlight:true,act:()=>{}});
 assert.deepEqual(unknown.map(t=>[t.aria,t.pressed]),[['Wi-Fi, opens Android settings',undefined],['Bluetooth, opens Android settings',undefined],['Do not disturb, opens Android settings',undefined],
  ['Agent can listen, opens Android permission settings',undefined],['Location, opens Android settings',undefined],['Airplane mode, opens Android settings',undefined],['Enclave lock, opens Android settings',undefined],['Flashlight',undefined]]);
 assert.equal(m.honestTiles(modelTiles(),{torch:false},{flashlight:true,act:()=>{}}).at(-1).pressed,false);
 for(const tile of [...tiles,...unknown])assert.doesNotMatch(tile.aria,/toggle|switch|pressed/i);
});
