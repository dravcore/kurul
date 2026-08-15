import { NestFactory } from '@nestjs/core';
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './openapi.document';
import { firstDifference, serialise, SNAPSHOT_PATH } from './snapshot';

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

// What is left in this file is process wiring — argv, two filesystem calls, and booting the
// container — and it is the one part of `src/openapi` with no unit test. That is deliberate
// rather than an omission: `pnpm openapi:check` runs exactly this path on every CI build, which
// is a stronger check than a test with a mocked filesystem would be. What that leaves genuinely
// unverified is the branch below `committed === generated`, because a green run never takes it;
// the sentence it prints is tested through `snapshot.ts`, which is why those helpers live there.
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
