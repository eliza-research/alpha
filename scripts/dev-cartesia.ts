import fs from 'node:fs';
import path from 'node:path';

// Explicit Mac developer configuration. Never exports the credential to Vite.
export function developmentCartesiaEnvironment(env = process.env) {
  if (env.ALPHA_DEV_CARTESIA === undefined || env.ALPHA_DEV_CARTESIA === '0') return {};
  if (env.ALPHA_DEV_CARTESIA !== '1') throw Error('ALPHA_DEV_CARTESIA must be 0 or 1');
  const file = env.CARTESIA_API_KEY_FILE;
  if (!file || !path.isAbsolute(file)) throw Error('A private absolute Cartesia credential reference is required');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size < 1 || stat.size > 4096) {
      throw Error('Cartesia credential file must be private and user-owned');
    }
  } finally { fs.closeSync(fd); }
  return {ELIZA_SELF_HOSTED_VOICE_ENABLED: '1', CARTESIA_API_KEY_FILE: file};
}
