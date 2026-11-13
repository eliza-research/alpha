// Browser site permissions (UPSTREAM:site-permission-consolidation). The record format, the prompt
// plan and the sealed store are upstream (plugin-native-browser-surface at the pin); this runs the
// upstream host-JVM record test against the pinned sources and checks that Alpha only supplies its
// installed-data names and the prompt dialog. It does not exercise WebView prompts, Android runtime
// permissions or the Keystore seal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {root,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';

const plugin=join(root,'vendor/eliza/plugins/plugin-native-browser-surface');
const upstream=join(plugin,'android/src/main/java/ai/eliza/plugins/browsersurface');

test('old-format records (allow, deny, damaged, 200-origin bound) read through the upstream rules',{skip:jsonJarSkip},()=>{
 assert.match(runJvm(['BrowserSitePermissions','BrowserWebOrigin','BrowserSitePermissionRecord'].map(name=>join(upstream,name+'.java')).concat(join(plugin,'test/native-host/BrowserSitePermissionRecordTest.java')),'BrowserSitePermissionRecordTest',{json:true}),/^\d+ assertions passed/);
});
