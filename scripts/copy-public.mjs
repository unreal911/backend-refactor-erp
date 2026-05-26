import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, 'src', 'public');
const targetDir = path.join(rootDir, 'dist', 'public');

if (!existsSync(sourceDir)) {
  console.warn(`[copy-public] Source folder not found: ${sourceDir}`);
  process.exit(0);
}

mkdirSync(path.dirname(targetDir), { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
console.log(`[copy-public] Copied ${sourceDir} -> ${targetDir}`);
