import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source-level guards for the native browser's download, permission, HTTP
// authentication, find-in-page and fullscreen contracts. Behaviour is exercised
// on Android by BrowserWebFeaturesInstrumentedTest; these keep the privacy
// invariants from regressing between device runs.
const read = file => fs.readFileSync(file, 'utf8');
const dir = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
// Downloads, blob capture and their list come from the reviewed pin (plugin-native-browser-surface),
// staged into the app by scripts/stage-local-agent-sources.mjs.
const shared = 'vendor/eliza/plugins/plugin-native-browser-surface/android/src/main/java/ai/eliza/plugins/browsersurface/';
// The tab host itself is shared too; AlphaBrowserPlugin names it and AlphaBrowserStores keeps Alpha's identity.
const plugin = read(shared + 'BrowserTabHostPlugin.java');
const alphaPlugin = read(dir + 'AlphaBrowserPlugin.java');
const downloads = read(shared + 'BrowserDownloads.java');
const capture = read(shared + 'BrowserBlobCapture.java');
const downloadPolicy = read(shared + 'BrowserDownloadPolicy.java');
const store = read(shared + 'BrowserSessionStore.java');
const prompt = read(shared + 'BrowserSitePrompt.java');
const stores = read(dir + 'AlphaBrowserStores.java');
const adapter = read('apps/app/src/prototype/browser-adapter.ts');

