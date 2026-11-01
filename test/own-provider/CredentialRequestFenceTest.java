import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
import ai.eliza.plugins.agent.runtime.CredentialRequestFence;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
public final class CredentialRequestFenceTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void rejected(Runnable work){try{work.run();throw new AssertionError("stale request accepted");}catch(IllegalStateException expected){}}
 public static void main(String[] args){
  Object lock=new Object();long[] now={0};CredentialIntentFence intents=new CredentialIntentFence(lock);CredentialRequestFence requests=new CredentialRequestFence(lock,intents,()->now[0]);
  for(int i=0;i<256;i++){String id=requests.reserve();requests.cancel(id);rejected(()->requests.begin(id));}
  for(int i=0;i<256;i++)requests.cancel(UUID.randomUUID().toString());
  String id=requests.reserve();long intent=requests.begin(id);requests.require(id,intent);rejected(()->requests.begin(id));requests.require(id,intent);requests.finish(id,intent);rejected(()->requests.begin(id));
  for(int i=0;i<256;i++){String next=requests.reserve();long n=requests.begin(next);requests.require(next,n);requests.finish(next,n);requests.cancel(next);}
  String old=requests.reserve();long older=requests.begin(old);String latest=requests.reserve();long current=requests.begin(latest);requests.cancel(old);requests.require(latest,current);requests.finish(old,older);requests.finish(latest,current);
  List<String> abandoned=new ArrayList<>();for(int i=0;i<64;i++)abandoned.add(requests.reserve());rejected(()->requests.reserve());now[0]=120_000_000_001L;
  String fresh=requests.reserve();long active=requests.begin(fresh);for(String stale:abandoned){requests.cancel(stale);rejected(()->requests.begin(stale));}requests.require(fresh,active);requests.finish(fresh,active);
  System.out.println("PASS request lease lifecycle: repeated reorder/cancel, unknown and finished cancellation, expiry, duplicate dispatch and fresh configuration");
 }
}
