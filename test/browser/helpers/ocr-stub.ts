import type { Page } from '@playwright/test';

/**
 * Replaces the local OCR worker with one that answers each request at once, for specs that test the
 * scan review rather than recognition. It speaks the pinned Tesseract 7 worker protocol that
 * `local-ocr.ts` checks (workerId, jobId and action echoed, `status: 'resolve'`), and `recognize`
 * returns `text` with no line positions. Real recognition stays in local-ocr, scan-searchable,
 * scan-links and scan-event.
 */
export async function stubOcr(page: Page, text: string) {
  const result = JSON.stringify({ text, confidence: 90, blocks: null });
  await page.route('**/ocr/worker.min.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `self.onmessage=({data})=>self.postMessage({workerId:data.workerId,jobId:data.jobId,action:data.action,status:'resolve',data:data.action==='recognize'?${result}:{}});`,
  }));
}
