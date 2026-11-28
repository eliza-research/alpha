package ai.alphacompute.ipc;

import android.os.ParcelFileDescriptor;
import ai.alphacompute.ipc.IAlphaRequestCallback;
import ai.alphacompute.ipc.IAlphaStreamCallback;
import ai.alphacompute.ipc.IAlphaEventCallback;

interface IAlphaAgentBroker {
    String getStatusJson();
    String lifecycleCommand(String command);
    void request(
        String callId,
        String method,
        String path,
        in byte[] inlineBody,
        in ParcelFileDescriptor bodyFd,
        String headersJson,
        IAlphaRequestCallback cb
    );
    void requestStream(
        String callId,
        String method,
        String path,
        in byte[] inlineBody,
        in ParcelFileDescriptor bodyFd,
        String headersJson,
        IAlphaStreamCallback cb
    );
    boolean abort(String callId);
    void subscribeEvents(String subId, String topic, String clientId, IAlphaEventCallback cb);
    void unsubscribeEvents(String subId);
}
