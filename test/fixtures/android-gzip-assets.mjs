import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// The Android asset merger unwraps one gzip layer and removes one suffix.
export function mergeGzipAssets(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) mergeGzipAssets(file);
    else if (entry.name.endsWith('.gz')) {
      fs.writeFileSync(file.slice(0, -3), zlib.gunzipSync(fs.readFileSync(file)));
      fs.rmSync(file);
    }
  }
}
