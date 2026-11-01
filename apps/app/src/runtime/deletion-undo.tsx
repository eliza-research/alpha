import {forgetNoteOrigin,savedNoteOrigin} from '../prototype/note-origin-adapter';
import {connectionController} from './connection-ui';
import {DeferredDeletionNotice} from '../../../../.eliza/client-features/packages/ui/src/components/composites/deferred-deletion-notice';
import {deletions,refreshDeletionViews} from './deletions';
import {browserScreenLocked} from '../browser/screen-locked';
import './deletion-undo.css';
/** Owner/session identity: a change clears every row before the new owner's are read. */
const identity={
 read(){const session=connectionController.getSnapshot().session;return session?JSON.stringify([session.origin,session.ownerId,session.agentId,session.sessionId]):'';},
 subscribe:(listener:()=>void)=>connectionController.subscribe(listener),
};
const refreshEvents=['alpha:deletions-changed','alpha:device-state'];
/** Alpha's binding of the shared reviewed-deletion Undo notice. */
export function DeletionUndo(){
 return <DeferredDeletionNotice bridge={deletions} identity={identity} concealed={browserScreenLocked} refreshEvents={refreshEvents} onChanged={refreshDeletionViews} className="alpha-deletion-undo"
  onDeletedOrigins={async origins=>{for(const origin of origins){if(savedNoteOrigin(origin.kind,origin.id))await forgetNoteOrigin(origin.kind,origin.id);}}}/>;
}
