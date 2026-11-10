package ai.elizaresearch.alphaphone;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.WebViewListener;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** One bounded startup window; only harmless readiness queries can be retried. */
final class StartupDocumentProbe implements AutoCloseable {
 private final Handler main=new Handler(Looper.getMainLooper());
 private final ReadinessEpoch epoch=new ReadinessEpoch();
 private final long deadline=SystemClock.elapsedRealtime()+20000;
 private Bridge bridge;
 private WebView web;
 private boolean closed, awaitingNavigation;
 private long waitId;
 private volatile String last="No ready document";
 private final WebViewListener listener=new WebViewListener(){
  @Override public void onPageStarted(WebView view){if(view==web){epoch.navigated();awaitingNavigation=false;last="Document navigation started";}}
  @Override public void onPageLoaded(WebView view){if(view==web)last="Document loaded; renderer readiness pending";}
  @Override public void onPageCommitVisible(WebView view,String url){if(view==web)last="Document committed; renderer readiness pending";}
 };
 StartupDocumentProbe()throws Exception{
  WebViewTestDriver.withActivity(MainActivity.class,a->{bridge=a.getBridge();web=bridge.getWebView();bridge.addWebViewListener(listener);});
 }
 void expectNavigation()throws Exception{
  BoundedActivityScenario.main(()->{awaitingNavigation=true;epoch.navigated();last="Waiting for requested document replacement";});
 }
 String awaitReady(boolean requestLive)throws Exception{
  // Mock readiness is acceptable only in test-mocks builds; product builds must reach live.
  final boolean requireLive=requestLive||!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS;
  CountDownLatch done=new CountDownLatch(1);AtomicReference<String> answer=new AtomicReference<>();AtomicReference<Throwable> failure=new AtomicReference<>();
  long remaining=deadline-SystemClock.elapsedRealtime();
  if(remaining<=0)throw new AssertionError("Startup readiness deadline expired: "+last);
  main.post(()->{
   final long thisWait=++waitId;
   Runnable poll=new Runnable(){public void run(){
    if(closed||waitId!=thisWait)return;
    if(SystemClock.elapsedRealtime()>=deadline){done.countDown();return;}
    try{
     // Do not query the old document while its replacement is visibly loading.
     if(!awaitingNavigation&&web.getProgress()==100){
      final long request=epoch.issue(SystemClock.elapsedRealtime()),document=epoch.generation();
      if(request!=0)web.evaluateJavascript("(()=>{const d=document.documentElement,m=d.dataset.connectionMode;const ready=m==='live'?!!d.dataset.activeView:m==='mock'&&!!document.querySelector('[data-screen]')&&!!document.querySelector('.mock-mode-banner button');return document.readyState==='complete'&&ready?m:null})()",value->{
       if(closed||waitId!=thisWait||!epoch.complete(document,request))return;
       if("\"live\"".equals(value)||(!requireLive&&"\"mock\"".equals(value))){answer.set("\"live\"".equals(value)?"live":"mock");waitId++;done.countDown();}
       else last="Renderer has not reached "+(requireLive?"live":"live/mock")+" readiness";
      });
     }
     main.postDelayed(this,100);
    }catch(Throwable error){failure.set(error);waitId++;done.countDown();}
   }};
   poll.run();
  });
  boolean finished=done.await(remaining,TimeUnit.MILLISECONDS);
  if(failure.get()!=null)throw new AssertionError("Startup readiness probe failed",failure.get());
  if(!finished||answer.get()==null)throw new AssertionError("Startup document did not become ready within 20s: "+last);
  return answer.get();
 }
 @Override public void close()throws Exception{
  BoundedActivityScenario.main(()->{closed=true;waitId++;epoch.close();if(bridge!=null)bridge.removeWebViewListener(listener);});
 }
}
