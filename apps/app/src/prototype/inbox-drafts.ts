import { createMailDraftsController, type ComposePrefill as SharedComposePrefill, type ForwardSource as SharedForwardSource, type MailDraftsProvider, type SuggestionTarget as SharedSuggestionTarget } from '../../../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/drafts-controller.ts';
import {inboxUnsaved} from './inbox-unsaved';
import { registerPlugin } from '../platform-plugins';
import {DailyApps} from '../daily';
import {reviewMailAttachment,type MailAttachment} from '../runtime/inbox-attachment';
import { inboxLocalStore } from '../runtime/inbox-local-store';
import { connectionController } from '../runtime/connection-ui';
const attachmentNative=registerPlugin<{readSelected(input:{selectionId:string}):Promise<MailAttachment & {size:number;sha256:string}>}>('AlphaMailAttachments');
/** Content handed to a new composer: shared from another app or moved to another From account. */
export type ComposePrefill=SharedComposePrefill;
/** Source attachments a forward carries, bound to the selected message and its historyId. */
export type ForwardSource=SharedForwardSource;
/** The destination of a reviewed assistant suggestion, as shown to the user before inserting it. */
export type SuggestionTarget=SharedSuggestionTarget;
/** Local encrypted drafts (@elizaos/plugin-inbox/mailbox) on Alpha's encrypted slots, recovery copy and
 * native file picker. They remain separate from explicitly reviewed provider operations. */
export function inboxDrafts(publish:()=>void,toast:(text:string)=>void, provider?:MailDraftsProvider) {
 return createMailDraftsController({publish,toast,provider,store:inboxLocalStore,retained:inboxUnsaved,reviewAttachment:reviewMailAttachment,
  confirm:message=>window.confirm(message),
  identity:()=>({sessionId:connectionController.getCloudClient()?.sessionId,account:connectionController.getSnapshot().cloudAccount??null}),
  attachments:{select:()=>DailyApps.perform({action:'files'}),read:selectionId=>attachmentNative.readSelected({selectionId}),forget:selectionId=>DailyApps.forgetSelected({selectionId})}});
}
