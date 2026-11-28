package ai.alphacompute.runtime;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Local {@code ElizaNetworkPolicy} plugin surfacing metered-network hints for Wi-Fi-aware model downloads. */
@CapacitorPlugin(name = "ElizaNetworkPolicy")
public final class RemoteNetworkPolicyPlugin extends Plugin {
    @PluginMethod public void getMeteredHint(PluginCall call) {
        call.resolve(readHints());
    }

    @PluginMethod public void getPathHints(PluginCall call) {
        call.resolve(readHints());
    }

    private JSObject readHints() {
        JSObject out = new JSObject();
        ConnectivityManager connectivity = getContext().getSystemService(ConnectivityManager.class);
        if (connectivity == null) {
            out.put("metered", false);
            out.put("expensive", false);
            out.put("constrained", false);
            out.put("transport", "unknown");
            return out;
        }
        boolean metered = false;
        String transport = "none";
        try {
            metered = connectivity.isActiveNetworkMetered();
            Network active = connectivity.getActiveNetwork();
            NetworkCapabilities caps = active == null ? null : connectivity.getNetworkCapabilities(active);
            if (caps != null) {
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transport = "wifi";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transport = "ethernet";
                else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transport = "cellular";
                else transport = "other";
            }
        } catch (SecurityException unavailable) {
            transport = "unknown";
        }
        out.put("metered", metered);
        out.put("expensive", metered || "cellular".equals(transport));
        out.put("constrained", false);
        out.put("transport", transport);
        return out;
    }
}
