package ai.elizaresearch.alphaphone;
import org.json.JSONArray;
import org.json.JSONObject;
/** Calls the real policy. Inputs and acceptance counts represent controlled service ports. */
public final class KeyboardDictationTraces {
 private final KeyboardDictationPolicy policy=new KeyboardDictationPolicy();
 private int inserted;private String op="init";private int inputTicket;private boolean sameEditor=true,account=true;
 private JSONObject observe()throws Exception{return new JSONObject().put("phase",policy.state().name().toLowerCase()).put("generation",Trace.read(policy,"generation")).put("inserted",inserted).put("op",op).put("inputTicket",inputTicket).put("sameEditor",sameEditor).put("account",account);}
 private void act(Trace t,String name,Object...args)throws Exception{
  op=name;inputTicket=0;sameEditor=true;account=true;
  if(name.equals("open"))policy.open();else if(name.equals("start"))policy.start();else if(name.equals("cancel"))policy.close();
  else if(name.equals("stop")){inputTicket=(Integer)args[0];policy.stop(inputTicket);}
  else if(name.equals("finish")){inputTicket=(Integer)args[0];sameEditor=(Boolean)args[1];account=(Boolean)args[2];if(policy.finish(inputTicket,sameEditor,account))inserted++;}
  else throw new IllegalArgumentException(name);
  t.step(name,observe(),args);
 }
 private static JSONObject scenario(int n)throws Exception{
  KeyboardDictationTraces f=new KeyboardDictationTraces();Trace t=new Trace("dictation-"+n,f.observe());
  f.act(t,"open");f.act(t,"start");
  if(n==5)f.act(t,"stop",1);
  f.act(t,"stop",2);
  if(n==1){f.act(t,"finish",2,true,true);f.act(t,"finish",2,true,true);}
  if(n==2){f.act(t,"cancel");f.act(t,"finish",2,true,true);}
  if(n==3){f.act(t,"open");f.act(t,"start");f.act(t,"stop",4);f.act(t,"finish",2,true,true);f.act(t,"finish",4,true,true);}
  if(n==4){f.act(t,"finish",2,false,true);f.act(t,"finish",2,true,false);f.act(t,"finish",2,true,true);}
  if(n==5)f.act(t,"finish",2,true,true);
  return t.value;
 }
 public static void main(String[]args)throws Exception{JSONArray traces=new JSONArray();for(int n=1;n<=5;n++)traces.put(scenario(n));System.out.print(traces);}
}
