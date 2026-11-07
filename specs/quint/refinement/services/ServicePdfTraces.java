package ai.elizaresearch.alphaphone;
import android.os.*;
import android.graphics.Bitmap;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;

public final class ServicePdfTraces {
 static void send(Messenger target,Messenger replies,ParcelFileDescriptor descriptor,int index)throws Exception {
  Bundle data=new Bundle();data.putParcelable("descriptor",descriptor);data.putString("request","00000000-0000-0000-0000-000000000001");data.putInt("page",index);
  Message message=Message.obtain(null,1);message.replyTo=replies;message.setData(data);target.send(message);
 }
 static boolean busy(IsolatedPdfService service)throws Exception {return ((java.util.concurrent.atomic.AtomicBoolean)Trace.read(service,"busy")).get();}
 public static void main(String[] args)throws Exception {
  JSONArray traces=new JSONArray();
  for(boolean protection:new boolean[]{true,false}) {
   SharedMemory.last=null;Bitmap.last=null;SharedMemory.protectionWorks=protection;Handler.immediate.clear();
   IsolatedPdfService service=new IsolatedPdfService();List<Bundle> replies=new ArrayList<>();
   Messenger reply=new Messenger(new Handler(Looper.getMainLooper(),m->{replies.add(m.getData());return true;}));
   Messenger target=(Messenger)Trace.read(service,"endpoint");
   Trace trace=new Trace("actual-pdf-worker-protection-"+protection,Trace.fields("busy",busy(service),"descriptor",false));trace.value.put("init",Trace.action("initFor",true));
   try {
    ParcelFileDescriptor input=new ParcelFileDescriptor();send(target,reply,input,0);
    trace.step("receive",Trace.fields("busy",busy(service)),1,true);
    ParcelFileDescriptor rejected=new ParcelFileDescriptor();send(target,reply,rejected,0);
    trace.step("receive",Trace.fields("busy",busy(service),"rejected",replies.size()),2,true);
    if(!rejected.closed)throw new AssertionError("refused request descriptor leaked");
    long deadline=System.nanoTime()+5000000000L;
    while((!input.closed||Handler.immediate.size()<2)&&System.nanoTime()<deadline)Thread.sleep(1);
    if(!input.closed)throw new AssertionError("worker failed to clean input");
    trace.macro("worker renders, unmaps, protects and cleans before main reply",Trace.fields("descriptor",!input.closed,"bitmap",!Bitmap.last.recycled,"mapped",SharedMemory.last.mapped,"readOnly",SharedMemory.last.readOnly),Trace.action("openPage",true),Trace.action("render"),Trace.action("unmap"),Trace.action("protect",protection),Trace.action("cleanup"));
    Handler.drain();Bundle result=replies.get(replies.size()-1);
    trace.step("reply",Trace.fields("busy",busy(service),"shared",!SharedMemory.last.closed,"recipientHandle",result.containsKey("pixels"),"publishedReadOnly",result.containsKey("pixels")&&SharedMemory.last.readOnly),true);
    traces.put(trace.value);
   } finally {service.onDestroy();Handler.immediate.clear();}
  }
  System.out.println(traces);
 }
}
