package ai.alphacompute.alphaphone;

import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.calendar.read.CalendarReadAccess;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Runs the pinned shared Calendar reader the way the shared list does for Alpha's
 * configuration (AlphaCalendarPlugin.CONFIGURATION, copied into AlphaCalendarConfiguration by
 * the runner): this app's package, its creation URI prefix and its read bound. The stand-in
 * provider holds a chosen number of instances; events 1000 and 1002 carry creation links. It is
 * not Android CalendarProvider and not a device run.
 */
public final class CalendarListWindowTest {
 static final String PACKAGE="ai.alphacompute.alphaphone",NOTE_CREATION="afc732b3-416e-4dd3-98ce-0bd854106c46";
 static void require(boolean value,String message){if(!value)throw new AssertionError(message);}
 static void same(Object expected,Object actual,String message){if(!String.valueOf(expected).equals(String.valueOf(actual)))throw new AssertionError(message+"\n expected "+expected+"\n actual   "+actual);}
 static final class Provider extends ContentResolver {
  final int held;final long base;int taken,instanceQueries;String linkPackage;
  Provider(int held,long base){this.held=held;this.base=base;}
  @Override public Cursor query(Uri target,String[] fields,String where,String[] values,String order){
   if(target.value.equals("events")){
    linkPackage=values[0];
    // Event 1000 was saved by Alpha from a note; 1002 carries another app's link shape.
    String[] links={CONFIGURATION().creationUriPrefix+NOTE_CREATION,"other://calendar-creation/"+NOTE_CREATION};long[] ids={1000,1002};
    return new Cursor(){int at=-1;public boolean moveToFirst(){at=0;return true;}public boolean moveToNext(){return ++at<links.length;}public boolean isNull(int c){return false;}public int getType(int c){return FIELD_TYPE_INTEGER;}public long getLong(int c){return ids[at];}public String getString(int c){return links[at];}public int getInt(int c){return 0;}public void close(){}};
   }
   instanceQueries++;
   return new Cursor(){
    int at=-1;
    public boolean moveToFirst(){at=0;return held>0;}
    public boolean moveToNext(){if(at+1>=held){at=held;return false;}at++;taken=Math.max(taken,at+1);return true;}
    public boolean isNull(int column){return column==3||(column==8&&at%3!=0);}
    public int getType(int column){return FIELD_TYPE_INTEGER;}
    public long getLong(int column){return column==0?1000+at:column==1?7:column==5?base+at*60000L:column==6?base+at*60000L+10000:0;}
    public String getString(int column){return column==2?"Row "+at:column==4?"Hall":column==8&&at%3==0?"FREQ=DAILY":null;}
    public int getInt(int column){return column==7&&at==1?1:0;}
    public void close(){}
   };
  }
 }
 static CalendarConfiguration CONFIGURATION(){return AlphaCalendarConfiguration.CONFIGURATION;}
 /** The shared list for a host whose configuration sets maximumReadEvents. */
 static JSONObject list(Provider provider)throws Exception{
  CalendarConfiguration configuration=CONFIGURATION();
  return new CalendarReadAccess(provider,PACKAGE,configuration.creationUriPrefix).window(provider.base,provider.base+90L*86400000L,configuration.maximumReadEvents);
 }
 public static void main(String[] arguments)throws Exception{
  long base=1790000000000L;
  same(2000,CONFIGURATION().maximumReadEvents,"Alpha's documented bound is 2,000 instances");
  same("alpha-calendar-creations-v1|alphaphone://calendar-creation/",CONFIGURATION().journalName+"|"+CONFIGURATION().creationUriPrefix,"The read bound leaves the installed journal identity unchanged");

  Provider exact=new Provider(2000,base);JSONObject whole=list(exact);
  same(2000,whole.getJSONArray("events").length(),"Exactly the bound is returned whole");
  require(!whole.getBoolean("truncated"),"Exactly 2,000 instances is a complete result");
  same(1,exact.instanceQueries,"One instance query");same(PACKAGE,exact.linkPackage,"Creation links are read only for this app's package");
  JSONArray rows=whole.getJSONArray("events");JSONObject noted=rows.getJSONObject(0),plain=rows.getJSONObject(1),foreign=rows.getJSONObject(2);
  same("[allDay, begin, calendarId, creationId, end, id, location, recurring, title]",new java.util.TreeSet<>(noted.keySet()).toString(),"Row fields the Calendar view reads, plus the creation link");
  same(NOTE_CREATION,noted.getString("creationId"),"An event Alpha saved from a note carries the creationId its note link is keyed by");
  require(!plain.has("creationId"),"An event without a link has no creationId");
  require(!foreign.has("creationId"),"A link under another prefix is not Alpha's creation");
  require(plain.getBoolean("allDay")&&!plain.getBoolean("recurring"),"All-day and non-recurring rows are carried");

  Provider over=new Provider(2001,base);JSONObject limited=list(over);
  same(2000,limited.getJSONArray("events").length(),"One instance past the bound is not returned");
  require(limited.getBoolean("truncated"),"One instance past the bound is reported as an incomplete result");
  same(base+1999*60000L,limited.getJSONArray("events").getJSONObject(1999).getLong("begin"),"The earliest 2,000 are the ones kept");
  same(NOTE_CREATION,limited.getJSONArray("events").getJSONObject(0).getString("creationId"),"A truncated read keeps creation links");

  Provider huge=new Provider(250000,base);JSONObject bounded=list(huge);
  same(2000,bounded.getJSONArray("events").length(),"A very large provider result stays bounded");require(bounded.getBoolean("truncated"),"and is reported incomplete");
  same(2001,huge.taken,"Reading stops at the first row past the bound");

  Provider refused=new Provider(1,base);
  try{new CalendarReadAccess(refused,PACKAGE,CONFIGURATION().creationUriPrefix).window(0,370L*86400000L+1,CONFIGURATION().maximumReadEvents);throw new AssertionError("A range over 370 days must be refused");}
  catch(IllegalArgumentException expected){same(0,refused.instanceQueries,"A refused range never reaches the provider");}
  System.out.println("PASS calendar list window");
 }
}
