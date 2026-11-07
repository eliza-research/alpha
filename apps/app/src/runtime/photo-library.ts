/** Device photo/video library contract (issue 408, policy P-24): the shared elizaOS contract
 * (plugin-assistant device-actions/photo-library-contract) with Alpha named in owner-facing text.
 * The local agent may use every photo and video Android lets Alpha read; full local access is not
 * an upload. Native scope and identity rules are the shared PermittedMediaCatalog (plugin-native-media). */
import * as shared from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts';

export * from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/photo-library-contract.ts';

const APP_NAME = 'Alpha';
export function scopePresentation(state: Parameters<typeof shared.scopePresentation>[0]): ReturnType<typeof shared.scopePresentation> { return shared.scopePresentation(state, APP_NAME); }
export function reviewText(action: shared.LibraryAction, count: number): ReturnType<typeof shared.reviewText> { return shared.reviewText(action, count, APP_NAME); }
export function describeLibraryOperation(op: shared.LibraryAgentOperation): ReturnType<typeof shared.describeLibraryOperation> { return shared.describeLibraryOperation(op, APP_NAME); }
