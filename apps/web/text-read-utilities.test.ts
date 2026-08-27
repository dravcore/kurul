import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `read` (14/21, docs/design.md §3) is a closed list on purpose: task description, comment body
 * and import report sentences carry it, nowhere else, board cards included, which stay
 * `text-body` (13/18). Same scanning technique `border-utilities.test.ts` uses for its own closed
 * lists, so a new call site cannot land silently.
 */

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const scanRoots = ['app', 'components', 'lib'];

const CLOSED_LIST = [
  'components/board/import-report-panel.tsx',
  'components/task/comment-body.tsx',
  'components/task/task-panel-fields.tsx',
].sort();

/** `text-read` only, never a longer token it happens to prefix (there is none today, but the
 * lookahead keeps that true if one is ever added). */
const TEXT_READ_RE = /(?<![\w.,/-])text-read(?![\w-])/;

/** Comments are prose in the same sense a test title is, not a call site. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield full;
  }
}

async function collectCallSites(): Promise<string[]> {
  const files = new Set<string>();
  for (const root of scanRoots) {
    for await (const file of sourceFiles(path.join(webRoot, root))) {
      const source = stripComments(await readFile(file, 'utf8'));
      if (TEXT_READ_RE.test(source)) files.add(path.relative(webRoot, file));
    }
  }
  return [...files].sort();
}

describe('text-read utility call sites', () => {
  it('confines text-read to the closed list: task description, comment body, import report sentences', async () => {
    expect(await collectCallSites()).toEqual(CLOSED_LIST);
  });
});
