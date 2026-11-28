package ai.alphacompute.alphaphone.widget;

import ai.alphacompute.alphaphone.R;
import ai.alphacompute.alphaphone.overlay.AlphaVoiceInteractionService;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Native Alpha Day widget styled in Alpha Compute monochrome with 30dp radius and #0000FF accent dot. */
public final class AlphaDayWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_REFRESH = "ai.alphacompute.alphaphone.widget.DAY_REFRESH";
    public static final String ACTION_OPEN_DAY = "ai.alphacompute.alphaphone.widget.DAY_OPEN";

    private static final String CACHE_PREFS = "alpha-widget-cache";
    private static final String KEY_SUMMARY_TITLE = "day_summary_title";
    private static final String KEY_SUMMARY_SUBTITLE = "day_summary_subtitle";

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) {
            manager.updateAppWidget(widgetId, buildViews(context));
        }
    }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null) return;
        String action = intent.getAction();
        if (ACTION_REFRESH.equals(action)) {
            refreshAll(context);
        } else if (ACTION_OPEN_DAY.equals(action)) {
            Bundle args = new Bundle();
            args.putString(AlphaVoiceInteractionService.EXTRA_ENTRY_SOURCE, "day-widget");
            AlphaVoiceInteractionService.showOverlay(context, args);
        }
    }

    /** Persists a bounded day-summary card headline and refreshes all active Alpha Day widgets. */
    public static void updateSummary(Context context, String title, String subtitle) {
        if (context == null) return;
        SharedPreferences.Editor editor = context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit();
        if (title == null || title.isBlank()) editor.remove(KEY_SUMMARY_TITLE);
        else editor.putString(KEY_SUMMARY_TITLE, title.trim());
        if (subtitle == null || subtitle.isBlank()) editor.remove(KEY_SUMMARY_SUBTITLE);
        else editor.putString(KEY_SUMMARY_SUBTITLE, subtitle.trim());
        editor.apply();
        refreshAll(context);
    }

    /** Re-renders all placed instances of {@link AlphaDayWidgetProvider}. */
    public static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, AlphaDayWidgetProvider.class));
        if (ids == null || ids.length == 0) return;
        RemoteViews views = buildViews(context);
        for (int widgetId : ids) {
            manager.updateAppWidget(widgetId, views);
        }
    }

    private static RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.alpha_day_widget);
        Date now = new Date();
        String weekday = new SimpleDateFormat("EEEE", Locale.getDefault()).format(now);
        String dateText = new SimpleDateFormat("MMM d", Locale.getDefault()).format(now);
        SharedPreferences cache = context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE);
        String summaryTitle = cache.getString(KEY_SUMMARY_TITLE, null);
        String summarySubtitle = cache.getString(KEY_SUMMARY_SUBTITLE, null);

        views.setTextViewText(R.id.alpha_day_weekday, weekday);
        views.setTextViewText(R.id.alpha_day_date, dateText);
        views.setTextViewText(
            R.id.alpha_day_summary,
            summaryTitle != null && !summaryTitle.isBlank()
                ? summaryTitle
                : context.getString(R.string.alpha_day_widget_default_summary)
        );
        views.setTextViewText(
            R.id.alpha_day_meta,
            summarySubtitle != null && !summarySubtitle.isBlank()
                ? summarySubtitle
                : context.getString(R.string.alpha_day_widget_default_meta)
        );

        Intent openIntent = new Intent(context, AlphaDayWidgetProvider.class).setAction(ACTION_OPEN_DAY);
        PendingIntent pendingOpen = PendingIntent.getBroadcast(
            context,
            101,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.alpha_day_widget_root, pendingOpen);
        return views;
    }
}
