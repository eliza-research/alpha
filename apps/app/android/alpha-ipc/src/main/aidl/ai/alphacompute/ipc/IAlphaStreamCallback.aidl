package ai.alphacompute.ipc;

oneway interface IAlphaStreamCallback {
    void onHead(String callId, long index, int status, String headersJson);
    void onChunk(String callId, long index, in byte[] chunk);
    void onEnd(String callId, String kind, String failCode);
}
