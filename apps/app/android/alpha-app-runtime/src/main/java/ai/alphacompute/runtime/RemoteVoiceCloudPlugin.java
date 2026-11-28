package ai.alphacompute.runtime;

import ai.alphacompute.ipc.IAlphaEventCallback;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import android.os.Handler;
import android.os.Looper;
import android.os.RemoteException;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Core-proxied {@code AlphaVoiceCloud} plugin forwarding local speech bridge methods and relaying speech events from AlphaCore. */
@CapacitorPlugin(name = "AlphaVoiceCloud")
public final class RemoteVoiceCloudPlugin extends CorePluginProxy {
    private static final Set<String> DIRECT_SPEECH_EVENTS = Set.of(
        "playbackEnded",
        "playbackFailed",
        "playbackStopped",
        "liveCapture",
        "liveCaptureEnded",
        "liveCaptureTranscript",
        "speechStatus"
    );

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean observerRegistered = new AtomicBoolean(false);
    private volatile boolean destroyed;

    private final IAlphaEventCallback.Stub speechObserver = new IAlphaEventCallback.Stub() {
        @Override public void onEvent(String subId, long index, String eventJson) {
            if (destroyed || subId == null || subId.isBlank()) return;
            if ("speechEvent".equals(subId)) {
                relayWrappedSpeechEvent(eventJson);
                return;
            }
            if (!DIRECT_SPEECH_EVENTS.contains(subId)) return;
            postSpeechEvent(subId, parseJsonObject(eventJson));
        }

        @Override public void onEnd(String subId, String kind, String failCode) {
            observerRegistered.set(false);
        }
    };

    @Override protected String corePluginName() { return "AlphaVoiceCloud"; }

