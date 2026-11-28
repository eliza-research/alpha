package ai.alphacompute.control;

import android.os.ParcelFileDescriptor;

interface IAlphaControlBridge {
    int getProtocolVersion();
    int getCapabilities();
    ParcelFileDescriptor captureDisplay(int displayId, int maxWidth, int jpegQuality);
    boolean injectKeyEvent(int keyCode, int metaState, int action);
    boolean injectMotionEvent(int action, float x, float y, long downTime, long eventTime);
    boolean setAlphaAccessibilityEnabled(boolean enabled);
}
