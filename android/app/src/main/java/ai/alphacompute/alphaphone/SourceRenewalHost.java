package ai.alphacompute.alphaphone;
import android.content.Context;
import org.json.*;
final class SourceRenewalHost {
 private static SourceRenewalNotices instance;
 static synchronized SourceRenewalNotices get(Context supplied){if(instance==null){Context context=supplied.getApplicationContext();AlphaCredentialStore store=new AlphaCredentialStore(context);HostedNoticePoster poster=new HostedNoticePoster(context);instance=new SourceRenewalNotices(new SourceRenewalNotices.Store(){public String read()throws Exception{return store.readCredentialSlot(SourceRenewalNotices.SLOT);}public void write(String value)throws Exception{store.writeCredentialSlot(SourceRenewalNotices.SLOT,value);}},selection->{try{return new NativeDigestHost(context).read(new JSONObject(selection.toString()).put("action","describe"));}catch(NativeDigestSources.SourceChanged changed){throw new SourceRenewalNotices.RenewalStale(changed.getMessage());}},new SourceRenewalNotices.Poster(){public void post(String key,long expiry,long now){if(!poster.allowed()||!poster.postRenewal(key,expiry,now))throw new IllegalStateException("Notifications unavailable");}public void cancel(String key){poster.cancelRenewal(key);}});}return instance;}
}
