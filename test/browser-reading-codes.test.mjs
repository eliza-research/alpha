// J05 native half: page-reading refusals carry stable reject codes so the renderer (WP6) never parses
// message text. Class S only; the refusals themselves are covered by the instrumented
// BrowserIsolatedReading and BrowserSensitiveReading classes, not run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('isolated-world and sensitive-page refusals use distinct codes and keep their messages',()=>{
 const source=readFileSync('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserReviewedReading.java','utf8');
 // The codes are the shared page-reading policy's (plugin-native-browser-surface at the pin).
 const policy=readFileSync('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserPageReading.java','utf8');
 assert.match(policy,/public static final String ISOLATED_WORLD_UNAVAILABLE = "isolated-world-unavailable";/);
 assert.match(policy,/public static final String SENSITIVE_PAGE = "sensitive-page";/);
 assert.match(policy,/public static final String READING_NOT_READY = "reading-not-ready";/);
 assert.match(source,/ISOLATED_MESSAGE="Isolated page reading is unavailable\. Update Android System WebView, then reload this page\.";/,'the existing message is kept');
 const review=source.slice(source.indexOf('private void review(PluginCall call'),source.indexOf('private void scheduleTimeout('));
 assert.match(review,/if\(BrowserPageReading\.sensitiveUrl\(web\.getUrl\(\)\)\)\{call\.reject\("Reading unavailable on a sensitive or unverified page",BrowserPageReading\.SENSITIVE_PAGE\);return;\}/);
 // A world that exists but has not started yet asks for a reload (its own code); a provider with no
 // isolated-world capability is refused first, as reading-unsupported (test/browser-reading-capability.test.mjs).
 assert.match(review,/if\(!world\.ready\(\)\)\{call\.reject\("This page is not ready for private reading\. Reload this page, then try again\.",BrowserPageReading\.READING_NOT_READY\);return;\}/);
 assert.match(review,/rejected\.reject\("Reading unavailable on a sensitive or ambiguous page",BrowserPageReading\.SENSITIVE_PAGE\);/,'a page the extractor blocks is a sensitive refusal');
 assert.match(review,/if\(rejected!=null\)rejected\.reject\(ISOLATED_MESSAGE,BrowserPageReading\.ISOLATED_WORLD_UNAVAILABLE\);/,'an isolated world that fails to run is unavailable, not sensitive');
 // The sensitive check runs first: a sensitive page is never reported as merely unavailable or not ready.
 assert.ok(review.indexOf('SENSITIVE_PAGE')<review.indexOf('READING_NOT_READY'));
 assert.ok(review.indexOf('SENSITIVE_PAGE')<review.indexOf('ISOLATED_WORLD_UNAVAILABLE'));
});
