package ai.alphacompute.ipc;

oneway interface IAlphaActionCallback {
    void onResult(String claimId, boolean switched, String resultJson, String errorCode);
}
