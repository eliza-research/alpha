export interface CloudDeploymentRow {api:string;web:string;services:string;tenant:string}
export type CloudDeploymentConfig = Record<'production'|'staging',CloudDeploymentRow>;
export function validateCloudDeployment(input:unknown):CloudDeploymentConfig;
export function deploymentOutputs(config:CloudDeploymentConfig):Record<string,string>;
export function checkCloudDeployment(directory?:string,sdkBases?:Readonly<Record<'production'|'staging',string>>):void;
