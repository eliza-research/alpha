package ai.elizaresearch.alphaphone;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * CalendarProvider stand-in for host-JVM tests. Each query's projection, selection, arguments
 * and sort order are executed by the sqlite3 command-line shell over tables that use
 * CalendarProvider's column names, so a wrong selection returns the rows a provider would.
 * It is not Android CalendarProvider, a permission check or a device run. Subclasses add
 * applyBatch where their ContentResolver stub needs it.
 */
public abstract class SqliteCalendarProvider extends ContentResolver {
 private static final String UNIT="\u001f",RECORD="\u001e";
 /** Calendars, events and their dependent rows, with the columns the sync and deletion snapshots read. */
 public static final String EVENTS_SCHEMA="CREATE TABLE calendars(_id INTEGER PRIMARY KEY,account_name TEXT,account_type TEXT,name TEXT,calendar_displayName TEXT,calendar_access_level INTEGER,ownerAccount TEXT,cal_sync1 TEXT);"
  +"CREATE TABLE events(_id INTEGER PRIMARY KEY,calendar_id INTEGER,title TEXT,description TEXT,eventLocation TEXT,dtstart INTEGER,dtend INTEGER,duration TEXT,eventTimezone TEXT,eventEndTimezone TEXT,allDay INTEGER,rrule TEXT,rdate TEXT,exrule TEXT,exdate TEXT,"
  +"original_id INTEGER,original_sync_id TEXT,originalInstanceTime INTEGER,originalAllDay INTEGER,eventStatus INTEGER,deleted INTEGER,hasAlarm INTEGER,hasAttendeeData INTEGER,availability INTEGER,accessLevel INTEGER,organizer TEXT,_sync_id TEXT,"
  +"selfAttendeeStatus INTEGER,guestsCanModify INTEGER,guestsCanInviteOthers INTEGER,guestsCanSeeGuests INTEGER,customAppPackage TEXT,customAppUri TEXT);"
  +"CREATE TABLE attendees(_id INTEGER PRIMARY KEY,event_id INTEGER,attendeeName TEXT,attendeeEmail TEXT,attendeeRelationship INTEGER,attendeeType INTEGER,attendeeStatus INTEGER,attendeeIdentity TEXT,attendeeIdNamespace TEXT);"
  +"CREATE TABLE reminders(_id INTEGER PRIMARY KEY,event_id INTEGER,minutes INTEGER,method INTEGER);"
  +"CREATE TABLE properties(_id INTEGER PRIMARY KEY,event_id INTEGER,name TEXT,value TEXT);"
  +"CREATE TABLE instances(event_id INTEGER,\"begin\" INTEGER,\"end\" INTEGER);";
 public final String database;
 /** Fixture writes are applied together before the next provider read. */
 private final StringBuilder pending=new StringBuilder();

 protected SqliteCalendarProvider(Path directory,String schema){
  database=directory.resolve("provider-"+System.nanoTime()+".db").toString();
  sqlite(database,schema);
 }
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static String sqlite(String database,String sql){
  try{
   Process process=new ProcessBuilder("sqlite3","-batch","-noheader","-separator",UNIT,"-newline",RECORD,database,sql).redirectErrorStream(true).start();
   String output=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new IllegalStateException("sqlite3 rejected the provider query: "+output+"\n"+sql);
   return output;
  }catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException(error);}
 }
 public void write(String sql){pending.append(sql);}
 private void flush(){if(pending.length()>0){String sql=pending.toString();pending.setLength(0);sqlite(database,sql);}}
 /** One row from column/value pairs: numbers stay integers, text is quoted, null is NULL. */
 public void insert(String table,Object... pairs){
  StringBuilder columns=new StringBuilder(),values=new StringBuilder();
  for(int i=0;i<pairs.length;i+=2){
   String column=(String)pairs[i];Object value=pairs[i+1];require(column.matches("[A-Za-z_][A-Za-z_0-9]*"),"Plain column: "+column);
   if(i>0){columns.append(',');values.append(',');}
   columns.append('[').append(column).append(']');
   values.append(value==null?"NULL":value instanceof Number?value.toString():"'"+value.toString().replace("'","''")+"'");
  }
  write("INSERT INTO "+table+"("+columns+") VALUES("+values+");");
 }
 /** Rows a selection matches, as a provider assert query counts them. */
 public int count(Uri uri,String selection,String[] arguments){
  int rows=0;try(Cursor cursor=query(uri,new String[]{"_id"},selection,arguments,null)){while(cursor.moveToNext())rows++;}return rows;
 }

 /** One result set. Every value arrives with its SQLite storage class, as a provider cursor reports it. */
 public static final class Rows implements Cursor {
  private final List<String[]> rows;private int at=-1;
  public Rows(List<String[]> rows){this.rows=rows;}
  private String value(int column){return rows.get(at)[column*2];}
  private String type(int column){return rows.get(at)[column*2+1];}
  public boolean moveToFirst(){at=0;return !rows.isEmpty();}
  public boolean moveToNext(){return ++at<rows.size();}
  public boolean isNull(int column){return type(column).equals("null");}
  public int getType(int column){return type(column).equals("integer")?FIELD_TYPE_INTEGER:3;}
  public long getLong(int column){return Long.parseLong(value(column));}
  public int getInt(int column){return Integer.parseInt(value(column));}
  public String getString(int column){return isNull(column)?null:value(column);}
  public void close(){}
 }

 /** table/id reads one row; instances/begin/end applies CalendarProvider's own range clause. */
 @Override public Cursor query(Uri uri,String[] projection,String selection,String[] arguments,String sort){
  String[] path=uri.value.split("/");String table=path[0],scope;
  require(table.matches("[a-z_]+"),"Provider table: "+uri.value);
  if(table.equals("instances")){
   require(path.length==3,"Instances need a range: "+uri.value);
   // CalendarProvider's range clause for an Instances URI: begin<=rangeEnd AND end>=rangeBegin.
   scope="\"begin\"<="+Long.parseLong(path[2])+" AND \"end\">="+Long.parseLong(path[1]);
  }else{require(path.length<=2,"Provider URI: "+uri.value);scope=path.length==2?"_id="+Long.parseLong(path[1]):"1";}
  StringBuilder columns=new StringBuilder();
  for(String column:projection){
   require(column.matches("[A-Za-z_][A-Za-z_0-9]*"),"Projection is a plain column: "+column);
   // Bracketed names fail on a missing column, where a double-quoted one would read as text.
   if(columns.length()>0)columns.append(',');columns.append('[').append(column).append("],typeof([").append(column).append("])");
  }
  String bound="1";
  if(selection!=null){
   StringBuilder text=new StringBuilder();int used=0;
   for(char c:selection.toCharArray()){
    if(c!='?'){text.append(c);continue;}
    require(arguments!=null&&used<arguments.length&&arguments[used].matches("[0-9]{1,19}"),"Each placeholder binds one numeric argument");
    text.append(arguments[used++]);
   }
   require(used==(arguments==null?0:arguments.length),"Every argument is bound");bound=text.toString();
  }
  flush();
  String output=sqlite(database,"SELECT "+columns+" FROM "+table+" WHERE ("+scope+") AND ("+bound+")"+(sort==null?"":" ORDER BY "+sort)+";");
  List<String[]> rows=new ArrayList<>();
  for(String record:output.split(RECORD,-1)){if(record.isEmpty())continue;String[] cells=record.split(UNIT,-1);require(cells.length==projection.length*2,"Complete provider row");rows.add(cells);}
  return new Rows(rows);
 }
}
