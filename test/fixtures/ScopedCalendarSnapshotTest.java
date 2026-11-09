package ai.eliza.plugins.calendar;
import android.content.*;import android.database.Cursor;import android.net.Uri;import java.util.*;
public final class ScopedCalendarSnapshotTest {
 static final long FIRST=1791766800000L,NEXT=FIRST+86400000L;
 static void check(boolean value){if(!value)throw new AssertionError();}
 interface Checked{void run()throws Exception;}static void refuses(Checked action)throws Exception{try{action.run();throw new AssertionError("Expected refusal");}catch(IllegalArgumentException|IllegalStateException expected){}}
 static Map<String,Object> row(Object...pairs){Map<String,Object> result=new HashMap<>();for(int i=0;i<pairs.length;i+=2)result.put((String)pairs[i],pairs[i+1]);return result;}
 static final class Provider extends ContentResolver {
  List<Map<String,Object>> events=new ArrayList<>(),attendees=new ArrayList<>(),reminders=new ArrayList<>(),instances=new ArrayList<>();ArrayList<ContentProviderOperation> dispatched;boolean nullEvents;
  Map<String,Object> source=row("_id",7L,"account_name","synthetic","account_type","com.fixture","name","fixture","calendar_access_level",700L,"ownerAccount","owner@invalid");
  Provider(){events.add(row("_id",42L,"calendar_id",7L,"title","Series","description","Private","eventLocation","Desk","dtstart",FIRST,"duration","PT1H","eventTimezone","UTC","allDay",0L,"rrule","FREQ=DAILY","deleted",0L,"eventStatus",1L,"organizer","owner@invalid","_sync_id","owned-synthetic"));instances.add(row("event_id",42L,"begin",FIRST,"end",FIRST+3600000));instances.add(row("event_id",42L,"begin",NEXT,"end",NEXT+3600000));}
  public Cursor query(Uri uri,String[] fields,String where,String[] args,String sort){
   String url=uri.value;if(nullEvents&&url.startsWith("events"))return null;List<Map<String,Object>> rows=new ArrayList<>();
   if(url.startsWith("calendars"))rows.add(source);else if(url.startsWith("instances")){for(Map<String,Object> instance:instances)if(args==null||(where.startsWith("(")?(Objects.equals(instance.get("event_id"),Long.valueOf(args[0]))||Objects.equals(instance.get("event_id"),Long.valueOf(args[1])))&&Objects.equals(instance.get("begin"),Long.valueOf(args[2])):Objects.equals(instance.get("event_id"),Long.valueOf(args[0]))&&Objects.equals(instance.get("begin"),Long.valueOf(args[1]))&&Objects.equals(instance.get("end"),Long.valueOf(args[2]))))rows.add(instance);}
   else{
    List<Map<String,Object>> table=url.startsWith("events")?events:url.startsWith("attendees")?attendees:reminders;
    String[] parts=url.split("/");for(Map<String,Object> value:table){if(parts.length>1&&!Objects.equals(value.get("_id"),Long.valueOf(parts[1])))continue;if(where!=null&&where.startsWith("original_id")&&(!Objects.equals(value.get("original_id"),Long.valueOf(args[0]))||!Objects.equals(value.get("originalInstanceTime"),Long.valueOf(args[1]))||!Objects.equals(value.get("deleted"),0L)))continue;rows.add(value);}
   }
   rows.sort(Comparator.comparingLong(value->((Number)value.getOrDefault("_id",0L)).longValue()));
   return new Cursor(){int index=-1;Object value(int n){return rows.get(index).get(fields[n]);}public boolean moveToFirst(){index=0;return index<rows.size();}public boolean moveToNext(){return ++index<rows.size();}public boolean isNull(int n){return value(n)==null;}public int getType(int n){return value(n) instanceof Number?1:3;}public long getLong(int n){return ((Number)value(n)).longValue();}public int getInt(int n){return (int)getLong(n);}public String getString(int n){return value(n)==null?null:value(n).toString();}public void close(){}};
  }
  public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations){check(dispatched==null);dispatched=operations;}
 }
 /** The SQLite stand-in: the family, child and Instances selections run as SQL. */
 static final class Sqlite extends ai.alphacompute.alphaphone.SqliteCalendarProvider {
  Sqlite(java.nio.file.Path directory){super(directory,EVENTS_SCHEMA);}
  public void applyBatch(String authority,ArrayList<ContentProviderOperation> operations){throw new AssertionError("Reads must not dispatch");}
 }
 /** Another calendar's exception row names the owned series; neither it nor its child rows join the family. */
 static void foreignException(java.nio.file.Path directory)throws Exception{
  Sqlite sql=new Sqlite(directory);
  sql.insert("calendars","_id",7L,"account_name","synthetic","account_type","com.fixture","name","fixture","calendar_access_level",700L,"ownerAccount","owner@invalid");
  sql.insert("calendars","_id",8L,"account_name","synthetic","account_type","com.fixture","name","other","calendar_access_level",700L,"ownerAccount","owner@invalid");
  sql.insert("events","_id",42L,"calendar_id",7L,"title","Series","description","Private","eventLocation","Desk","dtstart",FIRST,"duration","PT1H","eventTimezone","UTC","allDay",0L,"rrule","FREQ=DAILY","deleted",0L,"eventStatus",1L,"organizer","owner@invalid","_sync_id","owned-synthetic");
  sql.insert("events","_id",44L,"calendar_id",8L,"title","Foreign","dtstart",NEXT,"dtend",NEXT+3600000,"eventTimezone","UTC","allDay",0L,"original_id",42L,"originalInstanceTime",NEXT,"deleted",0L,"eventStatus",1L);
  sql.insert("attendees","_id",1L,"event_id",42L,"attendeeEmail","guest@invalid");sql.insert("attendees","_id",2L,"event_id",44L,"attendeeEmail","foreign@invalid");sql.insert("reminders","_id",3L,"event_id",44L,"minutes",10L,"method",1L);
  sql.insert("instances","event_id",42L,"begin",FIRST,"end",FIRST+3600000);sql.insert("instances","event_id",42L,"begin",NEXT,"end",NEXT+3600000);
  for(long begin:new long[]{FIRST,NEXT})for(String scope:new String[]{"occurrence","series"}){
   var deletion=CalendarEventGuard.selectScopedDeletion(sql,42,7,scope,begin,begin+3600000);check(deletion.eventId==42&&deletion.selectedEventId==42);
   // Each compare-and-swap assertion selects exactly the rows it expects in the same SQL.
   for(ContentProviderOperation op:deletion.assertions())check(sql.count(op.uri,op.selection,op.args)==op.count);
   check(deletion.assertions().stream().anyMatch(op->op.uri.value.equals("events")&&op.count==1)&&deletion.assertions().stream().anyMatch(op->op.uri.value.equals("attendees")&&op.count==1)&&deletion.assertions().stream().anyMatch(op->op.uri.value.equals("reminders")&&op.count==0));
  }
 }
 public static void main(String[] args)throws Exception{
  java.nio.file.Path directory=java.nio.file.Files.createTempDirectory("scoped-calendar-snapshot-");
  try{foreignException(directory);}finally{try(var files=java.nio.file.Files.walk(directory)){files.sorted(Comparator.reverseOrder()).forEach(path->path.toFile().delete());}}
  Provider provider=new Provider();var first=CalendarEventGuard.selectScopedDeletion(provider,42,7,null,FIRST,FIRST+3600000);var next=CalendarEventGuard.selectScopedDeletion(provider,42,7,null,NEXT,NEXT+3600000);check(first.scope.equals("occurrence")&&next.originalInstanceTime==NEXT&&!first.revision.equals(next.revision));
  refuses(()->CalendarEventGuard.selectScopedDeletion(provider,42,7,"event",FIRST,FIRST+3600000));refuses(()->CalendarEventGuard.readScopedDeletion(provider,42,7,"occurrence",FIRST,42,NEXT,NEXT+3600000));
  provider.attendees.add(row("_id",1L,"event_id",42L,"attendeeEmail","guest@invalid"));var guest=CalendarEventGuard.selectScopedDeletion(provider,42,7,null,FIRST,FIRST+3600000);check(!guest.revision.equals(first.revision));provider.attendees.get(0).put("attendeeEmail","changed@invalid");check(!guest.revision.equals(CalendarEventGuard.selectScopedDeletion(provider,42,7,null,FIRST,FIRST+3600000).revision));
  var assertions=guest.assertions();check(assertions.stream().anyMatch(op->op.uri.value.equals("attendees")&&op.count==1));check(assertions.stream().anyMatch(op->op.uri.value.equals("attendees/1")&&op.values.getAsString("attendeeEmail").equals("guest@invalid")));
  guest.dispatch(provider);var mutation=provider.dispatched.get(provider.dispatched.size()-1);check(mutation.type.equals("insert")&&mutation.uri.value.equals("exceptions/42"));check(mutation.values.getAsLong("originalInstanceTime")==FIRST&&mutation.values.getAsLong("eventStatus")==2);check(provider.dispatched.stream().noneMatch(op->op.type.equals("delete")));
  check(!guest.deletionVerified(provider));provider.events.add(row("_id",90L,"calendar_id",7L,"original_id",42L,"originalInstanceTime",FIRST,"deleted",0L,"eventStatus",2L));check(!guest.deletionVerified(provider));provider.instances.remove(0);check(guest.deletionVerified(provider));check(provider.instances.size()==1&&Objects.equals(provider.instances.get(0).get("begin"),NEXT));
  Provider local=new Provider();local.source.put("account_type","LOCAL");local.events.get(0).remove("_sync_id");var localFirst=CalendarEventGuard.selectScopedDeletion(local,42,7,"occurrence",FIRST,FIRST+3600000);localFirst.dispatch(local);
  var localChanges=new ArrayList<ContentProviderOperation>();for(var op:local.dispatched)if(!op.type.equals("assert"))localChanges.add(op);
  check(localChanges.size()==1);var exclusion=localChanges.get(0);check(exclusion.type.equals("update")&&exclusion.uri.value.equals("events/42")&&exclusion.count==1&&exclusion.values.getAsLong("dtstart")==FIRST&&exclusion.values.getAsString("duration").equals("PT1H")&&exclusion.values.getAsString("rrule").equals("FREQ=DAILY"));
  check(!localFirst.deletionVerified(local));local.events.get(0).put("exdate",exclusion.values.getAsString("exdate"));check(!localFirst.deletionVerified(local));local.instances.remove(0);check(localFirst.deletionVerified(local));check(local.instances.size()==1&&Objects.equals(local.instances.get(0).get("begin"),NEXT));
  local.events.add(row("_id",99L,"calendar_id",7L,"original_id",42L,"originalInstanceTime",NEXT,"deleted",0L));try{CalendarEventGuard.selectScopedDeletion(local,42,7,"occurrence",NEXT,NEXT+3600000);throw new AssertionError("Modified unsynced series must use editor review");}catch(UnsupportedOperationException expected){}
  Provider seriesProvider=new Provider();var series=CalendarEventGuard.selectScopedDeletion(seriesProvider,42,7,"series",NEXT,NEXT+3600000);series.dispatch(seriesProvider);check(seriesProvider.dispatched.get(seriesProvider.dispatched.size()-1).uri.value.equals("events/42"));check(seriesProvider.dispatched.get(seriesProvider.dispatched.size()-1).type.equals("delete"));check(!series.deletionVerified(seriesProvider));seriesProvider.events.get(0).put("deleted",1L);check(series.deletionVerified(seriesProvider));
  seriesProvider.nullEvents=true;refuses(()->series.deletionVerified(seriesProvider));refuses(()->CalendarEventGuard.selectScopedDeletion(seriesProvider,42,7,"series",NEXT,NEXT+3600000));
  Provider moved=new Provider();moved.events.add(row("_id",99L,"calendar_id",7L,"title","Moved","dtstart",NEXT+7200000,"dtend",NEXT+10800000,"eventTimezone","UTC","original_id",42L,"originalInstanceTime",NEXT,"deleted",0L,"eventStatus",1L));moved.instances.add(row("event_id",99L,"begin",NEXT+7200000,"end",NEXT+10800000));var exception=CalendarEventGuard.selectScopedDeletion(moved,99,7,null,NEXT+7200000,NEXT+10800000);check(exception.eventId==42&&exception.selectedEventId==99&&exception.originalInstanceTime==NEXT);exception.dispatch(moved);check(moved.dispatched.get(moved.dispatched.size()-1).type.equals("update")&&moved.dispatched.get(moved.dispatched.size()-1).uri.value.equals("events/99"));
  moved.events.add(row("_id",100L,"calendar_id",7L,"original_id",42L,"originalInstanceTime",NEXT,"deleted",0L));refuses(()->CalendarEventGuard.selectScopedDeletion(moved,99,7,null,NEXT+7200000,NEXT+10800000));
  Provider unsynced=new Provider();unsynced.events.get(0).remove("_sync_id");try{CalendarEventGuard.selectScopedDeletion(unsynced,42,7,"occurrence",FIRST,FIRST+3600000);throw new AssertionError("Unsynced nonlocal series must use editor review");}catch(UnsupportedOperationException expected){}
  Provider readOnly=new Provider();readOnly.source.put("calendar_access_level",100L);refuses(()->CalendarEventGuard.selectScopedDeletion(readOnly,42,7,null,FIRST,FIRST+3600000));
  System.out.println("PASS scoped Calendar provider snapshots and exact atomic mutation plans");
 }
}
