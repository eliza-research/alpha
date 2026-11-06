import {
 parseWorkflowPhoneReview as parseSharedPhoneReview,
 parseWorkflowReminderRead,
 validateWorkflowReadResult,
 type WorkflowPhoneReview,
 type WorkflowReadOperation,
 type WorkflowReadResult,
 type WorkflowReminderReadOperation,
 type WorkflowReminderRow,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
/** Workflow data scopes are the shared `@elizaos/contracts/workflow-device` contract: reviewed read
 * operations and results, the run's phone review and the step-request check. */
export {
 SELECTED_REMINDERS_WINDOW,
 assertWorkflowOperation,
 parseWorkflowBinding,
 parseWorkflowRead,
 parseWorkflowReminderRead,
 workflowApprovalNotice,
 workflowBytes,
 workflowId,
 workflowObject,
 workflowSha,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
export type {
 WorkflowDeviceBinding,
 WorkflowDeviceTarget,
 WorkflowPhoneReview,
 WorkflowReadOperation,
 WorkflowReadResult,
 WorkflowReminderReadOperation,
 WorkflowReminderRow,
} from '../../../../.eliza/client-features/packages/contracts/src/workflow-device.ts';
/** Validates a phone read result against its reviewed scope before any model sees it. */
export const validateWorkflowResult=(operation:WorkflowReadOperation,value:unknown):Promise<WorkflowReadResult>=>validateWorkflowReadResult(operation,value);
/** Validates a phone reminder read against its reviewed owner-day window. */
export async function validateWorkflowReminderResult(operation:WorkflowReminderReadOperation,value:unknown):Promise<{kind:'reminders';reminders:WorkflowReminderRow[]}>{
 const result=await validateWorkflowReadResult(parseWorkflowReminderRead(operation),value);
 if(result.kind!=='reminders')throw new Error('Workflow phone scope could not be verified');
 return result;
}
export async function parseWorkflowPhoneReview(value:unknown,expected:{id:string;workflowId:string;versionId:string}):Promise<WorkflowPhoneReview>{
 const {normalizePhoneSpec}=await import('./phone-workflow-authoring');
 return parseSharedPhoneReview(value,expected,{normalizePhoneSpec:spec=>normalizePhoneSpec(spec) as never});
}
