package ai.elizaresearch.notificationfixture;

import android.app.*;
import android.content.*;
import android.os.Bundle;
import android.widget.TextView;
import java.util.UUID;

/** No network, data access or other-app operations. All effects use an exact UUID namespace. */
public final class FixtureActivity extends Activity {
 @Override public void onCreate(Bundle state){super.onCreate(state);handle(getIntent());}
 @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handle(intent);}
 private void handle(Intent intent){
  String nonce=intent.getStringExtra("nonce"),operation=intent.getStringExtra("operation");
  TextView text=new TextView(this);text.setTextSize(22);setContentView(text);
  try{
   if(nonce==null||!UUID.fromString(nonce).toString().equals(nonce))throw new IllegalArgumentException();
   String channel="synthetic-"+nonce;NotificationManager manager=getSystemService(NotificationManager.class);
   if("cleanup".equals(operation)){for(int id=1;id<=5;id++)manager.cancel(nonce,id);manager.deleteNotificationChannel(channel);getSharedPreferences("receipts",0).edit().remove(nonce).commit();text.setText("Cleaned "+nonce);return;}
   if("tap".equals(operation)){int count=getSharedPreferences("receipts",0).getInt(nonce,0)+1;if(!getSharedPreferences("receipts",0).edit().putInt(nonce,count).commit())throw new IllegalStateException();text.setText("Tapped "+nonce+" count "+count);return;}
   if(!"post".equals(operation)&&!"replace".equals(operation))throw new IllegalArgumentException();
   manager.createNotificationChannel(new NotificationChannel(channel,"Synthetic witness "+nonce,NotificationManager.IMPORTANCE_LOW));
   int maximum="replace".equals(operation)?1:5;
   for(int id=1;id<=maximum;id++){
    Intent target=new Intent(this,FixtureActivity.class).putExtra("nonce",nonce).putExtra("operation","tap").setData(android.net.Uri.parse("fixture://"+getPackageName()+"/"+nonce+"/"+id));
    PendingIntent tap=PendingIntent.getActivity(this,id,target,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    Notification.Builder builder=new Notification.Builder(this,channel).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Synthetic "+operation+" "+nonce+" "+id).setContentText("Canary "+getPackageName()+" "+nonce).setVisibility(id==2?Notification.VISIBILITY_PRIVATE:id==3?Notification.VISIBILITY_SECRET:Notification.VISIBILITY_PUBLIC).setOngoing(id==4).setAutoCancel(id==1);
    if(id!=5)builder.setContentIntent(tap);
    manager.notify(nonce,id,builder.build());
   }
   text.setText("Posted "+nonce+" "+operation);
  }catch(Exception failure){text.setText("Synthetic fixture unavailable");}
 }
}
