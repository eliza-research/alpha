import {assertPhoneWorkflowCapabilities,describePhoneWorkflowTrigger,parsePhoneWorkflowCatalog,validatePhoneWorkflowSpec,type PhoneTimeTrigger,type PhoneWorkflowCatalog,type PhoneWorkflowSaveReceipt,type PhoneWorkflowTrigger} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
import {browserDevProfile} from '../browser/dev-profile';
import type {WorkflowDeviceTarget} from './workflow-device-contract';
/** Typed phone workflows use the shared upstream contract (`@elizaos/contracts/phone-workflow`): the agent
 * normalizes, digests and compiles exactly the bytes this phone reviews. Only editor typing and the
 * development-profile enrollment label stay here. */
export type {PhoneTimeTrigger};
export type PhoneTrigger=PhoneWorkflowTrigger;
/** Editor view of the shared step union: loosely indexed so the authoring form can edit any variant. */
export interface PhoneStep {id:string;kind:'Read'|'If'|'Write'|'Notify'|'Speak';operation:string;[key:string]:any}
export interface PhoneSpec {device?:WorkflowDeviceTarget;version:1;name:string;description:string;trigger:PhoneTrigger;steps:PhoneStep[]}
export type PhoneCatalog=PhoneWorkflowCatalog;
export type PhoneSaveReceipt=PhoneWorkflowSaveReceipt;
const DEVELOPMENT_ENROLLMENT=/^development-cloud\.(first|second)-enrollment$/;
export function normalizePhoneSpec(value:unknown):PhoneSpec{
 const raw=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:null;
 const device=raw?.device&&typeof raw.device==='object'&&!Array.isArray(raw.device)?raw.device as Record<string,unknown>:null;
 // Preserve the public development enrollment labels (test-mocks builds only) without broadening native identifiers.
 const label=browserDevProfile&&typeof device?.enrollmentId==='string'&&DEVELOPMENT_ENROLLMENT.test(device.enrollmentId)?device.enrollmentId:undefined;
 if(!label)return validatePhoneWorkflowSpec(value) as PhoneSpec;
 const spec=validatePhoneWorkflowSpec({...raw,device:{...device,enrollmentId:label.replace('.','-')}}) as PhoneSpec;
 return {...spec,device:{...spec.device!,enrollmentId:label}};
}
export const parsePhoneCatalog=(value:unknown):PhoneCatalog=>parsePhoneWorkflowCatalog(value);
export function assertPhoneCapabilities(spec:PhoneSpec,catalog:PhoneCatalog){assertPhoneWorkflowCapabilities(spec as Parameters<typeof assertPhoneWorkflowCapabilities>[0],catalog);}
export const describePhoneTrigger=(trigger:PhoneTrigger):string=>describePhoneWorkflowTrigger(trigger);
/** Review copy for a scheduled time a forward clock change skips: shared `@elizaos/contracts/phone-workflow`. */
export {phoneTriggerClockChangeNote,zoneOffsetMinutes} from '../../../../.eliza/client-features/packages/contracts/src/phone-workflow.ts';
