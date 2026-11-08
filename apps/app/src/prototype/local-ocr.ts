import { recognizeLocalText as recognize } from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/local-ocr.ts';
import type { OcrProgress } from '../../../../.eliza/client-features/plugins/plugin-files/src/documents/local-ocr.ts';
/** Alpha ships a pinned local English OCR asset set. */
export function recognizeLocalText(image:Blob,signal:AbortSignal,onProgress:(value:OcrProgress)=>void=()=>{},layout=false) {
 return recognize({workerUrl:'/ocr/worker.min.js',assetsUrl:'/ocr/',language:'eng'},image,signal,onProgress,layout);
}
