import { createMailReviewController } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/review-controller.ts';
import { inboxLocalStore } from '../runtime/inbox-local-store';
import { connectionController } from '../runtime/connection-ui';
import { reviewMailAttachment } from '../runtime/inbox-attachment';
/** Explicit provider review (@elizaos/plugin-inbox/mailbox) on Alpha's Cloud binding and encrypted
 * slots; state never enters prototype persistence or agent context. A fixture connection never
 * reaches a provider. */
export function inboxProviderControls(publish:()=>void,toast:(message:string)=>void){
 return createMailReviewController({publish,toast,store:inboxLocalStore,reviewAttachment:reviewMailAttachment,
  disabled:()=>document.documentElement.dataset.connectionMode==='mock',
  binding:()=>{const binding=connectionController.getCloudClient();if(!binding)return null;const account=connectionController.getSnapshot().cloudAccount;return {client:binding.client,sessionId:binding.sessionId,owner:account?JSON.stringify([account.environment,account.userId,account.organizationId||'']):null};}});
}
