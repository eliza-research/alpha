package ai.alphacompute.alphaphone;

import java.util.Set;

/** Host-JVM check of the renderer recovery budget and escape decision. Not Android evidence. */
public final class RendererRecoveryBudgetTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static final RendererRecoveryBudget.Action NOW=RendererRecoveryBudget.Action.RECREATE_NOW,
  LATER=RendererRecoveryBudget.Action.RECREATE_AFTER_BACKOFF,ESCAPE=RendererRecoveryBudget.Action.SHOW_ESCAPE,
  REBUILD=RendererRecoveryBudget.Action.REBUILD_ON_START;
 public static void main(String[] args){
  // Standalone (not HOME): three immediate recoveries, then a 5 s backoff inside the window.
  RendererRecoveryBudget budget=new RendererRecoveryBudget();
  long t=1_000L;
  for(int loss=1;loss<=3;loss++)check(budget.onLoss(t+loss*1_000L,false,true,true)==NOW,"loss "+loss+" recreates at once");
  check(budget.onLoss(t+4_000L,false,true,true)==LATER,"the fourth loss in the window backs off");
  check(RendererRecoveryBudget.delay(LATER)==5_000L&&RendererRecoveryBudget.delay(NOW)==0L,"backoff is 5 s");
  check(budget.onLoss(t+59_000L,false,true,true)==LATER,"still inside the 60 s window");
  // The window runs from its first loss; a loss after it starts a new budget.
  check(budget.onLoss(t+1_000L+60_001L,false,true,true)==NOW,"after the window the budget resets");
  check(budget.onLoss(t+62_000L,false,true,true)==NOW&&budget.onLoss(t+63_000L,false,true,true)==NOW,"a fresh window has three immediate recoveries");
  check(budget.onLoss(t+64_000L,false,true,true)==LATER,"and then backs off again");
  // Clock zero is a valid start (elapsed realtime early in boot).
  RendererRecoveryBudget early=new RendererRecoveryBudget();
  for(int loss=0;loss<3;loss++)check(early.onLoss(loss,false,true,true)==NOW,"a window may start at time zero");
  check(early.onLoss(3,false,true,true)==LATER,"and is counted from there");
  // HOME: the fourth loss inside the window shows the native escape view instead of recreating.
  RendererRecoveryBudget home=new RendererRecoveryBudget();
  for(int loss=1;loss<=3;loss++)check(home.onLoss(loss*100L,true,true,true)==NOW,"HOME loss "+loss+" recreates at once");
  check(home.onLoss(400L,true,true,true)==ESCAPE,"N=4 losses inside the window while HOME show the escape view");
  check(home.onLoss(500L,true,true,true)==ESCAPE,"Reload that dies again inside the window shows it again, never a loop");
  check(RendererRecoveryBudget.delay(ESCAPE)==0L,"the escape view does not schedule a recreate");
  check(home.onLoss(100L+60_001L,true,true,true)==NOW,"a loss after the window recreates again");
  // Three losses spread beyond the window never reach the escape view.
  RendererRecoveryBudget spread=new RendererRecoveryBudget();
  for(int loss=0;loss<8;loss++)check(spread.onLoss(loss*61_000L,true,true,true)==NOW,"spread losses recover at once");
  // A renderer Android reclaimed in the background is rebuilt on the next start and never counted.
  RendererRecoveryBudget pressure=new RendererRecoveryBudget();
  for(int loss=1;loss<=10;loss++)check(pressure.onLoss(loss*100L,true,false,false)==REBUILD,"background reclaim "+loss+" waits for the next start");
  for(int loss=1;loss<=3;loss++)check(pressure.onLoss(1_000L+loss,true,true,true)==NOW,"reclaims left the whole budget for visible losses");
  // A reclaim while visible is counted: the page is needed now, and a loop must still end.
  RendererRecoveryBudget shown=new RendererRecoveryBudget();
  for(int loss=1;loss<=3;loss++)check(shown.onLoss(loss,true,false,true)==NOW,"visible reclaim "+loss+" recreates at once");
  check(shown.onLoss(4,true,false,true)==ESCAPE,"visible reclaims count toward the escape view while HOME");
  check(new RendererRecoveryBudget().onLoss(5,false,false,true)==NOW,"a visible reclaim recreates at once when not HOME");
  // A real crash in the background is counted but still rebuilt on the next start.
  RendererRecoveryBudget hidden=new RendererRecoveryBudget();
  for(int loss=1;loss<=3;loss++)check(hidden.onLoss(loss,false,true,false)==REBUILD,"background crash "+loss+" waits for the next start");
  check(hidden.onLoss(4,false,true,false)==REBUILD,"past the budget a background crash still waits when not HOME");
  check(hidden.onLoss(5,false,true,true)==LATER,"background crashes used the budget, so a visible one backs off");
  check(hidden.onLoss(6,true,true,false)==ESCAPE,"past the budget while HOME the escape view waits for the owner");
  // HOME is decided now: the role when Android has one, else the HOME resolver, else the task kind.
  check(RendererRecoveryBudget.currentHome(true,null,"alpha",false),"role held: HOME although the task began from the icon");
  check(!RendererRecoveryBudget.currentHome(false,"alpha","alpha",true),"role not held: not HOME although the task began as HOME");
  check(RendererRecoveryBudget.currentHome(null,"alpha","alpha",false)&&!RendererRecoveryBudget.currentHome(null,"android","alpha",true),"no role: the HOME resolver decides");
  check(RendererRecoveryBudget.currentHome(null,null,"alpha",true)&&!RendererRecoveryBudget.currentHome(null,null,"alpha",false),"neither: how the task started");
  // Saturation is retained from the reviewed release: a long crash loop cannot wrap.
  try{RendererRecoveryBudget saturated=new RendererRecoveryBudget();saturated.onLoss(1,true,true,true);java.lang.reflect.Field losses=RendererRecoveryBudget.class.getDeclaredField("lossesInWindow");losses.setAccessible(true);losses.setInt(saturated,Integer.MAX_VALUE);check(saturated.onLoss(2,true,true,true)==ESCAPE,"count overflow reopened crash loop");}catch(Exception failure){throw new AssertionError(failure);}
  // The launcher surface (HOME) and the assistant surface share the renderer: both report each death.
  RendererRecoveryBudget shared=new RendererRecoveryBudget();
  for(int death=1;death<=3;death++){
   long launcher=shared.deaths(),assistant=shared.deaths();
   check(shared.onLoss(10_000L+death,true,true,true,launcher)==NOW&&shared.deaths()==death,"the first report counts death "+death);
   check(shared.onLoss(10_000L+death,false,true,false,assistant)==REBUILD&&shared.deaths()==death,"the hidden assistant's report of death "+death+" spends nothing");
  }
  // Only the fourth death in the window is past the budget; counted per activity, the second was.
  long launcherAt=shared.deaths(),assistantAt=shared.deaths();
  check(shared.onLoss(10_004L,false,true,true,assistantAt)==LATER,"the fourth death backs the assistant off");
  check(shared.onLoss(10_004L,true,true,true,launcherAt)==ESCAPE,"and the same death shows the launcher's escape view from its own HOME flag");
  check(shared.deaths()==4,"four deaths, four counts");
  // Reports arrive in either order, also after the first activity was already recreated.
  RendererRecoveryBudget order=new RendererRecoveryBudget();
  long first=order.deaths(),second=order.deaths();
  check(order.onLoss(1,false,true,true,second)==NOW&&order.deaths()==1,"the assistant may report first");
  long recreated=order.deaths();
  check(order.onLoss(2,true,true,true,first)==NOW&&order.deaths()==1,"the launcher's late report of that death spends nothing");
  check(order.onLoss(3,false,true,true,recreated)==NOW&&order.deaths()==2,"a WebView created after the death counts its own loss");
  // A background reclaim is no death: the visible surface's report of the same loss is the one counted.
  RendererRecoveryBudget reclaim=new RendererRecoveryBudget();
  long hiddenAt=reclaim.deaths(),shownAt=reclaim.deaths();
  check(reclaim.onLoss(1,false,false,false,hiddenAt)==REBUILD&&reclaim.deaths()==0,"a hidden reclaim is not counted");
  check(reclaim.onLoss(1,true,false,true,shownAt)==NOW&&reclaim.deaths()==1,"the visible surface counts it once");
  check(reclaim.onLoss(2,false,false,false,hiddenAt)==REBUILD&&reclaim.deaths()==1,"a stale hidden reclaim still waits for the next start");
  // A lone activity: every loss is its own death, exactly as without a creation count.
  RendererRecoveryBudget alone=new RendererRecoveryBudget();
  for(int loss=1;loss<=3;loss++)check(alone.onLoss(loss,true,true,true,alone.deaths())==NOW,"a lone activity recovers three times");
  check(alone.onLoss(4,true,true,true,alone.deaths())==ESCAPE,"then reaches the escape view");
  // Buttons resolve to stock Settings activities, with the documented fallbacks.
  Set<String> all=Set.of("android.settings.SETTINGS","android.settings.HOME_SETTINGS","android.settings.MANAGE_DEFAULT_APPS_SETTINGS");
  check("android.settings.SETTINGS".equals(RendererRecoveryBudget.settingsAction(all::contains)),"Open Android Settings uses ACTION_SETTINGS");
  check("android.settings.HOME_SETTINGS".equals(RendererRecoveryBudget.homeChoiceAction(all::contains)),"Choose Home app prefers ACTION_HOME_SETTINGS");
  Set<String> noHome=Set.of("android.settings.SETTINGS","android.settings.MANAGE_DEFAULT_APPS_SETTINGS");
  check("android.settings.MANAGE_DEFAULT_APPS_SETTINGS".equals(RendererRecoveryBudget.homeChoiceAction(noHome::contains)),"then default apps");
  Set<String> settingsOnly=Set.of("android.settings.SETTINGS");
  check("android.settings.SETTINGS".equals(RendererRecoveryBudget.homeChoiceAction(settingsOnly::contains)),"then Settings itself");
  check(RendererRecoveryBudget.homeChoiceAction(action->false)==null&&RendererRecoveryBudget.settingsAction(action->false)==null,"no stock handler shows no button");
  System.out.println("PASS renderer recovery budget");
 }
}
