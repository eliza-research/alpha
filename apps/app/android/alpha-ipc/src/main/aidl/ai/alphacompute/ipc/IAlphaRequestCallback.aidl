package ai.alphacompute.ipc;

import android.os.ParcelFileDescriptor;

oneway interface IAlphaRequestCallback {
    void onResponse(String callId, int status, in byte[] inlineBody, in ParcelFileDescriptor bodyFd);
    void onError(String callId, String failCode, String message);
}
