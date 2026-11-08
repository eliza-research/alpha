package ai.elizaresearch.alphaphone;

import java.util.function.Predicate;

/**
 * What to do after the page's WebView renderer dies (MainActivity.onRenderProcessGone). The first
 * three losses in a 60 s window recreate the activity at once; later losses in that window wait
 * 5 s, so a crash loop backs off instead of spinning. A loss after the window has passed starts a
 * new window. While Alpha is HOME, a loss past the budget does not keep recreating a blank home
 * screen: MainActivity shows a native escape view (Reload, Android Settings, Choose Home app), so a
 * broken renderer never traps the user in Alpha as HOME. No Android types: host-tested by javac.
 */
final class RendererRecoveryBudget {
 static final long WINDOW_MS=60_000L,BACKOFF_MS=5_000L;
 static final int BUDGET=3;
 /** Settings actions, as android.provider.Settings defines them. */
 static final String ACTION_SETTINGS="android.settings.SETTINGS",
  ACTION_HOME_SETTINGS="android.settings.HOME_SETTINGS",
  ACTION_MANAGE_DEFAULT_APPS_SETTINGS="android.settings.MANAGE_DEFAULT_APPS_SETTINGS";
 enum Action { RECREATE_NOW, RECREATE_AFTER_BACKOFF, SHOW_ESCAPE }
 private boolean started;
 private long windowStart;
 private int lossesInWindow;
 /** Counts one renderer loss at elapsed-realtime now and says how the activity recovers. */
 synchronized Action onLoss(long now,boolean home){
  if(!started||now-windowStart>WINDOW_MS||now<windowStart){started=true;windowStart=now;lossesInWindow=0;}
  if(lossesInWindow<BUDGET+1)lossesInWindow++;
  if(lossesInWindow<=BUDGET)return Action.RECREATE_NOW;
  return home?Action.SHOW_ESCAPE:Action.RECREATE_AFTER_BACKOFF;
 }
 static long delay(Action action){return action==Action.RECREATE_AFTER_BACKOFF?BACKOFF_MS:0L;}
 /** The first candidate a stock activity handles, or null. */
 static String firstResolved(Predicate<String> resolves,String... actions){
  for(String action:actions)if(resolves.test(action))return action;
  return null;
 }
 /** 'Open Android Settings'. */
 static String settingsAction(Predicate<String> resolves){return firstResolved(resolves,ACTION_SETTINGS);}
 /** 'Choose Home app': the Home picker, else default apps, else Settings itself. */
 static String homeChoiceAction(Predicate<String> resolves){
  return firstResolved(resolves,ACTION_HOME_SETTINGS,ACTION_MANAGE_DEFAULT_APPS_SETTINGS,ACTION_SETTINGS);
 }
}
