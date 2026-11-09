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
const files = fs.readdirSync(root).filter(name => name.endsWith(".java")).sort();
const read = name => fs.readFileSync(path.join(root, name), "utf8");

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
const EXECUTOR_TYPES = "ExecutorService|ScheduledExecutorService|ThreadPoolExecutor|ScheduledThreadPoolExecutor|Executor|WorkflowNoticeIo";

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
  { file: "HostedTransport.java", receiver: "timer", method: "schedule", count: 1,
    why: "runs in the constructor, on a timer created by that same object's field initialiser; nothing can have stopped it yet" },
  { file: "IsolatedPdfService.java", receiver: "worker", method: "execute", count: 1,
    why: "not a plugin: an isolated service whose onDestroy kills its own process right after stopping the worker; a request outside the isolated process is refused before the hand-off" },
  { file: "WorkflowNoticeIo.java", receiver: "executor", method: "execute", count: 1,
    why: "the wrapper itself; it deliberately lets the rejection reach its callers, and every NOTICE_IO.execute call is scanned here" },
];

const sites = files.flatMap(name => handOffs(name, mask(read(name))));

test("the scanner sees the executors the app really has", () => {
  // A scanner that silently finds nothing would pass every assertion below.
  assert.ok(sites.length >= 30, `only ${sites.length} executor hand-offs were found`);
  for (const name of ["AlphaDevicePlugin.java", "AlphaMailAttachmentsPlugin.java", "AlphaActionJournalPlugin.java", "AlphaLocalAgentPlugin.java", "AlphaNotificationsPlugin.java", "BrowserDownloads.java", "AlphaConnectionPlugin.java"])
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

  const downloads = read("BrowserDownloads.java");
  assert.match(helper("BrowserDownloads.java", "private void work(ExecutorService worker,Runnable task,Runnable dropped){"), /try\{worker\.execute\(task\);\}\s*catch\(java\.util\.concurrent\.RejectedExecutionException \w+\)\{dropped\.run\(\);\}/);
  assert.equal([...downloads.matchAll(/\b(?:io|network)\.execute\(/g)].length, 0, "download workers are reached only through the helper");
});

test("nothing is shown or created on a destroyed activity by a late browser call", () => {
  const plugin = read("AlphaBrowserPlugin.java");
  assert.match(plugin, /private boolean closed\(PluginCall call\)\{if\(!destroyed\)return false;call\.reject\("Browser closed"\);return true;\}/);
  // Every plugin method that reaches the main thread checks first; load() has no call to reject.
  const posts = plugin.split("\n").filter(line => /getActivity\(\)\.runOnUiThread\(/.test(line) && /PluginCall call/.test(line));
  assert.ok(posts.length >= 13, `expected the browser's main-thread plugin methods, found ${posts.length}`);
  for (const line of posts) assert.match(line, /runOnUiThread\(\s*\(\)\s*->\s*\{if\(closed\(call\)\)return;/, line.slice(0, 90));
  assert.match(plugin, /handleOnDestroy\(\) \{ destroyed=true;/, "destruction is recorded before anything else is torn down");

  // The download dialogs: a completion posted from a worker can land after destroy().
  const downloads = read("BrowserDownloads.java");
  assert.match(downloads, /void destroy\(\)\{closed=true;dismissDialogs\(\);/);
  assert.match(downloads, /private void message\(String text\)\{if\(closed\)return;new AlertDialog\.Builder/);
  assert.match(downloads, /void show\(\)\{\n\s*if\(closed\)return;/);
  assert.match(downloads, /private void review\(String tab,String title,String details,Runnable confirm\)\{\n\s*if\(closed\)return;/);
  assert.match(downloads, /private boolean reviewable\(\)\{\n\s*if\(closed\)return false;/);
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
    let guarded = /LateLaunch\.ask\(\s*\w+\s*,\s*\(\)\s*->\s*$/.test(code.slice(Math.max(0, at - 80), at));
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
  for (const [name, method] of [["AlphaHostedResultsPlugin.java", "requestPermissionForAlias"], ["AlphaVoiceCloudPlugin.java", "requestPermissionForAlias"], ["DailyAppsPlugin.java", "startActivityForResult"], ["AlphaFilesPlugin.java", "startActivityForResult"], ["AlphaMailAttachmentsPlugin.java", "startActivityForResult"], ["AlphaNoteDocumentsPlugin.java", "startActivityForResult"], ["AlphaBrowserPlugin.java", "takePicture.launch"], ["AlphaBrowserPlugin.java", "runtimePermissions.launch"], ["AlphaBrowserPlugin.java", "filePicker.launch"], ["AlphaBrowserPlugin.java", "pageShare.launch"]])
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
      // Photos must select aliases for this Android version, rather than asking
      // for the obsolete legacy permission together with the current media grants.
      assert.match(read(name),/@Override @PluginMethod public void requestPermissions\(PluginCall call\)\{(?:requestLibraryAccess|requestAccess)\(call\);\}/);
      assert.match(read(name),/LateLaunch\.ask\(call,\(\)->requestPermissionForAliases\(aliases,call,"libraryPermissionResult"\)\)/);
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
  assert.ok(destroy.indexOf("destroyed=true;") > 0 && destroy.indexOf("destroyed=true;") < destroy.indexOf("AlphaNavigationService.activeSessionOwnedBy(navigationStops)"), "the flag is set before the owned session is read and stopped");
});

test("closing the assistant window never ends the launcher's navigation session", () => {
  const maps = read("AlphaMapsTransportPlugin.java");
  const start = maps.slice(maps.indexOf("@PluginMethod public void startNavigation(PluginCall call){"), maps.indexOf("@PluginMethod public void updateNavigation(PluginCall call){"));
  assert.ok(start.indexOf("getActivity() instanceof AlphaAssistActivity") > 0 && start.indexOf("getActivity() instanceof AlphaAssistActivity") < start.indexOf("AlphaNavigationService.start("), "the assistant window cannot start guidance");
  assert.match(start, /AlphaNavigationService\.start\(getContext\(\),session,[^\n]*,navigationStops,getActivity\(\)/, "each session records the bridge and task that started it");
  const destroy = maps.slice(maps.indexOf("@Override protected void handleOnDestroy(){"));
  const stops = [...destroy.matchAll(/AlphaNavigationService\.stop\(getContext\(\),(\w+),/g)].map(match => match[1]);
  assert.deepEqual(stops, ["owned"], "a closing bridge stops only the session it started");
  assert.match(destroy, /String owned=AlphaNavigationService\.activeSessionOwnedBy\(navigationStops\);/);
  assert.doesNotMatch(maps, /setStopListener\(|AlphaNavigationService\.activeSession\(\);if\(active/, "no process-wide stop listener a second bridge could replace");
  const service = read("AlphaNavigationService.java");
  const removed = service.slice(service.indexOf("@Override public void onTaskRemoved("), service.indexOf("@Override public void onDestroy()"));
  assert.ok(removed.indexOf("AlphaAssistActivity.class.getName()") > 0 && removed.indexOf("ownerTaskAlive()") > 0, "task removal checks the assistant root and the owner's task");
  assert.ok(removed.indexOf("ownerTaskAlive()") < removed.indexOf('finish(null, "task-removed")'), "the owner's task is checked before the session ends");
  assert.match(service, /target = owner;/, "the stop is reported to the session's own bridge");
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

test("Contacts generic permission requests remain image and foreground gated",()=>{const source=read("AlphaContactsPlugin.java");assert.match(source,/public void requestPermissions\(PluginCall call\)\{\s*if\(!foreground\(\)\)/);assert.match(source,/LateLaunch.ask\(call,\(\)->requestPermissionForAlias\("contacts",call,"permissionResult"\)\)/);});
