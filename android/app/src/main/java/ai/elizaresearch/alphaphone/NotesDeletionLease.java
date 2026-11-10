package ai.elizaresearch.alphaphone;

import org.json.JSONObject;

/**
 * The renderer's lease on a deletion recovery row (runtime/permanent-voice-deletion.ts). A live
 * renderer writes lease.until on each row it is between steps on or still shows under review, and
 * renews it at least every 15 minutes. The native passes (the 6-hour WorkManager job and the
 * plugin-load pass) cannot take the renderer's Web Lock, so they leave a held row exactly as it is
 * and finish it only once the lease has expired. No Android types: host-tested by javac.
 */
final class NotesDeletionLease {
 private NotesDeletionLease(){}
 /** Matches PERMANENT_DELETION_LEASE_MS in the renderer. */
 static final long LEASE_MS=20L*60*1000;
 /**
  * True while a renderer holds the row. A row without a lease (written before leases, or by an
  * earlier process that never renewed it) is not held. A lease that is malformed, or that runs
  * further ahead than any renderer writes (a clock moved backwards), counts as held: erasing is
  * the unrecoverable direction, and the renderer's own startup pass still settles such a row.
  */
 static boolean held(JSONObject row,long now){
  if(row==null||!row.has("lease"))return false;
  JSONObject lease=row.optJSONObject("lease");
  if(lease==null)return true;
  Object until=lease.opt("until");
  if(!(until instanceof Number))return true;
  double value=((Number)until).doubleValue();
  if(!Double.isFinite(value)||value-now>LEASE_MS)return true;
  return value>now;
 }
}
