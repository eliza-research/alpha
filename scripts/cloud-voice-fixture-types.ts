/** VM renderer and synthetic native ports are installed dynamically by the closed voice harness. */
import type vm from 'node:vm';
import type {cloudVoiceViewFixture} from '../test/fixtures/cloud-voice-view.mjs';
export type CloudVoiceFixture=Omit<ReturnType<typeof cloudVoiceViewFixture>,'box'|'shell'|'driver'|'render'|'renderChat'|'events'> & {
 box:vm.Context;shell:vm.Context;driver:vm.Context;render:()=>vm.Context;renderChat:()=>vm.Context;
 events:Map<string,Set<(event:any)=>void>>;
 holdPlaybackCleanup:boolean;releasePlaybackCleanup:()=>void;
 notesRecorderControl:vm.Context;transcribeInput:{consent:boolean;credentialId:string;[field:string]:unknown};
};
