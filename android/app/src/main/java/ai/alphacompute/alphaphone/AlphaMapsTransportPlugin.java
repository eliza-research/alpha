package ai.alphacompute.alphaphone;

import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.app.Activity;

/** The navigation methods own the screen-off session of AlphaNavigationService:
 * the renderer starts it only from an explicit Start, mirrors the next instruction, and
 * hears exactly one navigationStopped event when the notification's Stop ends it. Each bridge
 * has its own instance; the session and its stop event belong to the one that started it. */
@CapacitorPlugin(name="AlphaMapsTransport")
public final class AlphaMapsTransportPlugin extends Plugin {
 private volatile boolean destroyed;
 private final AlphaNavigationService.StopListener navigationStops=(session,reason)->{if(destroyed)return;JSObject event=new JSObject();event.put("sessionId",session);event.put("reason",reason);notifyListeners("navigationStopped",event);};
 private static String text(PluginCall call,String name){String value=call.getString(name,"");return value==null?"":value.length()>200?value.substring(0,200):value;}
 @PluginMethod public void consumeNavigationOpen(PluginCall call){
  Activity activity=getActivity();JSObject result=new JSObject();
  result.put("open",!destroyed&&activity instanceof MainActivity&&!activity.isFinishing()&&!activity.isDestroyed()&&((MainActivity)activity).consumeNavigationOpen());call.resolve(result);
 }
 @PluginMethod public void clearNavigationOpen(PluginCall call){Activity activity=getActivity();if(activity instanceof MainActivity)((MainActivity)activity).clearNavigationOpen();call.resolve();}
 @PluginMethod public void navigationAvailability(PluginCall call){JSObject result=new JSObject();result.put("background",AlphaNavigationService.declared(getContext()));result.put("activeSessionId",AlphaNavigationService.activeSession());call.resolve(result);}
 @PluginMethod public void startNavigation(PluginCall call){
  String session=call.getString("sessionId");
  if(session==null||!session.matches(AlphaNavigationService.SESSION_PATTERN)){call.reject("Invalid navigation session");return;}
  if(!AlphaNavigationService.declared(getContext())){call.reject("Background navigation is unavailable in this build","unavailable");return;}
  if(!AlphaNavigationService.locationGranted(getContext())){call.reject("Location permission is required for background navigation","permission-denied");return;}
  // A Start delivered after this renderer closed has no guidance behind it and nothing left to stop it.
  if(destroyed){call.reject("Background navigation is unavailable: Alpha closed","unavailable");return;}
  try{
   Activity activity=getActivity();
   if(!AlphaNavigationService.start(getContext(),session,text(call,"title"),text(call,"text"),navigationStops,
     activity==null?null:activity.getComponentName(),()->!destroyed)){
    call.reject(destroyed?"Background navigation is unavailable: Alpha closed":"Background navigation changed","unavailable");return;
   }
   call.resolve();
  }
  catch(RuntimeException refused){call.reject("Background navigation could not start","unavailable");}
 }
 @PluginMethod public void updateNavigation(PluginCall call){
  String session=call.getString("sessionId");JSObject result=new JSObject();
  try{result.put("active",session!=null&&AlphaNavigationService.update(getContext(),session,text(call,"title"),text(call,"text"),navigationStops));}catch(RuntimeException unavailable){result.put("active",false);}
  call.resolve(result);
 }
 @PluginMethod public void stopNavigation(PluginCall call){
  String session=call.getString("sessionId");JSObject result=new JSObject();
  result.put("stopped",session!=null&&AlphaNavigationService.stop(getContext(),session,navigationStops,"app"));call.resolve(result);
 }
 @Override protected void handleOnDestroy(){
  // Guidance lives in the renderer that started the session; without it the session must not keep a stale
  // notification. A session another bridge owns keeps running. The flag comes first: a Start still running
  // on the bridge thread sees it and retires its own session, and no event goes to this closed renderer.
  destroyed=true;
  AlphaNavigationService.stop(getContext(),null,navigationStops,"renderer-closed");
 }
}
