// Alpha's browser is the shared native tab host (plugin-native-browser-surface BrowserTabHostPlugin)
// under Alpha's Capacitor name. This compiles Alpha's actual identity expression against the pinned
// BrowserTabHostConfig on the host JVM, for both build flavors, and checks that it yields the names
// earlier Alpha builds wrote: the sign-in profile, the private and pre-P-04 profile prefixes, the
// download list, the retired-profile ledger, the notice file and the activity-result keys. Keeping
// them is what keeps an installed browser's data readable; nothing is migrated. Host JVM only: it
// does not exercise WebView profiles, Android preferences or the Keystore.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {nativeSource,runJvm} from './fixtures/jvm-tools.mjs';

const shared=name=>path.join('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface',name+'.java');
const stores=fs.readFileSync(nativeSource('AlphaBrowserStores.java'),'utf8');
const plugin=fs.readFileSync(nativeSource('AlphaBrowserPlugin.java'),'utf8');

test('AlphaBrowserPlugin is the shared tab host with Alpha identity and speech route only',()=>{
 assert.match(plugin,/@CapacitorPlugin\(name = "AlphaBrowser"\)\npublic class AlphaBrowserPlugin extends BrowserTabHostPlugin \{/);
 assert.doesNotMatch(plugin,/@PluginMethod|WebView|ProfileStore|AlertDialog/,'no tab model, profile handling or prompt of its own');
 assert.match(plugin,/protected BrowserTabHostConfig tabHostConfig\(\) \{ return AlphaBrowserStores\.IDENTITY; \}/);
 assert.match(plugin,/\(\(AlphaVoiceCloudPlugin\)handle\.getInstance\(\)\)\.cancelBrowserSpeech\(requestId\)/,'a cancelled reading stops its Alpha speech request');
 assert.ok(!fs.existsSync(nativeSource('BrowserReading.java')),'the reviewed reading is the shared BrowserReviewedReading');
 const host=fs.readFileSync(shared('BrowserTabHostPlugin'),'utf8');
 assert.match(host,/public abstract class BrowserTabHostPlugin extends Plugin \{/);
 assert.match(host,/public String consumeReading\(PluginCall call\)throws Exception\{return reading\.consume\(call\);\}/,'AlphaVoiceCloud consumes the approved excerpt through the host');
});

for(const mocks of [false,true]) test(`Alpha's ${mocks?'test-mocks':'production'} identity keeps every installed browser name`,()=>{
 const start=stores.indexOf('BrowserTabHostConfig.builder(');
 const expression=stores.slice(start,stores.indexOf('.build();',start)+'.build()'.length);
 const constant=name=>new RegExp(`static final String ${name}="([^"]+)"`).exec(stores)?.[1];
 const [persistent,priv,legacy]=['PERSISTENT_PROFILE','PRIVATE_PREFIX','LEGACY_PREFIX'].map(constant);
 assert.deepEqual([persistent,priv,legacy],['alpha_browser_v1','alpha_private_','alpha_public_']);
 const directory=fs.mkdtempSync(path.join(process.env.TMPDIR||'/tmp','alpha-tab-host-'));
 try{
  const probe=path.join(directory,'AlphaBrowserIdentityProbe.java');
  fs.writeFileSync(probe,`import ai.eliza.plugins.browsersurface.*;
public final class AlphaBrowserIdentityProbe {
 static final class BuildConfig { static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=${mocks}, DEBUG=${mocks}; }
 static final class PasswordAutofillPolicy { static final String FIELD_ORIGIN="vault-field-origin"; }
 static final class PasswordFormPolicy { static final String TOP_ORIGIN_EXTRA="vault-top-origin"; }
 static final String PERSISTENT_PROFILE=${JSON.stringify(persistent)}, PRIVATE_PREFIX=${JSON.stringify(priv)}, LEGACY_PREFIX=${JSON.stringify(legacy)};
 public static void main(String[] args) {
  BrowserTabHostConfig c=${expression};
  String[] out={c.persistentProfile,c.downloadPreferences,c.retiredProfilePreferences,c.noticePreferences,c.registryKey("share"),c.registryKey("site-permission"),c.registryKey("take-picture"),c.registryKey("file"),
   String.valueOf(c.ephemeral("alpha_public_0")),String.valueOf(c.ephemeral("alpha_private_x_t")),String.valueOf(c.admits(PERSISTENT_PROFILE,false)),String.valueOf(c.admits(PERSISTENT_PROFILE,true)),
   String.valueOf(c.allowLoopback),c.appName,c.hostName,c.browserName,String.join(",",c.hostSchemes),c.autofillExtras.fieldOrigin,c.autofillExtras.topOrigin,String.valueOf(c.maxTabs)};
  System.out.println(String.join("\\n",out));
 }
}`);
  const sources=['BrowserTabHostConfig','BrowserSessionPolicy','BrowserWebOrigin','BrowserProfilePolicy','BrowserAutofillExtras'].map(shared);
  const lines=runJvm([...sources,probe],'AlphaBrowserIdentityProbe').trim().split('\n');
  assert.deepEqual(lines,['alpha_browser_v1','alpha-browser-downloads','alpha-browser-retired-profiles','alpha-browser-notices',
   'alpha-browser-share','alpha-browser-site-permission','alpha-browser-take-picture','alpha-browser-file',
   'true','true','true','false',String(mocks),'Alpha Phone','Alpha','Alpha Browser','alphaphone','vault-field-origin','vault-top-origin','8']);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('instrumented tests reach browser host state through the shared BrowserTabHostPlugin', () => {
 // The host's fields and helpers are declared on the upstream base class, so a reflective lookup on
 // AlphaBrowserPlugin (or on the plugin instance's own class) fails only on a device, and the deleted
 // BrowserReading class would stop androidTest compiling.
 const roots=['android/app/src/androidTest/java','android/app/src/testMocks/androidTest/java'];
 const files=roots.filter(root=>fs.existsSync(root)).flatMap(root=>fs.readdirSync(root,{recursive:true}).filter(name=>String(name).endsWith('.java')).map(name=>path.join(root,String(name))));
 assert.ok(files.length>0);
 for(const file of files){
  const source=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(source,/\bnew BrowserReading\(|\bBrowserReading\.class\b/,`${file}: BrowserReading is the shared BrowserReviewedReading`);
  assert.doesNotMatch(source,/AlphaBrowserPlugin\.class\.getDeclared(?:Field|Method)/,`${file}: host members are declared on BrowserTabHostPlugin`);
  if(source.includes('getPlugin("AlphaBrowser")'))
   assert.doesNotMatch(source,/plugin\.getClass\(\)\.getDeclaredField\(/,`${file}: the plugin instance's class is AlphaBrowserPlugin, not the host`);
 }
 const features=fs.readFileSync('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/BrowserWebFeaturesInstrumentedTest.java','utf8');
 assert.match(features,/private Object field\(Object owner,String name\)throws Exception\{for\(Class<\?> type=owner\.getClass\(\);type!=null;type=type\.getSuperclass\(\)\)/,'the field helper walks to the shared host');
});
