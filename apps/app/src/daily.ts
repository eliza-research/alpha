import type {ReminderCreateOperation,ReminderCreateResult} from '../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts';
import type {ReminderOperation,ReminderTarget,ReminderResult} from '../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-contract.ts';
import { registerPlugin } from './platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import type { ClockDay } from './runtime/clock-contract';
export type Action =
  | "camera"
  | "photos"
  | "files"
  | "maps"
  | "calendar"
  | "calendar-create"
  | "email"
  | "inbox"
  | "browser"
  | "notifications"
  | "settings"
  | "reminder"
  | "voice"
  | "autofill"
  | "phone"
  | "messages"
  | "contacts";
export type Reminder = {
  target?: ReminderTarget;
  id: string;
  title: string;
  body: string;
  at: number;
  status: "pending" | "scheduled" | "posted" | "completed" | "cancelled" | "permission-denied" | "scheduling-failed";
  mode: "inexact" | "none";
  createdAt: number;
  occurrenceId?: string;
  dueAt?: number;
  alertMinutes?: number|null;
  snoozedAt?: number;
  recurrence?: {rule: "daily"|"weekdays"|"weekly";zone:string;date:string;time:string;leadMinutes:number};
  history?: {occurrenceId:string;dueAt:number;completedAt:number;skippedDates:number}[];
  postedAt?: number;
  cancelledAt?: number;
  completedAt?: number;
};
export type NativeResult = {
  status: "opened" | "selected" | "renamed-reselect" | "cancelled" | "unavailable" | "failed";
  action: Action;
  message?: string;
  selectionId?: string;
  uri?: string;
  name?: string;
  mimeType?: string;
  transcript?: string;
};
/** `days` (Sunday=1 … Saturday=7, ascending) is sent only when surfaceInfo reports clockRepeatDaysVersion >= 1. */
export type ClockRequest = {action:'set';hour:number;minute:number;label:string;timeZone?:string;reviewed:true;days?:ClockDay[]} | {action:'show'|'dismiss';reviewed:true} | {action:'snooze';snoozeMinutes:number;reviewed:true};
export type ClockResult = {action:ClockRequest['action'];status:'opened'|'unavailable'|'denied'|'failed'|'unknown';message:string};
export const DailyApps = registerPlugin<{
  clockHandoff(options:ClockRequest):Promise<ClockResult>;
  surfaceInfo(): Promise<{ developmentBuild: boolean; assistant: boolean; reminderCreationVersion?:1; reminderTapVersion?:1; reminderTimingVersion?: 2; clockRepeatDaysVersion?: number; bottomInset?: number; topInset?: number }>;
  pendingReminderTap():Promise<{token?:string;target?:ReminderTarget;retained?:boolean;question?:boolean}>;
  consumeReminderTap(options:{token:string}):Promise<void>;
  releaseReminderQuestion(options:{token:string}):Promise<void>;
  dismissReminderTap(options:{token:string}):Promise<void>;
  addListener(event:"pendingReminderTap",callback:(result:Record<string,never>)=>void):Promise<PluginListenerHandle>;
  closeAssistant(): Promise<{ closed: boolean }>;
  addListener(
    event: "appResumed",
    callback: (result: Record<string, never>) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "assistantInvoked",
    callback: (result: { source: "android-assist"; surface: "assistant" }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "restoredResult",
    callback: (result: NativeResult) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "reminderOpened",
    callback: (result: { id: string; occurrenceId?: string }) => void,
  ): Promise<PluginListenerHandle>;
  restoreSelected(): Promise<NativeResult>;
  describeSelected(options: { selectionId: string }): Promise<NativeResult>;
  renameSelected(options: { selectionId: string; name: string }): Promise<NativeResult>;
  pdfSelected(options: { selectionId: string; page: number }): Promise<{status:string; message?:string; page?:number; pageCount?:number; imageUri?:string; text?:string}>;
  readSelected(options: {
    selectionId: string;
  }): Promise<{
    status: string;
    text?: string;
    mimeType?: string;
    bytes?: number;
    message?: string;
  }>;
  openSelected(options: {
    selectionId: string;
  }): Promise<{ status: string; message?: string }>;
  shareSelected(options: { selectionId: string }): Promise<{ status: string; message?: string }>;
  forgetSelected(options: { selectionId: string }): Promise<void>;
  scheduleReminder(options: {
    id: string;
    title: string;
    body?: string;
    at: number;
    recurrence?: Reminder["recurrence"];
    dueAt?: number;
    alertMinutes?: number|null;
  }): Promise<{
    status: "pending" | "scheduled" | "permission-denied" | "past" | "failed";
    id: string;
    mode: "inexact" | "none";
    message?: string;
  }>;
  selectedReminder(options:{id:string}):Promise<ReminderTarget>;
  operateReminder(options:{operationId:string;bindingHash:string;operation:ReminderOperation|ReminderCreateOperation}):Promise<{status:string;result?:ReminderResult|ReminderCreateResult;message?:string}>;
  reminderOperationReceipt(options:{operationId:string;bindingHash:string;operation:ReminderOperation|ReminderCreateOperation}):Promise<{status:string;result?:ReminderResult|ReminderCreateResult;message?:string}>;
  reminderDecision(options:{id:string;occurrenceId:string;action:"done"|"snooze"}):Promise<{status:string;message?:string}>;
  saveTodo(options:{id:string;title:string;body?:string}):Promise<{status:string;id:string;message?:string}>;
  todoDecision(options:{target:NonNullable<Reminder['target']>;action:'done'|'reopen'|'cancel'}):Promise<{status:string;id:string}>;
  listReminders(): Promise<{
    reminders: Reminder[];
    notificationsEnabled: boolean;
  }>;
  capabilities(): Promise<{
    platform: string;
    actions: { action: Action; available: boolean; mode: string }[];
  }>;
  perform(options: {
    action: Action;
    query?: string;
    title?: string;
    body?: string;
    url?: string;
    startTime?: number;
    endTime?: number;
    mime?: string[];
    initialLocation?: "downloads";
  }): Promise<NativeResult>;
}>("DailyApps");
