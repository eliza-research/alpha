// Source-shape guard (class S). It shows nothing about Android's behaviour.
//
// Capacitor can deliver a plugin call the page made just before the activity was destroyed after
// handleOnDestroy has run. A plugin that hands that call to a worker it has already stopped gets a
// RejectedExecutionException on Capacitor's bridge thread, and Capacitor rethrows it: the process
// dies. Round 8 saw this once on the API 36 emulator (AlphaDevicePlugin.crashLog) and fixed that
// plugin; this guard covers every Java source the app ships.
//
// Rule: work is handed to an executor only where a stopped executor is answered, not thrown. That
// means the hand-off goes through PluginWorkers.submit, or sits in a try block that catches
// RejectedExecutionException (or a wider type) with no lambda or anonymous class body between the
// two, because code in such a body runs later, outside that try.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = "android/app/src/main/java/ai/elizaresearch/alphaphone";
// Shared browser classes the app compiles from the reviewed pin (scripts/stage-local-agent-sources.mjs).
const shared = "vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface";
// The browser tab host and its reviewed reading are the shared BrowserTabHostPlugin; AlphaBrowserPlugin only names it.
const sharedFiles = ["BrowserBlobCapture.java", "BrowserDownloads.java", "BrowserLoginFields.java", "BrowserReadingWorld.java", "BrowserReviewedReading.java", "BrowserTabHostPlugin.java"];
const files = [...fs.readdirSync(root).filter(name => name.endsWith(".java")), ...sharedFiles].sort();
const read = name => fs.readFileSync(path.join(sharedFiles.includes(name) ? shared : root, name), "utf8");

/** Blanks comments, strings, text blocks and character literals, keeping every offset. */
function mask(source) {
  const out = source.split("");
  const blank = (from, to) => { for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " "; };
  for (let i = 0; i < source.length;) {
    const two = source.slice(i, i + 2);
    if (two === "//") { const end = source.indexOf("\n", i); const stop = end < 0 ? source.length : end; blank(i, stop); i = stop; }
    else if (two === "/*") { const end = source.indexOf("*/", i + 2); const stop = end < 0 ? source.length : end + 2; blank(i, stop); i = stop; }
    else if (source.startsWith('"""', i)) { const end = source.indexOf('"""', i + 3); const stop = end < 0 ? source.length : end + 3; blank(i, stop); i = stop; }
    else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i]; let j = i + 1;
      while (j < source.length && source[j] !== quote && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      blank(i + 1, j); i = j + 1;
    } else i++;
  }
  return out.join("");
}

/** Every brace block with what opened it: a try (and what it catches), a deferred body, or other. */
function blocks(code) {
  const found = [], stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") {
      const before = code.slice(Math.max(0, i - 400), i).trimEnd();
      let kind = "other";
      if (/\btry$/.test(before) || /\btry\s*\([^{}]*\)$/.test(before)) kind = "try";
      // A lambda body, or an anonymous class body (new Type(...){ ... }): both run later.
      else if (/->$/.test(before) || /\bnew\s+[\w.<>?,\s]+\([^{};]*\)$/.test(before)) kind = "deferred";
      stack.push({ kind, start: i });
    } else if (code[i] === "}") {
      const block = stack.pop();
      if (!block) continue;
      block.end = i;
      if (block.kind === "try") {
        block.catches = [];
        let rest = i + 1;
        for (;;) {
          const clause = /^\s*catch\s*\(([^)]*)\)\s*\{/.exec(code.slice(rest));
          if (!clause) break;
          block.catches.push(...clause[1].replace(/\bfinal\b/g, "").trim().split(/\s+/).slice(0, -1).join("").split("|"));
          // Skip the catch body.
          let depth = 0, j = rest + clause[0].length - 1;
          for (; j < code.length; j++) { if (code[j] === "{") depth++; else if (code[j] === "}" && --depth === 0) break; }
          rest = j + 1;
        }
      }
      found.push(block);
    }
  }
  return found;
}

