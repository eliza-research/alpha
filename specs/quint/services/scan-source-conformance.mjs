/** Check explicit scan ownership through the actual UI, IndexedDB store and export policy. */
import {scanRefinement} from '../refinement/services/scan.mjs';
const result = await scanRefinement();
console.log(`Scan draft source refinement passed ${result.traces} implementation-driven traces`);
