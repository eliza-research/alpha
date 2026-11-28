package ai.eliza.plugins.messages;

import android.content.Context;
import android.net.Uri;

/** Package-scoped bridge exposing {@link MmsStore#notifyIncoming} to thin default-SMS hosts. */
public final class ThinSmsAccess {
    private ThinSmsAccess() {}

    public static void notifyIncoming(Context context, SmsRoleConfiguration config, Uri message, String sender, String preview) {
        MmsStore.notifyIncoming(context, config, message, sender, preview);
    }
}
