// The ESM build (dist/*.js) relies on the package-level "type": "module".
// The CJS build lives in dist/cjs and needs its own package.json marking
// that subtree as CommonJS, so Node treats dist/cjs/*.js as CJS instead of
// inheriting the parent "type": "module".
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'dist', 'cjs', 'package.json');

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('Wrote dist/cjs/package.json');
