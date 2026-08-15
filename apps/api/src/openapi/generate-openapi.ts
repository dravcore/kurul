import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './openapi.document';

/**
 * Where the snapshot lives, resolved from this file rather than from `process.cwd()`.
 *
 * Two levels up is the package root both from `dist/openapi/` and from `src/openapi/`, so the
 * same constant works whether this runs from the build output or straight from source, and it
 * does not care which directory the command was typed in.
 */
const SNAPSHOT_PATH = join(__dirname, '..', '..', 'openapi.json');

/**
 * Serialises the document the way the repository stores it.
 *
 * `prettier` rather than `JSON.stringify` alone because `pnpm format:check` runs over the whole
 * tree, `openapi.json` is not excluded, and a snapshot that fails the formatter would have to
 * be either reformatted by hand on every regeneration or added to `.prettierignore` — and
 * ignoring it would mean the one file CI diffs is the one file CI does not format-check.
 * Loading prettier here keeps the two in agreement by construction.
 */
async function serialise(document: object): Promise<string> {
  // Imported lazily: `prettier` is a root devDependency and must not be a runtime import of the
  // API, which ships without devDependencies. Nothing on the serving path reaches this file.
  const prettier = await import('prettier');
  const raw = `${JSON.stringify(document, null, 2)}\n`;
  const options = await prettier.resolveConfig(SNAPSHOT_PATH);
  return prettier.format(raw, { ...options, filepath: SNAPSHOT_PATH });
}

/** The first line at which two documents stop agreeing, for an error message worth reading. */
function firstDifference(expected: string, actual: string): string {
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

  return '  files differ in length only';
}

/**
 * Builds the document without starting a server or dialling a dependency.
 *
 * `preview: true` is what makes that true: Nest loads every module and registers every
 * controller's metadata — which is all `SwaggerModule` reads — but instantiates no providers,
 * so `PrismaService.onModuleInit` never opens a pool and nothing connects to Redis. That is why
 * this can run next to `pnpm build` in a CI job with no Postgres and no Redis.
 *
 * **It does still need the environment the application validates at import.** Preview mode
 * skips provider *instantiation*, not module *evaluation*: `auth/auth.ts` throws
 * `BETTER_AUTH_SECRET is required` while its module body runs, and `prisma/database.ts` builds
 * a pool object from `DATABASE_URL` (lazily — it opens no socket). Both are therefore set in
 * the `build` job, to placeholders, and CI failing on that once is how it was found rather than
 * reasoned about.
 */
async function generate(): Promise<string> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  try {
    return await serialise(buildOpenApiDocument(app));
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const generated = await generate();
  const displayPath = relative(process.cwd(), SNAPSHOT_PATH);

  if (!check) {
    await writeFile(SNAPSHOT_PATH, generated, 'utf8');
    process.stdout.write(`openapi: wrote ${displayPath}\n`);
    return;
  }

  const committed = await readFile(SNAPSHOT_PATH, 'utf8').catch(() => undefined);
  if (committed === undefined) {
    process.stderr.write(
      `openapi: ${displayPath} does not exist. Run \`pnpm openapi\` and commit the result.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (committed === generated) {
    process.stdout.write(`openapi: ${displayPath} matches the generated document\n`);
    return;
  }

  process.stderr.write(
    [
      `openapi: ${displayPath} is out of date.`,
      firstDifference(committed, generated),
      '',
      'The API changed and the committed specification did not. Run `pnpm openapi` and commit',
      'the result in the same change that altered the routes or the DTOs.',
      '',
    ].join('\n'),
  );
  process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
