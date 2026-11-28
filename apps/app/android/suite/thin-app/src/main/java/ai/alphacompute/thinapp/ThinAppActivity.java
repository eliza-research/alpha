package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import com.getcapacitor.Plugin;

/** Thin standalone Alpha app activity binding a single Alpha view flavor and its native plugins to {@link AlphaBaseActivity}. */
public final class ThinAppActivity extends AlphaBaseActivity {
    @Override protected String alphaAppId() {
        return BuildConfig.ALPHA_APP_ID;
    }

    @Override protected String alphaViewName() {
        return BuildConfig.ALPHA_VIEW;
    }

    @Override protected String alphaSurfaceMode() {
        return BuildConfig.ALPHA_SURFACE;
    }

    @Override protected void registerAppPlugins() {
        FlavorPlugins.register(this);
    }

    void registerThinPlugin(Class<? extends Plugin> pluginClass) {
        registerPlugin(pluginClass);
    }
}
