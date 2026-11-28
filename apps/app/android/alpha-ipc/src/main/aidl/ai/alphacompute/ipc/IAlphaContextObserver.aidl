package ai.alphacompute.ipc;

oneway interface IAlphaContextObserver {
    void onContextChanged(String activeContextJson);
}
