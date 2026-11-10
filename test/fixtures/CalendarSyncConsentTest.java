package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

public final class CalendarSyncConsentTest {
 static void check(boolean value,String label){if(!value)throw new AssertionError(label);}
 public static void main(String[] args)throws Exception{
  String path=CalendarSyncConsent.EVENT_PATH;
  JSONObject binding=new JSONObject().put("connectionId","grant-1").put("calendarId","primary").put("providerAccountId","google-user");
  String enabled=new JSONObject().put("version",1).put("enabled",true).put("binding",binding).put("operations",new JSONObject()).toString();
  String paused=new JSONObject(enabled).put("enabled",false).toString();
  String body=new JSONObject().put("grantId","grant-1").put("calendarId","primary").put("accountId","google-user").put("idempotencyKey","stable").put("event",new JSONObject().put("title","Synthetic")).toString();
  String delete="grantId=grant-1&calendarId=primary&accountId=google-user&eventId=saved&expectedEtag=%221%22";

  check(CalendarSyncConsent.admits(path,"grantId=grant-1&calendarId=primary","GET",null,null),"reads never need the consent slot");
  check(CalendarSyncConsent.admits("/api/v1/eliza/google/calendar/sync-v1/capabilities","grantId=grant-1","GET",null,null),"capabilities are a read");
  check(CalendarSyncConsent.admits("/api/v1/maps/routes",null,"POST","{}",null),"other routes are not this rule's concern");

  for(String method:new String[]{"POST","PATCH"}){
   check(CalendarSyncConsent.admits(path,null,method,body,enabled),method+" with enabled consent for this binding");
   check(!CalendarSyncConsent.admits(path,null,method,body,null),method+" without any native consent");
   check(!CalendarSyncConsent.admits(path,null,method,body,paused),method+" while sync is paused");
   check(!CalendarSyncConsent.admits(path,null,method,new JSONObject(body).put("grantId","grant-2").toString(),enabled),method+" for another grant");
   check(!CalendarSyncConsent.admits(path,null,method,new JSONObject(body).put("calendarId","work").toString(),enabled),method+" for another calendar");
   check(!CalendarSyncConsent.admits(path,null,method,new JSONObject(body).put("accountId","other").toString(),enabled),method+" for another provider account");
   check(!CalendarSyncConsent.admits(path,null,method,"{}",enabled),method+" without a target");
   check(!CalendarSyncConsent.admits(path,null,method,"not JSON",enabled),method+" with an unreadable body");
  }
  check(CalendarSyncConsent.admits(path,delete,"DELETE",null,enabled),"DELETE with enabled consent for this binding");
  check(!CalendarSyncConsent.admits(path,delete,"DELETE",null,paused),"DELETE while sync is paused");
  check(!CalendarSyncConsent.admits(path,delete.replace("grant-1","grant-2"),"DELETE",null,enabled),"DELETE for another grant");
  check(!CalendarSyncConsent.admits(path,delete+"&grantId=grant-1","DELETE",null,enabled),"repeated parameters are refused");
  check(!CalendarSyncConsent.admits(path,null,"DELETE",null,enabled),"DELETE without a target");
  check(!CalendarSyncConsent.admits(path,null,"POST",body,"{\"version\":2,\"enabled\":true}"),"unknown consent version");
  check(!CalendarSyncConsent.admits(path,null,"POST",body,new JSONObject(enabled).put("enabled","true").toString()),"enabled must be a boolean");
  check(!CalendarSyncConsent.admits(path,null,"POST",body,"corrupt"),"corrupt consent refuses");
  System.out.println("PASS calendar sync consent");
 }
}
