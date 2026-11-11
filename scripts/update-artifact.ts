import fs from 'node:fs';
import {createHash} from 'node:crypto';

/** APKs include native speech models. Hash them with bounded memory. */
export function updateArtifactDigest(file: string) {
  const input = fs.openSync(file,'r'), hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  let size = 0;
  try {
    for (let count; (count = fs.readSync(input,buffer,0,buffer.length,null)) > 0;) {
      size += count;
      hash.update(buffer.subarray(0,count));
    }
    return {size,sha256:hash.digest('hex')};
  } finally {fs.closeSync(input);}
}
