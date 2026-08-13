import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'smartroutine-web', 'dist');
const dest = join(root, 'smartroutine-api', 'public');

if (!existsSync(join(src, 'index.html'))) {
  console.error('Missing smartroutine-web/dist — run web build first');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied ${src} -> ${dest}`);
