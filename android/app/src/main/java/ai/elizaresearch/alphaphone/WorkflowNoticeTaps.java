package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.NoticeRoutes;

/** Alpha's deployed identifiers for the shared notice route ledger (ai.eliza.plugins.notifications.NoticeRoutes):
 * encrypted, bounded, owner-fenced routes where a tap is a read request, never approval. Changing a slot
 * name, action or prefix orphans the routes and PendingIntents already stored on installed phones. */
final class WorkflowNoticeTaps extends NoticeRoutes {
 static final String SLOT="workflow-notice-taps:v1", OWNER_SLOT="workflow-notice-owner:v1";
 static final String ACTION="ai.elizaresearch.alphaphone.OPEN_WORKFLOW_NOTICE", PREFIX="alpha-workflow-notice:", ASK_ACTION="ai.elizaresearch.alphaphone.ASK_WORKFLOW_NOTICE";
 static final NoticeRoutes.Config CONFIG=new NoticeRoutes.Config(SLOT,OWNER_SLOT,WorkflowNoticeDelivery.CONFIG,"workflowId","runId","versionId");
 WorkflowNoticeTaps(WorkflowNoticeDelivery.Storage storage){super(storage,CONFIG);}
}
