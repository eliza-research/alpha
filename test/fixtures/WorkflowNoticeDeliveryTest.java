package ai.elizaresearch.alphaphone;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
public final class WorkflowNoticeDeliveryTest {
 static String binding="a".repeat(64);
 static class Store implements WorkflowNoticeDelivery.Storage {String raw;int writes,failAt=-1;boolean after;public String read(String slot){if(!WorkflowNoticeDelivery.SLOT.equals(slot))throw new AssertionError();return raw;}public void write(String slot,String value)throws Exception{writes++;if(writes==failAt&&!after)throw new Exception("Disk");raw=value;if(writes==failAt)throw new Exception("Disk after commit");}}
 static class Poster implements WorkflowNoticeDelivery.Poster {int posts,allowedReads,matchReads;boolean allowed=true,active=true,fail;Map<String,String> delivered=new HashMap<>();public boolean allowed(){allowedReads++;return allowed;}public void post(String id,String title,String body)throws Exception{posts++;delivered.put(id,title+"\n"+body);if(fail)throw new Exception("Uncertain binder return");}public boolean matches(String id,String title,String body){matchReads++;return active&&Objects.equals(delivered.get(id),title+"\n"+body);}}
 interface Work {void run()throws Exception;}
 static void require(boolean value){if(!value)throw new AssertionError();}
 static void rejects(Class<? extends Exception> type,String pattern,Work work)throws Exception{try{work.run();}catch(Exception thrown){if(type.isInstance(thrown)&&(pattern==null||thrown.getMessage()!=null&&java.util.regex.Pattern.compile(pattern).matcher(thrown.getMessage()).find()))return;throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/ but got "+thrown,thrown);}throw new AssertionError("Expected "+type.getSimpleName()+" /"+pattern+"/");}
 static WorkflowNoticeDelivery delivery(Store store,Poster poster){return new WorkflowNoticeDelivery(store,poster);}
 public static void main(String[] args)throws Exception{
  Store s=new Store();Poster p=new Poster();WorkflowNoticeDelivery d=delivery(s,p);
  require("succeeded".equals(d.publish("one",binding,"Exact title","Exact body")));require(p.posts==1);require(!s.raw.contains("Exact title")&&!s.raw.contains("Exact body"));
  p.active=false;require("succeeded".equals(delivery(s,p).publish("one",binding,"Exact title","Exact body")));require(p.posts==1);
  rejects(IllegalStateException.class,"receipt mismatch",()->d.publish("one",binding,"Changed title","Exact body"));rejects(IllegalStateException.class,"receipt mismatch",()->d.publish("one",binding,"Exact title","Changed body"));rejects(IllegalStateException.class,"receipt mismatch",()->d.publish("one","b".repeat(64),"Exact title","Exact body"));require(p.posts==1);
  Store deniedStore=new Store();Poster denied=new Poster();denied.allowed=false;require("failed".equals(delivery(deniedStore,denied).publish("denied",binding,"Title","Body")));denied.allowed=true;require("failed".equals(delivery(deniedStore,denied).publish("denied",binding,"Title","Body")));require(denied.posts==0);
  for(boolean after:new boolean[]{false,true}){Store blocked=new Store();Poster poster=new Poster();blocked.failAt=1;blocked.after=after;rejects(Exception.class,"^Disk",()->delivery(blocked,poster).publish("blocked",binding,"Title","Body"));require(poster.posts==0);if(after){blocked.failAt=-1;require("unknown".equals(delivery(blocked,poster).publish("blocked",binding,"Title","Body")));require(poster.posts==0);}}
  Store terminal=new Store();Poster posted=new Poster();terminal.failAt=2;rejects(Exception.class,"^Disk",()->delivery(terminal,posted).publish("terminal",binding,"Title","Body"));require(posted.posts==1);terminal.failAt=-1;require("succeeded".equals(delivery(terminal,posted).receipt("terminal",binding,"Title","Body")));require(posted.posts==1);
  Store late=new Store();Poster pending=new Poster();pending.active=false;require("unknown".equals(delivery(late,pending).publish("late",binding,"Title","Body")));require("unknown".equals(delivery(late,pending).publish("late",binding,"Title","Body")));pending.active=true;require("succeeded".equals(delivery(late,pending).receipt("late",binding,"Title","Body")));require(pending.posts==1);
  Store uncertain=new Store();Poster exception=new Poster();exception.fail=true;require("unknown".equals(delivery(uncertain,exception).publish("exception",binding,"Title","Body")));require(exception.posts==1);require("succeeded".equals(delivery(uncertain,exception).receipt("exception",binding,"Title","Body")));require(exception.posts==1);
  // At the cap no intent was committed or notice shown: failed is definite, and
  // cannot fabricate a retained receipt. Restart and repeated requests do nothing.
  Store capacity=new Store();Poster full=new Poster();JSONObject entries=new JSONObject();JSONObject retained=new JSONObject(s.raw).getJSONObject("one");
  for(int i=0;i<512;i++)entries.put("retained"+i,new JSONObject(retained.toString()));
  capacity.raw=entries.toString();String beforeFull=capacity.raw;
  for(int attempt=0;attempt<3;attempt++){
   WorkflowNoticeDelivery bounded=delivery(capacity,full);
   require("failed".equals(bounded.publish("new",binding,"Title","Body")));
   require("unknown".equals(bounded.receipt("new",binding,"Title","Body")));
   require(capacity.writes==0&&beforeFull.equals(capacity.raw)&&new JSONObject(capacity.raw).length()==512&&!new JSONObject(capacity.raw).has("new"));
   require(full.posts==0&&full.allowedReads==0&&full.matchReads==0&&full.delivered.isEmpty());
  }
  Store invalid=new Store();Poster untouched=new Poster();WorkflowNoticeDelivery checked=delivery(invalid,untouched);for(String id:new String[]{"","../escape","x".repeat(129)})rejects(IllegalArgumentException.class,"Invalid notification binding",()->checked.publish(id,binding,"Title","Body"));for(String title:new String[]{"","x".repeat(201),"bad\0text"})rejects(IllegalArgumentException.class,"Invalid notification text",()->checked.publish("bad",binding,title,"Body"));for(String body:new String[]{"","x".repeat(2001),"bad\0text"})rejects(IllegalArgumentException.class,"Invalid notification text",()->checked.publish("bad",binding,"Title",body));require(untouched.posts==0&&invalid.writes==0);
  Store concurrent=new Store();Poster once=new Poster();ExecutorService pool=Executors.newFixedThreadPool(6);try{List<Future<String>> calls=new ArrayList<>();for(int i=0;i<12;i++)calls.add(pool.submit(()->delivery(concurrent,once).publish("same",binding,"Title","Body")));for(Future<String> call:calls)require("succeeded".equals(call.get()));require(once.posts==1);}finally{pool.shutdownNow();}
  System.out.println("PASS workflow notices: exact replay binding, dismissal, denial, storage faults, late confirmation, bounded history and concurrency");
 }
}
