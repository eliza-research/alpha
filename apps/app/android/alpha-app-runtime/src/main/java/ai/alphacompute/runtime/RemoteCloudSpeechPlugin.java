package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code ElizaCloudSpeech} Capacitor plugin delegating cloud speech streaming to AlphaCore. */
@CapacitorPlugin(name = "ElizaCloudSpeech")
public final class RemoteCloudSpeechPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "ElizaCloudSpeech"; }

    @PluginMethod public void prewarmCloudSpeech(PluginCall call) { forwardToCore(call, "prewarmCloudSpeech"); }
    @PluginMethod public void startCloudSpeech(PluginCall call) { forwardToCore(call, "startCloudSpeech"); }
    @PluginMethod public void stopCloudSpeech(PluginCall call) { forwardToCore(call, "stopCloudSpeech"); }
    @PluginMethod public void cancelCloudSpeech(PluginCall call) { forwardToCore(call, "cancelCloudSpeech"); }
    @PluginMethod public void speakCloudSpeech(PluginCall call) { forwardToCore(call, "speakCloudSpeech"); }
    @PluginMethod public void setCloudSpeechMuted(PluginCall call) { forwardToCore(call, "setCloudSpeechMuted"); }
    @PluginMethod public void setCloudSpeechOutputMuted(PluginCall call) { forwardToCore(call, "setCloudSpeechOutputMuted"); }
    @Override @PluginMethod public void requestPermissions(PluginCall call) { forwardToCore(call, "requestPermissions"); }
}
