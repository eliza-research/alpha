package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
/**
 * Test APK only. Stands in for AlphaCloudSignInPlugin: the in-app email-code screen stores the
 * synthetic fixture key in the real encrypted slot, as the native host does, and returns only the
 * non-secret outcome. No Steward, Cloud or browser traffic.
 */
@CapacitorPlugin(name="AlphaCloudSignIn")
public final class InboxFixtureSignIn extends Plugin {
 static final String EMAIL="fixture-owner@example.invalid",CODE="123456",ATTEMPT="12345678-1234-4234-8234-123456789abc";
 /** Fills the in-app sign-in screen through its own controls. */
 static final String DRIVE_EMAIL="(()=>{const toggle=document.getElementById('alpha-sign-in-other-methods')?.previousElementSibling;if(toggle?.getAttribute('aria-expanded')==='false')toggle.click();const field=document.querySelector('.alpha-cloud-sign-in input[name=email]');field.value='"+EMAIL+"';[...document.querySelectorAll('.alpha-cloud-sign-in button')].find(b=>b.textContent.trim()==='Email me a code').click();})()";
 static final String DRIVE_CODE="(()=>{const field=document.querySelector('.alpha-cloud-sign-in input[name=one-time-code]');field.value='"+CODE+"';[...document.querySelectorAll('.alpha-cloud-sign-in button')].find(b=>b.textContent.trim()==='Verify').click();})()";
 @PluginMethod public void startEmail(PluginCall call){
  if(!EMAIL.equals(call.getString("email"))||!"production".equals(call.getString("environment"))){call.reject("invalid-request","invalid-request");return;}
  long now=System.currentTimeMillis();call.resolve(new JSObject().put("attemptId",ATTEMPT).put("expiresAt",now+600000).put("resendAt",now+60000));
 }
 @PluginMethod public void verifyEmail(PluginCall call){
  if(!ATTEMPT.equals(call.getString("attemptId"))||!CODE.equals(call.getString("code"))){call.reject("invalid-code","invalid-code");return;}
  try{
   long expiresAt=System.currentTimeMillis()+30L*24*3600*1000;
   new AlphaCredentialStore(getContext()).writeCredentialSlot("cloud:production",new JSONObject().put("credentialId",java.util.UUID.randomUUID().toString()).put("token",InboxFixtureConnection.token()).put("expiresAt",expiresAt).toString());
   call.resolve(new JSObject().put("status","authenticated").put("environment","production").put("expiresAt",expiresAt).put("accountCreated",false));
  }catch(Exception failure){call.reject("storage","storage");}
 }
 @PluginMethod public void startGoogle(PluginCall call){call.reject("browser-unavailable","browser-unavailable");}
 @PluginMethod public void verifyMfa(PluginCall call){call.reject("expired","expired");}
 @PluginMethod public void cancel(PluginCall call){call.resolve();}
 @PluginMethod public void status(PluginCall call){call.resolve(new JSObject().put("active",false).put("inApp",true).put("google",false).put("email",true));}
}
