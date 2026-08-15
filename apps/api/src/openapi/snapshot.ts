import { join } from 'node:path';

/**
 * The committed-snapshot half of the drift gate: where the file is, how it is written, and what
 * to say when it disagrees with the generated document.
 *
 * Separate from `generate-openapi.ts` so that testing it does not mean importing `AppModule`.
 * The command has to import the whole application — that is its job — but nothing in this file
 * does, so a unit test can exercise it without booting a container, and the unit suite cannot
 * accidentally run the generator.
 */

/**
 * Where the snapshot lives, resolved from this file rather than from `process.cwd()`.
 *
 * Two levels up is the package root both from `dist/openapi/` and from `src/openapi/`, so the
 * same constant works whether this runs from the build output or straight from source, and it
 * does not care which directory the command was typed in.
 */
export const SNAPSHOT_PATH = join(__dirname, '..', '..', 'openapi.json');

/**
 * Serialises the document the way the repository stores it.
 *
 * `prettier` rather than `JSON.stringify` alone because `pnpm format:check` runs over the whole
 * tree, `openapi.json` is not excluded, and a snapshot that fails the formatter would have to
 * be either reformatted by hand on every regeneration or added to `.prettierignore` — and
 * ignoring it would mean the one file CI diffs is the one file CI does not format-check.
 * Loading prettier here keeps the two in agreement by construction.
 */
export async function serialise(document: object): Promise<string> {
  // Imported lazily: `prettier` is a devDependency and must not be a runtime import of the API,
  // which ships without them. Nothing on the serving path reaches this file.
  const prettier = await import('prettier');
  const raw = `${JSON.stringify(document, null, 2)}\n`;
  const options = await prettier.resolveConfig(SNAPSHOT_PATH);
  return prettier.format(raw, { ...options, filepath: SNAPSHOT_PATH });
}

/**
 * The first line at which two documents stop agreeing, for an error message worth reading.
 *
 * Tested directly, and not only for the coverage. This is the sentence a developer reads at the
 * exact moment CI has stopped them, and an off-by-one in the line number is the kind of defect
 * that survives forever because everyone who sees it is already debugging something else. The
 * drift gate cannot check it: a green run never calls this function, so the instrument that
 * exercises the rest of the generator is by construction blind to the part that only runs when
 * the generator has something to report.
 */
export function firstDifference(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const limit = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < limit; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return [
        `  first difference at line ${index + 1}:`,
        `    committed: ${expectedLines[index] ?? '<end of file>'}`,
        `    generated: ${actualLines[index] ?? '<end of file>'}`,
      ].join('\n');
    }
  }

  // Only reachable when the two are identical, which the caller has already ruled out before it
  // asks. Kept total rather than throwing: a diff helper that explodes on equal inputs is a
  // worse thing to own than one that says so.
  return '  the two documents are identical';
}
