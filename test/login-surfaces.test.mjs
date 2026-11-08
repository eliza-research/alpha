import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {preparePatchedNative} from '../scripts/prepare-patched-native.mjs';

// Issue #404 (P-20): every eligible login surface in Alpha supports password-manager fill,
// website fills bind to the committed HTTPS origin, app fills to verified app identity, and
// secrets never reach observations, transcripts or logs. config/login-surfaces.json is the
// inventory; these source guards keep a new login field from landing unregistered or unwired.
// They do not establish device behaviour: see remainingGates in the inventory.
const read = file => fs.readFileSync(file, 'utf8');
const inventory = JSON.parse(read('config/login-surfaces.json'));
// The native tab host is shared (plugin-native-browser-surface); Alpha's plugin only names it.
const plugin = read('vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/BrowserTabHostPlugin.java');
// The browser's login adapters are staged into the app from the reviewed pin (plugin-native-browser-surface).
const sharedBrowser = 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/';

function walk(dir, accept, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, accept, out); }
    else if (accept(full)) out.push(full);
  }
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// Signals that a field holds a reusable credential. A field that only says autocomplete="off"
// is not detected; pairing codes are registered for documentation, not discovered.
const RENDERER_DETECTORS = [
  /\btype\s*[=:]\s*\{?\s*["']password["']/gi,
  /\btype\s*=\s*password\b/gi, // unquoted HTML attribute
  /\btype\s*=\s*\{[^}\n]*password[^}\n]*\}/gi, // dynamic type={show ? 'text' : 'password'}
  /\bauto[cC]omplete\s*[=:]\s*\{?\s*["'][^"']*\b(?:username|current-password|new-password|one-time-code|webauthn)\b[^"']*["']/gi,
  /\binput\([^\n]*?,\s*'password',/g,
  /(?:-webkit-)?text-security\s*:|[wW]ebkitTextSecurity|textSecurity\s*:/g, // masked text that is not type=password
];
const NATIVE_DETECTORS = [
  /textPassword|textWebPassword|numberPassword|textVisiblePassword/g,
  /TYPE_TEXT_VARIATION_(?:WEB_|VISIBLE_)?PASSWORD|TYPE_NUMBER_VARIATION_PASSWORD/g,
  /autofillHints|setAutofillHints|AUTOFILL_HINT_(?:PASSWORD|USERNAME)/g,
  /PasswordTransformationMethod|PasswordVisualTransformation|KeyboardType\.Password/g,
  /setInputType\(\s*(?:0x[0-9a-fA-F]+|\d+)\s*\)|android:inputType\s*=\s*"(?:0x[0-9a-fA-F]+|\d+)"/g, // numeric input types hide a password variation
];
const registered = inventory.surfaces.filter(surface => surface.file);

test('the inventory covers websites, other apps and every Alpha-owned secret field', () => {
  const ids = new Set(inventory.surfaces.map(surface => surface.id));
  assert.equal(ids.size, inventory.surfaces.length, 'unique surface ids');
  for (const id of ['browser-website-login', 'third-party-app-login', 'eliza-cloud-sign-in-google', 'eliza-cloud-sign-in-code']) assert.ok(ids.has(id), id);
  for (const surface of inventory.surfaces) {
    assert.equal(typeof surface.eligible, 'boolean', surface.id);
    if (surface.eligible) {
      assert.ok(inventory.rules[surface.binding], `${surface.id} names a binding rule`);
      assert.ok(surface.providers?.integrated && (surface.providers.proton || surface.providers.other), `${surface.id} states both the integrated vault and an optional provider`);
      assert.ok(Array.isArray(surface.remainingGates) && surface.remainingGates.length, `${surface.id} lists its remaining acceptance gates`);
    } else {
      assert.ok(surface.reason?.length > 20, `${surface.id} explains why it is not a fill target`);
    }
  }
  assert.equal(inventory.surfaces.find(s => s.id === 'browser-website-login').binding, 'websiteBinding');
  assert.equal(inventory.surfaces.find(s => s.id === 'third-party-app-login').binding, 'appBinding');
});

test('subscription redemption is inventoried but excluded from password-provider fill', () => {
  const surface = inventory.surfaces.find(s => s.id === 'eliza-cloud-subscription-code');
  assert.ok(surface, 'subscription grant entry must remain explicitly inventoried');
  assert.equal(surface.kind, 'alpha-owned');
  assert.equal(surface.eligible, false, 'a redemption code is not a reusable credential');
  assert.equal(surface.binding, undefined, 'never bind a grant code to a website or app password');
  assert.equal(surface.providers, undefined, 'no password-provider fill route');
  const field = read(surface.file).match(/<input[^\n]*name="membership-code"[^\n]*\/>/);
  assert.ok(field, 'the inventoried redemption input exists');
  assert.match(field[0], /autoComplete="one-time-code"/);
  assert.match(field[0], /data-autofill-ignore="true"/);
  assert.match(plugin, /getBridge\(\)\.getWebView\(\)\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\);/, 'framework exclusion, not the HTML marker, prevents native password fill');
});

test('no Alpha-owned login form is eligible until it has a provider-owned native fill route', () => {
  // The renderer WebView is excluded from Autofill, so registering an Alpha-owned form as
  // eligible without a native credential surface would be a false claim.
  for (const surface of inventory.surfaces.filter(s => s.kind === 'alpha-owned')) {
    assert.equal(surface.eligible, false, `${surface.id}: build a native credential surface first (rules.rendererWebView)`);
  }
  // A native Alpha-owned surface is eligible only when every field reports an authoritative origin.
  const native = inventory.surfaces.filter(s => s.kind === 'alpha-owned-native' && s.eligible);
  assert.equal(inventory.surfaces.find(s => s.id === 'browser-http-auth-prompt').eligible, false);
  for (const surface of native) {
    const source = read(surface.file);
    assert.ok(surface.fillRoute, surface.id);
    assert.match(source, /bundle\.putString\(extras\.topOrigin, origin\);/, surface.id);
    assert.match(source, /bundle\.putString\(extras\.fieldOrigin, origin\);/, surface.id);
    assert.match(source, /structure\.setWebDomain\(origin\);/, surface.id);
    assert.match(source, /if \(origin == null \|\| extras == null\) \{\s*field\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO\);\s*return field;\s*\}/, `${surface.id} fails closed without an origin`);
  }
});

test('the HTTP authentication prompt fills only for an engine-authenticated origin and says why otherwise', () => {
  const auth = read(sharedBrowser + 'BrowserHttpAuthAutofill.java');
  const rule = read(sharedBrowser + 'BrowserHttpAuthOrigin.java');
  // The decision rule itself is executed on the JVM below (redirects, frames, wrong origin, stale/hidden tabs, revoke).
  assert.match(rule, /static final EngineChallengeSource STANDARD_WEBVIEW = \(reportedHost, reportedRealm\) -> null;/, 'standard WebView reports no challenge origin');
  assert.match(plugin, /private final BrowserHttpAuthOrigin\.EngineChallengeSource authEngine=BrowserHttpAuthOrigin\.STANDARD_WEBVIEW;/);
  assert.match(plugin, /BrowserHttpAuthOrigin\.Decision authDecision=BrowserHttpAuthOrigin\.bind\(authEngine\.challenge\(host,realm\),authSnapshot\(t,host,realm\)\);/);
  // An engine report is never synthesized by Alpha from navigation history, page script or the top-level URL.
  // Every app source set (flavors and the flag-only testMocks set included), whatever the qualifier
  // or import: only the class itself names the constructor, and STANDARD_WEBVIEW is the one source.
  const appSources = walk('android/app/src', file => /\.(java|kt)$/.test(file) && !/[\\/]androidTest[\\/]/.test(file));
  for (const file of appSources) {
    const source = read(file);
    const own = file.endsWith('BrowserHttpAuthOrigin.java');
    assert.doesNotMatch(source, /new\s+(?:[\w.]+\.)?EngineChallenge\s*\(/, `${file} must not fabricate an engine challenge`);
    if (!own) assert.doesNotMatch(source, /EngineChallengeSource(?!\s+authEngine=BrowserHttpAuthOrigin\.STANDARD_WEBVIEW;)/, `${file} must not supply another engine source`);
  }
  assert.equal((rule.match(/EngineChallenge\(/g) || []).length, 1, 'the only constructor is the declaration');
  assert.equal((rule.match(/EngineChallengeSource [A-Z_]+\s*=/g) || []).length, 1, 'STANDARD_WEBVIEW is the only engine source');
  assert.doesNotMatch(plugin, /requestOrigins|recordRequestOrigin/, 'observed request history is not an origin source');
  // Refusal is stated in the prompt; manual entry stays available.
  assert.match(plugin, /String managerLine=authOrigin==null\?"\\n"\+authDecision\.refusal:/);
  // Fields: hints and origin only while bound; revoked or unbound fields drop out and drop late values.
  assert.match(auth, /public static EditText field\(Context context, String origin, BooleanSupplier bound,\s*boolean password, BrowserAutofillExtras extras\)/);
  assert.match(auth, /if \(origin == null \|\| extras == null\) \{\s*field\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO\);\s*return field;\s*\}\s*field\.setAutofillHints\(password \? View\.AUTOFILL_HINT_PASSWORD : View\.AUTOFILL_HINT_USERNAME\);/);
  assert.match(auth, /public int getImportantForAutofill\(\) \{\s*return admitted\(\) \? super\.getImportantForAutofill\(\) : View\.IMPORTANT_FOR_AUTOFILL_NO;\s*\}/);
  assert.match(auth, /if \(!admitted\(\)\) \{[^}]*structure\.setAutofillHints\(null\);\s*structure\.setAutofillType\(View\.AUTOFILL_TYPE_NONE\);\s*structure\.setAutofillValue\(null\);\s*structure\.setText\(""\);\s*structure\.setDataIsSensitive\(true\);\s*return;/, 'an unbound or revoked field reports no typed value, even to a manual request');
  assert.match(auth, /public int getAutofillType\(\) \{\s*return admitted\(\) \? super\.getAutofillType\(\) : View\.AUTOFILL_TYPE_NONE;\s*\}/, 'unbound fields are not autofillable, so typed text is never tracked for save');
  assert.match(auth, /public AutofillValue getAutofillValue\(\) \{\s*return admitted\(\) \? super\.getAutofillValue\(\) : null;\s*\}/);
  assert.match(auth, /public void autofill\(AutofillValue value\) \{\s*if \(admitted\(\)\)\s*super\.autofill\(value\);\s*\}/);
  // Alpha passes the integrated vault's extras keys; a field without them is never bound.
  const alphaStores = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaBrowserStores.java');
  assert.match(alphaStores, /\.autofillExtras\(new BrowserAutofillExtras\(PasswordAutofillPolicy\.FIELD_ORIGIN,PasswordFormPolicy\.TOP_ORIGIN_EXTRA\)\)/);
  assert.match(plugin, /BrowserHttpAuthAutofill\.field\(getActivity\(\),authOrigin,bound,false,config\(\)\.autofillExtras\);[\s\S]{0,140}BrowserHttpAuthAutofill\.field\(getActivity\(\),authOrigin,bound,true,config\(\)\.autofillExtras\);/);
  assert.match(plugin, /java\.util\.function\.BooleanSupplier bound=\(\)->authBinding!=null&&authBinding\.admits\(authSnapshot\(t,host,realm\)\)&&siteDialogTab==t;/);
  assert.match(plugin, /siteDialogRevoke=\(\)->\{if\(authBinding!=null\)authBinding\.revoke\(\);BrowserHttpAuthAutofill\.exclude\(user,pass\);\};/);
  // Cancel, Back, tab change, navigation and process loss all dismiss through these two paths, which revoke first.
  assert.match(plugin, /AlertDialog dialog=siteDialog;if\(dialog==null\)return;\n\s*revokeSiteDialogAutofill\(\);/);
  assert.match(plugin, /dialog\.setOnDismissListener\(d->\{if\(siteDialog!=dialog\)return;revokeSiteDialogAutofill\(\);/);
  assert.match(auth, /InputType\.TYPE_CLASS_TEXT\s*\|\s*\(password \? InputType\.TYPE_TEXT_VARIATION_PASSWORD : InputType\.TYPE_TEXT_FLAG_NO_SUGGESTIONS\)/, 'exactly one password-typed field');
  // The only getAutofillValue is the framework-facing gate above; Alpha never reads values itself.
  assert.equal((auth.match(/getAutofillValue/g) || []).length, 2, 'getAutofillValue appears only in the bound/unbound gate');
  assert.doesNotMatch(auth, /getText\(\)/, 'Alpha never reads provider values back');
  // Renderer loss revokes an open prompt for that tab (and cancels its framework session) immediately.
  assert.match(plugin, /onRenderProcessGone\(WebView v, RenderProcessGoneDetail detail\) \{[^\n]*t\.dead=true; if\(siteDialogTab==t\)dismissSiteDialogs\(\);[^\n]*v\.destroy\(\);/);
  // No tab is fillable while any site prompt is open, including after a provider unlock resumes the activity.
  const can = plugin.slice(plugin.indexOf('private boolean canAutofill(Tab t)'), plugin.indexOf('private void cancelAutofill(Tab t)'));
  assert.match(can, /state\.overlay=siteDialog!=null;/);
  assert.match(can, /return BrowserAutofillEligibility\.eligible\(state\);/);
  assert.match(plugin, /dismissSiteDialogs\(\);siteDialog=dialog;siteDialogTab=t;siteDialogCancel=cancel;siteDialogAutofill=false;siteDialogRevoke=null;\n\s*for\(Tab tab:tabs\.values\(\)\)disableAutofill\(tab\);/);
  // Save waits for the site: Sign in keeps the prompt open; commit() only when the load commits at the bound origin.
  assert.match(plugin, /\.setPositiveButton\("Sign in",null\)\.setNegativeButton\("Cancel",null\)\.create\(\);/);
  assert.match(plugin, /t\.authSaveOrigin=authOrigin;authBinding\.submitted\(\);\n\s*v\.setEnabled\(false\);dialog\.setMessage\(message\+"\\n\\nSigning in…"\);\n\s*handler\.proceed\(u,p\);/);
  assert.doesNotMatch(plugin.slice(plugin.indexOf('private void httpAuth('), plugin.indexOf('// ---- Camera for capture-enabled')), /\.commit\(\)/, 'the prompt itself never commits');
  const finish = plugin.slice(plugin.indexOf('private void finishAuthSave('), plugin.indexOf('private void finishAuthSave(') + 700);
  assert.match(finish, /boolean accepted=committedUrl!=null&&origin\.equals\(BrowserHttpAuthOrigin\.exactHttps\(committedUrl\)\)&&t\.httpStatus!=401&&t\.httpStatus!=407;/);
  assert.match(finish, /if\(accepted\)\{siteDialogAutofill=false;AutofillManager manager=[^\n]*manager\.commit\(\);\}\n\s*dismissSiteDialogs\(\);/);
  assert.match(plugin, /finishAuthSave\(t,url\); syncAutofill\(t\);/, 'resolved before the tab can become fillable');
  assert.match(plugin, /\/\/ A repeated challenge means the previous answer was not accepted: never offer to save it\.\n\s*finishAuthSave\(t,null\);/);
  assert.match(plugin, /private void fail\(Tab t, String message\) \{ finishAuthSave\(t,null\);/);
  // Dismissal cancels first: a provider may save when every field becomes invisible.
  assert.match(plugin, /if\(siteDialogAutofill\)\{siteDialogAutofill=false;AutofillManager manager=getActivity\(\)\.getSystemService\(AutofillManager\.class\);if\(manager!=null\)manager\.cancel\(\);\}\n\s*dialog\.dismiss\(\);/);
  assert.match(plugin, /dialog\.setCancelable\(authOrigin==null\);dialog\.setCanceledOnTouchOutside\(false\);/);
  // The password manager is named only when Android has an Autofill service enabled.
  assert.match(plugin, /boolean autofillOn=authOrigin!=null&&autofillState!=null&&autofillState\.isEnabled\(\);/);
});

test('Alpha-owned native credential fields declare hints and report a website origin, never Alpha\'s identity', () => {
  // Any native source that declares username/password Autofill hints must be a registered
  // alpha-owned-native surface whose fields fail closed (excluded, no hints) without a bound origin.
  const declaring = [...walk('android', file => /\.(java|kt|xml)$/.test(file) && !/[\\/](test|androidTest|build)[\\/]/.test(file)), ...walk(sharedBrowser, file => file.endsWith('.java'))]
    .filter(file => /setAutofillHints|AUTOFILL_HINT_(?:PASSWORD|USERNAME)|autofillHints=/.test(read(file)));
  const nativeSurfaces = inventory.surfaces.filter(s => s.kind === 'alpha-owned-native');
  // The browser's engine-attested field adapter declares hints for website fields; it is the
  // inventoried website surface's file and is guarded in its own test below.
  const websiteAdapters = inventory.surfaces.filter(s => s.kind === 'website' && s.file);
  assert.deepEqual(declaring.sort(), [...nativeSurfaces, ...websiteAdapters].map(s => s.file).sort(), 'every hint-declaring native file is an inventoried credential surface');
  for (const surface of nativeSurfaces) {
    const source = read(surface.file);
    assert.ok(inventory.rules[surface.binding], `${surface.id} names a binding rule`);
    assert.match(source, /field\.setAutofillHints\(password \? View\.AUTOFILL_HINT_PASSWORD : View\.AUTOFILL_HINT_USERNAME\);/, `${surface.id} declares username and password hints`);
    assert.match(source, /bundle\.putString\(extras\.fieldOrigin, origin\);/, `${surface.id} reports a per-field website origin`);
    assert.match(source, /if \(origin == null \|\| extras == null\) \{\s*field\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO\);\s*return field;\s*\}/, `${surface.id} fails closed`);
    assert.doesNotMatch(source, /getPackageName\(\)|setWebDomain\([^)]*package/i, `${surface.id} never binds to Alpha's package`);
  }
  assert.ok(inventory.rules.alphaOwnedAppIdentity);
});

test('External authorization uses the browser and Google sign-in uses the native account picker', () => {
  for (const id of ['eliza-cloud-sign-in', 'google-account-authorization']) {
    const surface = inventory.surfaces.find(s => s.id === id);
    assert.equal(surface?.kind, 'external-browser', id);
    assert.equal(surface.eligible, false, id);
  }
  const connection = read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java');
  const open = connection.slice(connection.indexOf('public void openExternal('), connection.indexOf('public void openExternal(') + 900);
  assert.match(open, /Intent intent = new Intent\(Intent\.ACTION_VIEW, Uri\.parse\(url\.toASCIIString\(\)\)\); intent\.addCategory\(Intent\.CATEGORY_BROWSABLE\);/);
  // Exact production hosts (eliza.app, cloud.eliza.app, accounts.google.com); staging only with test mocks.
  assert.match(open, /if \(!ConnectionRoutes\.externalHost\(url\.getScheme\(\), url\.getHost\(\), url\.getPort\(\), BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)\) throw new IllegalArgumentException\(\);/);
  const routes = read('android/app/src/main/java/ai/elizaresearch/alphaphone/ConnectionRoutes.java');
  // Alpha supplies its hosts and Google consent to the shared policy, which opens exactly those (plugin-native-agent).
  assert.match(routes, /CloudDeployment\.PRODUCTION_WEB_HOST,CloudDeployment\.STAGING_WEB_HOST,\s*CloudDeployment\.PRODUCTION_SERVICES_HOST,CloudDeployment\.STAGING_SERVICES_HOST,java\.util\.Collections\.singleton\("accounts\.google\.com"\)\)\)/);
  const policy = read('vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/CloudConnectionPolicy.java');
  assert.match(policy, /if \(hosts\.productionWeb\.equals\(value\) \|\| hosts\.productionServices\.equals\(value\) \|\| hosts\.externalProviders\.contains\(value\)\)\s+return true;/);
  assert.doesNotMatch(open, /setPackage\(getContext\(\)\.getPackageName\(\)\)|AlphaBrowserPlugin/, 'never opened in Alpha\'s own browser');
  // Alpha registers no general web handler, so a sign-in page cannot resolve back into Alpha. The one
  // exception is the verified in-app sign-in return: exactly one https host and one exact path.
  const callback = /^<intent-filter android:autoVerify="true"><action android:name="android\.intent\.action\.VIEW"\/><category android:name="android\.intent\.category\.DEFAULT"\/><category android:name="android\.intent\.category\.BROWSABLE"\/><data android:scheme="https" android:host="(eliza\.app|\$\{stagingCloudWebHost\})" android:path="\/alphaphone\/auth\/callback"\/><\/intent-filter>$/;
  const returns = [];
  for (const manifest of walk('android', file => file.endsWith('AndroidManifest.xml') && !/[\\/](test|androidTest|build)[\\/]/.test(file))) {
    const live = read(manifest).replace(/<!--[\s\S]*?-->/g, '');
    for (const filter of live.match(/<intent-filter[\s\S]*?<\/intent-filter>/g) || []) {
      if (!/android\.intent\.action\.VIEW/.test(filter) || !/android:scheme="https?"/.test(filter)) continue;
      const match = filter.match(callback);
      assert.ok(match, `${manifest} declares a web VIEW handler other than the verified sign-in return`);
      returns.push(`${manifest.split(path.sep).join('/')}:${match[1]}`);
    }
  }
  assert.deepEqual(returns.sort(), ['android/app/src/testMocks/AndroidManifest.xml:${stagingCloudWebHost}'], 'the production return comes only from the ELIZAOS_APP_LINK_HOST overlay (android/app/product.gradle); the staging return exists only in the test-mocks overlay');
  assert.match(read('android/app/product.gradle'), /android:host="\\\$\{appLinkHost\}" android:path="\/alphaphone\/auth\/callback"\/><\/intent-filter>/, 'the build-gated sign-in return is one exact path');
  // Inspect the exact shared source that the Android build packages.
  const staged=preparePatchedNative({root:process.cwd()});
  const signIn = read(path.join(staged.root,'packages/auth/android/src/main/java/ai/eliza/auth/cloud/CloudSignInPlugin.java'));
  assert.match(read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCloudSignInPlugin.java'), /extends CloudSignInPlugin/);
  assert.equal(inventory.surfaces.find(s=>s.id==='eliza-cloud-sign-in-google').kind,'external-browser');
  assert.match(signIn,/CustomTabsIntent/, 'Google sign-in uses the external browser');
  assert.match(read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCloudSignInPlugin.java'),/googleSignInMode\("browser"\)/);
  assert.match(signIn,/tab\.intent\.setPackage\(browser\)/, 'launch targets the selected Custom Tabs browser');
  assert.doesNotMatch(signIn, /new WebView|WebView\.loadUrl|AlphaBrowserPlugin/, 'never an embedded user agent');
  const ui = read('apps/app/src/runtime/google-connection-ui.tsx');
  assert.match(ui, /await openConnectionBrowser\(url,abort\.signal\);/);
});

/** Every detector hit whose line no registered pattern for that file covers (per line, not per file). */
function unregisteredHits(files, detectors) {
  const hits = [];
  for (const file of files) {
    const text = read(file);
    const coveredLines = new Set();
    for (const surface of registered.filter(entry => entry.file === file)) {
      for (const match of text.matchAll(new RegExp(surface.pattern, 'g'))) coveredLines.add(lineOf(text, match.index));
    }
    for (const detector of detectors) {
      for (const match of text.matchAll(detector)) {
        const line = lineOf(text, match.index);
        if (!coveredLines.has(line)) hits.push(`${file}:${line} ${match[0]}`);
      }
    }
  }
  return hits;
}

test('every renderer credential field is registered in config/login-surfaces.json', () => {
  const files = walk('apps/app/src', file => /\.(ts|tsx|js|jsx|mjs|cjs|html|css)$/.test(file) && !/\.test\./.test(file));
  assert.deepEqual(unregisteredHits(files, RENDERER_DETECTORS), [], 'register each new credential field (and wire its fill route if eligible)');
});

test('the detectors catch the field shapes they claim to', () => {
  const samples = {
    renderer: ['<input type=password>', '<input type={reveal ? "text" : "password"}>', "style={{WebkitTextSecurity:'disc'}}", '.pin{-webkit-text-security:disc}', '<input autoComplete="current-password">'],
    native: ['android:inputType="textVisiblePassword"', 'InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD', 'new PasswordTransformationMethod()', 'field.setInputType(0x81)', 'android:inputType="129"'],
  };
  for (const sample of samples.renderer) assert.ok(RENDERER_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
  for (const sample of samples.native) assert.ok(NATIVE_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
});

test('each registered Alpha-owned field still exists exactly as inventoried', () => {
  for (const surface of registered) {
    const matches = [...read(surface.file).matchAll(new RegExp(surface.pattern, 'g'))];
    assert.equal(matches.length, surface.count ?? 1, `${surface.id} in ${surface.file}`);
  }
});

test('membership inventory retains exact code semantics across controlled JSX props',()=>{
  const surface=registered.find(entry=>entry.id==='eliza-cloud-subscription-code');
  const pattern=new RegExp(surface.pattern);
  assert.ok(pattern.test('name="membership-code" value={codeValue} onChange={event=>setCodeValue(event.target.value)} autoComplete="one-time-code"'));
  for(const source of ['name="other-code" autoComplete="one-time-code"','name="membership-code" autoComplete="current-password"','name="membership-code"><input autoComplete="one-time-code"'])assert.equal(pattern.test(source),false,source);
});

test('native Alpha UI declares no unregistered credential fields', () => {
  // Every Android module's source sets (app, launcher, embedding-host, local-speech, fixtures), per line.
  const roots = fs.readdirSync('android', {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => path.join('android', entry.name, 'src')).filter(dir => fs.existsSync(dir));
  assert.ok(roots.includes(path.join('android', 'app', 'src')));
  const files = roots.flatMap(root => walk(root, file => /\.(java|kt|xml)$/.test(file) && !/[\\/](test|androidTest)[\\/]/.test(file)));
  assert.deepEqual(unregisteredHits(files, NATIVE_DETECTORS), []);
});

test('website fills bind to the committed HTTPS top-level origin of an eligible tab', () => {
  assert.match(plugin, /getBridge\(\)\.getWebView\(\)\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\);/, 'the privileged renderer WebView is never an Autofill target');
  const credential = plugin.slice(plugin.indexOf('private final class CredentialWebView'), plugin.indexOf('static String topOrigin('));
  // With engine-attested fields the WebView's own structure (no per-field origins) is never offered.
  assert.match(credential, /onProvideAutofillVirtualStructure\(ViewStructure structure,int flags\) \{\n\s*if\(canAutofill\(tab\)&&tab\.fields==null\) \{/);
  assert.match(credential, /onProvideAutofillStructure\(ViewStructure structure,int flags\) \{\n\s*if\(canAutofill\(tab\)&&tab\.fields==null\)super\.onProvideAutofillStructure/);
  assert.match(credential, /String origin=topOrigin\(tab\.url\);\n\s*if\(origin!=null && structure\.getExtras\(\)!=null\)structure\.getExtras\(\)\.putString\(config\(\)\.autofillExtras\.topOrigin,origin\);/);
  assert.match(credential, /else structure\.setChildCount\(0\);/, 'an ineligible tab exposes no fields');
  assert.match(credential, /public void autofill\(SparseArray<AutofillValue> values\) \{\n\s*if\(canAutofill\(tab\)&&tab\.fields==null\)super\.autofill\(values\);/, 'late values for an ineligible tab are dropped');
  const top = plugin.slice(plugin.indexOf('static String topOrigin('));
  assert.match(top.slice(0, 600), /https/, 'only HTTPS origins are reported');
  // Upstream policy: cross-origin frames and missing per-field origins are refused for the integrated vault.
  const policy = read('vendor/eliza/plugins/plugin-native-passwords/android/src/main/java/ai/eliza/plugins/passwords/PasswordFormPolicy.java');
  assert.match(policy, /throw new Rejected\("Cross-origin frame"\)/);
  assert.match(policy, /throw new Rejected\("Field origin unavailable"\)/);
  assert.match(policy, /throw new Rejected\("Host interface is never filled"\)/);
});

test('secrets stay out of observations, transcripts and logs', () => {
  const client = read('apps/app/src/runtime/alpha-client.ts');
  const context = client.slice(client.indexOf('export interface ViewContext'), client.indexOf('export interface VerifiedSession'));
  // The observation is identity-only: no field values, page text, usernames or origins.
  assert.doesNotMatch(context, /\b(value|password|username|text|url|origin|fields?)\??:/i);
  const adapter = read('apps/app/src/prototype/agent-adapter.ts');
  assert.match(adapter, /sensitive: view === 'wallet' \|\| \(view === 'settings' && passwordSurfaceOpen\(shell\.vget\('settings'\)\)\)[^\n]*connectionController\.getSnapshot\(\)\.open,/, 'password pages and connection sheets (provider key, pairing) suspend observation');
  for (const file of ['apps/app/src/passwords/password-manager.ts', 'apps/app/src/browser/password-provider.ts', 'apps/app/src/prototype/browser-adapter.ts']) {
    assert.doesNotMatch(read(file), /console\.(log|info|warn|error|debug)\(/, `${file} does not log`);
  }
  for (const file of ['AlphaBrowserPlugin.java', 'PasswordProviderSupport.java', sharedBrowser + 'BrowserTabHostPlugin.java', sharedBrowser + 'BrowserReviewedReading.java', sharedBrowser + 'BrowserLoginFields.java', sharedBrowser + 'BrowserFieldOrigin.java', sharedBrowser + 'BrowserHttpAuthAutofill.java']) {
    const text = read(file.startsWith(sharedBrowser) ? file : 'android/app/src/main/java/ai/elizaresearch/alphaphone/' + file);
    const logs = [...text.matchAll(/(?:android\.util\.)?Log\.[vdiwe]\([^;]*;/g)].map(match => match[0]);
    for (const line of logs) assert.doesNotMatch(line, /url|value|password|username|structure|getText|origin/i, `${file}: ${line}`);
    assert.doesNotMatch(text, /printStackTrace\(/, file);
  }
  // Autofill values are never read back into the bridge.
  assert.doesNotMatch(plugin, /getAutofillValue\(|AutofillValue\.forText|\.getTextValue\(\)/);
});

// Plain-JVM run, at the pin, of the shared field-origin and HTTP-auth binding rules against the
// pinned PasswordFormPolicy (plugin-native-browser-surface's own tests: redirects, frames, wrong
// origin, stale and hidden tabs, revoke, the anchor and prompt field shapes). No APK, device,
// provider or vault.
test('the pinned binding rules and password policy pass their JVM tests', () => {
  const java = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' : '');
  // A nested test run reports through NODE_TEST_CONTEXT unless it is removed; read its TAP output instead.
  const {NODE_TEST_CONTEXT: _parent, ...inherited} = process.env;
  const env = java ? {...inherited, JAVA_HOME: java} : inherited;
  const result = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'vendor/eliza/plugins/plugin-native-browser-surface/test/native-host/policies.node.mjs'], {encoding: 'utf8', timeout: 180000, env});
  for (const name of ['BrowserFieldOriginTest', 'BrowserHttpAuthOriginTest', 'BrowserLinkAutofillPolicyTest']) assert.match(result, new RegExp(`ok \\d+ - ${name}`), name);
  assert.match(result, /# fail 0/);
});

// Engine-attested field origins for the browser's website logins (BrowserFieldOrigin,
// BrowserLoginFields). These guards keep the only origin source the WebView engine's
// sourceOrigin; the rule itself runs on the JVM below and the injected script in
// test/browser/login-field-reporter.spec.ts. Neither establishes device behaviour.
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const fieldsSource = read(sharedBrowser + 'BrowserLoginFields.java');
const ruleSource = read(sharedBrowser + 'BrowserFieldOrigin.java');
// The reporter is BrowserLoginFields.SCRIPT, a Java text block; undo its backslash escapes.
const reporterScript = fieldsSource.split('static final String SCRIPT = """')[1].split('""";')[0].replaceAll('\\\\', '\\');

test('website field origins come only from the engine\'s sourceOrigin, never from page or script content', () => {
  // Native code only: the reporter text block (checked below) also posts on its own channel.
  const code = strip(fieldsSource.replace(/static final String SCRIPT = """[\s\S]*?""";/, ''));
  // The listener signature WebView calls, and the single place an engine source is built: from its arguments.
  assert.match(code, /private void onPostMessage\(WebView view, WebMessageCompat message, Uri sourceOrigin,\s*boolean isMainFrame, JavaScriptReplyProxy reply\) \{/);
  assert.match(code, /new BrowserFieldOrigin\.EngineSource\(\s*sourceOrigin == null \? null : sourceOrigin\.toString\(\), isMainFrame\)/);
  // Every app source set: no Alpha file builds an engine source or a binding, or writes per-field origins itself.
  const appSources = walk('android/app/src', file => /\.(java|kt)$/.test(file) && !/[\\/]androidTest[\\/]/.test(file));
  for (const file of appSources) {
    const text = strip(read(file));
    assert.doesNotMatch(text, /EngineSource\s*\(|new\s+(?:[\w.]+\.)?Binding\s*\(\s*decision|BrowserFieldOrigin\.Binding\s*\(/, `${file} must not fabricate a field-origin engine source or binding`);
    assert.doesNotMatch(text, /putString\(\s*(?:PasswordAutofillPolicy\.)?FIELD_ORIGIN/, `${file} must not write per-field origins`);
  }
  assert.equal((code.match(/new BrowserFieldOrigin\.EngineSource\(/g) || []).length, 1, 'one engine source, built in the listener');
  assert.equal((code.match(/new BrowserFieldOrigin\.Binding\(/g) || []).length, 1, 'one binding site');
  assert.match(code, /if \(!decision\.fillable\(\)\)\s*return;\s*binding = new BrowserFieldOrigin\.Binding\(decision\.origin, now\.navigation, report\);\s*proxy = reply;\s*focus = report;/, 'binds only an admitted engine origin, and replies only to the reporting frame');
  // The script report carries no origin, URL or frame: the parser accepts no such field.
  const report = strip(ruleSource.slice(ruleSource.indexOf('public static final class Report')));
  const declared = [...report.matchAll(/public final (?:Kind|String|int|float) ([\w, ]+);/g)].flatMap(match => match[1].split(',').map(name => name.trim()));
  assert.deepEqual(declared.sort(), ['document', 'focused', 'height', 'kind', 'password', 'passwordAutocomplete', 'passwordValue', 'username', 'usernameAutocomplete', 'usernameValue', 'viewportWidth', 'width', 'x', 'y'].sort(), 'the script message has no origin, address or frame field');
  assert.doesNotMatch(report, /origin|frame|location|getHost|URI\b|Uri\b/i, 'the parser never reads an address');
  const bind = strip(ruleSource.slice(ruleSource.indexOf('public static Decision bind('), ruleSource.indexOf('public static final class Binding')));
  assert.doesNotMatch(bind, /Report|message/, 'the decision reads only the engine source and the tab');
  assert.match(bind, /if \(!origin\.equals\(top\)\)\s*return refuse\(engine\.mainFrame \? MISMATCH : FRAME\);/, 'cross-origin frames are denied');
  // Per-field origins are the binding's engine origin; the committed top-level URL fills only the host extra.
  assert.match(code, /bundle\.putString\(extras\.fieldOrigin, origin\);/);
  assert.match(code, /child\(structure\.newChild\(index\+\+\), parent, base \+ 1, current\.origin, false,/);
  assert.doesNotMatch(code, /notifyViewVisibilityChanged/, 'fields are never reported invisible (a provider may save when all fields disappear)');
  assert.match(code, /child\(structure\.newChild\(index\), parent, base \+ 2, current\.origin, true,/);
  assert.match(code, /String top = BrowserFieldOrigin\.exactHttps\(host\.snapshot\(\)\.state\.documentUrl\);[\s\S]{0,260}bundle\.putString\(extras\.topOrigin, top\);/);
  assert.equal((code.match(/extras\.fieldOrigin/g) || []).length, 1, 'the per-field origin is written in one place');
  // Alpha passes the integrated vault's keys when it installs the adapter.
  assert.match(plugin, /t\.fields=BrowserLoginFields\.install\(t\.web,\(\)->fieldSnapshot\(t\),config\(\)\.autofillExtras\);/);
  // Fail closed: no binding or no admission, no fields; late values are dropped.
  assert.match(code, /if \(current == null \|\| !admitted\(\)\) \{\s*structure\.setChildCount\(0\);\s*return;\s*\}/);
  assert.match(code, /public int getImportantForAutofill\(\) \{\s*return admitted\(\) \? View\.IMPORTANT_FOR_AUTOFILL_YES\s*: View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS;\s*\}/);
  assert.match(code, /if \(values == null \|\| target == null \|\| !admitted\(\)\)\s*return;/);
  assert.match(code, /private boolean admitted\(\) \{\s*BrowserFieldOrigin\.Binding current = binding;\s*return !closed && current != null && proxy != null && current\.admits\(host\.snapshot\(\)\);\s*\}/);
  // Values go only to the reporting frame's reply proxy, with the binding's origin for the script's own check.
  assert.equal((code.match(/\.postMessage\(/g) || []).length, 1, 'one outbound message');
  assert.match(code, /target\.postMessage\(message\.toString\(\)\);/);
  assert.match(code, /message\.put\("t", "fill"\)\.put\("d", current\.document\)\.put\("o", current\.origin\);/);
  // Submitted values reach only the framework session (the provider asks the user before saving).
  assert.match(code, /if \(binding == null \|\| !binding\.sameFrame\(engine, report\) \|\| !binding\.admits\(now\)\)\s*return;/);
  // Isolated world only: page script cannot reach the channel or the script, and no page-world injection exists.
  assert.match(code, /WebViewCompat\.addWebMessageListener\(web, CHANNEL, Set\.of\("\*"\), fields\.world, fields::onPostMessage\);/);
  assert.match(code, /WebViewCompat\.addJavaScriptOnEvent\(web, SCRIPT,\s*WebViewCompat\.INJECTION_EVENT_DOCUMENT_START, Set\.of\("\*"\), fields\.world\);/);
  assert.doesNotMatch(code, /addDocumentStartJavaScript|addJavascriptInterface|evaluateJavascript|PAGE_WORLD/);
  assert.match(code, /WebViewFeature\.isFeatureSupported\(WebViewFeature\.WEB_MESSAGE_LISTENER\)\s*&& WebViewFeature\.isFeatureSupported\(WebViewFeature\.JS_INJECTION_IN_FRAME_AND_WORLD\)/, 'runtime feature check');
  // No logging or persistence of anything here.
  for (const [name, text] of [['BrowserLoginFields', fieldsSource], ['BrowserFieldOrigin', ruleSource]]) {
    assert.doesNotMatch(strip(text), /\bLog\.[vdiwe]\(|printStackTrace|System\.(?:out|err)|SharedPreferences|FileOutputStream/, name);
  }
  // The browser installs the adapter before any load and makes it the tab's only Autofill surface.
  assert.match(plugin, /t\.fields=BrowserLoginFields\.install\(t\.web,\(\)->fieldSnapshot\(t\),config\(\)\.autofillExtras\);\n\s*if\(t\.fields!=null\)t\.frame\.addView\(t\.fields\.anchor, new FrameLayout\.LayoutParams\(-1,-1\)\);/);
  assert.ok(plugin.indexOf('t.fields=BrowserLoginFields.install(') < plugin.indexOf('t.web.setWebViewClient(new WebViewClient() {'), 'installed before the tab can load');
  assert.match(plugin, /t\.web\.setImportantForAutofill\(t\.fields==null\?View\.IMPORTANT_FOR_AUTOFILL_YES:View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\);/);
  assert.match(plugin, /snapshot\.supported=t\.fields!=null&&!destroyed&&tabs\.get\(t\.id\)==t;\n\s*snapshot\.state=autofillState\(t\);snapshot\.navigation=t\.navigation;/);
  // Revocation: cancel (tab change, overlay, navigation, error, close) hides first; commit ends after Save values are taken.
  assert.match(plugin, /private void cancelAutofill\(Tab t\) \{\n\s*t\.autofillEnabled=false;(?:\n\s*\/\/[^\n]*)*\n\s*if\(t\.fields!=null\)t\.fields\.revoke\(true\);/);
  assert.match(plugin, /if\(manager!=null\)manager\.commit\(\);\n[^\n]*\n\s*if\(t\.fields!=null\)t\.fields\.revoke\(false\);/);
  assert.match(plugin, /else \{if\(t\.fields!=null\)t\.fields\.revoke\(true\);t\.web\.setImportantForAutofill\(View\.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS\);\}/);
  assert.match(plugin, /if\(t\.fields!=null\)\{t\.fields\.close\(\);/, 'closed with the tab');
  assert.match(plugin, /disableAutofill\(t\); if\(t\.fields!=null\)t\.fields\.close\(\);/, 'closed on renderer loss');
});

test('the injected reporter sends no origin and fills only its own registered fields', () => {
  const code = strip(reporterScript);
  assert.ok((code.match(/send\(`[^`]*`\)/g) || []).length >= 5, 'every report kind is checked');
  for (const send of code.match(/send\(`[^`]*`\)/g) || []) assert.doesNotMatch(send, /location|origin|href|document\.URL|top\b/, send);
  assert.match(code, /if \(!event\.isTrusted\) return;/, 'trusted events only');
  assert.match(code, /data\.d !== documentId \|\| data\.o !== location\.origin\) return;/);
  assert.match(code, /const channel = globalThis\.__elizaLoginFields;/);
  assert.doesNotMatch(code, /console\.|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|sendBeacon|postMessage\((?!message)/);
  assert.match(fieldsSource, /public static final String CHANNEL = "__elizaLoginFields";/);
});
