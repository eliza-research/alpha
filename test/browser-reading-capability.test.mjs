// Source and host-renderer guards. They show nothing about Android's behaviour.
//
// Page reading (Read aloud, Ask about page) runs its extraction script in a world the page's own
// script cannot reach. A WebView provider without that capability (the SDK emulator's WebView 133
// is one) gets no page reading. These checks hold the three parts of that rule together: there is
// no injection into the page's world to fall back to, the native refusal names the capability, and
// the renderer says the same thing before a review starts.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {JSDOM} from 'jsdom';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const java = name => fs.readFileSync(`android/app/src/main/java/ai/elizaresearch/alphaphone/${name}.java`, "utf8");
// The isolated reading world, blob capture and downloads are staged into the app from the reviewed
// pin (plugin-native-browser-surface).
const shared = name => fs.readFileSync(`vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/${name}.java`, "utf8");
const world = shared("BrowserReadingWorld");
// The tab host and its reviewed reading are shared; AlphaBrowserPlugin supplies only Alpha's identity.
const reading = shared("BrowserReviewedReading"), plugin = shared("BrowserTabHostPlugin"), alphaPlugin = java("AlphaBrowserPlugin");
const downloads = shared("BrowserDownloads"), capture = shared("BrowserBlobCapture"), loginFields = shared("BrowserLoginFields");
const adapter = fs.readFileSync("apps/app/src/prototype/browser-adapter.ts", "utf8");
// The shared page-reading policy at the pin: the renderer module and its native half.
const capability = fs.readFileSync("vendor/eliza/plugins/plugin-native-browser-surface/src/page-reading.ts", "utf8");
const policy = shared("BrowserPageReading");
const template = fs.readFileSync("apps/app/src/prototype/template.html", "utf8");

