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
 /** The same reads with every selection executed by sqlite3 over CalendarProvider's column names. */
 static final class SqliteProvider extends SqliteCalendarProvider {
  static String table(String name,String... columns){return "CREATE TABLE "+name+"(_id INTEGER PRIMARY KEY,"+String.join(",",columns)+");";}
  SqliteProvider(java.nio.file.Path directory){
   super(directory,table("calendars","account_name","account_type","name","calendar_access_level","ownerAccount","cal_sync1")
    +table("events","calendar_id","title","description","eventLocation","dtstart","dtend","duration","eventTimezone","eventEndTimezone","allDay","rrule","rdate","exrule","exdate","original_id","original_sync_id","originalInstanceTime","originalAllDay","eventStatus","deleted","hasAlarm","hasAttendeeData","availability","accessLevel","organizer","_sync_id","selfAttendeeStatus","guestsCanModify","guestsCanInviteOthers","guestsCanSeeGuests","customAppPackage","customAppUri")
    +table("attendees","event_id","attendeeName","attendeeEmail","attendeeRelationship","attendeeType","attendeeStatus","attendeeIdentity","attendeeIdNamespace")
    +table("reminders","event_id","minutes","method")+table("properties","event_id","name","value"));
  }
  public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations){throw new AssertionError("Snapshots must not dispatch");}
  long count(Uri uri,String where,String[] args){long rows=0;try(Cursor cursor=query(uri,new String[]{"_id"},where,args,null)){while(cursor.moveToNext())rows++;}return rows;}
 }
 static List<Long> ids(List<ContentValues> rows){List<Long> out=new ArrayList<>();for(ContentValues row:rows)out.add(row.getAsLong("_id"));return out;}
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
  // An exception row in another calendar whose original_id names the owned event is not part of
  // the family, and neither are its child rows. Every assertion's selection, run by sqlite3,
  // matches the count it asserts.
  java.nio.file.Path directory=java.nio.file.Files.createTempDirectory("calendar-sync-snapshot-");
  try{
   SqliteProvider sql=new SqliteProvider(directory);
   sql.write("INSERT INTO calendars(_id,account_name,account_type,name,calendar_access_level,ownerAccount,cal_sync1) VALUES(7,'Alpha Phone','LOCAL','alpha-phone-local',700,'Alpha Phone','"+GENERATION+"'),(8,'Other','LOCAL','other',700,'Other',NULL);"
    +"INSERT INTO events(_id,calendar_id,title,dtstart,duration,eventTimezone,allDay,rrule,deleted) VALUES(42,7,'Owned series',0,'P1D','UTC',1,'FREQ=DAILY',0);"
    +"INSERT INTO events(_id,calendar_id,original_id,originalInstanceTime,deleted) VALUES(43,7,42,86400000,0),(44,8,42,86400000,0);"
    +"INSERT INTO events(_id,calendar_id,title,dtstart,duration,eventTimezone,allDay,deleted) VALUES(45,7,'Unrelated',0,'P1D','UTC',1,0);"
    +"INSERT INTO attendees(_id,event_id,attendeeEmail) VALUES(8,42,'fixture@example.invalid'),(9,43,'fixture@example.invalid'),(10,44,'foreign@example.invalid'),(11,45,'other@example.invalid');"
    +"INSERT INTO reminders(_id,event_id,minutes,method) VALUES(12,44,15,1);");
   CalendarSyncSnapshot family=CalendarSyncSnapshot.read(sql,7,42,"Alpha Phone","alpha-phone-local",GENERATION);
   check(ids(family.family).equals(List.of(42L,43L))&&ids(family.attendees).equals(List.of(8L,9L))&&family.reminders.isEmpty()&&family.properties.isEmpty());
   for(ContentProviderOperation op:family.assertions())check(sql.count(op.uri,op.selection,op.args)==op.count);
  }finally{try(var files=java.nio.file.Files.walk(directory)){files.sorted(Comparator.reverseOrder()).forEach(path->path.toFile().delete());}}
  System.out.println("PASS exact owned Calendar sync snapshots, tombstones and atomic assertions");
  // A timed event at a whole second in a zone other than UTC, as the native bridge reports it.
  Provider timed=new Provider();long at=java.time.Instant.parse("2026-10-16T19:00:00Z").toEpochMilli();
  timed.events.set(0,row("_id",42L,"calendar_id",7L,"title","Timed review","dtstart",at,"dtend",at+3600000L,"eventTimezone","America/New_York","allDay",0L,"deleted",0L));
  System.out.println(read(timed).semantic());
 }
}
