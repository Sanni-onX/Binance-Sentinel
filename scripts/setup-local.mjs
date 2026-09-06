import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
if (!existsSync('.dev.vars')) {
  writeFileSync(
    '.dev.vars',
    `TOKEN_ENCRYPTION_KEY="${randomBytes(32).toString('base64')}"\n`,
    { flag: 'wx' },
  );
  console.log(
    'Created local encryption configuration. No credentials printed.',
  );
} else console.log('Existing local configuration preserved.');
