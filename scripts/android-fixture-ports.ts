/** Consumer types for the pinned native JS harness, whose empty-array defaults infer never[]. */
interface FixtureApk {apk:string;testApk:string;additionalInstrumentationRunners?:string[]}
interface FixtureVariant extends FixtureApk {name:string;upgrade?:FixtureApk}
type FixtureHook=(context:any)=>unknown|Promise<unknown>;
export interface IsolatedAndroidTestOptions {
 serial:string|undefined;adb:string;aapt:string;packageName:string;directory:string;variants:FixtureVariant[];
 env?:NodeJS.ProcessEnv;testPackage?:string;runner?:string;additionalInstrumentationRunners?:string[];
 testClass?:string;testClasses?:string[];testMethod?:string;expectedTests?:number;
 requiredAbi?:string;expectedAvdName?:string;expectedCuttlefish?:unknown;developmentDevice?:unknown;
 androidUser?:number;deviceLease?:unknown;signal?:AbortSignal;commandTimeoutMs?:number;cleanupTimeoutMs?:number;
 companionApks?:{packageName:string;apk:string;sha256:string}[];evidence?:string;appEvidence?:unknown;wake?:boolean;
 runnerArgs?:string[];upgradeRunnerArgs?:string[];instrumentationTimeoutMs?:number;
 beforeUpgrade?:FixtureHook;afterUpgrade?:FixtureHook;preflightVariant?:FixtureHook;prepareVariant?:FixtureHook;collectVariant?:FixtureHook;cleanupVariant?:FixtureHook;
}
export type IsolatedAndroidTest=(options:IsolatedAndroidTestOptions)=>Promise<Record<string,any>>;
