package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/** Host-JVM check of the renderer lease the native Notes passes honour. Not Android evidence. */
public final class NotesDeletionLeaseTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static JSONObject row(Object lease)throws Exception{
  JSONObject row=new JSONObject().put("id","0f8fad5b-d9cb-469f-a165-70867728950e").put("permanent",true);
  if(lease!=null)row.put("lease",lease);
  return row;
 }
 public static void main(String[] args)throws Exception {
  long now=1_800_000_000_000L,lease=NotesDeletionLease.LEASE_MS;
  check(lease==20L*60*1000,"the native lease matches the renderer's 20 minutes");
  check(NotesDeletionLease.held(row(new JSONObject().put("until",now+lease)),now),"a fresh lease is held: the row is left untouched");
  check(NotesDeletionLease.held(row(new JSONObject().put("until",now+1)),now),"held until its last millisecond");
  check(!NotesDeletionLease.held(row(new JSONObject().put("until",now)),now),"a lease ending now has expired: the row may be finished");
  check(!NotesDeletionLease.held(row(new JSONObject().put("until",now-1)),now),"an expired lease is finished");
  check(!NotesDeletionLease.held(row(null),now),"a row without a lease (an earlier process, before leases) is finished as before");
  check(!NotesDeletionLease.held(null,now),"no row, no lease");
  // Malformed or implausible leases keep the row for the renderer's review: erasing cannot be undone.
  for(Object bad:new Object[]{"tomorrow",JSONObject.NULL,42,new JSONObject(),new JSONObject().put("until","1"),new JSONObject().put("until",now+lease+1),new JSONObject().put("until",Double.MAX_VALUE)})
   check(NotesDeletionLease.held(row(bad),now),"held: "+bad);
  // A renewal every pass (at most 15 minutes apart) keeps a shown row held across passes.
  long renewed=now;
  for(int pass=0;pass<8;pass++){JSONObject shown=row(new JSONObject().put("until",renewed+lease));check(NotesDeletionLease.held(shown,renewed+15L*60*1000),"pass "+pass+" is still held 15 minutes later");renewed+=15L*60*1000;}
  System.out.println("PASS notes deletion lease");
 }
}
