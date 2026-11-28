// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
package ai.alphacompute.alphaphone.messaging;

import android.app.Activity;
import android.view.ViewTreeObserver;
import java.util.Collections;
import java.util.HashMap;
import java.util.Set;
import java.util.WeakHashMap;
import org.json.JSONObject;

final class MessagingNoticeFront implements ViewTreeObserver.OnWindowFocusChangeListener {
    private static final Set<MessagingNoticeFront> resumed = Collections.newSetFromMap(new WeakHashMap<>());
    private final HashMap<String, String> displayed = new HashMap<>();
    private boolean focused;

    void resume(Activity activity) {
        var view = activity.getWindow().getDecorView();
        synchronized (resumed) {
            if (!resumed.add(this)) return;
            focused = view.hasWindowFocus();
        }
        view.getViewTreeObserver().addOnWindowFocusChangeListener(this);
    }

    void pause(Activity activity) {
        synchronized (resumed) {
            if (!resumed.remove(this)) return;
            displayed.clear();
            focused = false;
        }
        var tree = activity.getWindow().getDecorView().getViewTreeObserver();
        if (tree.isAlive()) tree.removeOnWindowFocusChangeListener(this);
    }

    @Override public void onWindowFocusChanged(boolean focus) {
        synchronized (resumed) { focused = focus; }
    }

    void show(String provider, JSONObject target) {
        synchronized (resumed) {
            if (!resumed.contains(this)) return;
            if (target == null) displayed.remove(provider);
            else displayed.put(provider, target.toString());
        }
    }

    static boolean shows(String provider, JSONObject target) {
        String key = target.toString();
        synchronized (resumed) {
            for (var window : resumed) {
                if (window.focused && key.equals(window.displayed.get(provider))) return true;
            }
            return false;
        }
    }
}
