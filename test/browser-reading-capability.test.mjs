// Source-shape guard (class S). It shows nothing about Android's behaviour.
//
// Page reading (Read aloud, Ask about page) runs its extraction script in a world the page's own
// script cannot reach. A WebView provider without that capability (the SDK emulator's WebView 133
// is one) gets no page reading. These checks hold the three parts of that rule together: there is
// no injection into the page's world to fall back to, the native refusal names the capability, and
// the renderer says the same thing before a review starts.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createReadingSupport, READING_UNSUPPORTED_MESSAGE } from "../apps/app/src/browser/reading-capability.ts";

const java = name => fs.readFileSync(`android/app/src/main/java/ai/elizaresearch/alphaphone/${name}.java`, "utf8");
const world = java("BrowserReadingWorld"), reading = java("BrowserReading"), plugin = java("AlphaBrowserPlugin"), downloads = java("BrowserDownloads");
const adapter = fs.readFileSync("apps/app/src/prototype/browser-adapter.ts", "utf8");
const template = fs.readFileSync("apps/app/src/prototype/template.html", "utf8");

test("no browser source can put a script or a bridge in a page's own world", () => {
  for (const [name, source] of [["BrowserReadingWorld", world], ["BrowserReading", reading], ["AlphaBrowserPlugin", plugin], ["BrowserDownloads", downloads]]) {
    assert.doesNotMatch(source, /addJavascriptInterface\s*\(/, `${name}: no JavaScript interface on a page`);
    assert.doesNotMatch(source, /addDocumentStartJavaScript\s*\(/, `${name}: no page-world document-start script`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /PAGE_WORLD|getPageWorld|JavaScriptExecutionWorld\.PAGE/, `${name}: the page world is never chosen`);
  }
  // Every listener and injected script names an isolated world as its last argument.
  for (const [name, source] of [["BrowserReadingWorld", world], ["BrowserDownloads", downloads]]) {
    const listeners = [...source.matchAll(/WebViewCompat\.addWebMessageListener\(([^;]*);/g)];
    const scripts = [...source.matchAll(/WebViewCompat\.addJavaScriptOnEvent\(/g)];
    const isolatedScripts = [...source.matchAll(/WebViewCompat\.addJavaScriptOnEvent\([\s\S]{0,400}?Set\.of\("\*"\),world\);/g)];
    assert.ok(listeners.length >= 1 && scripts.length >= 1, `${name}: listener and script found`);
    for (const match of listeners) assert.match(match[1], /Set\.of\("\*"\),world,/, `${name}: the listener lives in the isolated world`);
    assert.equal(isolatedScripts.length, scripts.length, `${name}: every injected script runs in the isolated world`);
  }
  // Reading never evaluates in the page: only through the isolated world's own proxy.
  assert.doesNotMatch(world, /\.evaluateJavascript\(/);
  assert.doesNotMatch(reading, /\.evaluateJavascript\(/);
  assert.match(world, /if\(!ready\(\)\)\{failure\.run\(\);return;\}/, "evaluation is refused, not rerouted, when no isolated world is ready");
});

test("the native side reports the capability and refuses a review with the unavailable answer", () => {
  assert.match(world, /static boolean supported\(\)\{\s*try\{return WebViewFeature\.isFeatureSupported\(WebViewFeature\.JS_INJECTION_IN_FRAME_AND_WORLD\);\}\s*catch\(RuntimeException\|LinkageError \w+\)\{return false;\}/);
  assert.match(world, /this\.web=web;\s*if\(!supported\(\)\)return;/, "no world, listener or script is created without the capability");
  assert.match(world, /boolean available\(\)\{return !closed&&world!=null;\}/);
  assert.match(plugin, /@PluginMethod public void readingSupport\(PluginCall call\) \{ JSObject out=new JSObject\(\);out\.put\("available",BrowserReadingWorld\.supported\(\)\);call\.resolve\(out\); \}/);
  // Unavailable is the first answer of a review: before a speech route is asked for, before the
  // page is judged, before extraction, and it is not the "reload this page" answer.
  const review = reading.slice(reading.indexOf("private void review(PluginCall call,WebView web,BrowserReadingWorld world,BooleanSupplier stillCurrent,boolean question){"));
  const unsupported = review.indexOf("if(world==null||!world.available()){call.reject(UNSUPPORTED,UNSUPPORTED_CODE);return;}");
  const route = review.indexOf('call.reject("Select an available speech route before reading")');
  const sensitive = review.indexOf('call.reject("Reading unavailable on a sensitive or unverified page",SENSITIVE_PAGE)');
  const notReady = review.indexOf('if(!world.ready()){call.reject("This page is not ready for private reading. Reload this page, then try again.","reading-not-ready");return;}');
  const extract = review.indexOf("world.evaluate(EXTRACT,");
  assert.ok(unsupported > 0 && route > unsupported && sensitive > route && notReady > sensitive && extract > notReady, "unsupported, then speech route, sensitive page, not ready, then extraction");
  assert.match(review, /^[^\n]*\n\s*cancel\(\);final long expected=generation;\n\s*\/\/[^\n]*\n\s*if\(world==null\|\|!world\.available\(\)\)/, "nothing but the cancellation of an earlier review precedes it");
  assert.match(reading, /static final String UNSUPPORTED_CODE="reading-unsupported";/);
  assert.match(reading, /ISOLATED_WORLD_UNAVAILABLE="isolated-world-unavailable"/);
  assert.match(reading, /SENSITIVE_PAGE="sensitive-page"/);
  assert.match(review, /rejected\.reject\([^\n]*,SENSITIVE_PAGE\);/, "a sensitive extraction is not recoverable by pasting");
  assert.match(review, /rejected\.reject\(ISOLATED_MESSAGE,ISOLATED_WORLD_UNAVAILABLE\);/, "an isolated-world failure can offer a paste review");
});

test("the renderer and the native side say the same words", () => {
  const native = /static final String UNSUPPORTED="([^"]+)";/.exec(reading)?.[1];
  assert.equal(native, READING_UNSUPPORTED_MESSAGE);
});

test("the renderer asks on Android only, says so before any speech route or excerpt is prepared, and shows it in the menu", () => {
  assert.match(adapter, /const readingSupport = Capacitor\.isNativePlatform\(\) \? createReadingSupport\(\(\) => Browser\.readingSupport\(\), \(\) => refresh\(\)\) : undefined;/);
  assert.match(adapter, /if \(browserActive && !browserWasActive\) void readingSupport\?\.check\(\);/, "asked when the browser opens, so the menu already knows");
  const read = adapter.slice(adapter.indexOf("async function readPage()"), adapter.indexOf("async function askPage()"));
  const ask = adapter.slice(adapter.indexOf("async function askPage()"), adapter.indexOf("function hide()"));
  assert.ok(read.indexOf("if(await readingUnsupported())return;") > 0 && read.indexOf("if(await readingUnsupported())return;") < read.indexOf("createNativeReadingVoice()"), "Read aloud refuses before a speech route is asked for");
  assert.ok(ask.indexOf("if(await readingUnsupported())return;") > 0 && ask.indexOf("if(await readingUnsupported())return;") < ask.indexOf("Browser.reviewQuestion"), "Ask about page refuses before preparing an excerpt");
  assert.match(adapter, /report\(new Error\(READING_UNSUPPORTED_MESSAGE\)\)/);
  assert.match(adapter, /readingUnavailable:readingSupport\?\.state==='unavailable',readingNote:READING_UNSUPPORTED_MESSAGE,/);
  assert.match(template, /<sc-if value="\{\{browser\.readingUnavailable\}\}"><p role="note" aria-label="Page reading unavailable" data-alpha-reading-unavailable [^>]*>\{\{browser\.readingNote\}\}<\/p><\/sc-if>/);
});

for (const [available, expected] of [[true, "available"], [false, "unavailable"]]) {
  test(`the renderer shares one pending probe and retains a confirmed ${expected} result`, async () => {
    let queries = 0;
    let changes = 0;
    const pending = Promise.withResolvers();
    const support = createReadingSupport(() => {
      queries++;
      return pending.promise;
    }, () => changes++);

    assert.equal(support.state, "unknown");
    const first = support.check();
    const second = support.check();
    pending.resolve({ available });
    assert.deepEqual(await Promise.all([first, second]), [expected, expected]);
    assert.equal(support.state, expected);
    assert.equal(await support.check(), expected);
    assert.equal(queries, 1);
    assert.equal(changes, 1);
  });
}

test("failed or malformed support probes stay unknown and can be retried", async () => {
  const malformed = [null, {}, { available: "false" }, { available: 0 }, "no"];
  const answers = [...malformed, { available: false }];
  let changes = 0;
  let attempts = 0;
  const support = createReadingSupport(async () => {
    if (attempts++ === 0) throw Error("The bridge is not ready");
    return answers.shift();
  }, () => changes++);

  for (let n = 0; n <= malformed.length; n++) {
    assert.equal(await support.check(), "unknown");
    assert.equal(support.state, "unknown");
  }
  assert.equal(changes, 0);
  assert.equal(await support.check(), "unavailable");
  assert.equal(changes, 1);
});
