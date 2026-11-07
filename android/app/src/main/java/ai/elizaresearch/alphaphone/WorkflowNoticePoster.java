package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.HostNoticePoster;
import android.content.Context;

/** Alpha's channels, icon, tag prefix and launch actions for the shared host notice poster
 * (ai.eliza.plugins.notifications.HostNoticePoster). Channel IDs, tags and actions are installed identities. */
final class WorkflowNoticePoster extends HostNoticePoster implements WorkflowNoticeDelivery.Poster {
 static final String CHANNEL="alpha_workflow_steps",APPROVAL_CHANNEL="alpha_workflow_approvals";
 static final HostNoticePoster.Config CONFIG=new HostNoticePoster.Config(
  CHANNEL,"Approved workflow notifications","Notifications explicitly approved in Alpha Phone workflows",
  APPROVAL_CHANNEL,"Workflow approval requests","A workflow step is waiting for your approval on this phone",
  R.drawable.notification_icon,"alpha-workflow-",WorkflowNoticeTaps.ACTION,WorkflowNoticeTaps.ASK_ACTION,WorkflowNoticeTaps.PREFIX,
  "Alpha Phone workflow","Alpha Phone","Unlock to review this notification.","Ask Alpha","alpha_quiet_approvals",WorkflowNoticeDelivery.STEP_NOTICE_TIMEOUT_MS);
 WorkflowNoticePoster(Context context){super(context,CONFIG,id->WorkflowNoticeTapsFactory.create(context).token(id));}
}
