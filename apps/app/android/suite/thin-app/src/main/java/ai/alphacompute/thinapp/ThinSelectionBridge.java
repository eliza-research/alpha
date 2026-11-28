package ai.alphacompute.thinapp;

import android.content.Context;
import android.net.Uri;

/** Process-local hook linking {@code ThinFilesPlugin} to {@code ThinSelectedDocumentsPlugin} when present in a flavor. */
final class ThinSelectionBridge {
    interface Authorizer {
        String authorize(Context context, Uri uri, int flags);
    }

    private static volatile Authorizer authorizer;

    private ThinSelectionBridge() {}

    static void register(Authorizer next) {
        authorizer = next;
    }

    static boolean available() {
        return authorizer != null;
    }

    static String authorize(Context context, Uri uri, int flags) {
        Authorizer current = authorizer;
        if (current == null) {
            throw new IllegalStateException("Selected document registry is unavailable");
        }
        return current.authorize(context, uri, flags);
    }
}
