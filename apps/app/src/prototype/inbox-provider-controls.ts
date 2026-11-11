import { createMailReviewController, type MailReviewClient } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import { inboxLocalStore } from '../runtime/inbox-local-store';
import { connectionController } from '../runtime/connection-ui';
import { reviewMailAttachment } from '../runtime/inbox-attachment';
import { InboxOperation } from '../runtime/inbox-operation';
// One review client per Cloud client and owner: receipt reads go through the saved-outcome guard,
// every other call goes to the Cloud client unchanged.
const reviewClients=new WeakMap<object,Map<string,MailReviewClient>>();
function reviewClient(client:MailReviewClient,owner:string):MailReviewClient{
 let owners=reviewClients.get(client);if(!owners)reviewClients.set(client,owners=new Map());
 let guarded=owners.get(owner);
 if(!guarded)owners.set(owner,guarded={
  gmailPrepareOperation:(grant,request,proposal,signal)=>client.gmailPrepareOperation(grant,request,proposal,signal),
  gmailDispatchOperation:(grant,request,digest,proposal,signal)=>client.gmailDispatchOperation(grant,request,digest,proposal,signal),
  gmailOperation:InboxOperation.receiptReads((grant,request,signal)=>client.gmailOperation(grant,request,signal),inboxLocalStore,owner),
  gmailInboxCapabilities:(grant,signal)=>client.gmailInboxCapabilities(grant,signal),
  gmailDraft:(grant,draftId,signal)=>client.gmailDraft(grant,draftId,signal),
 });
 return guarded;
}
/** Explicit provider review (@elizaos/plugin-inbox/mailbox) on Alpha's Cloud binding and encrypted
 * slots; state never enters prototype persistence or agent context. A fixture connection never
 * reaches a provider. */
export function inboxProviderControls(publish:()=>void,toast:(message:string)=>void){
 return createMailReviewController({publish,toast,store:inboxLocalStore,reviewAttachment:reviewMailAttachment,
  disabled:()=>document.documentElement.dataset.connectionMode==='mock',
  binding:()=>{const binding=connectionController.getCloudClient();if(!binding)return null;const account=connectionController.getSnapshot().cloudAccount,owner=account?JSON.stringify([account.environment,account.userId,account.organizationId||'']):null;return {client:owner?reviewClient(binding.client,owner):binding.client,sessionId:binding.sessionId,owner};}});
}
