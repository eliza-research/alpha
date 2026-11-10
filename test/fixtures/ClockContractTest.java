package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.clock.ClockDays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Host-JVM check of the shared Clock repeat-day admission (plugin-native-system clock.ClockDays) as Alpha
 * uses it. Not Android, Clock app or AlarmClock evidence; the shared intents and receiver are tested upstream. */
public final class ClockContractTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static boolean refused(Runnable body){try{body.run();return false;}catch(IllegalArgumentException expected){return true;}}
 public static void main(String[] args)throws Exception {
  // Alpha's own form: 1-7 unique ascending days, exactly as before.
  check(ClockDays.strict(new JSONArray("[2,3,4,5,6]")).equals(List.of(2,3,4,5,6)),"weekdays");
  check(ClockDays.strict(JSONObject.NULL)==null&&ClockDays.strict((Object)null)==null,"no days is a one-time alarm");
  for(String bad:new String[]{"[]","[3,2]","[1,1]","[0]","[8]","[1.5]","[\"1\"]","[1,2,3,4,5,6,7,1]"})check(refused(()->ClockDays.strict(new JSONArray(bad))),"strict refuses "+bad);
  check(refused(()->ClockDays.strict("1,2")),"strict refuses a non-array");
  // Agent operations: what the pinned upstream clockDays admits never fails here.
  check(ClockDays.agent(new JSONArray("[3,2]")).equals(List.of(2,3)),"unordered days are sorted");
  check(ClockDays.agent(new JSONArray("[7,1,4]")).equals(List.of(1,4,7)),"Saturday, Sunday, Wednesday");
  check(ClockDays.agent(new JSONArray("[]"))==null,"an explicit empty list is a one-time alarm");
  check(ClockDays.agent(new JSONArray("[5,5]")).equals(List.of(5)),"duplicates collapse");
  check(ClockDays.agent(JSONObject.NULL)==null,"omitted days");
  for(String bad:new String[]{"[0]","[8]","[1.5]","[\"1\"]","[1,2,3,4,5,6,7,1]",}){check(refused(()->ClockDays.agent(new JSONArray(bad))),"agent refuses "+bad);}
  check(refused(()->ClockDays.agent("[1]")),"agent refuses a non-array");
  // Outputs of upstream validateClockOperation, passed by the node test: every admitted operation's
  // days normalize to Alpha's strict form (or to a one-time alarm), never to a refusal.
  if(args.length>0){
   JSONArray cases=new JSONArray(args[0]);
   for(int i=0;i<cases.length();i++){
    JSONObject operation=cases.getJSONObject(i);
    List<Integer> days=ClockDays.agent(operation.opt("days"));
    if(days!=null)ClockDays.strict(days);
    JSONArray expected=operation.getJSONArray("expected");
    check(expected.length()==0?days==null:days!=null&&days.toString().equals(expected.toString().replace(",",", ")),"upstream case "+operation);
   }
  }
  System.out.println("PASS clock contract");
 }
}
