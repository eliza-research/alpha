package ai.alphacompute.alphaphone;

import android.app.Notification;
import android.app.PendingIntent;
import android.service.notification.StatusBarNotification;
import static org.junit.Assert.*;

/** The posted reminder's actions, found by title: Done, Snooze and the configured question action (AlphaReminders: "Ask Alpha"). */
final class ReminderNotificationActions {
 static final String DONE="Done",SNOOZE="Snooze 10 minutes",ASK=AlphaReminders.CONFIGURATION.questionActionLabel;
 private ReminderNotificationActions(){}
 /** Requires exactly these three actions, so a changed set fails here rather than at a later index. */
 static Notification.Action action(StatusBarNotification posted,String title){
  Notification.Action[] actions=posted.getNotification().actions;assertNotNull("Reminder actions",actions);assertEquals("Done, Snooze and "+ASK,3,actions.length);
  Notification.Action found=null;
  for(Notification.Action action:actions){String label=action.title==null?null:action.title.toString();assertTrue("Unexpected reminder action: "+label,DONE.equals(label)||SNOOZE.equals(label)||ASK.equals(label));if(title.equals(label))found=action;}
  assertNotNull("Reminder action "+title,found);return found;
 }
 static PendingIntent intent(StatusBarNotification posted,String title){return action(posted,title).actionIntent;}
}
