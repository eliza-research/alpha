package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserExternalHandoff;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import org.json.JSONArray;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real package visibility/filter resolution only; no external Activity or network dispatch. */
public final class BrowserInstalledResolverInstrumentedTest {
 @Test public void installedBrowserPublishesAnEligibleGenericHttpsFilter()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse("https://browser-handoff.invalid/")).addCategory(Intent.CATEGORY_DEFAULT).addCategory(Intent.CATEGORY_BROWSABLE);
  List<ResolveInfo> resolved=context.getPackageManager().queryIntentActivities(intent,PackageManager.MATCH_DEFAULT_ONLY|PackageManager.GET_RESOLVED_FILTER);
  JSONArray eligible=new JSONArray();
  for(ResolveInfo row:resolved){
   if(row.activityInfo==null||row.activityInfo.applicationInfo==null||context.getPackageName().equals(row.activityInfo.packageName)||!row.activityInfo.exported||!row.activityInfo.enabled||!row.activityInfo.applicationInfo.enabled)continue;
   if(BrowserExternalHandoff.genericHttps(row.filter))eligible.put(row.activityInfo.packageName+"/"+row.activityInfo.name);
  }
  assertTrue("Owned image must have a real eligible installed browser under product package visibility",eligible.length()>0);
  Bundle receipt=new Bundle();receipt.putString("installedGenericHttpsBrowsers",eligible.toString());InstrumentationRegistry.getInstrumentation().addResults(receipt);
 }
}
