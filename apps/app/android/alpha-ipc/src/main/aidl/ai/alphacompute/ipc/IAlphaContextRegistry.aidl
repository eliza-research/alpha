package ai.alphacompute.ipc;

import ai.alphacompute.ipc.IAlphaContextObserver;

interface IAlphaContextRegistry {
    void registerClient(IBinder clientToken);
    void publishContext(String view, String route, String snapshotJson, boolean sensitive, long leaseMs);
    void clearContext(String view);
    String getActiveContextJson();
    void registerContextObserver(IAlphaContextObserver observer);
    void unregisterContextObserver(IAlphaContextObserver observer);
}
