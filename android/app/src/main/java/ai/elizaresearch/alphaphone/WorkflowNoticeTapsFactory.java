package ai.elizaresearch.alphaphone;
import android.content.Context;
final class WorkflowNoticeTapsFactory {
 private static WorkflowNoticeDelivery.Storage storage(Context context){AlphaCredentialStore store=new AlphaCredentialStore(context);return new WorkflowNoticeDelivery.Storage(){public String read(String key)throws Exception{return store.readCredentialSlot(key);}public void write(String key,String value)throws Exception{store.writeCredentialSlot(key,value);}};}
 static WorkflowNoticeTaps create(Context context){return new WorkflowNoticeTaps(storage(context));}
 static WorkflowNoticeDelivery delivery(Context context){return new WorkflowNoticeDelivery(storage(context),new WorkflowNoticePoster(context));}
}
