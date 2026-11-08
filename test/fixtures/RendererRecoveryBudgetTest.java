package ai.elizaresearch.alphaphone;

import java.util.Set;

/** Host-JVM check of the renderer recovery budget and escape decision. Not Android evidence. */
public final class RendererRecoveryBudgetTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static final RendererRecoveryBudget.Action NOW=RendererRecoveryBudget.Action.RECREATE_NOW,
  LATER=RendererRecoveryBudget.Action.RECREATE_AFTER_BACKOFF,ESCAPE=RendererRecoveryBudget.Action.SHOW_ESCAPE;
 public static void main(String[] args){
  // Standalone (not HOME): three immediate recoveries, then a 5 s backoff inside the window.
  RendererRecoveryBudget budget=new RendererRecoveryBudget();
  long t=1_000L;
  for(int loss=1;loss<=3;loss++)check(budget.onLoss(t+loss*1_000L,false)==NOW,"loss "+loss+" recreates at once");
  check(budget.onLoss(t+4_000L,false)==LATER,"the fourth loss in the window backs off");
  check(RendererRecoveryBudget.delay(LATER)==5_000L&&RendererRecoveryBudget.delay(NOW)==0L,"backoff is 5 s");
  check(budget.onLoss(t+59_000L,false)==LATER,"still inside the 60 s window");
  // The window runs from its first loss; a loss after it starts a new budget.
  check(budget.onLoss(t+1_000L+60_001L,false)==NOW,"after the window the budget resets");
  check(budget.onLoss(t+62_000L,false)==NOW&&budget.onLoss(t+63_000L,false)==NOW,"a fresh window has three immediate recoveries");
  check(budget.onLoss(t+64_000L,false)==LATER,"and then backs off again");
  // Clock zero is a valid start (elapsed realtime early in boot).
  RendererRecoveryBudget early=new RendererRecoveryBudget();
  for(int loss=0;loss<3;loss++)check(early.onLoss(loss,false)==NOW,"a window may start at time zero");
  check(early.onLoss(3,false)==LATER,"and is counted from there");
  // HOME: the fourth loss inside the window shows the native escape view instead of recreating.
  RendererRecoveryBudget home=new RendererRecoveryBudget();
  for(int loss=1;loss<=3;loss++)check(home.onLoss(loss*100L,true)==NOW,"HOME loss "+loss+" recreates at once");
  check(home.onLoss(400L,true)==ESCAPE,"N=4 losses inside the window while HOME show the escape view");
  check(home.onLoss(500L,true)==ESCAPE,"Reload that dies again inside the window shows it again, never a loop");
  check(RendererRecoveryBudget.delay(ESCAPE)==0L,"the escape view does not schedule a recreate");
  check(home.onLoss(100L+60_001L,true)==NOW,"a loss after the window recreates again");
  // Three losses spread beyond the window never reach the escape view.
  RendererRecoveryBudget spread=new RendererRecoveryBudget();
  for(int loss=0;loss<8;loss++)check(spread.onLoss(loss*61_000L,true)==NOW,"spread losses recover at once");
  try{
   RendererRecoveryBudget overflow=new RendererRecoveryBudget();overflow.onLoss(1,true);
   var counter=RendererRecoveryBudget.class.getDeclaredField("lossesInWindow");counter.setAccessible(true);counter.setInt(overflow,Integer.MAX_VALUE);
   check(overflow.onLoss(2,true)==ESCAPE,"a saturated window never wraps back to immediate recovery");
  }catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
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
