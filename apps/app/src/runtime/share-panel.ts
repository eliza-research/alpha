export type SharePanelOptions = {
 current: () => boolean;
 external?: () => unknown | Promise<unknown>;
};
let sharing = false;
/** Open the platform chooser directly. Cancellation never chooses another destination. */
export async function openSharePanel(options: SharePanelOptions): Promise<void> {
 if (sharing || document.hidden || !options.current()) return;
 if (!options.external) throw Error('Sharing is unavailable on this device.');
 sharing = true;
 try {
  await options.external();
 } catch (error) {
  if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
 } finally {
  sharing = false;
 }
}
