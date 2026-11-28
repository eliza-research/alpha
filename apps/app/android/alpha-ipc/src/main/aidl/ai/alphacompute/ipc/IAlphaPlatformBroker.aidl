package ai.alphacompute.ipc;

import android.os.ParcelFileDescriptor;
import ai.alphacompute.ipc.IAlphaCloudCallback;
import ai.alphacompute.ipc.IAlphaEventCallback;

interface IAlphaPlatformBroker {
    void cloudRequest(
        String callId,
        String method,
        String path,
        String queryJson,
        String headersJson,
        in byte[] inlineBody,
        in ParcelFileDescriptor bodyFd,
        String expectedCredentialId,
        String expectedSessionCredentialId,
        IAlphaCloudCallback cb
    );
    String signInCall(String method, String argsJson);
    String secureStoreCall(String op, String key, String expected, String value);
    boolean setAgentGoogleConsent(boolean gmailChanges, boolean calendarEdits);
    String diagnosticsFactsJson();
    String corePluginCall(String pluginName, String method, String argsJson);
    void registerSignInObserver(IAlphaEventCallback cb);
    void unregisterSignInObserver(IAlphaEventCallback cb);
    boolean launchSiblingApp(String targetPackage, String uri, String extrasJson);
    boolean openAlphaOverlay(String entrySource, String initialQuery, boolean startVoice);
}
