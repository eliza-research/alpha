/** Alpha's local composer record is the shared durable draft row: text only, no source handles, approvals or message receipts. */
import {DURABLE_DRAFT_TEXT_LIMIT,readDurableDraft,replaceDurableDraft,type DurableDraft} from '../../../../.eliza/client-features/packages/ui/src/state/durable-draft.ts';
export type AssistantDraft=DurableDraft;
export const assistantDraftLimit=DURABLE_DRAFT_TEXT_LIMIT;
export function readAssistantDraft(value:unknown,binding:string):AssistantDraft|null{return readDurableDraft(value,binding);}
export function replaceAssistantDraft(actual:unknown,expected:AssistantDraft|null,binding:string,text:string,revision:()=>string){return replaceDurableDraft(actual,expected,binding,text,{revision});}
