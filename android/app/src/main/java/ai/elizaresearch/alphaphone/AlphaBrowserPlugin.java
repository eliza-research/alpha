package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserBookmarkStore;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;
import ai.eliza.plugins.browsersurface.BrowserTabHostConfig;
import ai.eliza.plugins.browsersurface.BrowserTabHostPlugin;
import android.content.Context;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Alpha's browser: the shared native tab host (plugin-native-browser-surface) under Alpha's
 * Capacitor name, with Alpha's installed identity and stores (AlphaBrowserStores) and its speech
 * plugin as the reviewed-reading speech route. The tab model, profiles, pop-ups, app links,
 * clearing, find, reading and autofill binding are upstream; see docs/browser-storage.md.
 */
@CapacitorPlugin(name = "AlphaBrowser")
public class AlphaBrowserPlugin extends BrowserTabHostPlugin {
 /** Durable profile shared by every normal tab. Never "Default" (the host's). */
 static final String PERSISTENT_PROFILE = AlphaBrowserStores.PERSISTENT_PROFILE;
 static final String PRIVATE_PREFIX = AlphaBrowserStores.PRIVATE_PREFIX;
 /** Builds before the sign-in decision gave every tab an ephemeral profile. */
 static final String LEGACY_PREFIX = AlphaBrowserStores.LEGACY_PREFIX;
 static boolean ephemeralProfile(String name) { return AlphaBrowserStores.IDENTITY.ephemeral(name); }
 @Override protected BrowserTabHostConfig tabHostConfig() { return AlphaBrowserStores.IDENTITY; }
 @Override protected BrowserBookmarkStore openBookmarkStore(Context context) { return AlphaBrowserStores.bookmarks(context); }
 @Override protected BrowserSessionStore openSessionStore(Context context) { return AlphaBrowserStores.session(context); }
 /** A reviewed reading ended: stop its speech request, which only Alpha's voice plugin holds. */
 @Override protected void cancelReadingSpeech(String requestId) {
  com.getcapacitor.PluginHandle handle=getBridge().getPlugin("AlphaVoiceCloud");
  if(handle!=null&&handle.getInstance() instanceof AlphaVoiceCloudPlugin)((AlphaVoiceCloudPlugin)handle.getInstance()).cancelBrowserSpeech(requestId);
 }
}
