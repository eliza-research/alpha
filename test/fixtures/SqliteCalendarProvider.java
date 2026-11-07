package ai.elizaresearch.alphaphone;

import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * A ContentResolver stand-in whose queries are executed by the sqlite3 command-line shell over
 * tables that use CalendarProvider's column names. The caller's exact projection, selection,
 * numeric arguments and sort order become one SQL statement, so a wrong selection returns the
 * rows a real provider would. "table" and "table/id" URIs map to that table and that _id;
 * subclasses add their own URIs through scope. This is not Android CalendarProvider.
 */
abstract class SqliteCalendarProvider extends ContentResolver {
 static final String UNIT="\u001f",RECORD="\u001e";
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 static String sqlite(String database,String sql){
  try{
   Process process=new ProcessBuilder("sqlite3","-batch","-noheader","-separator",UNIT,"-newline",RECORD,database,sql).redirectErrorStream(true).start();
   String output=new String(process.getInputStream().readAllBytes(),StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new IllegalStateException("sqlite3 rejected the provider query: "+output+"\n"+sql);
   return output;
  }catch(RuntimeException error){throw error;}catch(Exception error){throw new IllegalStateException(error);}
 }
 /** One result set. Every value arrives with its SQLite storage class, as a provider cursor reports it. */
 static final class Rows implements Cursor {
  private final List<String[]> rows;private int at=-1;
  Rows(List<String[]> rows){this.rows=rows;}
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
 final String database;
 SqliteCalendarProvider(Path directory,String schema){
  database=directory.resolve("provider-"+System.nanoTime()+".db").toString();
  sqlite(database,schema);
 }
 /** Fixture writes are applied together before the next provider read. */
 private final StringBuilder pending=new StringBuilder();
 void write(String sql){pending.append(sql);}
 private void flush(){if(pending.length()>0){String sql=pending.toString();pending.setLength(0);sqlite(database,sql);}}
 /** The table a URI reads and the provider's own clause for it: {table, clause}. */
 String[] scope(Uri uri,String[] projection){
  String[] path=uri.value.split("/");
  if(path.length==1)return new String[]{path[0],"1"};
  if(path.length==2)return new String[]{path[0],"_id="+Long.parseLong(path[1])};
  throw new AssertionError("Unexpected provider URI "+uri.value);
 }
 @Override public Cursor query(Uri uri,String[] projection,String selection,String[] arguments,String sort){
  String[] scoped=scope(uri,projection);
  StringBuilder columns=new StringBuilder();
  for(String column:projection){
   require(column.matches("[A-Za-z_][A-Za-z0-9_]*"),"Projection is a plain column: "+column);
   if(columns.length()>0)columns.append(',');columns.append('"').append(column).append("\",typeof(\"").append(column).append("\")");
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
  String output=sqlite(database,"SELECT "+columns+" FROM "+scoped[0]+" WHERE ("+scoped[1]+") AND ("+bound+")"+(sort==null?"":" ORDER BY "+sort)+";");
  List<String[]> rows=new ArrayList<>();
  for(String record:output.split(RECORD,-1)){if(record.isEmpty())continue;String[] cells=record.split(UNIT,-1);require(cells.length==projection.length*2,"Complete provider row");rows.add(cells);}
  return new Rows(rows);
 }
}
