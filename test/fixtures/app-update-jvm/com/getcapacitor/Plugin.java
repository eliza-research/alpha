package com.getcapacitor;
public class Plugin {
 public android.app.Activity activity;public android.content.Context context;
 public android.app.Activity getActivity(){return activity;}
 public android.content.Context getContext(){return context;}
 protected void handleOnResume(){}
 protected void handleOnDestroy(){}
 public void load(){}
 public static java.util.function.BiConsumer<Plugin,JSObject> ready=(plugin,value)->{
  try{var method=plugin.getClass().getDeclaredMethod("activateUpdate",PluginCall.class);method.setAccessible(true);method.invoke(plugin,new PluginCall(value.put("ready",true)));}catch(Exception error){throw new RuntimeException(error);}
 };
 public final java.util.List<String> events=new java.util.concurrent.CopyOnWriteArrayList<>();
 public void notifyListeners(String event,JSObject value){events.add(event+":"+value.optString("outcome"));if(event.equals("alphaUpdateReady"))ready.accept(this,value);}

}
