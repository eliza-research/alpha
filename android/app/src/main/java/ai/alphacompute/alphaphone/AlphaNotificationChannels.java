package ai.alphacompute.alphaphone;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;

/**
 * Display names and descriptions for channels that shared code creates without a description, or
 * with a name that repeats another row (app review #855, NOTIF-13). Channel IDs are installed
 * identities and never change here. Only a channel that already exists is touched, with its own
 * importance: Android then updates just its name and description, so nothing is created early and
 * no owner choice (importance, sound, lock screen) is replaced.
 *
 * No channel is put in a group. The shared posters decide "blocked" from the channel alone, and the
 * shared notice routing reads a grouped eliza_updates as owner-customised, so grouping needs a
 * shared change first.
 */
final class AlphaNotificationChannels {
 private AlphaNotificationChannels(){}
 /** Channel ID, display name (null keeps the installed name), description. */
 static final String[][] ROWS={
  {"eliza_alerts",null,"Notices Alpha marks as urgent."},
  {"eliza_notifications",null,"Notices Alpha marks as important."},
  {"eliza_updates",null,"Routine notices from Alpha."},
  {"eliza_quiet",null,"Low-priority notices from Alpha. Shown without sound."},
  // The shared reminder store names this channel after the older one plus " (due)"; it is the one in use.
  {AlphaReminders.CONFIGURATION.channelId,"Reminders (not used)","Kept so your earlier sound and alert choices carry over. Reminder alerts use Reminders."},
  {AlphaReminders.CONFIGURATION.dueChannelId(),"Reminders","Reminders you set on this phone. Android may delay them."},
 };
 /** Safe to repeat: a channel whose name and description already match is left alone. */
 static void describe(Context context){
  try{
   NotificationManager manager=context.getSystemService(NotificationManager.class);
   if(manager==null)return;
   for(String[] row:ROWS){
    NotificationChannel existing=manager.getNotificationChannel(row[0]);
    if(existing==null)continue;
    String name=row[1]==null?String.valueOf(existing.getName()):row[1];
    if(name.contentEquals(existing.getName())&&row[2].equals(existing.getDescription()))continue;
    NotificationChannel next=new NotificationChannel(row[0],name,existing.getImportance());
    next.setDescription(row[2]);
    manager.createNotificationChannel(next);
   }
  }catch(RuntimeException unavailable){/* Presentation only; retried on the next start or return to the app. */}
 }
}
