/** Synthetic transport response; endpoint-specific JSON fields are asserted by each host campaign. */
export interface FixtureHttpResponse<T=Record<string,any>> {status:number;body:T}
/** Reports acquire endpoint-specific measurements as each real campaign phase completes. */
export interface FixtureReport {scope:string;passed:boolean;testedAt?:string;error?:string;[measurement:string]:any}
/** Source/APK/user lifecycle reports populate their checked measurements in stages. */
export interface FixtureEvidence {passed:boolean;[measurement:string]:any}
