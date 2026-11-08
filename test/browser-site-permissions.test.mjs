// Browser site permissions (UPSTREAM:site-permission-consolidation). The record format, the prompt
// plan and the sealed store are upstream (plugin-native-browser-surface at the pin); this runs the
// upstream host-JVM record test against the pinned sources and checks that Alpha only supplies its
// installed-data names and the prompt dialog. It does not exercise WebView prompts, Android runtime
// permissions or the Keystore seal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

const plugin=join(root,'vendor/eliza/plugins/plugin-native-browser-surface');
const upstream=join(plugin,'android/src/main/java/ai/eliza/plugins/browsersurface');

test('old-format records (allow, deny, damaged, 200-origin bound) read through the upstream rules',{skip:jsonJarSkip},()=>{
 assert.match(runJvm(['BrowserSitePermissions','BrowserWebOrigin','BrowserSitePermissionRecord'].map(name=>join(upstream,name+'.java')).concat(join(plugin,'test/native-host/BrowserSitePermissionRecordTest.java')),'BrowserSitePermissionRecordTest',{json:true}),/^\d+ assertions passed/);
});

test('Alpha keeps its record names and its prompt dialog; the rules are upstream',()=>{
 const stores=readFileSync(nativeSource('AlphaBrowserStores.java'),'utf8');
 assert.match(stores,/new BrowserSessionStore\(context\.getSharedPreferences\(SESSION_PREFERENCES,Context\.MODE_PRIVATE\),sealer\(SESSION_KEY_ALIAS,2000000\)\)/);
 assert.match(stores,/new BrowserBookmarkStore\(context\.getSharedPreferences\(BOOKMARK_PREFERENCES,Context\.MODE_PRIVATE\),sealer\(BOOKMARK_KEY_ALIAS,800000\)\)/);
 assert.match(stores,/BOOKMARK_PREFERENCES="alpha-browser-bookmarks",BOOKMARK_KEY_ALIAS="alpha-browser-bookmarks-v1"/);
 const store=readFileSync(join(upstream,'BrowserSessionStore.java'),'utf8');
 assert.match(store,/PERMISSIONS_KEY = "permissions"/,'the stored preference key is unchanged');
 assert.match(store,/BrowserSitePermissionRecord\.read\(sealer\.open\(packed\)\)/,'the record is unsealed before it is read');
 const app=readFileSync(join(upstream,'BrowserTabHostPlugin.java'),'utf8');
 const decide=app.slice(app.indexOf('private void sitePermission('),app.indexOf('private void mediaPermission('));
 assert.match(decide,/BrowserSitePrompt\.plan\(origin,kinds,promptable\(t\),t\.priv,/,'only the selected, shown page may prompt or use a stored Allow');
 assert.match(decide,/runtimePermissions\.launch\(/,'an Allow is chained to the Android runtime permission');
 assert.match(decide,/for\(String kind:decided\)if\(!androidGranted\(kind\)\)/);
 assert.doesNotMatch(app,/origin\.matches\(/,'no local origin grammar remains');
});
