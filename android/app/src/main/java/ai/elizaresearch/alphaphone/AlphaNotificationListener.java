package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.NotificationMirror;
import ai.eliza.plugins.notifications.NotificationMirrorListenerService;

/** Keeps the installed Android component identity and the process-wide mirror. */
public final class AlphaNotificationListener extends NotificationMirrorListenerService {
 @Override protected NotificationMirror mirror() { return NotificationAccess.MIRROR; }
}
