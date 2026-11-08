package ai.elizaresearch.alphaphone;

import java.util.function.Predicate;

/**
 * What to do after the page's WebView renderer dies (MainActivity.onRenderProcessGone). The first
 * three losses in a 60 s window recreate the activity at once; later losses in that window wait
 * 5 s, so a crash loop backs off instead of spinning. A loss after the window has passed starts a
 * new window. While Alpha is HOME, a loss past the budget does not keep recreating a blank home
 * screen: MainActivity shows a native escape view (Reload, Android Settings, Choose Home app), so a
 * broken renderer never traps the user in Alpha as HOME. A renderer Android killed to reclaim memory
 * while the activity was in the background is not a crash: it is not counted, and the activity is
 * rebuilt when it is next started, so memory pressure cannot turn into a rebuild loop. A real crash
 * in the background is counted but also rebuilt on the next start. No Android types: host-tested
 * by javac.
 */
final class RendererRecoveryBudget {
 static final long WINDOW_MS=60_000L,BACKOFF_MS=5_000L;
 static final int BUDGET=3;
 /** Settings actions, as android.provider.Settings defines them. */
 static final String ACTION_SETTINGS="android.settings.SETTINGS",
  ACTION_HOME_SETTINGS="android.settings.HOME_SETTINGS",
  ACTION_MANAGE_DEFAULT_APPS_SETTINGS="android.settings.MANAGE_DEFAULT_APPS_SETTINGS";
 enum Action { RECREATE_NOW, RECREATE_AFTER_BACKOFF, SHOW_ESCAPE, REBUILD_ON_START }
 private boolean started;
 private long windowStart;
 private int lossesInWindow;
 /**
  * Counts one renderer loss at elapsed-realtime now and says how the activity recovers. home: Alpha
  * holds HOME now; crashed: RenderProcessGoneDetail.didCrash(); visible: the activity is started.
  */
 synchronized Action onLoss(long now,boolean home,boolean crashed,boolean visible){
  if(!crashed&&!visible)return Action.REBUILD_ON_START;
  if(!started||now-windowStart>WINDOW_MS||now<windowStart){started=true;windowStart=now;lossesInWindow=0;}
  lossesInWindow++;
  if(lossesInWindow>BUDGET&&home)return Action.SHOW_ESCAPE;
  if(!visible)return Action.REBUILD_ON_START;
  return lossesInWindow<=BUDGET?Action.RECREATE_NOW:Action.RECREATE_AFTER_BACKOFF;
 }
 /**
  * Whether Alpha is the HOME app now. The HOME role answers when Android has one (API 29+); before
  * that, the activity the HOME intent resolves to. Without either, how the live task started.
  */
 static boolean currentHome(Boolean roleHeld,String resolvedHomePackage,String ownPackage,boolean startedAsHome){
  if(roleHeld!=null)return roleHeld;
  if(resolvedHomePackage!=null)return resolvedHomePackage.equals(ownPackage);
  return startedAsHome;
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
