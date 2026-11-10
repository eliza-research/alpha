package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.NoticeCoordinator;
import ai.eliza.plugins.notifications.NoticeDelivery;
import java.util.List;
import org.json.JSONObject;

/** Alpha's inputs to the shared receipt ledger (ai.eliza.plugins.notifications.NoticeDelivery) and its host
 * coordination (NoticeCoordinator): the slot names, redacted approval text and approval bound already
 * deployed. The ledger (at-most-once OS dispatch, never reposting an uncertain or dismissed notice), the
 * route ledger, the owner fence and the quiet repost are upstream code; the stored record formats are unchanged. */
final class WorkflowNoticeDelivery {
 interface Storage extends NoticeDelivery.Storage {}
 interface Poster extends NoticeDelivery.Poster {}
 /** An unopened step notice withdraws itself after a day; its receipt and history stay retained. */
 static final long STEP_NOTICE_TIMEOUT_MS=24L*3600000;
 /** Phone-step approvals are short-lived; a longer requested lifetime is refused. */
 static final long MAXIMUM_APPROVAL_MS=7L*86400000;
 /** Deployed slot names. Changing either one orphans the receipts already stored on installed phones. */
 static final String SLOT="workflow-notice-delivery:v1",APPROVAL_SLOT="workflow-approval-notices:v1";
 /** Redacted: no workflow name, destination, source or operation detail leaves the app. */
 static final String APPROVAL_TITLE="Workflow step waiting for approval",APPROVAL_BODY="Open Alpha Phone to review it. Nothing runs until you approve it on this phone.";
 static final NoticeDelivery.Config CONFIG=new NoticeDelivery.Config(SLOT,APPROVAL_SLOT,APPROVAL_TITLE,APPROVAL_BODY,MAXIMUM_APPROVAL_MS);
 static boolean approvalId(String id){return NoticeDelivery.approvalId(id);}
 private final NoticeDelivery shared;
 WorkflowNoticeDelivery(Storage storage,Poster poster){shared=new NoticeDelivery(CONFIG,storage,poster);}
 /** Time until the approval expires, or -1 when it already expired. */
 long approvalTimeout(long expiresAt,long now){return shared.approvalTimeout(expiresAt,now);}
 String receipt(String id,String binding,String title,String body)throws Exception{return shared.receipt(id,binding,title,body);}
 String publish(String id,String binding,String title,String body)throws Exception{return shared.publish(id,binding,title,body);}
 /** One redacted notice per pending phone-step approval ID, posted at most once and never after a decision withdrew it. */
 String publishApproval(String id,String binding,long expiresAt,long now)throws Exception{return shared.publishApproval(id,binding,expiresAt,now);}
 private NoticeCoordinator with(WorkflowNoticeTaps taps){return new NoticeCoordinator(shared,taps);}
 /** The whole approval post with its tap route (NoticeCoordinator.postApproval). */
 String postApproval(WorkflowNoticeTaps taps,String id,String binding,JSONObject route,long expiresAt,long now)throws Exception{return with(taps).postApproval(id,binding,route,expiresAt,now);}
 /** A decision withdraws the notice. The receipt stays (as withdrawn) until expiry, so the notice is never
  * reposted. A decision that arrives before any publish is retained too, for the maximum approval lifetime. */
 void withdrawApproval(String id,long now)throws Exception{shared.withdrawApproval(id,now);}
 /** The whole withdrawal; the route is released even when the ledger refuses to record it. */
 void withdrawApproval(WorkflowNoticeTaps taps,String id,long now)throws Exception{with(taps).withdrawApproval(id,now);}
 /** Persist the privacy fence before touching OS notices. Repeated calls complete interrupted cancellation. */
 int withdrawOtherOwners(WorkflowNoticeTaps taps,JSONObject owner,long now)throws Exception{return with(taps).withdrawOtherOwners(owner,now);}
 /** Caller revalidated the exact proposal without authorizing it. Rotate its tap before quiet dispatch. */
 String resumeApproval(WorkflowNoticeTaps taps,String id,String binding,JSONObject route,long expiresAt,long now)throws Exception{return with(taps).resumeApproval(id,binding,route,expiresAt,now);}
 /** Removes receipts whose approval expired (the OS already timed the notice out) and returns their IDs. */
 List<String> expireApprovals(long now)throws Exception{return shared.expireApprovals(now);}
}
