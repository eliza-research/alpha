package ai.elizaresearch.alphaphone;
import ai.eliza.voice.LiveSegmentPipe;
import java.util.concurrent.*;
import org.json.JSONObject;

/** Source regression for failure notification throwing during executor rejection. */
public final class AsrPipeFailureProbe {
 public static void main(String[]args)throws Exception {
  LiveSegmentPipe pipe=new LiveSegmentPipe(new LiveSegmentPipe.Transport(){public void check(){}public JSONObject post(JSONObject body){throw new AssertionError("No provider");}public void cancelInFlight(){if(args.length>0&&args[0].equals("cancel"))throw new IllegalStateException("cancel fixture");}},
   new LiveSegmentPipe.Sink(){public void result(JSONObject value){}public void failed(String code){throw new IllegalStateException("receiver fixture");}},
   "00000000-0000-0000-0000-000000000001",null);
  boolean threw=false;try{pipe.start(task->{throw new RejectedExecutionException("worker fixture");});}catch(IllegalStateException expected){threw=true;}
  CompletableFuture<?> closed=(CompletableFuture<?>)Trace.read(pipe,"closed");
  System.out.println(new JSONObject().put("callbackThrew",threw).put("readySettled",pipe.ready().isDone()).put("closeSettled",closed.isDone()).put("finished",Trace.read(pipe,"finished")));
 }
}
