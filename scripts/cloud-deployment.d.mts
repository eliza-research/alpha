export interface CloudDeploymentRow {api:string;web:string;services:string;tenant:string;name?:string;entitlementAudience?:string}
export type CloudDeploymentConfig = Record<'production'|'staging',CloudDeploymentRow>;
export interface CloudDeploymentCheckOptions {
  config?: CloudDeploymentConfig;
  sdkBases?: Readonly<Record<'production'|'staging',string>>;
  namespaces?: readonly string[];
}
export function validateCloudDeployment(input:unknown):CloudDeploymentConfig;
export function deploymentOutputs(config:CloudDeploymentConfig):Record<string,string>;
export const PAGES_NATIVE_AUTH_CALLBACKS:string;
export interface NativeAuthCallbackRegistration {redirectUri:string;androidPackage:string;appName:string;browserSignIn:{startPath:string;returnPath:string;storageKey:string;apiOrigin:string;tenant:string}}
export function nativeAuthCallbackRegistration(config:CloudDeploymentConfig,identity:{appId:string;appName:string},environment:'production'|'staging'):NativeAuthCallbackRegistration;
export function checkCloudDeployment(directory?:string,options?:CloudDeploymentCheckOptions):void;
