package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaAgentBroker;
import ai.alphacompute.ipc.IAlphaEventCallback;
import ai.alphacompute.ipc.IAlphaRequestCallback;
import ai.alphacompute.ipc.IAlphaStreamCallback;
import ai.alphacompute.ipc.PfdStreams;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Drop-in Capacitor {@code ElizaAgent} proxy forwarding requests, streams, and feeds over {@link IAlphaAgentBroker}. */
@CapacitorPlugin(name = "ElizaAgent")
public final class RemoteAgentPlugin extends Plugin {
    /** Non-sensitive diagnostic summary of {@link IAlphaAgentBroker} connectivity for launch verification. */
    record BrokerProbe(boolean bound, String state) {}

    private final String owner = "remote-screen-" + UUID.randomUUID();
    private final Set<String> activeCalls = ConcurrentHashMap.newKeySet();
    private final Set<String> activeSubscriptions = ConcurrentHashMap.newKeySet();
    private final ExecutorService workers = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaRemoteAgent");
        thread.setDaemon(true);
        return thread;
    });

    private CoreServiceConnector<IAlphaAgentBroker> connector;
    private String statusSubId;

    @Override public void load() {
        connector = new CoreServiceConnector<>(getContext(), AlphaIpcContract.ACTION_AGENT_BROKER, IAlphaAgentBroker.Stub::asInterface);
        connector.warmUp();
        workers.execute(this::subscribeStatusUpdates);
    }

    @Override protected void handleOnDestroy() {
        IAlphaAgentBroker broker = connector == null ? null : connector.connect(500L);
        if (broker != null) {
            for (String callId : activeCalls) {
                try {
                    broker.abort(callId);
                } catch (RemoteException ignored) {
                }
            }
            for (String subId : activeSubscriptions) {
                try {
                    broker.unsubscribeEvents(subId);
                } catch (RemoteException ignored) {
                }
            }
            if (statusSubId != null) {
                try {
                    broker.unsubscribeEvents(statusSubId);
                } catch (RemoteException ignored) {
                }
            }
        }
        activeCalls.clear();
        activeSubscriptions.clear();
        if (connector != null) connector.close();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void getStatus(PluginCall call) {
        workers.execute(() -> {
            IAlphaAgentBroker broker = connector.connect();
            if (broker == null) {
                call.resolve(unavailableStatus());
                return;
            }
            try {
                call.resolve(parseObject(broker.getStatusJson(), unavailableStatus()));
            } catch (RemoteException lost) {
                call.resolve(unavailableStatus());
            }
        });
    }

    @PluginMethod public void start(PluginCall call) {
        runLifecycle(call, "start");
    }

    @PluginMethod public void stop(PluginCall call) {
        runLifecycle(call, "stop");
    }

    @PluginMethod public void restart(PluginCall call) {
        runLifecycle(call, "restart");
    }

    @PluginMethod public void reviewRecovery(PluginCall call) {
        workers.execute(() -> {
            IAlphaAgentBroker broker = connector.connect();
            if (broker == null) {
                call.resolve(new JSObject().put("kind", "unavailable"));
                return;
            }
            try {
                call.resolve(parseObject(broker.lifecycleCommand("reviewRecovery"), new JSObject().put("kind", "unavailable")));
            } catch (RemoteException | SecurityException refused) {
                call.resolve(new JSObject().put("kind", "unavailable"));
            }
        });
    }

    @PluginMethod public void archiveRecovery(PluginCall call) {
        String token = call.getString("reviewToken", "");
        workers.execute(() -> {
            IAlphaAgentBroker broker = connector.connect();
            if (broker == null) {
                call.resolve(new JSObject().put("kind", "unavailable"));
                return;
            }
            try {
                String command = "archiveRecovery:" + token;
                call.resolve(parseObject(broker.lifecycleCommand(command), new JSObject().put("kind", "unavailable")));
            } catch (RemoteException | SecurityException refused) {
                call.resolve(new JSObject().put("kind", "unavailable"));
            }
        });
    }

    @PluginMethod public void request(PluginCall call) {
        String id = nonEmptyOrRandom(call.getString("id", ""));
        String method = call.getString("method", "");
        String path = call.getString("path", "");
        byte[] bodyBytes = serializeBody(call.getData().opt("body"));
        String headersJson = serializeHeaders(call.getData().opt("headers"));

        try {
            workers.execute(() -> {
                IAlphaAgentBroker broker = connector.connect();
                if (broker == null) {
                    reject(call, AlphaIpcContract.FAIL_NOT_READY);
                    return;
                }
                activeCalls.add(id);
                try (PfdStreams.Payload payload = PfdStreams.pack(bodyBytes)) {
                    broker.request(id, method, path, payload.inlineBody(), payload.bodyFd(), headersJson, new IAlphaRequestCallback.Stub() {
                        @Override public void onResponse(String callId, int status, byte[] inlineBody, ParcelFileDescriptor bodyFd) {
                            activeCalls.remove(callId);
                            try {
                                workers.execute(() -> {
                                    try {
                                        byte[] bytes = PfdStreams.unpack(inlineBody, bodyFd, AlphaIpcContract.MAX_PFD_BODY_BYTES);
                                        call.resolve(decodeResponse(status, bytes));
                                    } catch (IOException failed) {
                                        reject(call, failed instanceof PfdStreams.PayloadTooLargeException
                                            ? AlphaIpcContract.FAIL_TOO_LARGE
                                            : AlphaIpcContract.FAIL_BROKEN);
                                    }
                                });
                            } catch (RejectedExecutionException closed) {
                                PfdStreams.closeQuietly(bodyFd);
                                reject(call, AlphaIpcContract.FAIL_BROKEN);
                            }
                        }

                        @Override public void onError(String callId, String failCode, String message) {
                            activeCalls.remove(callId);
                            reject(call, failCode == null || failCode.isEmpty() ? AlphaIpcContract.FAIL_BROKEN : failCode);
                        }
                    });
                } catch (PfdStreams.PayloadTooLargeException tooLarge) {
                    activeCalls.remove(id);
                    reject(call, AlphaIpcContract.FAIL_TOO_LARGE);
                } catch (IOException | RemoteException | SecurityException failed) {
                    activeCalls.remove(id);
                    reject(call, failed instanceof SecurityException ? AlphaIpcContract.FAIL_ROUTE_REFUSED : AlphaIpcContract.FAIL_BROKEN);
                }
            });
        } catch (RejectedExecutionException closed) {
            reject(call, AlphaIpcContract.FAIL_NOT_READY);
        }
    }

    @PluginMethod public void requestStream(PluginCall call) {
        String id = call.getString("id", "");
        if (id.isEmpty()) {
            reject(call, AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        String method = call.getString("method", "");
        String path = call.getString("path", "");
        byte[] bodyBytes = serializeBody(call.getData().opt("body"));
        String headersJson = serializeHeaders(call.getData().opt("headers"));

        try {
            workers.execute(() -> {
                IAlphaAgentBroker broker = connector.connect();
                if (broker == null) {
                    reject(call, AlphaIpcContract.FAIL_NOT_READY);
                    return;
                }
                activeCalls.add(id);
                try (PfdStreams.Payload payload = PfdStreams.pack(bodyBytes)) {
                    broker.requestStream(id, method, path, payload.inlineBody(), payload.bodyFd(), headersJson, new IAlphaStreamCallback.Stub() {
                        @Override public void onHead(String callId, long index, int status, String responseHeadersJson) {
                            JSObject head = new JSObject()
                                .put("id", callId)
                                .put("kind", "head")
                                .put("index", index)
                                .put("status", status)
                                .put("headers", parseObject(responseHeadersJson, new JSObject()));
                            notifyListeners("streamData", head);
                        }

                        @Override public void onChunk(String callId, long index, byte[] chunk) {
                            JSObject frame = new JSObject()
                                .put("id", callId)
                                .put("kind", "chunk")
                                .put("index", index)
                                .put("dataBase64", Base64.encodeToString(chunk == null ? new byte[0] : chunk, Base64.NO_WRAP));
                            notifyListeners("streamData", frame);
                        }

                        @Override public void onEnd(String callId, String kind, String failCode) {
                            activeCalls.remove(callId);
                            JSObject end = new JSObject().put("id", callId).put("kind", kind == null ? "end" : kind);
                            if ("failed".equals(kind) && failCode != null && !failCode.isEmpty()) {
                                end.put("code", failCode);
                            }
                            notifyListeners("streamEnd", end);
                        }
                    });
                    call.resolve(new JSObject().put("id", id));
                } catch (PfdStreams.PayloadTooLargeException tooLarge) {
                    activeCalls.remove(id);
                    reject(call, AlphaIpcContract.FAIL_TOO_LARGE);
                } catch (IOException | RemoteException | SecurityException failed) {
                    activeCalls.remove(id);
                    reject(call, failed instanceof SecurityException ? AlphaIpcContract.FAIL_ROUTE_REFUSED : AlphaIpcContract.FAIL_BROKEN);
                }
            });
        } catch (RejectedExecutionException closed) {
            reject(call, AlphaIpcContract.FAIL_NOT_READY);
        }
    }

    @PluginMethod public void abort(PluginCall call) {
        String id = call.getString("id", "");
        workers.execute(() -> {
            activeCalls.remove(id);
            IAlphaAgentBroker broker = connector.connect();
            boolean aborted = false;
            if (broker != null && !id.isEmpty()) {
                try {
                    aborted = broker.abort(id);
                } catch (RemoteException ignored) {
                }
            }
            call.resolve(new JSObject().put("aborted", aborted));
        });
    }

    @PluginMethod public void subscribeEvents(PluginCall call) {
        String id = call.getString("id", "");
        String topic = call.getString("topic", "");
        String clientId = call.getString("clientId", owner);
        if (id.isEmpty() || (!"view".equals(topic) && !"voice".equals(topic))) {
            reject(call, AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        workers.execute(() -> {
            IAlphaAgentBroker broker = connector.connect();
            if (broker == null) {
                reject(call, AlphaIpcContract.FAIL_NOT_READY);
                return;
            }
            activeSubscriptions.add(id);
            try {
                broker.subscribeEvents(id, topic, clientId, new IAlphaEventCallback.Stub() {
                    @Override public void onEvent(String subId, long index, String eventJson) {
                        JSObject frame = new JSObject()
                            .put("id", subId)
                            .put("kind", "event")
                            .put("index", index)
                            .put("event", parseObject(eventJson, new JSObject()));
                        notifyListeners("agentEvent", frame);
                    }

                    @Override public void onEnd(String subId, String kind, String failCode) {
                        activeSubscriptions.remove(subId);
                        JSObject end = new JSObject().put("id", subId).put("kind", kind == null ? "end" : kind);
                        if ("failed".equals(kind) && failCode != null && !failCode.isEmpty()) {
                            end.put("code", failCode);
                        }
                        notifyListeners("agentEvent", end);
                    }
                });
                call.resolve(new JSObject().put("id", id));
            } catch (RemoteException | SecurityException failed) {
                activeSubscriptions.remove(id);
                reject(call, failed instanceof SecurityException ? AlphaIpcContract.FAIL_ROUTE_REFUSED : AlphaIpcContract.FAIL_BROKEN);
            }
        });
    }

    @PluginMethod public void unsubscribeEvents(PluginCall call) {
        String id = call.getString("id", "");
        workers.execute(() -> {
            boolean removed = activeSubscriptions.remove(id);
            IAlphaAgentBroker broker = connector.connect();
            if (broker != null && !id.isEmpty()) {
                try {
                    broker.unsubscribeEvents(id);
                    removed = true;
                } catch (RemoteException ignored) {
                }
            }
            call.resolve(new JSObject().put("aborted", removed));
        });
    }

    /** Probes whether {@link IAlphaAgentBroker} is bound and reports its non-sensitive lifecycle state string. */
    BrokerProbe probeBroker() {
        IAlphaAgentBroker broker = connector == null ? null : connector.connect(2_000L);
        if (broker == null) return new BrokerProbe(false, "unavailable");
        try {
            JSObject parsed = parseObject(broker.getStatusJson(), unavailableStatus());
            return new BrokerProbe(true, parsed.optString("state", "unknown"));
        } catch (RemoteException lost) {
            return new BrokerProbe(false, "disconnected");
        }
    }

    private void subscribeStatusUpdates() {
        IAlphaAgentBroker broker = connector == null ? null : connector.connect();
        if (broker == null) return;
        String subId = "status-" + UUID.randomUUID();
        try {
            broker.subscribeEvents(subId, "status", owner, new IAlphaEventCallback.Stub() {
                @Override public void onEvent(String id, long index, String eventJson) {
                    notifyListeners("status", parseObject(eventJson, unavailableStatus()));
                }

                @Override public void onEnd(String id, String kind, String failCode) {}
            });
            statusSubId = subId;
        } catch (RemoteException | SecurityException ignored) {
        }
    }

    private void runLifecycle(PluginCall call, String command) {
        workers.execute(() -> {
            IAlphaAgentBroker broker = connector.connect();
            if (broker == null) {
                reject(call, AlphaIpcContract.FAIL_NOT_READY);
                return;
            }
            try {
                call.resolve(parseObject(broker.lifecycleCommand(command), unavailableStatus()));
            } catch (RemoteException | SecurityException refused) {
                call.reject(refused.getMessage() == null ? AlphaIpcContract.FAIL_ROUTE_REFUSED : refused.getMessage(), AlphaIpcContract.FAIL_ROUTE_REFUSED);
            }
        });
    }

    private static String nonEmptyOrRandom(String value) {
        return value == null || value.isEmpty() ? UUID.randomUUID().toString() : value;
    }

    private static byte[] serializeBody(Object body) {
        if (body == null || body == JSONObject.NULL) return null;
        String text = body instanceof String plain ? JSONObject.quote(plain) : body.toString();
        return text.getBytes(StandardCharsets.UTF_8);
    }

    private static String serializeHeaders(Object headers) {
        return headers instanceof JSONObject json ? json.toString() : "{}";
    }

    private static JSObject decodeResponse(int status, byte[] body) {
        JSObject answer = new JSObject().put("status", status);
        String text = body == null ? "" : new String(body, StandardCharsets.UTF_8);
        Object data = JSONObject.NULL;
        if (!text.isEmpty()) {
            try {
                data = new JSONTokener(text).nextValue();
            } catch (JSONException notJson) {
                data = text;
            }
        }
        return answer.put("data", data);
    }

    private static JSObject parseObject(String json, JSObject fallback) {
        if (json == null || json.isBlank()) return fallback;
        try {
            return new JSObject(json);
        } catch (JSONException ignored) {
            return fallback;
        }
    }

    private static JSObject unavailableStatus() {
        return new JSObject()
            .put("available", false)
            .put("state", "unavailable")
            .put("epoch", 0)
            .put("requestBodyLimit", 0);
    }

    private static void reject(PluginCall call, String code) {
        call.reject(code, code);
    }
}
