import {createHash} from 'node:crypto';
import fs from 'node:fs';

/** Lowercase hex SHA-256 of bytes or UTF-8 text. */
export const sha256 = (bytes: string | NodeJS.ArrayBufferView) => createHash('sha256').update(bytes).digest('hex');

/** Lowercase hex SHA-256 of a file, streamed so large model and image files need no large buffer. */
export function sha256File(file: string) {
  const hash = createHash('sha256'), fd = fs.openSync(file, 'r'), buffer = Buffer.alloc(4 * 1024 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
