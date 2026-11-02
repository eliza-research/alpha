import type {LocalAgentProtocol} from '../runtime/local-agent';
/** Browser plugin registration must not import runtime modules that claim native plugin identities. */
type SpeechConnection={
 getBrowserSpeechAgent():LocalAgentProtocol|null;
 getCloudEnvironment?():string|null;
 getCloudClient?():{sessionId:string;credentialId:string}|null;
 getSnapshot():{session?:{sessionId:string}|null;kind?:string;residentInference?:string|null;providerStatus?:{voiceConfigured?:boolean;revision?:string}|null};
 subscribe(listener:()=>void):()=>void;
};
let connection:SpeechConnection|undefined,detach:(()=>void)|undefined;
const listeners=new Set<()=>void>();
const notify=()=>{for(const listener of listeners)listener();};
export const browserSpeechConnection={
 getBrowserSpeechAgent:()=>connection?.getBrowserSpeechAgent()??null,
 getCloudEnvironment:()=>connection?.getCloudEnvironment?.()??null,
 getCloudClient:()=>connection?.getCloudClient?.()??null,
 getSnapshot:()=>connection?.getSnapshot()??{session:null},
 subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
};
/** Bind after all browser plugins have registered; the provider remains live across session changes. */
export function bindBrowserSpeechConnection(value:SpeechConnection){detach?.();connection=value;detach=value.subscribe(notify);notify();}
