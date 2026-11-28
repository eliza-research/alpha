package ai.alphacompute.localllm;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Capacitor plugin exposing on-device local LLM catalog, resumable downloads,
 * activation, generation, and AI mode switching to AlphaCore and thin apps.
 */
@CapacitorPlugin(name = "AlphaLocalLlm")
public final class AlphaLocalLlmPlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaLocalLlmPlugin");
        thread.setDaemon(true);
        return thread;
    });
    private volatile AutoCloseable progressSubscription;

    @Override public void load() {
        super.load();
        Context context = getContext();
        if (context != null) {
            progressSubscription = AlphaLocalModelManager.shared(context).subscribeProgress(this::emitDownloadProgress);
        }
    }

    @Override protected void handleOnDestroy() {
        AutoCloseable sub = progressSubscription;
        progressSubscription = null;
        if (sub != null) {
            try {
                sub.close();
            } catch (Exception ignored) {
            }
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    /** Returns the pinned GGUF model catalog annotated with device RAM and storage fit. */
    @PluginMethod public void catalog(PluginCall call) {
        dispatch(call, "catalog", call.getData());
    }

    /** Returns active AI mode, selected model, download state, and inference host readiness. */
    @PluginMethod public void status(PluginCall call) {
        dispatch(call, "status", call.getData());
    }

    /** Starts a resumable HTTP Range download with SHA-256 verification and metered-network guard. */
    @PluginMethod public void download(PluginCall call) {
        executor.execute(() -> {
            try {
                JSONObject params = call.getData() == null ? new JSONObject() : call.getData();
                AlphaLocalModelManager.ProgressListener listener = progressSubscription == null
                    ? this::emitDownloadProgress
                    : null;
                JSONObject result = invoke(getContext(), "download", params, listener);
                call.resolve(JSObject.fromJSONObject(result));
            } catch (AlphaLocalModelManager.ModelRefusedException refused) {
                call.reject(refused.getMessage(), refused.code);
            } catch (IOException | JSONException failed) {
                call.reject(failed.getMessage() == null ? "Local LLM operation failed" : failed.getMessage(), "LOCAL_LLM_FAILED");
            }
        });
    }

    /** Cancels an active download while preserving partial bytes for resume. */
    @PluginMethod public void cancelDownload(PluginCall call) {
        dispatch(call, "cancelDownload", call.getData());
    }

    /** Verifies and activates an installed local GGUF model. */
    @PluginMethod public void activate(PluginCall call) {
        dispatch(call, "activate", call.getData());
    }

    /** Releases the active local model from native memory. */
    @PluginMethod public void unload(PluginCall call) {
        dispatch(call, "unload", call.getData());
    }

    /** Unloads and deletes an installed local model from disk. */
    @PluginMethod public void delete(PluginCall call) {
        dispatch(call, "delete", call.getData());
    }

    /** Runs one on-device completion through {@link AlphaLocalInferenceHost}. */
    @PluginMethod public void generate(PluginCall call) {
        dispatch(call, "generate", call.getData());
    }

    /** Switches persisted AI routing mode ({@code local}, {@code cloud}, or {@code own-key}). */
    @PluginMethod public void setMode(PluginCall call) {
        dispatch(call, "setMode", call.getData());
    }

    /**
     * Headless dispatch entry point allowing {@code AlphaCorePluginDispatch} to serve
     * {@code AlphaLocalLlm} calls from standalone thin apps without a WebView bridge.
     */
    public static JSONObject invoke(Context context, String method, JSONObject params)
        throws AlphaLocalModelManager.ModelRefusedException, IOException, JSONException {
        return invoke(context, method, params, null);
    }

    /**
     * Headless dispatch entry point accepting an optional download {@code progressListener}
     * so broker callers can stream {@code downloadProgress} updates to thin apps.
     */
    public static JSONObject invoke(
        Context context,
        String method,
        JSONObject params,
        AlphaLocalModelManager.ProgressListener progressListener
    ) throws AlphaLocalModelManager.ModelRefusedException, IOException, JSONException {
        JSONObject input = params == null ? new JSONObject() : params;
        AlphaLocalModelManager manager = AlphaLocalModelManager.shared(context);
        AlphaLocalInferenceHost host = AlphaLocalInferenceHost.shared(context);
        return switch (method) {
            case "catalog" -> {
                JSONObject status = manager.statusJson(host.isEngineAvailable(), host.socketPath().toString());
                yield AlphaLocalLlmCatalog.catalogJson(status.optLong("deviceRamMb", 8192L), status.optLong("freeDiskMb", 0L));
            }
            case "status" -> manager.statusJson(host.isEngineAvailable(), host.socketPath().toString());
            case "download" -> {
                String modelId = input.optString("modelId", AlphaLocalLlmCatalog.DEFAULT_MODEL_ID);
                boolean allowMetered = input.optBoolean("allowMetered", false);
                AlphaLocalModelManager.DownloadProgress started = manager.startDownload(modelId, allowMetered, progressListener);
                yield new JSONObject()
                    .put("ok", true)
                    .put("modelId", started.modelId())
                    .put("status", started.toJson());
            }
            case "cancelDownload" -> {
                String modelId = input.optString("modelId", AlphaLocalLlmCatalog.DEFAULT_MODEL_ID);
                boolean cancelled = manager.cancelDownload(modelId);
                yield new JSONObject().put("ok", cancelled).put("modelId", modelId);
            }
            case "activate" -> {
                String modelId = input.optString("modelId", manager.activeModelId());
                JSONObject activated = manager.activate(modelId);
                if (host.isEngineAvailable()) {
                    JSONObject loaded = host.loadModel(modelId);
                    activated.put("loaded", loaded.optBoolean("ok", false));
                }
                yield activated;
            }
            case "unload" -> {
                host.unload();
                yield manager.unload();
            }
            case "delete" -> {
                String modelId = input.optString("modelId", "");
                yield manager.delete(modelId);
            }
            case "generate" -> {
                String modelId = input.optString("modelId", manager.activeModelId());
                JSONArray rawMessages = input.optJSONArray("messages");
                List<AlphaLocalChatTemplate.ChatMessage> messages = rawMessages != null
                    ? AlphaLocalChatTemplate.parseMessages(rawMessages)
                    : List.of(AlphaLocalChatTemplate.ChatMessage.of("user", input.optString("prompt", "")));
                List<AlphaLocalChatTemplate.ToolSpec> tools = AlphaLocalChatTemplate.parseTools(input.optJSONArray("tools"));
                int maxTokens = input.optInt("maxTokens", 1024);
                float temperature = (float) input.optDouble("temperature", 0.2d);
                AlphaLocalChatTemplate.ParsedCompletion completion = host.generate(modelId, messages, tools, maxTokens, temperature, null);
                yield completion.toStructuredJson().put("modelId", modelId);
            }
            case "setMode" -> {
                String mode = input.optString("mode", "");
                String modelId = input.has("modelId") && !input.isNull("modelId") ? input.optString("modelId", null) : null;
                yield manager.setMode(mode, modelId);
            }
            default -> throw new AlphaLocalModelManager.ModelRefusedException("UNSUPPORTED_METHOD", "Unsupported AlphaLocalLlm method: " + method);
        };
    }

    private void emitDownloadProgress(AlphaLocalModelManager.DownloadProgress progress) {
        if (progress == null) return;
        try {
            notifyListeners("downloadProgress", JSObject.fromJSONObject(progress.toJson()));
        } catch (JSONException | RuntimeException ignored) {
        }
    }

    private void dispatch(PluginCall call, String method, JSONObject params) {
        executor.execute(() -> {
            try {
                JSONObject result = invoke(getContext(), method, params);
                call.resolve(JSObject.fromJSONObject(result));
            } catch (AlphaLocalModelManager.ModelRefusedException refused) {
                call.reject(refused.getMessage(), refused.code);
            } catch (IOException | JSONException failed) {
                call.reject(failed.getMessage() == null ? "Local LLM operation failed" : failed.getMessage(), "LOCAL_LLM_FAILED");
            }
        });
    }
}
