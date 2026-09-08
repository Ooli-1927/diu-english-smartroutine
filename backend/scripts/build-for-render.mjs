#!/usr/bin/env node
/**
 * Render often sets Root Directory to `backend/` and runs `npm install; npm run build`.
 * This script builds the sibling frontend/ and copies dist → backend/public.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(backendRoot, '..');
const frontendRoot = join(repoRoot, 'frontend');
const dist = join(frontendRoot, 'dist');
const publicDir = join(backendRoot, 'public');

function run(cmd, args, cwd) {
  console.log(`==> (${cwd}) ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (!existsSync(join(frontendRoot, 'package.json'))) {
  console.error(
    'frontend/ not found next to backend/. On Render set Root Directory blank and Build Command to: bash ./scripts/render-build.sh',
  );
  process.exit(1);
}

run('npm', ['install'], frontendRoot);
run('npm', ['run', 'build'], frontendRoot);

if (!existsSync(join(dist, 'index.html'))) {
  console.error('frontend build did not produce dist/index.html');
  process.exit(1);
}

rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(dist, publicDir, { recursive: true });
console.log(`==> Copied ${dist} -> ${publicDir}`);
console.log('==> Backend build ready');
