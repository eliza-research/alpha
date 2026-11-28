package ai.alphacompute.thinapp;

import android.content.Context;
import org.json.JSONObject;

/** Process-local hook decoupling {@code ThinContactsPlugin} from telephony deletion classes in non-telephony flavors. */
final class ThinDeletionBridge {
    interface Stager {
        JSONObject stage(Context context, String kind, JSONObject target) throws Exception;
    }

    private static volatile Stager stager;

    private ThinDeletionBridge() {}

    static void register(Stager next) {
        stager = next;
    }

    static boolean available() {
        return stager != null;
    }

    static JSONObject stage(Context context, String kind, JSONObject target) throws Exception {
        Stager current = stager;
        if (current == null) {
            throw new IllegalStateException("Telephony Undo window is unavailable");
        }
        return current.stage(context, kind, target);
    }
}
