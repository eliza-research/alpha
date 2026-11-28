package ai.alphacompute.ipc;

oneway interface IAlphaEventCallback {
    void onEvent(String subId, long index, String eventJson);
    void onEnd(String subId, String kind, String failCode);
}
