package ai.alphacompute.alphaphone.widget;

import ai.alphacompute.alphaphone.R;
import ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionService;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.RemoteViews;

/** Tier-1 standalone Ask Alpha search bar AppWidget styled with 31dp dock pill radius and #0000FF brand mark. */
public final class AlphaSearchWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_LAUNCH_ASK = "ai.alphacompute.alphaphone.widget.SEARCH_ASK";
    public static final String ACTION_LAUNCH_VOICE = "ai.alphacompute.alphaphone.widget.SEARCH_VOICE";

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            manager.updateAppWidget(widgetId, buildViews(context));
        }
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null) return;
        String action = intent.getAction();
        if (ACTION_LAUNCH_ASK.equals(action) || ACTION_LAUNCH_VOICE.equals(action)) {
            Bundle args = new Bundle();
            args.putString(AlphaVoiceInteractionService.EXTRA_ENTRY_SOURCE, "search-widget");
            args.putBoolean(AlphaVoiceInteractionService.EXTRA_START_VOICE, ACTION_LAUNCH_VOICE.equals(action));
            AlphaVoiceInteractionService.showOverlay(context, args);
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.alpha_search_widget);

        Intent askIntent = new Intent(context, AlphaSearchWidgetProvider.class).setAction(ACTION_LAUNCH_ASK);
        PendingIntent askPending = PendingIntent.getBroadcast(
            context,
            201,
            askIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.alpha_search_widget_root, askPending);

        Intent voiceIntent = new Intent(context, AlphaSearchWidgetProvider.class).setAction(ACTION_LAUNCH_VOICE);
        PendingIntent voicePending = PendingIntent.getBroadcast(
            context,
            202,
            voiceIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.alpha_search_widget_mic, voicePending);
        return views;
    }
}