    @Override public void load() {
        super.load();
        registerObserverAsync();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (observerRegistered.compareAndSet(true, false)) {
            IAlphaPlatformBroker broker = connectBroker(300L);
            if (broker != null) {
                try {
                    broker.unregisterSignInObserver(speechObserver);
                } catch (RemoteException | SecurityException ignored) {
                }
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod public void dictationForeground(PluginCall call) { forwardSpeech(call, "dictationForeground"); }
    @PluginMethod public void synthesizeLocalBrowserReading(PluginCall call) { forwardSpeech(call, "synthesizeLocalBrowserReading"); }
    @PluginMethod public void transcribeLocalRecording(PluginCall call) { forwardSpeech(call, "transcribeLocalRecording"); }
    @PluginMethod public void transcribeSavedNote(PluginCall call) { forwardSpeech(call, "transcribeSavedNote"); }
    @PluginMethod public void transcribeVoicemail(PluginCall call) { forwardSpeech(call, "transcribeVoicemail"); }
    @PluginMethod public void cancelVoicemailTranscription(PluginCall call) { forwardSpeech(call, "cancelVoicemailTranscription"); }

    @PluginMethod public void cancel(PluginCall call) { forwardSpeech(call, "cancel"); }
    @PluginMethod public void startRecording(PluginCall call) { forwardSpeech(call, "startRecording"); }
    @PluginMethod public void stopRecording(PluginCall call) { forwardSpeech(call, "stopRecording"); }
    @PluginMethod public void cancelRecording(PluginCall call) { forwardSpeech(call, "cancelRecording"); }
    @PluginMethod public void releaseLocalSpeech(PluginCall call) { forwardSpeech(call, "releaseLocalSpeech"); }
    @PluginMethod public void holdSpeechEngine(PluginCall call) { forwardSpeech(call, "holdSpeechEngine"); }
    @PluginMethod public void releaseSpeechEngineHold(PluginCall call) { forwardSpeech(call, "releaseSpeechEngineHold"); }
    @PluginMethod public void warmSpeechOutput(PluginCall call) { forwardSpeech(call, "warmSpeechOutput"); }
    @PluginMethod public void localSpeechStatus(PluginCall call) { forwardSpeech(call, "localSpeechStatus"); }
    @PluginMethod public void synthesizeLocal(PluginCall call) { forwardSpeech(call, "synthesizeLocal"); }
    @PluginMethod public void setSpeechOutputMuted(PluginCall call) { forwardSpeech(call, "setSpeechOutputMuted"); }
    @PluginMethod public void play(PluginCall call) { forwardSpeech(call, "play"); }
    @PluginMethod public void stopPlayback(PluginCall call) { forwardSpeech(call, "stopPlayback"); }
    @PluginMethod public void nativeVoiceTiming(PluginCall call) { forwardSpeech(call, "nativeVoiceTiming"); }
    @PluginMethod public void markVoiceTurn(PluginCall call) { forwardSpeech(call, "markVoiceTurn"); }
    @PluginMethod public void clearNativeVoiceTiming(PluginCall call) { forwardSpeech(call, "clearNativeVoiceTiming"); }
    @PluginMethod public void liveCaptureStatus(PluginCall call) { forwardSpeech(call, "liveCaptureStatus"); }
    @PluginMethod public void startLiveCapture(PluginCall call) { forwardSpeech(call, "startLiveCapture"); }
    @PluginMethod public void stopLiveCapture(PluginCall call) { forwardSpeech(call, "stopLiveCapture"); }

    private void registerObserverAsync() {
        if (destroyed || observerRegistered.get()) return;
        runBackground(() -> {
            if (destroyed || observerRegistered.get()) return;
            IAlphaPlatformBroker broker = connectBroker();
            if (broker != null) ensureObserverRegistered(broker);
        });
    }

    private void ensureObserverRegistered(IAlphaPlatformBroker broker) {
        if (destroyed || !observerRegistered.compareAndSet(false, true)) return;
        try {
            broker.registerSignInObserver(speechObserver);
        } catch (RemoteException | SecurityException failed) {
            observerRegistered.set(false);
        }
    }

    private void forwardSpeech(PluginCall call, String method) {
        String argsJson = call.getData() == null ? "{}" : call.getData().toString();
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker == null) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
                return;
            }
            ensureObserverRegistered(broker);
            try {
                String raw = broker.corePluginCall(corePluginName(), method, argsJson);
                relayInlineSpeechEvents(raw);
                resolveCoreReply(call, raw);
            } catch (RemoteException | SecurityException refused) {
                String code = refused instanceof SecurityException ? "Rejected" : "AlphaCoreUnavailable";
                call.reject(code, code);
            }
        });
    }

    private void relayWrappedSpeechEvent(String eventJson) {
        if (destroyed || eventJson == null || eventJson.isBlank()) return;
        try {
            JSONObject wrapper = new JSONObject(eventJson);
            String plugin = wrapper.optString("plugin", "");
            if (!plugin.isEmpty() && !corePluginName().equals(plugin)) return;
            String name = wrapper.optString("event", wrapper.optString("name", ""));
            if (name.isEmpty()) return;
            JSONObject payload = wrapper.optJSONObject("data");
            if (payload == null) payload = wrapper.optJSONObject("payload");
            postSpeechEvent(name, payload == null ? new JSObject() : JSObject.fromJSONObject(payload));
        } catch (JSONException ignored) {
        }
    }

    private void relayInlineSpeechEvents(String raw) {
        if (destroyed || raw == null || raw.isBlank()) return;
        try {
            JSONObject parsed = new JSONObject(raw);
            JSONArray events = parsed.optJSONArray("events");
            if (events != null) {
                for (int index = 0; index < events.length(); index++) {
                    JSONObject item = events.optJSONObject(index);
                    if (item == null) continue;
                    String name = item.optString("name", item.optString("event", ""));
                    JSONObject payload = item.optJSONObject("payload");
                    if (payload == null) payload = item.optJSONObject("data");
                    if (!name.isEmpty()) {
                        postSpeechEvent(name, payload == null ? new JSObject() : JSObject.fromJSONObject(payload));
                    }
                }
            }
            if (parsed.has("playbackStopped") && parsed.optBoolean("playbackStopped", false)) {
                postSpeechEvent("playbackStopped", new JSObject());
            }
        } catch (JSONException ignored) {
        }
    }

    private static JSObject parseJsonObject(String raw) {
        if (raw == null || raw.isBlank()) return new JSObject();
        try {
            return new JSObject(raw);
        } catch (JSONException malformed) {
            return new JSObject();
        }
    }

    private void postSpeechEvent(String eventName, JSObject payload) {
        mainHandler.post(() -> {
            if (!destroyed) {
                notifyListeners(eventName, payload);
            }
        });
    }
}
