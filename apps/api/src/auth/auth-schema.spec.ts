import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSchema } from 'better-auth/db';
import { auth } from './auth';

/**
 * The Prisma schema against the tables Better Auth writes, read the way Better Auth's own schema
 * validation reads them: a table or column it writes must exist, and a column it does not write
 * must let an insert leave it out.
 *
 * Better Auth runs that validation itself since 1.7.3, at startup and before every auth request,
 * but through a Prisma 7 client it sees only names. The runtime data model the generated client
 * carries says nothing about whether a column is required, so the adapter treats every column
 * as nullable. That is how `Account.issuer` got through: Better Auth 1.7.3 stopped writing it,
 * its check passed against the `NOT NULL` column 0.4.0 added, and every sign-up then failed at
 * the insert with `Argument issuer is missing`. This spec reads the rule off `schema.prisma`,
 * where the `?` and the `@default` are, so the next column Better Auth stops writing fails here
 * rather than in the integration suite or on an instance.
 */

const SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

interface PrismaColumn {
  name: string;
  /** Not optional, not a list, and no `@default` or `@updatedAt`: an insert must name it. */
  insertMustName: boolean;
}

/** Every model's scalar columns. A field typed as another model is a relation, not a column. */
function readPrismaModels(source: string): Map<string, PrismaColumn[]> {
  const blocks = [...source.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)];
  const modelNames = new Set(blocks.map(([, name]) => name));
  const models = new Map<string, PrismaColumn[]>();
  for (const [, name, body] of blocks) {
    const columns: PrismaColumn[] = [];
    for (const line of body.split('\n')) {
      const field = /^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!field || modelNames.has(field[2])) continue;
      const [, column, , list, optional, attributes] = field;
      columns.push({
        name: column,
        insertMustName: !list && !optional && !/@default\(|@updatedAt/.test(attributes),
      });
    }
    models.set(name, columns);
  }
  return models;
}

/** The Prisma adapter addresses `prisma.workspaceMember`, which is the model `WorkspaceMember`. */
function prismaModelName(modelName: string): string {
  return modelName.charAt(0).toUpperCase() + modelName.slice(1);
}

describe('the Prisma schema against the tables Better Auth writes', () => {
  const models = readPrismaModels(readFileSync(SCHEMA_PATH, 'utf8'));
  const tables = Object.entries(getSchema(auth.options)).filter(
    ([, table]) => table.disableMigrations !== true,
  );

  it('reads the seven tables this configuration writes, so the checks below are not vacuous', () => {
    expect(tables.map(([modelName]) => modelName).sort()).toEqual([
      'account',
      'session',
      'user',
      'verification',
      'workspace',
      'workspaceInvitation',
      'workspaceMember',
    ]);
  });

  it('has every table and column Better Auth writes', () => {
    const missing: string[] = [];
    for (const [modelName, table] of tables) {
      const columns = models.get(prismaModelName(modelName));
      if (columns === undefined) {
        missing.push(prismaModelName(modelName));
        continue;
      }
      for (const field of ['id', ...Object.keys(table.fields)]) {
        if (!columns.some((column) => column.name === field)) {
          missing.push(`${prismaModelName(modelName)}.${field}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('requires no column Better Auth never writes', () => {
    const unwritable: string[] = [];
    for (const [modelName, table] of tables) {
      const written = new Set(['id', ...Object.keys(table.fields)]);
      for (const column of models.get(prismaModelName(modelName)) ?? []) {
        if (column.insertMustName && !written.has(column.name)) {
          unwritable.push(`${prismaModelName(modelName)}.${column.name}`);
        }
      }
    }
    expect(unwritable).toEqual([]);
  });
});
