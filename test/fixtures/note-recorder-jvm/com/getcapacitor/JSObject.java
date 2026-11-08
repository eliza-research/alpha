package com.getcapacitor;
/** Host stub of Capacitor's JSONObject subclass: put never throws and returns this. */
public class JSObject extends org.json.JSONObject {
 @Override public JSObject put(String k,Object v){try{super.put(k,v);}catch(org.json.JSONException e){throw new RuntimeException(e);}return this;}
 @Override public JSObject put(String k,boolean v){return put(k,(Object)v);}
 @Override public JSObject put(String k,long v){return put(k,(Object)v);}
 @Override public JSObject put(String k,int v){return put(k,(Object)v);}
 @Override public JSObject put(String k,double v){return put(k,(Object)v);}
}
