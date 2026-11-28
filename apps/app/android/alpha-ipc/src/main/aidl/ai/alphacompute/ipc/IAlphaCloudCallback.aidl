package ai.alphacompute.ipc;

import android.os.ParcelFileDescriptor;

oneway interface IAlphaCloudCallback {
    void onResponse(String callId, int status, String headersJson, in byte[] inlineBody, in ParcelFileDescriptor bodyFd);
    void onError(String callId, String failureCode, String message);
}
