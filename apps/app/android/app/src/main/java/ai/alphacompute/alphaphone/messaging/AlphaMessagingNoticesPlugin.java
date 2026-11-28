// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
package ai.alphacompute.alphaphone.messaging;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "AlphaMessagingNotices", permissions = {
    @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
})
public final class AlphaMessagingNoticesPlugin extends Plugin {
    private final MessagingNoticeFront window = new MessagingNoticeFront();

    private void changed() { notifyListeners("messagingNoticesChanged", new JSObject(), true); }

    private void accept(Intent intent) {
        if (MessagingNotices.opened(getContext(), intent)) changed();
    }

    @Override public void load() { accept(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { accept(intent); }
    @Override protected void handleOnResume() { window.resume(getActivity()); changed(); }
    @Override protected void handleOnPause() { window.pause(getActivity()); }
    @Override protected void handleOnDestroy() { window.pause(getActivity()); }

    @PluginMethod public void front(PluginCall call) {
        String provider = call.getString("provider", "");
        if (!MessagingNotices.serves(getContext(), provider)) { call.resolve(); return; }
        try {
            var target = call.getData().has("target") ? MessagingNotices.target(call.getObject("target"), true) : null;
            if (target != null && !provider.equals(target.getString("provider"))) throw new IllegalArgumentException("Conflicting messaging notice provider");
            window.show(provider, target);
            call.resolve();
        } catch (Exception failure) { call.reject("Invalid visible messaging conversation", failure); }
    }

    @PluginMethod public void status(PluginCall call) {
        try { call.resolve(new JSObject().put("allowed", MessagingNoticeAuthority.allowed(getContext(), call.getString("provider", "")))); }
        catch (Exception failure) { call.reject("Messaging notification status unavailable", failure); }
    }

    @PluginMethod public void configure(PluginCall call) {
        String provider = call.getString("provider", "");
        if (!MessagingNotices.serves(getContext(), provider)) { call.resolve(); return; }
        var activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                var lock = activity.getSystemService(KeyguardManager.class);
                if (activity.isFinishing() || activity.isDestroyed() || !activity.hasWindowFocus() || lock == null || lock.isDeviceLocked()) {
                    call.reject("Open the messaging app to configure notifications"); return;
                }
                var remote = MessagingNoticeAuthority.canonical(activity, provider);
                boolean allowed = MessagingNoticeAuthority.allowed(activity, provider);
                PermissionState state = getPermissionState("notifications");
                if (remote == null && Build.VERSION.SDK_INT >= 33 && (state == PermissionState.PROMPT || state == PermissionState.PROMPT_WITH_RATIONALE)) {
                    requestPermissionForAlias("notifications", call, "permissionAnswered");
                    return;
                }
                String name = remote == null ? activity.getPackageName() : MessagingNotices.thin(provider);
                var intent = new Intent(allowed ? Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS : Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, name);
                if (allowed) intent.putExtra(Settings.EXTRA_CHANNEL_ID, MessagingNotices.channel(provider));
                activity.startActivity(intent);
                call.resolve();
            } catch (RuntimeException | org.json.JSONException failure) { call.reject("Messaging notification settings unavailable", failure); }
        });
    }

    @PermissionCallback private void permissionAnswered(PluginCall call) { changed(); call.resolve(); }

    @PluginMethod public void post(PluginCall call) {
        try {
            var target = MessagingNotices.target(call.getObject("target"), true);
            boolean posted = MessagingNoticeAuthority.post(getContext(), target, call.getString("title", ""), call.getString("body", ""));
            call.resolve(new JSObject().put("posted", posted));
        } catch (Exception failure) { call.reject("Could not post messaging notification", failure); }
    }

    @PluginMethod public void withdraw(PluginCall call) {
        try { MessagingNoticeAuthority.withdraw(getContext(), MessagingNotices.target(call.getData(), false)); call.resolve(); }
        catch (Exception failure) { call.reject("Could not withdraw messaging notification", failure); }
    }

    @PluginMethod public void pendingTap(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(MessagingNotices.pending(getContext(), call.getString("provider", "")))); }
        catch (Exception failure) { call.reject("Could not open messaging notification", failure); }
    }

    @PluginMethod public void consumeTap(PluginCall call) {
        try { if (MessagingNotices.consume(getContext(), call.getString("token"))) changed(); call.resolve(); }
        catch (RuntimeException failure) { call.reject("Could not consume messaging notification", failure); }
    }
}
