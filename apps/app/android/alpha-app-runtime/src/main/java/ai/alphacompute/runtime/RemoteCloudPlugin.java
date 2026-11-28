package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaCloudCallback;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import ai.alphacompute.ipc.PfdStreams;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import org.json.JSONException;
import org.json.JSONObject;

/** Drop-in Capacitor {@code ElizaCloud} proxy delegating authenticated cloud requests to {@link IAlphaPlatformBroker}. */
@CapacitorPlugin(name = "ElizaCloud")
public final class RemoteCloudPlugin extends Plugin {
    private static final int INLINE_REPLY_LIMIT = 8 * 1024 * 1024;
    private static final int GRANT_CHUNK_BYTES = 512 * 1024;

    private static final class GrantBuffer {
        final byte[] bytes;
        int offset;

        GrantBuffer(byte[] bytes) {
            this.bytes = bytes;
        }
    }

    private final Map<String, GrantBuffer> grants = new ConcurrentHashMap<>();
    private final ExecutorService workers = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaRemoteCloud");
        thread.setDaemon(true);
        return thread;
    });

    private CoreServiceConnector<IAlphaPlatformBroker> connector;

    @Override public void load() {
        connector = new CoreServiceConnector<>(getContext(), AlphaIpcContract.ACTION_PLATFORM_BROKER, IAlphaPlatformBroker.Stub::asInterface);
        connector.warmUp();
    }

    @Override protected void handleOnDestroy() {
        grants.clear();
        if (connector != null) connector.close();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void request(PluginCall call) {
        String method = call.getString("method");
        String target = call.getString("target");
        if (method == null || target == null) {
            reject(call, AlphaIpcContract.CLOUD_INVALID_REQUEST);
            return;
        }
        String callId = call.getString("id");
        if (callId == null || callId.isEmpty()) callId = UUID.randomUUID().toString();
        String expectedCredentialId = call.getString("expectedCredentialId");
        String expectedSessionCredentialId = call.getString("expectedSessionCredentialId");
        Object rawBody = call.getData().opt("body");
        if (rawBody != null && rawBody != JSONObject.NULL && !(rawBody instanceof String)) {
            reject(call, AlphaIpcContract.CLOUD_INVALID_REQUEST);
            return;
        }
        byte[] bodyBytes = rawBody instanceof String text ? text.getBytes(StandardCharsets.UTF_8) : null;
        JSObject headersObj = call.getObject("headers", new JSObject());
        String headersJson = headersObj == null ? "{}" : headersObj.toString();

        ParsedTarget parsed = parseTarget(target);
        if (parsed == null) {
            reject(call, AlphaIpcContract.CLOUD_INVALID_REQUEST);
            return;
        }
        String finalCallId = callId;
        try {
            workers.execute(() -> {
                IAlphaPlatformBroker broker = connector.connect();
                if (broker == null) {
                    reject(call, AlphaIpcContract.CLOUD_NOT_CONFIGURED);
                    return;
                }
                try (PfdStreams.Payload payload = PfdStreams.pack(bodyBytes)) {
                    broker.cloudRequest(
                        finalCallId,
                        method,
                        parsed.path,
                        parsed.queryJson,
                        headersJson,
                        payload.inlineBody(),
                        payload.bodyFd(),
                        expectedCredentialId,
                        expectedSessionCredentialId,
                        new IAlphaCloudCallback.Stub() {
                            @Override public void onResponse(String id, int status, String replyHeadersJson, byte[] inlineBody, ParcelFileDescriptor bodyFd) {
                                try {
                                    workers.execute(() -> {
                                        try {
                                            byte[] replyBytes = PfdStreams.unpack(inlineBody, bodyFd, 64 * 1024 * 1024);
                                            call.resolve(buildReply(status, replyHeadersJson, replyBytes == null ? new byte[0] : replyBytes));
                                        } catch (IOException failed) {
                                            reject(call, failed instanceof PfdStreams.PayloadTooLargeException ? "reply-too-large" : "network");
                                        }
                                    });
                                } catch (RejectedExecutionException closed) {
                                    PfdStreams.closeQuietly(bodyFd);
                                    reject(call, "network");
                                }
                            }

                            @Override public void onError(String id, String failureCode, String message) {
                                reject(call, failureCode == null || failureCode.isEmpty() ? "network" : failureCode);
                            }
                        }
                    );
                } catch (PfdStreams.PayloadTooLargeException tooLarge) {
                    reject(call, "body-too-large");
                } catch (IOException | RemoteException | SecurityException failed) {
                    reject(call, failed instanceof SecurityException ? AlphaIpcContract.CLOUD_NOT_LISTED : "network");
                }
            });
        } catch (RejectedExecutionException closed) {
            reject(call, AlphaIpcContract.CLOUD_NOT_CONFIGURED);
        }
    }

    @PluginMethod public void cancel(PluginCall call) {
        call.resolve(new JSObject().put("cancelled", false));
    }

    @PluginMethod public void readGrant(PluginCall call) {
        String grantId = call.getString("grant");
        if (grantId == null) {
            reject(call, "grant-unknown");
            return;
        }
        GrantBuffer buffer = grants.get(grantId);
        if (buffer == null) {
            reject(call, "grant-unknown");
            return;
        }
        synchronized (buffer) {
            int end = Math.min(buffer.bytes.length, buffer.offset + GRANT_CHUNK_BYTES);
            byte[] slice = Arrays.copyOfRange(buffer.bytes, buffer.offset, end);
            buffer.offset = end;
            boolean done = buffer.offset >= buffer.bytes.length;
            if (done) grants.remove(grantId);
            call.resolve(new JSObject()
                .put("data", Base64.encodeToString(slice, Base64.NO_WRAP))
                .put("done", done));
        }
    }

    @PluginMethod public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (!isSafeHttpsLink(url)) {
            reject(call, "link-refused");
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url))
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(view);
            call.resolve(new JSObject().put("opened", true));
        } catch (ActivityNotFoundException absent) {
            reject(call, "no-browser");
        }
    }

    private JSObject buildReply(int status, String headersJson, byte[] body) {
        JSObject reply = new JSObject().put("status", status);
        if (headersJson != null && !headersJson.isBlank()) {
            try {
                JSONObject headers = new JSONObject(headersJson);
                if (headers.has("etag")) reply.put("etag", headers.optString("etag"));
                if (headers.has("contentType")) reply.put("contentType", headers.optString("contentType"));
                if (headers.has("retryAfter")) reply.put("retryAfter", headers.optString("retryAfter"));
            } catch (JSONException ignored) {
            }
        }
        if (body.length <= INLINE_REPLY_LIMIT) {
            return reply.put("body", Base64.encodeToString(body, Base64.NO_WRAP));
        }
        String grantId = UUID.randomUUID().toString();
        grants.put(grantId, new GrantBuffer(body));
        return reply.put("grant", new JSObject()
            .put("id", grantId)
            .put("size", body.length)
            .put("sha256", sha256Hex(body)));
    }

    private record ParsedTarget(String path, String queryJson) {}

    private static ParsedTarget parseTarget(String target) {
        int queryStart = target.indexOf('?');
        String path = queryStart >= 0 ? target.substring(0, queryStart) : target;
        if (!path.startsWith("/")) return null;
        JSONObject query = new JSONObject();
        if (queryStart >= 0 && queryStart + 1 < target.length()) {
            String rawQuery = target.substring(queryStart + 1);
            for (String pair : rawQuery.split("&")) {
                if (pair.isEmpty()) continue;
                int eq = pair.indexOf('=');
                String rawKey = eq >= 0 ? pair.substring(0, eq) : pair;
                String rawVal = eq >= 0 ? pair.substring(eq + 1) : "";
                String key = URLDecoder.decode(rawKey, StandardCharsets.UTF_8);
                String val = URLDecoder.decode(rawVal, StandardCharsets.UTF_8);
                if (query.has(key)) return null;
                try {
                    query.put(key, val);
                } catch (JSONException ignored) {
                    return null;
                }
            }
        }
        return new ParsedTarget(path, query.toString());
    }

    private static boolean isSafeHttpsLink(String url) {
        if (url == null || url.isBlank()) return false;
        Uri uri = Uri.parse(url);
        return "https".equalsIgnoreCase(uri.getScheme())
            && uri.getHost() != null
            && !uri.getHost().isBlank()
            && uri.getUserInfo() == null;
    }

    private static String sha256Hex(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(Character.forDigit((value >> 4) & 0xf, 16));
                hex.append(Character.forDigit(value & 0xf, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static void reject(PluginCall call, String code) {
        call.reject(code, code);
    }
}
