package ai.alphacompute.alphaphone;
public final class NavigationOpenRequestTest {
 private static void require(boolean value){if(!value)throw new AssertionError("Navigation intent delivery");}
 public static void main(String[] args){
  NavigationOpenRequest request=new NavigationOpenRequest();
  require(!request.consume(0));
  request.offer(10); // Cold Activity captures before the renderer has any listeners.
  require(request.consume(2000));require(!request.consume(2001));
  request.offer(3000);require(request.consume(3001));require(!request.consume(3002));
  request.offer(4000);request.clear();require(!request.consume(4001));
  request.offer(5000);require(!request.consume(35000));
  request.offer(40000);require(request.consume(40001));require(!request.consume(40002));
  System.out.println("PASS bounded one-use Maps notification requests");
 }
}
