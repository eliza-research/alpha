package ai.elizaresearch.alphaphone;

/** Product wire identity for deletion scope. Numeric legacy identities never authorize recurrence. */
final class CalendarDeletionIdentity {
 enum Scope { EVENT, OCCURRENCE, SERIES }
 final long eventId,originalInstanceTime;
 final Scope scope;
 final boolean legacy;
 private CalendarDeletionIdentity(long eventId,Scope scope,long originalInstanceTime,boolean legacy){this.eventId=eventId;this.scope=scope;this.originalInstanceTime=originalInstanceTime;this.legacy=legacy;}
 static CalendarDeletionIdentity parse(String value){
  if(value==null||value.length()>128)throw new IllegalArgumentException("Invalid Calendar deletion identity");
  if(value.matches("[1-9][0-9]*"))return new CalendarDeletionIdentity(number(value,false),Scope.EVENT,-1,true);
  String[] pieces=value.split(":",-1);
  if(pieces.length<3||!"delete2".equals(pieces[0]))throw new IllegalArgumentException("Unknown Calendar deletion identity");
  long eventId=number(pieces[1],false);
  if(pieces.length==3&&"event".equals(pieces[2]))return new CalendarDeletionIdentity(eventId,Scope.EVENT,-1,false);
  if(pieces.length==3&&"series".equals(pieces[2]))return new CalendarDeletionIdentity(eventId,Scope.SERIES,-1,false);
  if(pieces.length==4&&"occurrence".equals(pieces[2]))return new CalendarDeletionIdentity(eventId,Scope.OCCURRENCE,number(pieces[3],true),false);
  throw new IllegalArgumentException("Ambiguous Calendar deletion scope");
 }
 private static long number(String value,boolean zero){
  if(!value.matches(zero?"0|[1-9][0-9]*":"[1-9][0-9]*"))throw new IllegalArgumentException("Noncanonical Calendar identity");
  try{return Long.parseLong(value);}catch(NumberFormatException invalid){throw new IllegalArgumentException("Calendar identity overflow",invalid);}
 }
 /** Recurrence is provider evidence, never inferred from a renderer's claim. */
 void requireProviderShape(boolean recurring){
  if(recurring==(scope==Scope.EVENT))throw new IllegalArgumentException("Calendar recurrence scope changed");
 }
 String encoded(){return legacy?Long.toString(eventId):"delete2:"+eventId+":"+(scope==Scope.EVENT?"event":scope==Scope.SERIES?"series":"occurrence:"+originalInstanceTime);}
}
