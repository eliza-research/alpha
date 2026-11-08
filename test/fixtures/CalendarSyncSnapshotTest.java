package ai.elizaresearch.alphaphone;
import android.content.*;import android.database.Cursor;import android.net.Uri;import java.util.*;
public final class CalendarSyncSnapshotTest {
 static final String GENERATION="00000000-0000-4000-8000-000000000001";
 static Map<String,Object> row(Object...pairs){Map<String,Object> out=new HashMap<>();for(int i=0;i<pairs.length;i+=2)out.put((String)pairs[i],pairs[i+1]);return out;}
 static void check(boolean value){if(!value)throw new AssertionError();}
 interface Checked{void run()throws Exception;}
 static void refuses(Checked work)throws Exception{try{work.run();throw new AssertionError("Expected refusal");}catch(IllegalStateException|IllegalArgumentException|SecurityException expected){}}
 static final class Provider extends ContentResolver {
  Map<String,Object> source=row("_id",7L,"account_name","Alpha Phone","account_type","LOCAL","name","alpha-phone-local","calendar_access_level",700L,"ownerAccount","Alpha Phone","cal_sync1",GENERATION);
  List<Map<String,Object>> events=new ArrayList<>(),attendees=new ArrayList<>(),reminders=new ArrayList<>(),properties=new ArrayList<>();
  String nullTable;int instances;
  Provider(){events.add(row("_id",42L,"calendar_id",7L,"title","Preserve rich event","dtstart",0L,"duration","P1D","eventTimezone","UTC","allDay",1L,"rrule","FREQ=MONTHLY;BYDAY=-1FR","exdate","20261225","deleted",0L));attendees.add(row("_id",8L,"event_id",42L,"attendeeEmail","fixture@example.invalid","attendeeStatus",1L));reminders.add(row("_id",9L,"event_id",42L,"minutes",15L,"method",1L));properties.add(row("_id",10L,"event_id",42L,"name","meeting","value","preserve-private-metadata"));}
  public Cursor query(Uri uri,String[] fields,String where,String[] args,String sort){
   String[] parts=uri.value.split("/");String table=parts[0];if(table.equals("instances")){instances++;throw new AssertionError("Sync must not use Instances");}if(table.equals(nullTable))return null;
   List<Map<String,Object>> all=table.equals("calendars")?List.of(source):table.equals("events")?events:table.equals("attendees")?attendees:table.equals("reminders")?reminders:properties;
   List<Map<String,Object>> selected=new ArrayList<>();
   for(Map<String,Object> r:all){
    if(parts.length>1&&!Objects.equals(r.get("_id"),Long.valueOf(parts[1])))continue;
    if(where!=null){
     if(table.equals("events")){if(!Objects.equals(r.get("calendar_id"),Long.valueOf(args[0]))||!(Objects.equals(r.get("_id"),Long.valueOf(args[1]))||Objects.equals(r.get("original_id"),Long.valueOf(args[2]))))continue;}
     else if(where.equals("event_id=?")){if(!Objects.equals(r.get("event_id"),Long.valueOf(args[0])))continue;}
     else{String ids=where.substring(where.indexOf('(')+1,where.indexOf(')'));if(!Arrays.asList(ids.split(",")).contains(String.valueOf(r.get("event_id"))))continue;}
    }
    selected.add(r);
   }
   selected.sort(Comparator.comparingLong(r->((Number)r.get("_id")).longValue()));
   return new Cursor(){int index=-1;Object value(int i){return selected.get(index).get(fields[i]);}public boolean moveToFirst(){index=0;return index<selected.size();}public boolean moveToNext(){return ++index<selected.size();}public boolean isNull(int i){return value(i)==null;}public int getType(int i){return value(i) instanceof Number?1:3;}public String getString(int i){return value(i)==null?null:value(i).toString();}public long getLong(int i){return ((Number)value(i)).longValue();}public int getInt(int i){return (int)getLong(i);}public void close(){}};
  }
  public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations){throw new AssertionError("Snapshots must not dispatch");}
 }
 static CalendarSyncSnapshot read(Provider p)throws Exception{return CalendarSyncSnapshot.read(p,7,42,"Alpha Phone","alpha-phone-local",GENERATION);}
 public static void main(String[] ignored)throws Exception{
  Provider p=new Provider();CalendarSyncSnapshot initial=read(p);check(!initial.missing&&!initial.deleted&&p.instances==0);
  check(initial.revision.equals(read(p).revision));p.source.put("calendar_displayName","Renamed display");check(initial.sourceRevision.equals(read(p).sourceRevision));
  String previous=initial.revision;p.attendees.get(0).put("attendeeStatus",2L);check(!previous.equals(read(p).revision));previous=read(p).revision;p.reminders.get(0).put("minutes",30L);check(!previous.equals(read(p).revision));previous=read(p).revision;p.properties.get(0).put("value","changed");check(!previous.equals(read(p).revision));
  previous=read(p).revision;p.events.add(row("_id",43L,"calendar_id",7L,"original_id",42L,"originalInstanceTime",1000L));check(!previous.equals(read(p).revision));
  var assertions=read(p).assertions();check(assertions.stream().allMatch(op->op.type.equals("assert")));check(assertions.stream().anyMatch(op->op.uri.value.equals("events")&&op.count==2));check(assertions.stream().anyMatch(op->op.uri.value.equals("attendees/8")&&op.values.getAsLong("attendeeStatus")==2));check(assertions.stream().anyMatch(op->op.uri.value.equals("properties/10")));
  p.events.get(0).put("deleted",1L);check(read(p).deleted&&!read(p).missing);
  Provider missing=new Provider();missing.events.clear();missing.attendees.clear();missing.reminders.clear();missing.properties.clear();check(read(missing).missing);check(read(missing).assertions().stream().anyMatch(op->op.uri.value.equals("events/42")&&op.count==0));
  for(String table:new String[]{"calendars","events","attendees","reminders","properties"}){Provider failed=new Provider();failed.nullTable=table;refuses(()->read(failed));}
  Provider moved=new Provider();moved.events.get(0).put("calendar_id",8L);refuses(()->read(moved));
  Provider foreign=new Provider();foreign.source.put("account_type","com.google");refuses(()->read(foreign));Provider regenerated=new Provider();regenerated.source.put("cal_sync1","00000000-0000-4000-8000-000000000002");refuses(()->read(regenerated));
  Provider orphan=new Provider();orphan.events.clear();refuses(()->read(orphan));
  Provider oversized=new Provider();oversized.properties.get(0).put("value","x".repeat(1024*1024+1));refuses(()->read(oversized));
  Provider weekly=new Provider();weekly.attendees.clear();weekly.events.get(0).putAll(row("dtstart",1793955600000L,"duration","P3600S","allDay",0L,"rrule","FREQ=WEEKLY","exdate",null));check(read(weekly).semantic().getString("endAt").equals("2026-11-06T10:00:00.000Z"));
  Provider timed=new Provider();timed.attendees.clear();timed.events.get(0).putAll(row("dtstart",1793955600000L,"duration",null,"dtend",1793959200000L,"allDay",0L,"rrule",null,"exdate",null));
  var event=read(timed).semantic();check(event.getString("startAt").equals("2026-11-06T09:00:00.000Z")&&event.getString("endAt").equals("2026-11-06T10:00:00.000Z"));
  timed.events.get(0).putAll(row("dtstart",1793955600250L,"dtend",1793959200999L));event=read(timed).semantic();check(event.getString("startAt").equals("2026-11-06T09:00:00.250Z")&&event.getString("endAt").equals("2026-11-06T10:00:00.999Z"));
  check(read(new Provider()).semantic().getString("startAt").equals("1970-01-01")&&read(new Provider()).semantic().getString("endAt").equals("1970-01-02"));
  check(CalendarSyncSnapshot.duration("P3600S")==3600000L&&CalendarSyncSnapshot.duration("PT1H")==3600000L&&CalendarSyncSnapshot.duration("P1D")==86400000L&&CalendarSyncSnapshot.duration("P1W")==604800000L&&CalendarSyncSnapshot.duration("P1DT2H30M")==95400000L&&CalendarSyncSnapshot.duration("-PT15M")==-900000L);
  for(String garbage:new String[]{null,"","P","PT","P1DT","1H","P1H2D","PT1.5H","P1W2D","P99999999999999999999D","P"+"9".repeat(129)+"S","one hour"}){try{CalendarSyncSnapshot.duration(garbage);throw new AssertionError("Accepted "+garbage);}catch(UnsupportedOperationException expected){}}
  weekly.events.get(0).put("duration","an hour");try{read(weekly).semantic();throw new AssertionError("Accepted an unparsable duration");}catch(UnsupportedOperationException expected){}check(read(weekly).revision!=null);
  System.out.println("PASS exact owned Calendar sync snapshots, tombstones and atomic assertions");
 }
}
