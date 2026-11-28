// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
package ai.alphacompute.alphaphone.messaging;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;

public final class MessagingNoticesInstrumentedTest {
    private static Intent open(String token) { return new Intent(MessagingNotices.OPEN, Uri.fromParts("alpha-messaging-notice", token, null)); }

    private static void visible(Context context, String title, boolean expected) {
        var manager = context.getSystemService(NotificationManager.class);
        long until = SystemClock.uptimeMillis() + 3000;
        boolean shown;
        do {
            shown = Arrays.stream(manager.getActiveNotifications())
                .anyMatch(entry -> title.contentEquals(entry.getNotification().extras.getCharSequence(Notification.EXTRA_TITLE, "")));
            if (shown == expected) return;
            SystemClock.sleep(40);
        } while (SystemClock.uptimeMillis() < until);
        assertEquals(expected, shown);
    }

    @Test public void keepsATapThroughAnotherMessageAndWithdrawsOnlyTheSelectedThread() throws Exception {
        var instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext().createDeviceProtectedStorageContext();
        if (Build.VERSION.SDK_INT >= 33) instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(), Manifest.permission.POST_NOTIFICATIONS);
        String id = UUID.randomUUID().toString();
        var provider = new JSONObject().put("provider", "slack").put("scope", android.util.Base64.encodeToString(
            java.security.MessageDigest.getInstance("SHA-256").digest(id.getBytes(java.nio.charset.StandardCharsets.UTF_8)),
            android.util.Base64.NO_WRAP | android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING));
        var channel = new JSONObject(provider.toString()).put("workspace", "device-test").put("channel", id).put("thread", "");
        var thread = new JSONObject(channel.toString()).put("thread", "thread-test");
        try {
            String first = MessagingNotices.post(context, channel, "First " + id, "Local test");
            assertNotNull(first);
            visible(context, "First " + id, true);
            assertTrue(MessagingNotices.opened(context, open(first)));
            String second = MessagingNotices.post(context, channel, "Second " + id, "Local test");
            String reply = MessagingNotices.post(context, thread, "Thread " + id, "Local test");
            visible(context, "Second " + id, true);
            assertEquals(first, MessagingNotices.pending(context, "slack").getString("token"));
            assertTrue(MessagingNotices.consume(context, first));
            assertFalse(MessagingNotices.consume(context, first));
            visible(context, "Second " + id, true);
            MessagingNotices.withdraw(context, channel);
            visible(context, "Second " + id, false);
            visible(context, "Thread " + id, true);
            assertFalse(MessagingNotices.opened(context, open(second)));
            assertTrue(MessagingNotices.opened(context, open(reply)));
            assertEquals("thread-test", MessagingNotices.pending(context, "slack").getJSONObject("target").getString("thread"));
            String latest = MessagingNotices.post(context, channel, "New selection " + id, "Local test");
            assertTrue(MessagingNotices.opened(context, open(latest)));
            assertFalse(MessagingNotices.consume(context, reply));
            assertFalse(MessagingNotices.opened(context, open(reply)));
            assertEquals(latest, MessagingNotices.pending(context, "slack").getString("token"));
            MessagingNotices.withdraw(context, provider);
            assertFalse(MessagingNotices.opened(context, open(latest)));
            assertEquals(0, MessagingNotices.pending(context, "slack").length());
        } finally { MessagingNotices.withdraw(context, provider); }
    }
}
