package com.getcapacitor;
/** Records how many times a bridge call was settled. */
public class PluginCall {
 private final JSObject data;
 private final java.util.concurrent.CountDownLatch answered=new java.util.concurrent.CountDownLatch(1);
 public final java.util.concurrent.atomic.AtomicInteger resolved=new java.util.concurrent.atomic.AtomicInteger(),rejected=new java.util.concurrent.atomic.AtomicInteger();
 public PluginCall(JSObject data){this.data=data;}
 public String getString(String key){return data.optString(key);}
 public JSObject getData(){return data;}
 public void resolve(){resolved.incrementAndGet();answered.countDown();}
 public void resolve(JSObject value){resolve();}
 public void reject(String message){rejected.incrementAndGet();answered.countDown();}
 public void awaitAnswer()throws InterruptedException{if(!answered.await(20,java.util.concurrent.TimeUnit.SECONDS))throw new AssertionError("The call was never settled");}
}
