import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Source-level guards for the native browser's download, permission, HTTP
// authentication, find-in-page and fullscreen contracts. Behaviour is exercised
// on Android by BrowserWebFeaturesInstrumentedTest; these keep the privacy
// invariants from regressing between device runs.
const read = file => fs.readFileSync(file, 'utf8');
const dir = 'android/app/src/main/java/ai/elizaresearch/alphaphone/';
const plugin = read(dir + 'AlphaBrowserPlugin.java');
const downloads = read(dir + 'BrowserDownloads.java');
const store = read(dir + 'BrowserSessionStore.java');
const adapter = read('apps/app/src/prototype/browser-adapter.ts');

test('private-tab downloads never reach the persisted download list', () => {
  assert.match(downloads, /private void persist\(\)\{[^\n]*if\(!item\.optBoolean\("private",false\)&&[^\n]*\)records\.put\(item\)/);
  assert.match(downloads, /if\(id!=0&&!item\.optBoolean\("private",false\)&&[^\n]*\)owned\.put\(id,item\)/, 'a stale private row is never restored');
  assert.match(downloads, /if\(source\.priv\)\{item\.put\("private",true\);item\.put\("tab",source\.tab\);\}/);
  assert.match(downloads, /Private tab: the file stays in Downloads after you close this tab/);
  assert.match(plugin, /if\(t\.priv\)downloads\.forgetPrivate\(t\.id\);/, 'closing a private tab forgets its entries');
  assert.match(plugin, /sessionStore\.clear\(\);sessionStore\.clearPermissions\(\);downloads\.clearHistory\(\);/, 'Clear browsing data clears downloads and permissions');
  assert.match(plugin, /downloads\.clearSite\(cleared\);/, 'Clear data for this site clears its downloads');
});

test('download cookies come only from the requesting tab, for its exact origin', () => {
  assert.match(downloads, /static boolean cookieAllowed\(String download,String pageOrigin\)\{String target=origin\(download\);return target!=null&&pageOrigin!=null&&target\.equals\(pageOrigin\);\}/);
  assert.match(downloads, /if\(signedIn\)\{String cookie=source\.cookies==null\?null:source\.cookies\.get\(\);/, 'the cookie is read at confirmation');
  assert.match(plugin, /if\(t\.dead\|\|tabs\.get\(t\.id\)!=t\)return null;\n\s*try\{return WebViewCompat\.getProfile\(t\.web\)\.getCookieManager\(\)\.getCookie\(url\);/, 'a closed tab supplies no cookie; the tab profile is used');
  assert.doesNotMatch(downloads, /CookieManager\.getInstance\(\)/, 'never the host/default profile cookie jar');
  // DownloadManager would replay a Cookie header to redirect targets and keep it in Android's download database.
  assert.doesNotMatch(downloads, /addRequestHeader\("Cookie"/, 'DownloadManager never receives the sign-in cookie');
  assert.match(downloads, /fetchSignedIn\(raw,name,mime,origin,source,cookie\)/, 'signed-in downloads are fetched by the app');
  assert.match(downloads, /connection\.setInstanceFollowRedirects\(false\)/, 'redirects are followed manually');
  assert.match(downloads, /if\(cookieAllowed\(url\.toString\(\),pageOrigin\)\)connection\.setRequestProperty\("Cookie",cookie\);/, 'each hop gets the cookie only for the exact page origin');
  assert.match(downloads, /if\(!allowed\(Uri\.parse\(next\.toString\(\)\)\)\)throw new Refused/, 'a redirect to a non-HTTPS address is refused');
  assert.match(downloads, /!item\.optBoolean\("private",false\)&&!item\.optBoolean\("running",false\)\)records\.put\(item\)/, 'running entries are never persisted');
  // Closing a private tab, Clear browsing data and Clear data for this site stop an unfinished
  // signed-in fetch, so its copied cookie is never sent on a later redirect hop.
  assert.match(downloads, /if\(entry\.getKey\(\)<0&&entry\.getValue\(\)\.optBoolean\("running",false\)\)cancelled\.add\(entry\.getKey\(\)\);/);
  for (const method of ['void forgetPrivate(String tab){boolean changed=removeEntries(', 'void clearHistory(){removeEntries(', 'boolean changed=removeEntries(item->{String host=']) assert.ok(downloads.includes(method), method);
  assert.doesNotMatch(downloads, /owned\.clear\(\)|owned\.values\(\)\.removeIf/, 'every bulk removal goes through removeEntries');
});

test('page-created files are captured in an isolated world and saved only after review', () => {
  assert.match(downloads, /getExecutionWorld\(web,"alpha-browser-capture-v1"\)/);
  assert.doesNotMatch(downloads + plugin, /addJavascriptInterface|PAGE_WORLD/);
  assert.match(downloads, /if\(nonce==null\|\|reply!=proxy\|\|!sender\.equals\(proxyOrigin\)\)return;/, 'only the started capture, from its own document, is accepted');
  assert.match(downloads, /if\(owner==null\|\|!owner\.equals\(actual\)/, 'blob URL origin must equal the page origin');
  assert.match(downloads, /MAX_CAPTURE=64L\*1024\*1024/);
  assert.match(downloads, /finally\{file\.delete\(\);\}/, 'the app-owned capture is removed after saving');
});

test('site permissions are origin-bound prompts, stored only for normal tabs and never retained by WebView', () => {
  assert.doesNotMatch(plugin, /onPermissionRequest\(PermissionRequest request\) \{ request\.deny\(\); \}/);
  assert.match(plugin, /if\(!t\.priv\)try\{stored=sessionStore\.permission\(origin,kind\);\}/, 'private tabs never read decisions');
  assert.match(plugin, /if\(!promptable\(t\)\)\{result\.accept\(Collections\.emptySet\(\)\);return;\}\n  for\(String kind:kinds\)/, 'a stored Allow is used only by the selected, shown page');
  assert.equal((plugin.match(/if\(!t\.priv\)for\(String kind:wanted\)try\{sessionStore\.setPermission/g) || []).length, 2, 'private tabs never store decisions');
  assert.match(plugin, /callback\.invoke\(requested,granted\.contains\("location"\),false\)/, 'WebView never retains a geolocation grant');
  assert.match(plugin, /if\(page==null\|\|!page\.equals\(asked\)/, 'embedded cross-origin requests are refused');
  assert.match(plugin, /!page\.equals\(BrowserDownloads\.origin\(t\.web\.getUrl\(\)\)\)\)return null;/, 'same-document navigations (pushState, fragments) keep the page origin');
  assert.match(plugin, /runtimePermissions\.launch\(missing\.toArray/, 'chained to the Android runtime permission');
  assert.match(plugin, /if\(!t\.priv\)try\{sessionStore\.clearPermissionsForSite\(cleared\);\}/);
  // Eliza owns the record format; Alpha owns which preference is unsealed and resealed.
  assert.match(store, /getString\("permissions",null\)/);
  assert.match(store, /BrowserSitePermissionRecord\.read\(frame\.open\(packed\)\)/);
  assert.match(store, /String bounded=BrowserSitePermissionRecord\.write\(decisions\);\s*if\(!preferences\.edit\(\)\.putString\("permissions",frame\.seal\(bounded\)\)/);
});

test('HTTP authentication is a native prompt for the page host over a secure connection only', () => {
  assert.doesNotMatch(plugin, /HTTP authentication\), which is not supported/);
  assert.match(plugin, /if\(!secureAuthPage\(page\)\)\{handler\.cancel\(\);fail\(t,"This site asks for a password over an insecure connection/);
  // The challenge has no URL: both the shown page and the pending main-frame request are checked.
  assert.match(plugin, /for\(String candidate:new String\[\]\{t\.url,t\.pendingMain\}\)/);
  assert.match(plugin, /if \(r\.isForMainFrame\(\)\) t\.pendingMain=r\.getUrl\(\)\.toString\(\);/, 'every main-frame request is recorded');
  assert.match(plugin, /if \(r\.isForMainFrame\(\)\) t\.pendingMain=target;/, 'main-frame redirects are recorded');
  assert.match(plugin, /if\(!matched\)\{handler\.cancel\(\);notice\(t,"Blocked a sign-in prompt from a different site\."\);return;\}/);
  assert.match(plugin, /"\\nAlpha's browser does not keep this password\."\+managerLine\+/);
  assert.match(plugin, /String managerLine=authOrigin==null\?"\\n"\+authDecision\.refusal:!autofillOn\?"":autofillState\.hasEnabledAutofillServices\(\)\?" Alpha's password manager can fill it, and offer to save it after the site accepts it, for "\+authOrigin\+"\.":" If your password manager supports this browser, it can fill or save it for "\+authOrigin\+"\.";/, 'provider wording depends on an enabled service; an unbound prompt states why fill is off');
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
  assert.match(plugin, /WebSettingsCompat\.setWebAuthenticationSupport\(settings,WebSettingsCompat\.WEB_AUTHENTICATION_SUPPORT_NONE\)/);
  assert.doesNotMatch(plugin, /WEB_AUTHENTICATION_SUPPORT_FOR_BROWSER/);
  assert.match(plugin, /Passkeys are not supported in Alpha Browser\./);
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
  assert.match(plugin, /priv \? namespace \+ "_" \+ id : PERSISTENT_PROFILE/);
});
