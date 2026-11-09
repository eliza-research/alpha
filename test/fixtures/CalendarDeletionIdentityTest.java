package ai.elizaresearch.alphaphone;
public final class CalendarDeletionIdentityTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void refuses(Runnable action){try{action.run();throw new AssertionError("Expected refusal");}catch(IllegalArgumentException expected){}}
 public static void main(String[] args){
  CalendarDeletionIdentity legacy=CalendarDeletionIdentity.parse("42");legacy.requireProviderShape(false);refuses(()->legacy.requireProviderShape(true));check(legacy.legacy);
  for(String id:new String[]{"delete2:42:event","delete2:42:series","delete2:42:occurrence:0","delete2:42:occurrence:1791766800000"}){
   CalendarDeletionIdentity parsed=CalendarDeletionIdentity.parse(id);check(id.equals(parsed.encoded()));check(parsed.eventId==42&&!parsed.legacy);
   parsed.requireProviderShape(parsed.scope!=CalendarDeletionIdentity.Scope.EVENT);refuses(()->parsed.requireProviderShape(parsed.scope==CalendarDeletionIdentity.Scope.EVENT));
  }
  CalendarDeletionIdentity first=CalendarDeletionIdentity.parse("delete2:42:occurrence:1791766800000"),next=CalendarDeletionIdentity.parse("delete2:42:occurrence:1791853200000");check(!first.encoded().equals(next.encoded()));check(first.scope!=CalendarDeletionIdentity.parse("delete2:42:series").scope);
  for(String malformed:new String[]{"", "0", "042", "-1", "+1", "42 ", "delete2:42", "delete2:42:event:0", "delete2:42:series:0", "delete2:42:occurrence", "delete2:42:occurrence:-1", "delete2:42:occurrence:01", "delete2:42:occurrence:9223372036854775808", "delete2:9223372036854775808:event", "delete2:42:occurrence:1:series", "delete3:42:event", "DELETE2:42:event", "delete2:42:all", "delete2:42:occurrence:NaN"})refuses(()->CalendarDeletionIdentity.parse(malformed));
 }
}
