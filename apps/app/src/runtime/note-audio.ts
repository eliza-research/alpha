import {registerPlugin} from '../platform-plugins';

type SavedAudio = { audioId: string; noteId: string; durationMs: number; transcript: string };
export const noteAudio = registerPlugin<{
  play(input: { audioId: string }): Promise<void>; stop(): Promise<void>;
  state(): Promise<{ playing: boolean; audioId?: string; positionMs: number }>;
  describe(input:{audioId:string}):Promise<SavedAudio & {deletedAt?:number}>;
  remove(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  deletionStatus(input:{audioId:string;noteId:string;operationId:string}):Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
  restore(input: { audioId: string; noteId: string; operationId:string }): Promise<unknown>;
  purge(input: { audioId: string; noteId: string; operationId:string }): Promise<{audioId:string;noteId:string;operationId:string;status:string}>;
}>('AlphaNoteAudio');
