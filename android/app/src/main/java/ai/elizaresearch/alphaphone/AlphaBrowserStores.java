package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserAutofillExtras;
import ai.eliza.plugins.browsersurface.BrowserBookmarkStore;
import ai.eliza.plugins.browsersurface.BrowserSealedText;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;
import ai.eliza.plugins.browsersurface.BrowserTabHostConfig;
import ai.eliza.plugins.passwords.PasswordFormPolicy;
import ai.eliza.plugins.securestore.nativeonly.KeystoreTextFrame;
import ai.eliza.plugins.securestore.nativeonly.PasswordAutofillPolicy;
import android.content.Context;
import java.util.Set;

/**
 * Alpha's installed-data identifiers for the shared browser tab host and stores in
 * plugin-native-browser-surface: the WebView profiles, preferences files, activity-result keys and
 * Android Keystore aliases that earlier builds wrote, so website sign-ins, saved bookmarks, tabs,
 * history, downloads and site-permission decisions stay readable. The host, the stores, their
 * formats and their rules are upstream; see docs/browser-storage.md.
 */
final class AlphaBrowserStores {
 /** Alpha's own URL scheme: an intent: link may never carry it as data. */
 static final Set<String> HOST_SCHEMES=Set.of("alphaphone");
 /** Durable profile shared by every normal tab (P-04). */
 static final String PERSISTENT_PROFILE="alpha_browser_v1";
 /** Private tabs: alpha_private_<namespace>_<tab>, purged on close and at start. */
 static final String PRIVATE_PREFIX="alpha_private_";
 /** Builds before P-04 gave every tab an ephemeral profile; leftovers are purged at start. */
 static final String LEGACY_PREFIX="alpha_public_";
 /**
  * Derived names keep the installed files and keys: alpha-browser-downloads (download list),
  * alpha-browser-retired-profiles, alpha-browser-notices and the alpha-browser-* activity-result keys.
  */
 static final BrowserTabHostConfig IDENTITY=BrowserTabHostConfig.builder(PERSISTENT_PROFILE,PRIVATE_PREFIX,"alpha-browser")
  .legacyEphemeralPrefix(LEGACY_PREFIX)
  .names("Alpha Phone","Alpha","Alpha Browser")
  .hostScheme("alphaphone")
  // The integrated vault's per-field and top-level origin extras for engine-bound login fields.
  .autofillExtras(new BrowserAutofillExtras(PasswordAutofillPolicy.FIELD_ORIGIN,PasswordFormPolicy.TOP_ORIGIN_EXTRA))
  .allowLoopback(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)
  .debugLogging(BuildConfig.DEBUG)
  .logTag("AlphaBrowser")
  .build();
 static final String BOOKMARK_PREFERENCES="alpha-browser-bookmarks",BOOKMARK_KEY_ALIAS="alpha-browser-bookmarks-v1";
 static final String SESSION_PREFERENCES="alpha-browser-session",SESSION_KEY_ALIAS="alpha-browser-session-v1";
 private AlphaBrowserStores(){}
 static BrowserBookmarkStore bookmarks(Context context){
  return new BrowserBookmarkStore(context.getSharedPreferences(BOOKMARK_PREFERENCES,Context.MODE_PRIVATE),sealer(BOOKMARK_KEY_ALIAS,800000));
 }
 static BrowserSessionStore session(Context context){
  return new BrowserSessionStore(context.getSharedPreferences(SESSION_PREFERENCES,Context.MODE_PRIVATE),sealer(SESSION_KEY_ALIAS,2000000));
 }
 private static BrowserSealedText sealer(String alias,int maxBytes){
  KeystoreTextFrame frame=new KeystoreTextFrame(alias,maxBytes);
  return new BrowserSealedText(){
   @Override public String seal(String plain)throws Exception{return frame.seal(plain);}
   @Override public String open(String sealed)throws Exception{return frame.open(sealed);}
  };
 }
}
