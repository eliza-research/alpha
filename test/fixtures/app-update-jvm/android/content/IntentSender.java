package android.content;
public class IntentSender {
 public final Intent callback;
 public IntentSender(){this(null);}
 public IntentSender(Intent callback){this.callback=callback;}
}