test("no browser source can put a script or a bridge in a page's own world", () => {
  for (const [name, source] of [["BrowserReadingWorld", world], ["BrowserReviewedReading", reading], ["BrowserTabHostPlugin", plugin], ["AlphaBrowserPlugin", alphaPlugin], ["BrowserDownloads", downloads], ["BrowserBlobCapture", capture], ["BrowserLoginFields", loginFields]]) {
    assert.doesNotMatch(source, /addJavascriptInterface\s*\(/, `${name}: no JavaScript interface on a page`);
    assert.doesNotMatch(source, /addDocumentStartJavaScript\s*\(/, `${name}: no page-world document-start script`);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /PAGE_WORLD|getPageWorld|JavaScriptExecutionWorld\.PAGE/, `${name}: the page world is never chosen`);
  }
  // Every listener and injected script names an isolated world as its last argument.
  for (const [name, source] of [["BrowserReadingWorld", world], ["BrowserBlobCapture", capture], ["BrowserLoginFields", loginFields]]) {
    const listeners = [...source.matchAll(/WebViewCompat\.addWebMessageListener\(([^;]*);/g)];
    const scripts = [...source.matchAll(/WebViewCompat\.addJavaScriptOnEvent\(/g)];
    const isolatedScripts = [...source.matchAll(/WebViewCompat\.addJavaScriptOnEvent\([\s\S]{0,400}?Set\.of\("\*"\),\s*(?:fields\.)?world\);/g)];
    assert.ok(listeners.length >= 1 && scripts.length >= 1, `${name}: listener and script found`);
    for (const match of listeners) assert.match(match[1], /Set\.of\("\*"\),\s*(?:fields\.)?world,/, `${name}: the listener lives in the isolated world`);
    assert.equal(isolatedScripts.length, scripts.length, `${name}: every injected script runs in the isolated world`);
  }
  // Reading never evaluates in the page: only through the isolated world's own proxy.
  assert.doesNotMatch(world, /\.evaluateJavascript\(/);
  assert.doesNotMatch(reading, /\.evaluateJavascript\(/);
  assert.match(world, /if \(!ready\(\)\) \{\s*failure\.run\(\);\s*return;\s*\}/, "evaluation is refused, not rerouted, when no isolated world is ready");
});

test("the isolated-reading probe looks for the shared world's channel in the page world", () => {
  // BrowserIsolatedReadingInstrumentedTest checks that the page (and a frame it creates) cannot see
  // the reading channel. A renamed channel would let that check pass without testing anything.
  const channel = /CHANNEL = "(__\w+)"/.exec(world)?.[1];
  assert.equal(channel, "__elizaBrowserReadWorld");
  const probe = fs.readFileSync("android/app/src/androidTest/java/ai/elizaresearch/alphaphone/BrowserIsolatedReadingInstrumentedTest.java", "utf8");
  assert.ok(probe.includes(`typeof ${channel}==='undefined'`), "the page world is probed");
  assert.ok(probe.includes(`typeof frame.contentWindow.${channel}==='undefined'`), "a frame the page creates is probed");
  assert.doesNotMatch(probe, /__alphaBrowserReadWorld/, "no retired channel name");
});

test("the native side reports the capability and refuses a review with the unavailable answer", () => {
  assert.match(world, /public static boolean supported\(\) \{\s*try \{\s*return WebViewFeature\.isFeatureSupported\(WebViewFeature\.JS_INJECTION_IN_FRAME_AND_WORLD\);\s*\} catch \(RuntimeException \| LinkageError \w+\) \{\s*return false;\s*\}/);
  assert.match(world, /this\.web = web;\s*if \(!supported\(\)\)\s*return;/, "no world, listener or script is created without the capability");
  assert.match(world, /public boolean available\(\) \{\s*return !closed && world != null;\s*\}/);
  // Alpha uses the shared world; it keeps no copy of its own.
  assert.ok(!fs.existsSync("android/app/src/main/java/ai/elizaresearch/alphaphone/BrowserReadingWorld.java"));
  // The tab host and its reading are in the world's own package; Alpha's plugin extends that host.
  for (const source of [plugin, reading]) assert.match(source, /^package ai\.eliza\.plugins\.browsersurface;$/m);
  assert.match(alphaPlugin, /public class AlphaBrowserPlugin extends BrowserTabHostPlugin \{/);
  assert.match(plugin, /@PluginMethod public void readingSupport\(PluginCall call\) \{ JSObject out=new JSObject\(\);out\.put\("available",BrowserReadingWorld\.supported\(\)\);call\.resolve\(out\); \}/);
  // Unavailable is the first answer of a review: before a speech route is asked for, before the
  // page is judged, before extraction, and it is not the "reload this page" answer.
  const reviewStart=reading.indexOf("private void review(PluginCall call,String tab,WebView web,BrowserReadingWorld world,BooleanSupplier stillCurrent,boolean question){");
  assert.ok(reviewStart>0,'the tab-bound shared review entry exists');
  const review = reading.slice(reviewStart);
  const unsupported = review.indexOf("if(world==null||!world.available()){call.reject(BrowserPageReading.UNSUPPORTED_MESSAGE,BrowserPageReading.READING_UNSUPPORTED);return;}");
  const route = review.indexOf('call.reject("Select an available speech route before reading")');
  const sensitive = review.indexOf('call.reject("Reading unavailable on a sensitive or unverified page",BrowserPageReading.SENSITIVE_PAGE)');
  const notReady = review.indexOf('if(!world.ready()){call.reject("This page is not ready for private reading. Reload this page, then try again.",BrowserPageReading.READING_NOT_READY);return;}');
  const extract = review.indexOf("world.evaluate(BrowserPageReading.EXTRACT,");
  assert.ok(unsupported > 0 && route > unsupported && sensitive > route && notReady > sensitive && extract > notReady, "unsupported, then speech route, sensitive page, not ready, then extraction");
  assert.match(review, /^[^\n]*\n\s*cancel\(\);final long expected=generation;tabId=tab;\n\s*\/\/[^\n]*\n\s*if\(world==null\|\|!world\.available\(\)\)/, "only earlier-review cancellation and tab binding precede the capability refusal");
  assert.match(policy, /public static final String READING_UNSUPPORTED = "reading-unsupported";/);
});

test("the renderer and the native side say the same words", () => {
  const message = /READING_UNSUPPORTED_MESSAGE =\s*"([^"]+)";/.exec(capability)?.[1];
  const native = /public static final String UNSUPPORTED_MESSAGE =\s*"([^"]+)";/.exec(policy)?.[1];
  assert.ok(message && native);
  assert.equal(native, message);
  assert.match(message, /Read aloud and Ask about page are unavailable on this device/);
  assert.match(message, /Update Android System WebView\.$/);
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

test("each refusal carries its own reject code, so the renderer never parses message text", () => {
  // The refusals themselves run in the instrumented BrowserIsolatedReading and BrowserSensitiveReading classes.
  assert.match(policy, /public static final String ISOLATED_WORLD_UNAVAILABLE = "isolated-world-unavailable";/);
  assert.match(policy, /public static final String SENSITIVE_PAGE = "sensitive-page";/);
  assert.match(policy, /public static final String READING_NOT_READY = "reading-not-ready";/);
  assert.match(reading, /ISOLATED_MESSAGE="Isolated page reading is unavailable\. Update Android System WebView, then reload this page\.";/);
  const review = reading.slice(reading.indexOf("private void review(PluginCall call"), reading.indexOf("private void scheduleTimeout("));
  assert.match(review, /rejected\.reject\("Reading unavailable on a sensitive or ambiguous page",BrowserPageReading\.SENSITIVE_PAGE\);/, "a page the extractor blocks is a sensitive refusal");
  assert.match(review, /if\(rejected!=null\)rejected\.reject\(ISOLATED_MESSAGE,BrowserPageReading\.ISOLATED_WORLD_UNAVAILABLE\);/, "an isolated world that fails to run is unavailable, not sensitive");
  // A sensitive page is never reported as merely unavailable.
  assert.ok(review.indexOf("SENSITIVE_PAGE") < review.indexOf("ISOLATED_WORLD_UNAVAILABLE"));
});


test('Cloud native Browser hides local-only reading without disabling page questions',()=>{
 const match=/readAloudAvailable:([^,]+),/.exec(adapter);assert.ok(match);
 for(const native of [true,false])for(const cloud of [true,false]){
  const available=new Function('Capacitor','cloudRuntimeEnabled','return '+match[1])({isNativePlatform:()=>native},cloud);
  assert.equal(available,!(native&&cloud));
 }
 // Render the real menu guards through dc-lite: a source-shape assertion alone
 // previously accepted an unsupported compound expression that hid the control.
 const menuRows=template.split('\n').filter(row=>row.includes('aria-label="Read aloud"')||row.includes('aria-label="Ask about page"'));
 assert.equal(menuRows.length,2,'both actual Browser menu controls are captured');
 const dom=new JSDOM(menuRows.join('\n'));
 try{
  const guarded=label=>{
   const button=dom.window.document.querySelector(`button[aria-label="${label}"]`);assert.ok(button,label);
   let node=button;while(node.parentElement?.localName==='sc-if')node=node.parentElement;
   return node.outerHTML;
  };
  const menu='<main class="os"><section data-screen>'+guarded('Read aloud')+guarded('Ask about page')+'</section></main>';
  const renderer=fs.readFileSync('apps/app/src/prototype/dc-lite.js','utf8')
   .replace("import {iconStyle} from '../icon-style';",'const iconStyle=()=>({});')
   .replace('import templateHtml from "./template.html?raw";',`const templateHtml=${JSON.stringify(menu)};`);
  const code=buildSync({stdin:{contents:renderer,resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,platform:'node',format:'cjs',external:['react']}).outputFiles[0].text;
  const module={exports:{}};new Function('require','module','exports','document',code)(createRequire(import.meta.url),module,module.exports,dom.window.document);
  class Menu extends module.exports.DCLogic{renderVals(){return {browser:this.props.browser};}}
  for(const readAloudAvailable of [false,true])for(const pageContentAvailable of [false,true]){
   const rendered=new JSDOM(renderToStaticMarkup(React.createElement(Menu,{browser:{readAloudAvailable,pageContentAvailable}})));
   try{
    assert.equal(!!rendered.window.document.querySelector('button[aria-label="Read aloud"]'),readAloudAvailable&&pageContentAvailable);
    assert.equal(!!rendered.window.document.querySelector('button[aria-label="Ask about page"]'),pageContentAvailable);
   }finally{rendered.window.close();}
  }
 }finally{dom.window.close();}
 const read=adapter.slice(adapter.indexOf('async function readPage()'),adapter.indexOf('async function askPage()'));
 assert.ok(read.indexOf('if(Capacitor.isNativePlatform()&&cloudRuntimeEnabled)return;')<read.indexOf('createNativeReadingVoice()'));
 const runtime=fs.readFileSync('apps/app/src/runtime/native-reading-voice.ts','utf8');
 assert.match(runtime,/createNativeReadingVoice\(\)\{\s*if\(cloudRuntimeEnabled\)return null;/);
});