test('private-tab downloads never reach the persisted download list', () => {
  assert.match(downloads, /private void persist\(\) \{[\s\S]{0,200}for \(BrowserDownloadPolicy\.Entry entry : history\.persistable\(\)\)/);
  assert.match(downloadPolicy, /if \(!entry\.ephemeral && !entry\.running\)\s*out\.add\(entry\);/, 'private and running entries are never persisted');
  assert.match(downloads, /if \(id == 0 \|\| item\.optBoolean\("private", false\) \|\| item\.optBoolean\("running", false\)\)\s*continue;/, 'a stale private row is never restored');
  assert.match(downloads, /return new BrowserDownloadPolicy\.Entry\(id, name, origin, source\.priv, source\.priv \? source\.tab : null\);/);
  assert.match(downloads, /Private tab: the file stays in Downloads after you close this tab/);
  assert.match(plugin, /if\(t\.priv\)downloads\.forgetPrivate\(t\.id\);/, 'closing a private tab forgets its entries');
  assert.match(plugin, /sessionStore\.clear\(\);sessionStore\.clearPermissions\(\);downloads\.clearHistory\(\);/, 'Clear browsing data clears downloads and permissions');
  assert.match(plugin, /downloads\.clearSite\(cleared\);/, 'Clear data for this site clears its downloads');
  // The installed list keeps its preference file, so existing download history survives the move upstream:
  // the shared host derives alpha-browser-downloads from Alpha's storage prefix (BrowserTabHostConfigTest).
  assert.match(stores, /BrowserTabHostConfig\.builder\(PERSISTENT_PROFILE,PRIVATE_PREFIX,"alpha-browser"\)/);
  assert.doesNotMatch(stores, /\.downloadPreferences\(/, 'the derived name is the installed one');
  assert.match(plugin, /new BrowserDownloads\(getActivity\(\),new BrowserDownloads\.Config\(identity\.downloadPreferences,identity\.allowLoopback\)\)/, 'loopback downloads only when the host allows loopback');
  assert.match(stores, /\.allowLoopback\(BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)/, 'Alpha allows loopback only in test-mocks builds');
});

test('download cookies come only from the requesting tab, for its exact origin', () => {
  assert.match(downloadPolicy, /String target = BrowserWebOrigin\.of\(downloadUrl\);\s*return target != null && target\.equals\(BrowserWebOrigin\.of\(pageOrigin\)\);/);
  assert.match(downloads, /boolean signedIn = BrowserDownloadPolicy\.cookieAllowed\(raw, source\.pageOrigin, true\);/);
  assert.match(downloads, /if \(signedIn\) \{\s*String cookie = source\.cookies == null \? null : source\.cookies\.get\(\);/, 'the cookie is read at confirmation');
  assert.match(plugin, /if\(t\.dead\|\|tabs\.get\(t\.id\)!=t\)return null;\n\s*try\{return WebViewCompat\.getProfile\(t\.web\)\.getCookieManager\(\)\.getCookie\(url\);/, 'a closed tab supplies no cookie; the tab profile is used');
  assert.doesNotMatch(downloads, /CookieManager\.getInstance\(\)/, 'never the host/default profile cookie jar');
  // DownloadManager would replay a Cookie header to redirect targets and keep it in Android's download database.
  assert.doesNotMatch(downloads, /addRequestHeader\("Cookie"/, 'DownloadManager never receives the sign-in cookie');
  assert.match(downloads, /fetchSignedIn\(raw, name, mime, origin, source, cookie\)/, 'signed-in downloads are fetched by the app');
  assert.match(downloads, /connection\.setInstanceFollowRedirects\(false\)/, 'redirects are followed manually');
  assert.match(downloads, /if \(BrowserDownloadPolicy\.cookieAllowed\(url\.toString\(\), pageOrigin, true\)\)\s*connection\.setRequestProperty\("Cookie", cookie\);/, 'each hop gets the cookie only for the exact page origin');
  assert.match(downloads, /if \(!allowed\(Uri\.parse\(next\.toString\(\)\)\)\)\s*throw new Refused/, 'a redirect to a non-HTTPS address is refused');
  // Closing a private tab, Clear browsing data and Clear data for this site stop an unfinished
  // signed-in fetch, so its copied cookie is never sent on a later redirect hop.
  assert.match(downloads, /for \(BrowserDownloadPolicy\.Entry entry : removed\)\s*if \(entry\.id < 0 && entry\.running\)\s*cancelled\.add\(entry\.id\);/);
  for (const method of ['public void forgetPrivate(String tab) {\n    boolean changed = removeEntries(', 'public void clearHistory() {\n    removeEntries(', 'boolean changed = removeEntries(entry -> BrowserWebOrigin.withinSite(']) assert.ok(downloads.includes(method), method);
  assert.doesNotMatch(downloads, /history\.clear\(\)|history\.forgetEphemeralTab|history\.clearSite/, 'every bulk removal goes through removeEntries');
});

test('page-created files are captured in an isolated world and saved only after review', () => {
  assert.match(capture, /WORLD = "eliza-browser-capture-v1"/);
  assert.match(capture, /WebViewCompat\.getExecutionWorld\(web, WORLD\)/);
  assert.doesNotMatch(downloads + capture + plugin, /addJavascriptInterface|PAGE_WORLD/);
  assert.doesNotMatch(capture, /executeJavaScript|evaluateJavascript/, 'the capture script is fixed; native code only posts the blob address');
  assert.match(capture, /if \(nonce == null \|\| reply != proxy \|\| !sender\.equals\(proxyOrigin\)\)\s*return;/, 'only the started capture, from its own document, is accepted');
  assert.match(capture, /if \(owner == null \|\| !owner\.equals\(actual\)/, 'blob URL origin must equal the page origin');
  assert.match(downloadPolicy, /MAX_CAPTURE = 64L \* 1024 \* 1024/);
  assert.match(downloads, /finally \{\s*file\.delete\(\);\s*\}/, 'the app-owned capture is removed after saving');
  assert.match(plugin, /t\.capture=new BrowserBlobCapture\(t\.web,downloads\.captureDirectory\(\)\);/);
});

test('the instrumented witnesses read the shared download list and name the shared isolated-world channels', () => {
  // BrowserWebFeaturesInstrumentedTest reads private native state by reflection and probes the page
  // world for channel names. A field or channel renamed upstream would otherwise fail only on a
  // device, or let the page-world check pass without testing anything.
  const instrumented = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/BrowserWebFeaturesInstrumentedTest.java');
  const login = read(shared + 'BrowserLoginFields.java');
  assert.match(plugin, /private BrowserDownloads downloads;/);
  assert.match(downloads, /private final BrowserDownloadPolicy\.History history = new BrowserDownloadPolicy\.History\(\);/);
  assert.match(instrumented, /\(BrowserDownloadPolicy\.History\)field\(downloads,"history"\)\)\.all\(\)/);
  assert.doesNotMatch(instrumented, /field\(downloads,"owned"\)/, 'the former JSON map is gone');
  const channels = [/CHANNEL = "(__\w+)"/.exec(capture)?.[1], /CHANNEL = "(__\w+)"/.exec(login)?.[1]];
  assert.deepEqual(channels, ['__elizaBrowserCapture', '__elizaLoginFields']);
  const probe = /Child page retains no app bridge","true",browser\.child\("([^"]+)"\)/.exec(instrumented)?.[1] ?? '';
  for (const channel of channels) assert.ok(probe.includes(`typeof ${channel}==='undefined'`), `the page world is probed for ${channel}`);
  assert.doesNotMatch(probe, /__alpha(?:BrowserCapture|LoginFields)/, 'no retired channel name');
});

test('site permissions are origin-bound prompts, stored only for normal tabs and never retained by WebView', () => {
  assert.doesNotMatch(plugin, /onPermissionRequest\(PermissionRequest request\) \{ request\.deny\(\); \}/);
  assert.match(plugin, /BrowserSitePrompt\.plan\(origin,kinds,promptable\(t\),t\.priv,this::grantable,sessionStore::permission\)/, 'the shared plan gets the shown-page gate, the private flag and the stored decisions');
  assert.match(prompt, /if \(!promptable \|\| origin == null \|\| kinds == null\)\s*return new Plan/, 'a stored Allow is used only by the selected, shown page');
  assert.match(prompt, /if \(!ephemeral\)\s*try \{\s*decision = stored\.apply/, 'private tabs never read decisions');
  assert.equal((plugin.match(/if\(!t\.priv\)for\(String kind:plan\.asked\)try\{sessionStore\.setPermission/g) || []).length, 2, 'private tabs never store decisions');
  assert.match(plugin, /callback\.invoke\(requested,granted\.contains\("location"\),false\)/, 'WebView never retains a geolocation grant');
  assert.match(plugin, /BrowserSitePrompt\.origin\(t\.lastCommittedUrl,t\.web\.getUrl\(\),requested,config\(\)\.allowLoopback\)/, 'local test hosts only in developer builds');
  assert.match(prompt, /if \(page == null \|\| !page\.equals\(asked\) \|\| !page\.equals\(BrowserWebOrigin\.of\(currentUrl\)\)\)/, 'embedded cross-origin requests are refused; same-document navigations keep the page origin');
  assert.match(plugin, /runtimePermissions\.launch\(missing\.toArray/, 'chained to the Android runtime permission');
  assert.match(plugin, /if\(!t\.priv\)try\{sessionStore\.clearPermissionsForSite\(cleared\);\}/);
  assert.match(store, /sealer\.seal\(bounded\)/, 'decisions are sealed by the host');
  assert.match(stores, /SESSION_PREFERENCES="alpha-browser-session",SESSION_KEY_ALIAS="alpha-browser-session-v1"/, 'installed records keep their file and Keystore key');
});

test('HTTP authentication is a native prompt for the page host over a secure connection only', () => {
  assert.doesNotMatch(plugin, /HTTP authentication\), which is not supported/);
  assert.match(plugin, /if\(!secureAuthPage\(page\)\)\{handler\.cancel\(\);fail\(t,"This site asks for a password over an insecure connection/);
  // The challenge has no URL: both the shown page and the pending main-frame request are checked.
  assert.match(plugin, /for\(String candidate:new String\[\]\{t\.url,t\.pendingMain\}\)/);
  assert.match(plugin, /if \(r\.isForMainFrame\(\)\) t\.pendingMain=r\.getUrl\(\)\.toString\(\);/, 'every main-frame request is recorded');
  assert.match(plugin, /if \(r\.isForMainFrame\(\)\) t\.pendingMain=target;/, 'main-frame redirects are recorded');
  assert.match(plugin, /if\(!matched\)\{handler\.cancel\(\);notice\(t,"Blocked a sign-in prompt from a different site\."\);return;\}/);
  assert.match(plugin, /"\\n"\+config\(\)\.hostName\+"'s browser does not keep this password\."\+managerLine\+/);
  assert.match(stores, /\.names\("Alpha Phone","Alpha","Alpha Browser"\)/, 'the prompts name Alpha');
  assert.match(plugin, /String managerLine=authOrigin==null\?"\\n"\+authDecision\.refusal:!autofillOn\?"":autofillState\.hasEnabledAutofillServices\(\)\?" "\+config\(\)\.hostName\+"'s password manager can fill it, and offer to save it after the site accepts it, for "\+authOrigin\+"\.":" If your password manager supports this browser, it can fill or save it for "\+authOrigin\+"\.";/, 'provider wording depends on an enabled service; an unbound prompt states why fill is off');
  assert.doesNotMatch(plugin, /setHttpAuthUsernamePassword|useHttpAuthUsernamePassword/, 'nothing is stored or reused');
});

test('find-in-page clears on navigation and tab change; fullscreen exits with Back', () => {
  assert.match(plugin, /t\.web\.setFindListener\(\(ordinal,count,done\)->findResult\(t,ordinal,count,done\)\);/);
  assert.match(plugin, /if\(t\.capture!=null\)t\.capture\.cancel\(\);\n  clearFind\(t\);/, 'navigation clears find and cancels a capture');
  assert.match(plugin, /disableAutofill\(old\);clearFind\(old\);/, 'tab switch clears find');
  assert.match(plugin, /new OnBackPressedCallback\(true\)\{@Override public void handleOnBackPressed\(\)\{exitFullscreen\(true\);\}\}/);
  assert.match(plugin, /if\(customView!=null\|\|!promptable\(t\)\)\{callback\.onCustomViewHidden\(\);return;\}/);
  for (const binding of ["openFind:", "find:{query:", "next:()=>findStep(true)", "prev:()=>findStep(false)", "close:()=>closeFind()"]) assert.ok(adapter.includes(binding), binding);
  assert.match(adapter, /if \(s\.finding\) \{ closeFind\(\); return true; \}/, 'Back closes the find bar first');
});

test('passkeys stay disabled and the native browser offers an honest external remedy', () => {
  assert.match(plugin, /t\.passkeys=false;/);
  assert.doesNotMatch(plugin, /(?:get|set)WebAuthenticationSupport\(/, 'fresh WebView defaults stay disabled without entering the compat converter');
  assert.doesNotMatch(plugin, /WEB_AUTHENTICATION_SUPPORT_FOR_(?:APP|BROWSER)/);
  assert.match(plugin, /"Passkeys are not supported in "\+config\(\)\.browserName\+"\./);
});

test('a page-initiated navigation commits the selected tab autofill session so the provider can offer Save', () => {
  assert.match(plugin, /if\(startedCallback&&t\.autofillEnabled&&!paused&&Objects\.equals\(presentedId,t\.id\)\)commitAutofill\(t\);\n\s*else disableAutofill\(t\);/);
  assert.match(plugin, /private void commitAutofill\(Tab t\) \{\n\s*t\.autofillEnabled=false;\n\s*AutofillManager manager=getActivity\(\)\.getSystemService\(AutofillManager\.class\);\n\s*if\(manager!=null\)manager\.commit\(\);/);
  assert.equal((plugin.match(/commitAutofill\(/g) || []).length, 2, 'commit is used only on page-started navigation; overlays, pause and tab changes cancel');
  const fill = read('android/app/src/androidTest/java/ai/elizaresearch/alphaphone/PasswordBrowserFillInstrumentedTest.java');
  assert.match(fill, /ai\.eliza\.plugins\.passwords\.ElizaPasswordAutofillService/);
  assert.match(fill, /No password offer for a cross-origin iframe/);
  assert.match(fill, /event\.preventDefault\(\);location\.href=/, 'the synthetic sign-in never submits its fields to the network');
});

// The executable cross-site iframe contract lives in BrowserCookiePolicyInstrumentedTest.
test('P-19 changes only child-tab third-party policy after assigning an isolated profile', () => {
  assert.match(plugin, /WebViewCompat\.setProfile\(t\.web, t\.profile\)/);
  assert.match(plugin, /setAcceptThirdPartyCookies\(t\.web, !priv\)/);
  assert.doesNotMatch(plugin, /setAcceptCookie\(/, 'never change the process-wide first-party policy');
  assert.ok(plugin.indexOf('WebViewCompat.setProfile(t.web, t.profile)') < plugin.indexOf('setAcceptThirdPartyCookies(t.web, !priv)'));
  assert.match(plugin, /priv \? config\(\)\.privateProfile\(namespace, id\) : config\(\)\.persistentProfile/);
  assert.match(stores, /PERSISTENT_PROFILE="alpha_browser_v1"/, 'normal tabs keep the installed sign-in profile');
});
