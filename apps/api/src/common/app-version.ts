import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Returned when no `package.json` can be found or read — never thrown, never guessed. */
const UNKNOWN_VERSION = 'unknown';

/**
 * The version of the running API, read from the nearest `package.json`.
 *
 * Resolved by walking up from this module's own directory rather than `process.cwd()`, for the
 * same reason `loadRootEnv` does: it has to give the same answer from `apps/api` under
 * `pnpm dev` (`__dirname` is `apps/api/dist/common`), from a Jest run (`apps/api/src/common`),
 * and from the runtime image, where `pnpm deploy` puts `dist/` and `package.json` side by side
 * under `/app`. All three land on `@kurul/api`'s own `package.json`.
 *
 * `npm_package_version` was the obvious alternative and is wrong: the environment variable only
 * exists when the process was started by a package manager script, and the container's
 * `CMD ["node", "dist/main.js"]` is not one — so it would be correct in development and silently
 * empty in exactly the deployments a version number is for.
 *
 * A missing or unreadable file returns {@link UNKNOWN_VERSION} rather than throwing. The only
 * caller is the opt-in telemetry ping, and a metrics nicety must never be able to stop a
 * process from booting.
 */
export function readAppVersion(startDir: string = __dirname): string {
  let dir = startDir;

  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        const version =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { version?: unknown }).version
            : undefined;
        if (typeof version === 'string' && version.trim() !== '') {
          return version.trim();
        }
      } catch {
        // A malformed or unreadable package.json is not a reason to stop looking upwards —
        // and not a reason to crash. Fall through to the parent directory.
      }
    }

    const parent = dirname(dir);
    if (parent === dir) {
      return UNKNOWN_VERSION;
    }
    dir = parent;
  }
}
