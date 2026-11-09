export interface CloudDeploymentRow {api:string;web:string;services:string;tenant:string;name?:string;entitlementAudience?:string}
export type CloudDeploymentConfig = Record<'production'|'staging',CloudDeploymentRow>;
export interface CloudDeploymentCheckOptions {
  config?: CloudDeploymentConfig;
  sdkBases?: Readonly<Record<'production'|'staging',string>>;
  namespaces?: readonly string[];
}
export function validateCloudDeployment(input:unknown):CloudDeploymentConfig;
export function deploymentOutputs(config:CloudDeploymentConfig):Record<string,string>;
export function checkCloudDeployment(directory?:string,options?:CloudDeploymentCheckOptions):void;
