export const CLOUD_MODEL:string;
export interface CloudResidentBinding {token:string;credentialId:string;reference:string;expiresAt?:number}
export interface CloudResidentStatus {provider:'elizacloud'|'cerebras';configured:boolean;selected:boolean;model:string;attachable:boolean;voiceConfigured?:boolean;persistence?:'host-session'|'host';revision?:string}
export interface CloudResidentHost {
 bind(credential:CloudResidentBinding):Promise<CloudResidentStatus>;
 clear():Promise<CloudResidentStatus>;
 selectOwn(input:{apiKey:string;cartesiaKey?:string},signal?:AbortSignal):Promise<CloudResidentStatus>;
 selectCloud(signal?:AbortSignal):Promise<CloudResidentStatus>;
 status(id?:string):CloudResidentStatus;
 ready(signal:AbortSignal):Promise<{state:string}>;
 close():Promise<void>;
}
export function createCloudResidentHost(options:{source:string;profile:string;port:number;environment?:'production'|'staging';profileMode?:'lean'|'full';cloudRealtimeVoice?:boolean;launch?:unknown;inherited?:NodeJS.ProcessEnv;request?:typeof fetch;startGoogleHost?:(apiToken:string,binding:Pick<CloudResidentBinding,'credentialId'|'reference'>)=>Promise<{port:number;close():Promise<void>}>}):Promise<CloudResidentHost>;
