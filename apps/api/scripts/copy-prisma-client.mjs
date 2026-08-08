import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'src', 'generated', 'prisma');
const target = join(root, 'dist', 'generated', 'prisma');

if (!existsSync(source)) {
  console.error('Prisma client not generated. Run: pnpm db:generate');
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(source, target, { recursive: true });
console.log('Copied Prisma client to dist/generated/prisma');
