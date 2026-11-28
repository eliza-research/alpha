package ai.alphacompute.alphaphone.ipc;

import ai.alphacompute.ipc.AlphaSuitePolicy;
import android.content.Context;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Loads the compiled {@code alpha-suite-policy.json} asset when present, falling back to {@link AlphaSuitePolicy#defaults()}. */
public final class AlphaSuitePolicyLoader {
    private static final String TAG = "AlphaSuitePolicy";
    private static final String POLICY_ASSET = "alpha-suite-policy.json";
    private static final int MAX_POLICY_BYTES = 256 * 1024;
    private static volatile AlphaSuitePolicy cached;

    private AlphaSuitePolicyLoader() {}

    /** Returns the cached suite policy loaded from bundled assets, or {@link AlphaSuitePolicy#defaults()}. */
    public static AlphaSuitePolicy load(Context context) {
        AlphaSuitePolicy current = cached;
        if (current != null) return current;
        synchronized (AlphaSuitePolicyLoader.class) {
            if (cached != null) return cached;
            cached = readFromAssetsOrDefault(context);
            return cached;
        }
    }

    private static AlphaSuitePolicy readFromAssetsOrDefault(Context context) {
        if (context == null) return AlphaSuitePolicy.defaults();
        try (InputStream in = context.getAssets().open(POLICY_ASSET)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int total = 0;
            for (int read; (read = in.read(buf)) != -1; ) {
                total += read;
                if (total > MAX_POLICY_BYTES) {
                    Log.w(TAG, "Bundled suite policy exceeded byte budget; using defaults");
                    return AlphaSuitePolicy.defaults();
                }
                out.write(buf, 0, read);
            }
            return AlphaSuitePolicy.fromJson(out.toString(StandardCharsets.UTF_8.name()));
        } catch (IOException | RuntimeException absent) {
            return AlphaSuitePolicy.defaults();
        }
    }
}
