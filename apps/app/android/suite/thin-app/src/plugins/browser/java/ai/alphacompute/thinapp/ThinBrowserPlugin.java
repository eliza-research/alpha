package ai.alphacompute.thinapp;

import ai.eliza.plugins.browsersurface.BrowserAutofillExtras;
import ai.eliza.plugins.browsersurface.BrowserBookmarkStore;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;
import ai.eliza.plugins.browsersurface.BrowserTabHostConfig;
import ai.eliza.plugins.browsersurface.BrowserTabHostPlugin;
import android.content.Context;
import android.os.Build;
import androidx.annotation.RequiresApi;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Standalone {@code AlphaBrowser} tab host wrapping eliza's shared {@link BrowserTabHostPlugin}. */
@RequiresApi(Build.VERSION_CODES.Q)
@CapacitorPlugin(name = "AlphaBrowser")
public final class ThinBrowserPlugin extends BrowserTabHostPlugin {
    private static final String BOOKMARK_PREFERENCES = "alpha-browser-bookmarks";
    private static final String BOOKMARK_KEY_ALIAS = "alpha-browser-bookmarks-v1";
    private static final String SESSION_PREFERENCES = "alpha-browser-session";
    private static final String SESSION_KEY_ALIAS = "alpha-browser-session-v1";

    private static final BrowserTabHostConfig IDENTITY = BrowserTabHostConfig
        .builder("alpha_browser_v1", "alpha_private_", "alpha-browser")
        .names("Alpha Phone", "Alpha", "Alpha Browser")
        .hostScheme("alphaphone")
        .appLinks(true)
        .autofillExtras(BrowserAutofillExtras.ELIZA_PASSWORDS)
        .debugLogging(BuildConfig.DEBUG)
        .logTag("AlphaBrowser")
        .build();

    @Override protected BrowserTabHostConfig tabHostConfig() {
        return IDENTITY;
    }

    @Override protected BrowserBookmarkStore openBookmarkStore(Context context) {
        return new BrowserBookmarkStore(
            context.getSharedPreferences(BOOKMARK_PREFERENCES, Context.MODE_PRIVATE),
            new KeystoreSealedText(BOOKMARK_KEY_ALIAS, 800_000)
        );
    }

    @Override protected BrowserSessionStore openSessionStore(Context context) {
        return new BrowserSessionStore(
            context.getSharedPreferences(SESSION_PREFERENCES, Context.MODE_PRIVATE),
            new KeystoreSealedText(SESSION_KEY_ALIAS, 2_000_000)
        );
    }

    @PluginMethod public void setDesktopSite(PluginCall call) {
        call.resolve(new JSObject().put("desktop", Boolean.TRUE.equals(call.getBoolean("enabled", false))));
    }

    @PluginMethod public void pageContext(PluginCall call) {
        call.resolve(new JSObject().put("withheld", "unreadable"));
    }

    @PluginMethod public void openFailedPage(PluginCall call) {
        openExternalBrowser(call);
    }
}
