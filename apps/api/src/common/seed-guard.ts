/**
 * Refuses to run the seed in production.
 *
 * The seed starts by wiping every table (`deleteMany` across the whole schema) before
 * inserting demo data, so running it against a production database is unrecoverable data
 * loss. There is deliberately no `SEED_FORCE`-style override: a production reseed should
 * never be one environment variable away from an accident.
 *
 * The check is over-inclusive on purpose — `"Production"` or `" production "` also refuse.
 * A guard against a destructive operation should fail safe on sloppy spellings, unlike
 * `isProductionEnv()` in `env.ts`, where a strict match merely hides internals a bit less.
 *
 * Lives in `src/common` (not next to `seed.ts`) so Jest, whose `rootDir` is `src`, can
 * unit-test it without a database.
 */
export function assertSeedAllowed(nodeEnv: string | undefined): void {
  if (nodeEnv?.trim().toLowerCase() === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV is "production". The seed deletes ALL data before ' +
        'inserting demo fixtures. Run it only against a local or staging database.',
    );
  }
}
