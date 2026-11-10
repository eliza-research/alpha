package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.TextView;
import java.io.InputStream;
import java.security.MessageDigest;

/** Test APK only: receives content in a different app UID, never uploads or persists it. */
public final class ShareReceiverActivity extends Activity {
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);
  String result;
  try {
   java.util.ArrayList<Uri> items;
   if(Intent.ACTION_SEND_MULTIPLE.equals(getIntent().getAction()))items=getIntent().getParcelableArrayListExtra(Intent.EXTRA_STREAM);
   else if(Intent.ACTION_SEND.equals(getIntent().getAction())){items=new java.util.ArrayList<>();items.add(getIntent().getParcelableExtra(Intent.EXTRA_STREAM));}
   else throw new IllegalArgumentException();
   if(items==null||items.isEmpty()||items.size()>20)throw new IllegalArgumentException();
   StringBuilder hashes=new StringBuilder();
   for(Uri uri:items){
   if(uri==null||!"content".equals(uri.getScheme()))throw new IllegalArgumentException();
   MessageDigest digest=MessageDigest.getInstance("SHA-256");
   try(InputStream input=getContentResolver().openInputStream(uri)){
    if(input==null)throw new IllegalStateException();
    byte[] buffer=new byte[8192];int count,total=0;
    while((count=input.read(buffer))!=-1){total+=count;if(total>16*1024*1024)throw new IllegalArgumentException();digest.update(buffer,0,count);}
   }
   StringBuilder hex=new StringBuilder();for(byte b:digest.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
   hashes.append("SHA-256: ").append(hex).append('\n');
   }
   result="Read access verified\nItem count: "+items.size()+"\n"+hashes+"Receiver UID: "+android.os.Process.myUid();
  } catch(Exception failure){result="Share receiver could not read this item";}
  TextView text=new TextView(this);text.setTextSize(18);text.setPadding(24,48,24,24);text.setText(result);setContentView(text);
 }
}
