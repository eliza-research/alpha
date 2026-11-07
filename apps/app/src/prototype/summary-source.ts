import {sensitiveReadingUrl} from '../../../../.eliza/client-features/plugins/plugin-native-browser-surface/src/page-reading.ts';
import {recordingRevision,recordingSourceOf,summarySourceOf as sharedSummarySourceOf,webSourceOf as sharedWebSourceOf,type RecordingSourceLink,type SummarySourceLink,type WebSourceLink} from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/source-links.ts';
/** Source-link validators are the shared plugin-files rules (J03); Alpha applies its reading policy to web links. */
export type WebSource=WebSourceLink;
export type RecordingSource=RecordingSourceLink;
export type SummarySource=SummarySourceLink;
export {recordingRevision,recordingSourceOf};
export function webSourceOf(value:unknown):WebSource|undefined{return sharedWebSourceOf(value,sensitiveReadingUrl);}
export function summarySourceOf(value:unknown):SummarySource|undefined{return sharedSummarySourceOf(value,sensitiveReadingUrl);}
