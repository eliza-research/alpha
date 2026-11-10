/** Types for the pinned JavaScript launcher; runtime ownership stays upstream. */
import type {StdioOptions} from 'node:child_process';
export interface RuntimeEnvironmentOptions {
 inherited:NodeJS.ProcessEnv;allow:readonly string[];settings:NodeJS.ProcessEnv;owned:NodeJS.ProcessEnv;remove?:readonly string[];
}
export type RuntimeEnvironment=(options:RuntimeEnvironmentOptions)=>NodeJS.ProcessEnv;
export interface PrivateRuntimeExit {code:number|null;signal:NodeJS.Signals|null;error:Error|null}
export interface PrivateRuntimeProcess {completion:Promise<PrivateRuntimeExit>;stop(signal?:NodeJS.Signals):Promise<unknown>}
export interface PrivateRuntimeLaunchOptions {
 command:string;args:readonly string[];cwd:string;env:NodeJS.ProcessEnv;stdio?:StdioOptions;
 recordLaunch?:(record:{pid:number;launchedAt:number})=>void|Promise<void>;
 signalSource?:Pick<NodeJS.Process,'on'|'removeListener'>;stopTimeoutMs?:number;
}
export type PrivateRuntimeLauncher=(options:PrivateRuntimeLaunchOptions)=>Promise<PrivateRuntimeProcess>;
