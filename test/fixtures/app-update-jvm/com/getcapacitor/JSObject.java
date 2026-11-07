package com.getcapacitor;
public class JSObject {
 private final java.util.Map<String,Object> values=new java.util.HashMap<>();
 public JSObject put(String key,Object value){values.put(key,value);return this;}
 public boolean optBoolean(String key,boolean fallback){Object value=values.get(key);return value instanceof Boolean?(Boolean)value:fallback;}
 public long optLong(String key){Object value=values.get(key);return value instanceof Long?(Long)value:0;}
 public String optString(String key){Object value=values.get(key);return value instanceof String?(String)value:null;}
}