const ANSWERS_A_STOPPED_EXECUTOR = new Set(["RejectedExecutionException", "java.util.concurrent.RejectedExecutionException", "RuntimeException", "Exception", "Throwable"]);
const EXECUTOR_TYPES = "ExecutorService|ScheduledExecutorService|ThreadPoolExecutor|ScheduledThreadPoolExecutor|Executor|NoticeWorker";

/** Hand-offs to an executor field of this file (or the shared journal plugin's worker()). */
function handOffs(name, code) {
  const fields = new Set(["worker()"]);
  const declaration = new RegExp(`(?:^|[\\s.;{(])(?:${EXECUTOR_TYPES})\\s+(\\w+)\\s*[=;,)]`, "g");
  for (const match of code.matchAll(declaration)) fields.add(match[1]);
  const all = blocks(code), sites = [];
  for (const match of code.matchAll(/(\w+(?:\(\))?)\.(execute|submit|schedule|scheduleAtFixedRate|scheduleWithFixedDelay)\(/g)) {
    if (!fields.has(match[1])) continue;
    const at = match.index;
    const enclosing = all.filter(block => block.start < at && at < block.end).sort((a, b) => b.start - a.start);
    let guarded = false;
    for (const block of enclosing) {
      if (block.kind === "deferred") break;
      if (block.kind === "try" && block.catches.some(type => ANSWERS_A_STOPPED_EXECUTOR.has(type))) { guarded = true; break; }
    }
    sites.push({ file: name, line: code.slice(0, at).split("\n").length, receiver: match[1], method: match[2], guarded });
  }
  // PluginWorkers.submit(worker, work, refused) answers a stopped or full worker by running refused
  // (test/plugin-worker-guard.test.mjs runs it on the JVM), so each such hand-off is guarded.
  for (const match of code.matchAll(/\bPluginWorkers\.submit\((\w+(?:\(\))?),/g)) {
    if (!fields.has(match[1])) continue;
    sites.push({ file: name, line: code.slice(0, match.index).split("\n").length, receiver: match[1], method: "PluginWorkers.submit", guarded: true });
  }
  return sites;
}

// Hand-offs that are safe for a reason the scanner cannot see. Each entry is one exact place.
const REVIEWED = [
  { file: "AlphaCanonicalNotifications.java", receiver: "SERIAL", method: "execute", count: 7,
    why: "private static final process dispatcher; stop retires sessions, never the executor; lifetime and non-escape checked below" },
  { file: "AlphaCanonicalNotifications.java", receiver: "SERIAL", method: "schedule", count: 2,
    why: "same process dispatcher; queued retries check session generation and the dispatcher is never shut down" },
  { file: "HostedTransport.java", receiver: "timer", method: "schedule", count: 1,
    why: "runs in the constructor, on a timer created by that same object's field initialiser; nothing can have stopped it yet" },
];

/** A lifetime exception is safe only while the executor cannot escape or be stopped. */
function assertNotificationDispatcherLifetime(source) {
  const code = mask(source);
  const declaration = /\bprivate\s+static\s+final\s+ScheduledExecutorService\s+SERIAL\s*=\s*Executors\.newSingleThreadScheduledExecutor\(\s*\)\s*;/g;
  const declarations = [...code.matchAll(declaration)];
  assert.equal(declarations.length, 1, "notification dispatcher must remain privately owned and immutable");
  const start = declarations[0].index, end = start + declarations[0][0].length;
  for (const reference of code.matchAll(/\bSERIAL\b/g)) {
    if (reference.index >= start && reference.index < end) continue;
    assert.match(code.slice(reference.index), /^SERIAL\s*\.\s*(?:execute|schedule)\s*\(/,
      "notification dispatcher must not escape, be reassigned or be shut down");
  }
}

const sites = files.flatMap(name => handOffs(name, mask(read(name))));

test("notification dispatcher outlives sessions and cannot escape to a shutdown owner", () => {
  const source = read("AlphaCanonicalNotifications.java");
  assertNotificationDispatcherLifetime(source);
  assert.throws(() => assertNotificationDispatcherLifetime(source.replace("static final ScheduledExecutorService SERIAL", "static ScheduledExecutorService SERIAL")));
  assert.throws(() => assertNotificationDispatcherLifetime(source.replace("SERIAL.execute(", "SERIAL.shutdown(); SERIAL.execute(")));
  assert.throws(() => assertNotificationDispatcherLifetime(source.replace("SERIAL.execute(", "ExecutorService alias = SERIAL; SERIAL.execute(")));
});

test("the scanner sees the executors the app really has", () => {
  // A scanner that silently finds nothing would pass every assertion below.
  assert.ok(sites.length >= 30, `only ${sites.length} executor hand-offs were found`);
  for (const name of ["AlphaDevicePlugin.java", "AlphaMailAttachmentsPlugin.java", "AlphaActionJournalPlugin.java", "AlphaLocalAgentPlugin.java", "BrowserDownloads.java", "AlphaConnectionPlugin.java"])
    assert.ok(sites.some(site => site.file === name), `${name}: no executor hand-off found`);
  const sample = "class A{private final ExecutorService w=null;void a(PluginCall c){w.execute(()->{});}void b(){try{w.execute(()->{});}catch(RejectedExecutionException e){}}void c(){try{run(()->{w.execute(()->{});});}catch(Exception e){}}void d(){try{w.execute(()->{});}catch(java.io.IOException e){}}}";
  assert.deepEqual(handOffs("A.java", mask(sample)).map(site => site.guarded), [false, true, false, false],
    "a bare hand-off, one inside a lambda within a try, and one whose try catches something else are all unguarded");
  assert.equal(mask('a("worker.execute(") // worker.execute(\n/* worker.execute( */').includes("execute"), false, "strings and comments are not scanned");
});

test("no plugin call, callback or broadcast hands work to an executor that may already be stopped without answering the rejection", () => {
  const open = sites.filter(site => !site.guarded);
  const unexplained = [];
  for (const entry of REVIEWED) {
    const matching = open.filter(site => site.file === entry.file && site.receiver === entry.receiver && site.method === entry.method);
    assert.equal(matching.length, entry.count, `${entry.file}: reviewed exception no longer matches the source (${entry.why})`);
  }
  for (const site of open)
    if (!REVIEWED.some(entry => entry.file === site.file && entry.receiver === site.receiver && entry.method === site.method))
      unexplained.push(`${site.file}:${site.line} ${site.receiver}.${site.method}(`);
  assert.deepEqual(unexplained, [], "each of these throws on the calling thread once the executor is stopped; route it through a helper that rejects the call");
});

test("the workers that plugins stop on destroy are reached through one rejecting helper each", () => {
  const helper = (name, signature) => {
    const source = read(name), at = source.indexOf(signature);
    assert.ok(at >= 0, `${name}: ${signature} exists`);
    return source.slice(at, source.indexOf("\n }", at));
  };
  const mail = read("AlphaMailAttachmentsPlugin.java");
  assert.match(helper("AlphaMailAttachmentsPlugin.java", "private void work(PluginCall call,Runnable task){"), /PluginWorkers\.submit\(worker,task,\(\)->call\.reject\(/);
  for (const method of ["readSelected", "retainSourceReference", "openSourceReference"])
    assert.match(mail, new RegExp(`@PluginMethod public void ${method}\\(PluginCall call\\)\\{int token=generation\\.get\\(\\);work\\(call,`), `${method} uses the helper`);
  assert.match(mail, /private void openReviewedAt\(PluginCall call,int token\)\{work\(call,/);
  assert.match(mail, /handleOnDestroy\(\)\{[^\n]*worker\.shutdown\(\);/, "the worker is still stopped with the plugin");

  const journal = read("AlphaActionJournalPlugin.java");
  assert.match(helper("AlphaActionJournalPlugin.java", "private void clockWork(PluginCall call,Runnable task){"), /PluginWorkers\.submit\(worker\(\),task,\(\)->call\.reject\(/);
  assert.match(journal, /public void reviewClock\(PluginCall call\)\{\s*clockWork\(call,/);
  assert.match(journal, /public void confirmClock\(PluginCall call\)\{[\s\S]{0,400}?\n\s*clockWork\(call,/);

  // The shared download list stops its workers on destroy; every hand-off answers a stopped worker.
  const downloads = read("BrowserDownloads.java");
  assert.match(downloads, /private void work\(ExecutorService worker, Runnable task, Runnable dropped\) \{\s*try \{\s*worker\.execute\(task\);\s*\} catch \(RejectedExecutionException \w+\) \{\s*dropped\.run\(\);\s*\}/);
  assert.equal([...downloads.matchAll(/\b(?:io|network)\.execute\(/g)].length, 0, "download workers are reached only through the helper");
});

test("nothing is shown or created on a destroyed activity by a late browser call", () => {
  const plugin = read("BrowserTabHostPlugin.java");
  assert.match(plugin, /private boolean closed\(PluginCall call\)\{if\(!destroyed\)return false;call\.reject\("Browser closed"\);return true;\}/);
  // Every plugin method that reaches the main thread checks first; load() has no call to reject.
  const posts = plugin.split("\n").filter(line => /getActivity\(\)\.runOnUiThread\(/.test(line) && /PluginCall call/.test(line));
  assert.ok(posts.length >= 13, `expected the browser's main-thread plugin methods, found ${posts.length}`);
  for (const line of posts) assert.match(line, /runOnUiThread\(\s*\(\)\s*->\s*\{if\(closed\(call\)\)return;/, line.slice(0, 90));
  assert.match(plugin, /handleOnDestroy\(\) \{ destroyed=true;/, "destruction is recorded before anything else is torn down");

  // The download dialogs: a completion posted from a worker can land after destroy().
  const downloads = read("BrowserDownloads.java");
  assert.match(downloads, /public void destroy\(\) \{\s*closed = true;\s*dismissDialogs\(\);/);
  assert.match(downloads, /private void message\(String text\) \{\s*if \(closed\)\s*return;\s*new AlertDialog\.Builder/);
  assert.match(downloads, /public void show\(\) \{\s*if \(closed\)\s*return;/);
  assert.match(downloads, /private void review\(String tab, String title, String details, Runnable confirm\) \{\s*if \(closed\)\s*return;/);
  assert.match(downloads, /private boolean reviewable\(\) \{\s*if \(closed\)\s*return false;/);
});

test("receivers and callbacks a plugin registers are released when it is destroyed", () => {
  for (const name of files) {
    const code = mask(read(name));
    // registerReceiver(null, filter) only reads a sticky broadcast; nothing stays registered.
    const registers = [...code.matchAll(/registerReceiver\(\s*(?!null\b)/g)].length;
    if (registers) assert.ok(/unregisterReceiver\(/.test(code), `${name}: registers a receiver and never unregisters one`);
    if (/\.registerCallback\(/.test(code)) assert.ok(/\.unregisterCallback\(/.test(code), `${name}: registers a callback and never unregisters it`);
    if (/registerComponentCallbacks\(/.test(code)) assert.ok(/unregisterComponentCallbacks\(/.test(code), `${name}: registers component callbacks and never unregisters them`);
    // An activity listening on its own bridge shares that bridge's lifetime; a plugin does not own it.
    if (/addWebViewListener\(/.test(code) && /extends Plugin\b/.test(code)) assert.ok(/removeWebViewListener\(/.test(code), `${name}: adds a WebView listener and never removes it`);
    if (/setStopListener\(/.test(code) && /extends Plugin/.test(code)) assert.ok(/clearStopListener\(/.test(code), `${name}: sets a navigation stop listener and never clears it`);
  }
});

// A second way the same late call ends the process. A permission request or an activity-result
// request launches through the activity, and androidx unregisters every launcher when the
// activity is destroyed: launch() then throws IllegalStateException on Capacitor's bridge thread.
// Rule: such a request is the body of LateLaunch.ask(call, () -> ...), or sits in a try that
// answers the exception, with no lambda or anonymous class body between the two.
const ANSWERS_A_MISSING_LAUNCHER = new Set(["IllegalStateException", "RuntimeException", "Exception", "Throwable"]);
const REQUESTS = "requestPermissionForAlias|requestPermissionForAliases|requestAllPermissions|requestPermissions|startActivityForResult";

/** Every request in this source that launches through the activity, and whether a missing launcher is answered. */
function launches(name, code) {
  const launchers = new Set([...code.matchAll(/\bActivityResultLauncher<[^;=()]*>\s+(\w+)\s*[=;,]/g)].map(match => match[1]));
  const all = blocks(code), sites = [];
  for (const match of code.matchAll(new RegExp(`(?:\\b(\\w+)\\.)?\\b(${REQUESTS}|launch)\\(`, "g"))) {
    const [, receiver, method] = match, at = match.index;
    if (method === "launch" ? !launchers.has(receiver) : receiver !== undefined && receiver !== "super" && receiver !== "this") continue;
    // A declaration of the method, not a call of it.
    if (/\b(?:void|boolean)\s+$/.test(code.slice(Math.max(0, at - 12), at))) continue;
    // LateLaunch.ask in Alpha; the shared TelephonyPlugin base has the same guard as its launch(call, ...) helper
    // and the shared PhotosPlugin as its ask(call, ...) helper (both checked below).
    let guarded = /(?:LateLaunch\.ask|(?<![\w.])(?:launch|ask))\(\s*\w+\s*,\s*\(\)\s*->\s*$/.test(code.slice(Math.max(0, at - 80), at));
    for (const block of all.filter(block => block.start < at && at < block.end).sort((a, b) => b.start - a.start)) {
      if (guarded || block.kind === "deferred") break;
      if (block.kind === "try" && block.catches.some(type => ANSWERS_A_MISSING_LAUNCHER.has(type))) guarded = true;
    }
    sites.push({ file: name, at, line: code.slice(0, at).split("\n").length, method: receiver ? `${receiver}.${method}` : method, guarded });
  }
  return sites;
}

/** The plugin methods of a source: name, parameter name and body. */
function pluginMethods(code) {
  const all = blocks(code), found = [];
  for (const match of code.matchAll(/@PluginMethod(?:\([^)]*\))?\s+public\s+(?:synchronized\s+)?void\s+(\w+)\(PluginCall\s+(\w+)\)\s*\{/g)) {
    const open = match.index + match[0].length - 1, body = all.find(block => block.start === open);
    if (body) found.push({ name: match[1], start: open, end: body.end });
  }
  return found;
}

test("a permission or activity-result request that arrives after the activity is destroyed is rejected, not thrown", () => {
  const helper = read("LateLaunch.java");
  assert.match(helper, /static boolean ask\(PluginCall call,Runnable launch\)\{\s*try\{launch\.run\(\);return true;\}\s*catch\(IllegalStateException \w+\)\{call\.reject\(CLOSED\);return false;\}\s*\}/);

  const sample = "class A extends Plugin{ActivityResultLauncher<Intent> picker;void a(PluginCall c){requestPermissionForAlias(\"x\",c,\"cb\");}void b(PluginCall c){LateLaunch.ask(c,()->requestPermissionForAlias(\"x\",c,\"cb\"));}void c(PluginCall c){try{startActivityForResult(c,i,\"cb\");}catch(ActivityNotFoundException e){}}void d(PluginCall c){try{picker.launch(i);}catch(RuntimeException e){}}void e(PluginCall c){try{run(()->{picker.launch(i);});}catch(Exception e){}}@Override public void requestPermissions(PluginCall c){LateLaunch.ask(c,()->super.requestPermissions(c));}void f(){other.launch(i);activity.startActivityForResult(i,1);}}";
  assert.deepEqual(launches("A.java", mask(sample)).map(site => [site.method, site.guarded]),
    [["requestPermissionForAlias", false], ["requestPermissionForAlias", true], ["startActivityForResult", false], ["picker.launch", true], ["picker.launch", false], ["super.requestPermissions", true]],
    "a bare request, one whose try answers something else and one inside a lambda within a try are unguarded; a declaration, another object's launch and an activity's own request are not requests of this kind");

  const found = files.flatMap(name => launches(name, mask(read(name))));
  // A scanner that silently finds nothing would pass.
  for (const [name, method] of [["AlphaHostedResultsPlugin.java", "requestPermissionForAlias"], ["DailyAppsPlugin.java", "startActivityForResult"], ["AlphaFilesPlugin.java", "startActivityForResult"], ["AlphaMailAttachmentsPlugin.java", "startActivityForResult"], ["AlphaNoteDocumentsPlugin.java", "startActivityForResult"], ["BrowserTabHostPlugin.java", "takePicture.launch"], ["BrowserTabHostPlugin.java", "runtimePermissions.launch"], ["BrowserTabHostPlugin.java", "filePicker.launch"], ["BrowserTabHostPlugin.java", "pageShare.launch"]])
    assert.ok(found.some(site => site.file === name && site.method === method), `${name}: ${method} not found`);
  assert.deepEqual(found.filter(site => !site.guarded).map(site => `${site.file}:${site.line} ${site.method}(`), [],
    "each of these throws on the calling thread once the activity is destroyed; make it the body of LateLaunch.ask");
});

test("Capacitor's own permission request, and the shared plugins' requests an app plugin inherits, are answered the same way", () => {
  // AlphaTelephonyPlugin re-checks the image capability first (P-36); the late-launch guard is the same.
  const guardedOverride = (source, method) => new RegExp(`@Override @PluginMethod public void ${method}\\(PluginCall call\\) ?\\{(?: if \\(refused\\(call\\)\\) return;)? ?LateLaunch\\.ask\\(call, ?\\(\\) ?-> ?super\\.${method}\\(call\\)\\); ?\\}`).test(source);
  // Plugin.requestPermissions is a plugin method of every plugin and launches for one that declares permissions.
  const declaring = files.filter(name => /@CapacitorPlugin\([^\n]*\bpermissions\s*=/.test(read(name)));
  assert.deepEqual(declaring, ["AlphaCalendarPlugin.java", "AlphaContactsPlugin.java", "AlphaHostedResultsPlugin.java", "AlphaPhotoLibraryPlugin.java", "AlphaPhotosPlugin.java", "AlphaSystemPlugin.java", "AlphaTelephonyPlugin.java", "AlphaVoiceCloudPlugin.java", "DailyAppsPlugin.java"], "the plugins that declare permissions");
  for (const name of declaring.filter(name=>name!=="AlphaContactsPlugin.java")) {
    if(name==='AlphaPhotosPlugin.java'||name==='AlphaPhotoLibraryPlugin.java') {
      // Registrations of the shared PhotosPlugin and DeviceLibraryPlugin. Photos must select aliases for this
      // Android version, rather than asking for the obsolete legacy permission together with the current media
      // grants, and a late request is answered with Alpha's LateLaunch wording.
      const media="vendor/eliza/plugins/plugin-native-media/android/src/main/java/ai/eliza/plugins/media/";
      const base=fs.readFileSync(media+(name==='AlphaPhotosPlugin.java'?"PhotosPlugin.java":"DeviceLibraryPlugin.java"),"utf8");
      assert.match(base,/@Override\n {2}@PluginMethod\n {2}public void requestPermissions\(PluginCall call\) \{\n {4}(?:requestLibraryAccess|requestAccess)\(call\);\n {2}\}/);
      if(name==='AlphaPhotosPlugin.java'){
        assert.match(base,/ask\(call, \(\) -> requestPermissionForAliases\(aliases, call, "libraryPermissionResult"\)\);/);
        assert.match(base,/protected final boolean ask\(PluginCall call, Runnable launch\) \{\n {4}try \{\n {6}launch\.run\(\);\n {6}return true;\n {4}\} catch \(IllegalStateException closed\) \{\n {6}call\.reject\(closedMessage\(\)\);\n {6}return false;/);
      } else assert.match(base,/try \{\n {6}requestPermissionForAliases\(aliases, call, "libraryPermissionResult"\);\n {4}\} catch \(IllegalStateException closed\) \{\n {6}call\.reject\(closedMessage\(\)\);/);
      assert.match(read(name),/@Override protected String closedMessage\(\)\{return LateLaunch\.CLOSED;\}/);
    } else if(name==='AlphaTelephonyPlugin.java') {
      // The shared TelephonyPlugin base answers a late request the same way (its launch helper rejects with CLOSED).
      const base=fs.readFileSync("vendor/eliza/plugins/plugin-native-messages/android/src/main/java/ai/eliza/plugins/messages/TelephonyPlugin.java","utf8");
      assert.match(base,/@Override @PluginMethod public void requestPermissions\(PluginCall call\) \{ if \(refused\(call\)\) return; launch\(call, \(\) -> super\.requestPermissions\(call\)\); \}/);
      assert.match(base,/protected static boolean launch\(PluginCall call, Runnable start\) \{\n  try \{ start\.run\(\); return true; \} catch \(IllegalStateException gone\) \{ call\.reject\(CLOSED\); return false; \}/);
    } else if(name==='AlphaVoiceCloudPlugin.java') {
      // The shared LocalSpeechBridgePlugin base sends every prompt (requestPermissions and both
      // microphone requests) through its launch port, which Alpha answers with LateLaunch.ask.
      const base=fs.readFileSync("vendor/eliza/plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/LocalSpeechBridgePlugin.java","utf8");
      assert.match(base,/@Override @PluginMethod public void requestPermissions\(PluginCall call\)\{launch\(call,\(\)->super\.requestPermissions\(call\)\);\}/);
      assert.match(base,/protected boolean launch\(PluginCall call,Runnable request\)\{\n  try\{request\.run\(\);return true;\}catch\(IllegalStateException closed\)\{call\.reject\(LAUNCH_CLOSED\);return false;\}/);
      const prompts=[...base.matchAll(/requestPermissionForAlias\(/g)].map(match=>base.slice(Math.max(0,match.index-24),match.index));
      assert.equal(prompts.length,2);for(const before of prompts)assert.match(before,/launch\(call,\(\)->$/);
      assert.match(read(name),/@Override protected boolean launch\(PluginCall call,Runnable request\)\{return LateLaunch\.ask\(call,request\);\}/);
    } else assert.ok(guardedOverride(read(name), "requestPermissions"), `${name}: requestPermissions is overridden with the guard`);
  }



  // A plugin that extends a shared (vendored) plugin inherits its plugin methods. The shared
  // source is not edited here; the app's subclass overrides each inherited method that launches.
  const shared = new Map();
  const walk = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) { const full = path.join(directory, entry.name); if (entry.isDirectory()) { if (!["node_modules", "build", "test", "androidTest"].includes(entry.name)) walk(full); } else if (entry.name.endsWith(".java")) shared.set(entry.name.slice(0, -5), full); } };
  for (const plugin of fs.readdirSync("vendor/eliza/plugins")) { const android = path.join("vendor/eliza/plugins", plugin, "android/src/main/java"); if (fs.existsSync(android)) walk(android); }
  const inherited = [];
  for (const name of files) {
    const source = read(name), parent = /\bclass\s+\w+\s+extends\s+([\w.]+)/.exec(mask(source))?.[1].split(".").pop();
    if (!parent || parent === "Plugin" || !shared.has(parent) || !/@CapacitorPlugin\(/.test(source)) continue;
    const code = mask(fs.readFileSync(shared.get(parent), "utf8")), open = launches(parent, code).filter(site => !site.guarded);
    for (const method of pluginMethods(code))
      if (open.some(site => method.start < site.at && site.at < method.end)) {
        inherited.push(`${name}<${parent}#${method.name}`);
        assert.ok(guardedOverride(source, method.name), `${name}: ${parent}.${method.name} launches through the activity and is not overridden with the guard`);
      }
  }
  assert.deepEqual(inherited.sort(), ["AlphaCalendarPlugin.java<CalendarPlugin#requestAccess", "AlphaCalendarPlugin.java<CalendarPlugin#requestWorkflowReadAccess", "DailyAppsPlugin.java<ReminderPlugin#scheduleReminder"],
    "the inherited plugin methods that launch; a new one in a shared plugin needs its override here");
});

test("background navigation cannot be started by a call that arrives after its renderer closed", () => {
  const maps = read("AlphaMapsTransportPlugin.java");
  const start = maps.slice(maps.indexOf("@PluginMethod public void startNavigation(PluginCall call){"), maps.indexOf("@PluginMethod public void updateNavigation(PluginCall call){"));
  const refused = 'if(destroyed){call.reject("Background navigation is unavailable: Alpha closed","unavailable");return;}';
  assert.ok(start.indexOf(refused) > 0 && start.indexOf(refused) < start.indexOf("AlphaNavigationService.start("), "refused before the service is started");
  assert.match(start, /AlphaNavigationService\.start\([^\n]*\n[^\n]*\n\s*if\(destroyed\)\{AlphaNavigationService\.stop\(getContext\(\),session,"renderer-closed"\);call\.reject\(/, "a start that raced destruction retires its own session");
  const destroy = maps.slice(maps.indexOf("@Override protected void handleOnDestroy(){"));
  assert.ok(destroy.indexOf("destroyed=true;") > 0 && destroy.indexOf("destroyed=true;") < destroy.indexOf("AlphaNavigationService.activeSession()"), "the flag is set before the active session is read and stopped");
});

// Kotlin shared plugins are outside the Java scanner above. Inventory every plugin method
// that directly launches a Capacitor permission/activity request, so new upstream methods
// cannot silently inherit an unguarded launch through the product wrapper.
test("shared Kotlin System activity launch methods have guarded product overrides", () => {
  const source = fs.readFileSync("vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemPlugin.kt", "utf8");
  const inherited = [...source.matchAll(/@PluginMethod\s+(?:open\s+)?fun\s+(\w+)\(call: PluginCall\)\s*\{/g)].filter(match => {
    const start = match.index + match[0].length - 1; let end = start + 1, depth = 1;
    for (; depth && end < source.length; end++) { if(source[end] === "{") depth++; else if(source[end] === "}") depth--; }
    return /(?:requestPermissionForAlias|startActivityForResult)\(/.test(source.slice(start,end));
  }).map(match=>match[1]).sort();
  assert.deepEqual(inherited,["requestRole","setFlashlight"]);
  const wrapper = read("AlphaSystemPlugin.java");
  for(const method of inherited) assert.ok(wrapper.includes(`@Override @PluginMethod public void ${method}(PluginCall call){LateLaunch.ask(call,()->super.${method}(call));}`),method);
});

test("Contacts generic permission requests remain image and foreground gated",()=>{
  // AlphaContactsPlugin is the shared AOSP-profile address book under Alpha's plugin name and image admission.
  const alpha=read("AlphaContactsPlugin.java");assert.match(alpha,/public final class AlphaContactsPlugin extends AddressBookPlugin \{/);assert.match(alpha,/protected boolean admitted\(\)\{return AlphaImageCapabilities\.aospImage\(getContext\(\)\);\}/);assert.match(alpha,/protected String closedMessage\(\)\{return LateLaunch\.CLOSED;\}/);
  const base=fs.readFileSync("vendor/eliza/plugins/plugin-native-contacts/android/src/main/java/ai/eliza/plugins/contacts/AddressBookPlugin.java","utf8");
  assert.match(base,/public void requestPermissions\(PluginCall call\) \{\n    if \(!foreground\(\)\) \{/);assert.match(base,/launch\(call, \(\) -> requestPermissionForAlias\("contacts", call, "permissionResult"\)\)/);
  assert.match(base,/launch\(call, \(\) -> startActivityForResult\(call, intent, "editorResult"\)\)/);assert.match(base,/catch \(IllegalStateException gone\) \{\n      call\.reject\(closedMessage\(\)\);/);
});
