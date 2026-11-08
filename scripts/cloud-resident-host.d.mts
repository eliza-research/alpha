export const CLOUD_MODEL:string;
export interface CloudResidentBinding {token:string;credentialId:string;reference:string;expiresAt?:number}
export type ProviderKey='text'|'voice';
export interface ProviderSelection {mode:'cloud'|'own';expectedRevision:string}
export interface ProviderKeyEdit {textKey?:string;voiceKey?:string;expectedRevision:string}
export interface ProviderKeyRequest {key:ProviderKey;expectedRevision:string}
export interface CloudResidentStatus {provider:'elizacloud'|'cerebras';configured:boolean;selected:boolean;model:string;attachable:boolean;voiceConfigured:boolean;persistence:'host-session';revision:string;mode:'cloud'|'own';keys:{text:{configured:boolean};voice:{configured:boolean}}}
export interface CloudResidentHost {
 bind(credential:CloudResidentBinding):Promise<CloudResidentStatus>;
 clear():Promise<CloudResidentStatus>;
 selectOwn(input:{apiKey:string;cartesiaKey?:string},signal?:AbortSignal):Promise<CloudResidentStatus>;
 selectCloud(signal?:AbortSignal):Promise<CloudResidentStatus>;
 selectProvider(input:ProviderSelection,signal?:AbortSignal):Promise<CloudResidentStatus>;
 editProviderKeys(input:ProviderKeyEdit,signal?:AbortSignal):Promise<CloudResidentStatus>;
 removeProviderKey(input:ProviderKeyRequest,signal?:AbortSignal):Promise<CloudResidentStatus>;
 revealProviderKey(input:ProviderKeyRequest,signal?:AbortSignal):Promise<{key:ProviderKey;value:string;revision:string}>;
 invalidateProviderRequests():void;
 status(id?:string):CloudResidentStatus;
 ready(signal:AbortSignal):Promise<{state:string}>;
 close():Promise<void>;
}
export function createCloudResidentHost(options:{source:string;profile:string;port:number;environment?:'production'|'staging';profileMode?:'lean'|'full';cloudRealtimeVoice?:boolean;launch?:unknown;inherited?:NodeJS.ProcessEnv;request?:typeof fetch;startGoogleHost?:(apiToken:string,binding:Pick<CloudResidentBinding,'credentialId'|'reference'>)=>Promise<{port:number;close():Promise<void>}>}):Promise<CloudResidentHost>;
