package ai.alphacompute.alphaphone;

import android.app.assist.AssistStructure;
import android.os.CancellationSignal;
import android.service.autofill.*;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;
import java.util.concurrent.atomic.AtomicInteger;

/** Debug APK only. Dormant unless explicitly armed by native instrumentation.
 * Never persists, logs, transmits, or saves an AssistStructure or credentials. */
public final class SyntheticAutofillService extends AutofillService {
 public static volatile boolean armed;
 public static final AtomicInteger accepted = new AtomicInteger();
 public static final AtomicInteger rejected = new AtomicInteger();
 /** Every fill request that reaches this provider while armed, before any filtering. */
 public static final AtomicInteger requests = new AtomicInteger();
 public static final String LABEL="Alpha synthetic login";
 public static final String USER="alpha-synthetic-user";
 public static final String PASSWORD="synthetic-password-not-an-account";
 private static final class Fields { AutofillId user,password; }
 private void fields(AssistStructure.ViewNode node,boolean validDomain,Fields result) {
  // WebView supplies the domain of the focused frame. Never inherit trust across
  // a child that declares a different frame origin.
  if(node.getWebDomain()!=null)validDomain="example.com".equals(node.getWebDomain()) && "https".equals(node.getWebScheme());
  String[] hints=node.getAutofillHints();
  if(validDomain && hints!=null)for(String hint:hints){
   if("username".equals(hint))result.user=node.getAutofillId();
   if("current-password".equals(hint)||"password".equals(hint))result.password=node.getAutofillId();
  }
  // Chromium versions may expose HTML autocomplete rather than Android hints.
  if(validDomain && node.getHtmlInfo()!=null && node.getHtmlInfo().getAttributes()!=null)
   for(android.util.Pair<String,String> attribute:node.getHtmlInfo().getAttributes())
    if("autocomplete".equals(attribute.first)){
     if("username".equals(attribute.second))result.user=node.getAutofillId();
     if("current-password".equals(attribute.second))result.password=node.getAutofillId();
    }
  for(int i=0;i<node.getChildCount();i++)fields(node.getChildAt(i),validDomain,result);
 }
 @Override public void onFillRequest(FillRequest request,CancellationSignal cancellation,FillCallback callback) {
  if(armed)requests.incrementAndGet();
  if(!armed || cancellation.isCanceled()){callback.onSuccess(null);return;}
  AssistStructure structure=request.getFillContexts().get(request.getFillContexts().size()-1).getStructure();
  if(!getPackageName().equals(structure.getActivityComponent().getPackageName())){rejected.incrementAndGet();callback.onSuccess(null);return;}
  Fields found=new Fields();for(int i=0;i<structure.getWindowNodeCount();i++)fields(structure.getWindowNodeAt(i).getRootViewNode(),false,found);
  if(found.user==null||found.password==null){rejected.incrementAndGet();callback.onSuccess(null);return;}
  RemoteViews presentation=new RemoteViews(getPackageName(),android.R.layout.simple_list_item_1);
  presentation.setTextViewText(android.R.id.text1,LABEL);
  Dataset dataset=new Dataset.Builder(presentation).setValue(found.user,AutofillValue.forText(USER)).setValue(found.password,AutofillValue.forText(PASSWORD)).build();
  accepted.incrementAndGet();callback.onSuccess(new FillResponse.Builder().addDataset(dataset).build());
 }
 @Override public void onSaveRequest(SaveRequest request,SaveCallback callback){callback.onSuccess();}
}
