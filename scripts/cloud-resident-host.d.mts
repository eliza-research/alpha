export const CLOUD_MODEL:string;
export interface CloudResidentBinding {token:string;credentialId:string;reference:string;expiresAt?:number}
export interface CloudResidentStatus {provider:'elizacloud';configured:boolean;model:string;attachable:boolean}
export interface CloudResidentHost {
 bind(credential:CloudResidentBinding):Promise<CloudResidentStatus>;
 clear():Promise<CloudResidentStatus>;
 status(id?:string):CloudResidentStatus;
 ready(signal:AbortSignal):Promise<{state:string}>;
 close():Promise<void>;
}
export function createCloudResidentHost(options:{source:string;profile:string;port:number;environment?:'production'|'staging';profileMode?:'lean'|'full';launch?:unknown;inherited?:NodeJS.ProcessEnv;request?:typeof fetch;startGoogleHost?:(apiToken:string,binding:Pick<CloudResidentBinding,'credentialId'|'reference'>)=>Promise<{port:number;close():Promise<void>}>}):Promise<CloudResidentHost>;
