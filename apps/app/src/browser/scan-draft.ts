import { createScanDraftStore } from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-draft.ts';
export { copyScanTextLayers } from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/scan-draft.ts';
export const {readScanDraft,saveScanDraft,deleteScanDraft} = createScanDraftStore('alpha.browser.scan-draft.v1');
