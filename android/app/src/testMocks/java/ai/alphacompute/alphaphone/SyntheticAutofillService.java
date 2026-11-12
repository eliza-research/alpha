package ai.alphacompute.alphaphone;

import android.app.assist.AssistStructure;
import android.os.Build;
import android.os.CancellationSignal;
import android.service.autofill.*;
import android.view.View;
import android.view.autofill.AutofillId;
import android.view.autofill.AutofillValue;
import android.widget.RemoteViews;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

/** Debug APK only. Dormant unless explicitly armed by native instrumentation.
 * Never persists, logs, transmits, or saves an AssistStructure or credentials. */
public final class SyntheticAutofillService extends AutofillService {
 public static volatile boolean armed;
 public static final AtomicInteger accepted = new AtomicInteger();
 public static final AtomicInteger rejected = new AtomicInteger();
 /** Every fill request that reaches this provider while armed, before any filtering. */
 public static final AtomicInteger requests = new AtomicInteger();
 static final AtomicInteger emptyRejections = new AtomicInteger();
 public static final String LABEL="Alpha synthetic login";
 public static final String USER="alpha-synthetic-user";
 public static final String PASSWORD="synthetic-password-not-an-account";
 private static final class Fields {
  AutofillId user,password;
  boolean focusedNodePresent, hasAutofillContent;
 }
 private void fields(AssistStructure.ViewNode node,boolean validDomain,AutofillId focusedId,Fields result) {
  // WebView supplies the domain of the focused frame. Never inherit trust across
  // a child that declares a different frame origin.
  String domain = node.getWebDomain(), scheme = node.getWebScheme();
  if(domain!=null)validDomain="example.com".equals(domain) && "https".equals(scheme);
  AutofillId nodeId = node.getAutofillId();
  String[] hints=node.getAutofillHints();
  android.view.ViewStructure.HtmlInfo html = node.getHtmlInfo();
  result.focusedNodePresent |= focusedId != null && focusedId.equals(nodeId);
  result.hasAutofillContent |= domain != null || scheme != null || html != null
    || (hints != null && hints.length != 0) || node.getAutofillType() != View.AUTOFILL_TYPE_NONE
    || node.getAutofillValue() != null
    || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA && nodeId != null && nodeId.isVirtual());
  if(validDomain && hints!=null)for(String hint:hints){
   if("username".equals(hint))result.user=nodeId;
   if("current-password".equals(hint)||"password".equals(hint))result.password=nodeId;
  }
  // Chromium versions may expose HTML autocomplete rather than Android hints.
  if(validDomain && html!=null && html.getAttributes()!=null)
   for(android.util.Pair<String,String> attribute:html.getAttributes())
    if("autocomplete".equals(attribute.first)){
     if("username".equals(attribute.second))result.user=nodeId;
     if("current-password".equals(attribute.second))result.password=nodeId;
    }
  for(int i=0;i<node.getChildCount();i++)fields(node.getChildAt(i),validDomain,focusedId,result);
 }
 @Override public void onFillRequest(FillRequest request,CancellationSignal cancellation,FillCallback callback) {
  if(armed)requests.incrementAndGet();
  if(!armed || cancellation.isCanceled()){callback.onSuccess(null);return;}
  List<FillContext> contexts = request.getFillContexts();
  FillContext latest = contexts.get(contexts.size()-1);
  AssistStructure structure=latest.getStructure();
  if(!getPackageName().equals(structure.getActivityComponent().getPackageName())){rejected.incrementAndGet();callback.onSuccess(null);return;}
  AutofillId focusedId = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? latest.getFocusedId() : null;
  Fields found=new Fields();
  for(int i=0;i<structure.getWindowNodeCount();i++)fields(structure.getWindowNodeAt(i).getRootViewNode(),false,focusedId,found);
  if(found.user==null||found.password==null){
   rejected.incrementAndGet();
   if(contexts.size()==1 && latest.getRequestId()==request.getId() && focusedId!=null
     && !found.focusedNodePresent && !found.hasAutofillContent) emptyRejections.incrementAndGet();
   callback.onSuccess(null);
   return;
  }
  RemoteViews presentation=new RemoteViews(getPackageName(),android.R.layout.simple_list_item_1);
  presentation.setTextViewText(android.R.id.text1,LABEL);
  Dataset dataset=new Dataset.Builder(presentation).setValue(found.user,AutofillValue.forText(USER)).setValue(found.password,AutofillValue.forText(PASSWORD)).build();
  accepted.incrementAndGet();callback.onSuccess(new FillResponse.Builder().addDataset(dataset).build());
 }
 @Override public void onSaveRequest(SaveRequest request,SaveCallback callback){callback.onSuccess();}
}
