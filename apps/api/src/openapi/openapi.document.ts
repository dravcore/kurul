import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { STATUS_CODES } from 'node:http';
import {
  ATTACHMENT_DOWNLOAD_RATE_LIMIT,
  ATTACHMENT_UPLOAD_RATE_LIMIT,
  DEFAULT_RATE_LIMIT,
  IMPORT_RATE_LIMIT,
  INVITATION_RATE_LIMIT,
  RATE_LIMIT_WINDOW_SECONDS,
  TASK_SEARCH_RATE_LIMIT,
} from '../common/rate-limit/rate-limit';
import { readAppVersion } from '../common/app-version';
import { ErrorEnvelopeSchema } from './schemas/error.schema';

/**
 * The OpenAPI object types, derived from the one type `@nestjs/swagger` re-exports.
 *
 * `OperationObject`, `ParameterObject` and the rest exist in the package but only under
 * `dist/interfaces/...`, which is not part of its public entry point. Indexing off
 * `OpenAPIObject` keeps this file on the supported surface and still fails to compile if the
 * shapes ever change underneath it.
 */
type PathItem = OpenAPIObject['paths'][string];
type Operation = NonNullable<PathItem['get']>;
type Parameter = NonNullable<Operation['parameters']>[number];
type ResponseOrRef = NonNullable<Operation['responses'][string]>;
type ResponseHeaders = NonNullable<Extract<ResponseOrRef, { description: string }>['headers']>;

/**
 * Version the spec advertises.
 *
 * Deliberately the monorepo version rather than an independent one. `api-conventions.md` says
 * there is no `/v1` prefix before 1.0 and that `@kurul/shared-types` is versioned with the
 * monorepo, so a client that pins the package pins the contract. A second version number here
 * would be a second promise, and the two would disagree the first time one of them moved.
 *
 * Read from `apps/api/package.json` rather than written down, because a literal is exactly the
 * second promise the paragraph above refuses: it said "the monorepo version" while advertising
 * `0.1.0` from `v0.1.0` all the way through `v0.3.0`, and no step of the release process would
 * have caught it. `readAppVersion()` resolves the same file the telemetry ping reads, from
 * `src/` under Jest and from `dist/` under `pnpm openapi` and the runtime image, so the
 * generator, the snapshot spec and the served document cannot disagree. The committed
 * `apps/api/openapi.json` is byte-compared by `pnpm openapi:check` in CI, so a version bump
 * that forgets to regenerate now fails the gate instead of drifting quietly.
 */
const OPENAPI_VERSION = readAppVersion();

/** Name of the cookie security scheme every guarded operation references. */
export const SESSION_SECURITY_SCHEME = 'session';

/**
 * Name of the Bearer scheme for personal access tokens.
 *
 * Referenced by every workspace-addressed operation except the three that manage tokens; an
 * operation with no `{workspaceId}` in its path is session-only, because a token is bound to
 * one workspace and `SessionAuthGuard` refuses it wherever there is no workspace to compare.
 */
export const TOKEN_SECURITY_SCHEME = 'personalAccessToken';

/**
 * Workspace-addressed operations a personal access token can never call, as `METHOD path`.
 *
 * Two families. Token management, because a credential must not mint or enumerate
 * credentials (`SessionOnlyGuard` on `TokenController`). And the writes Better Auth's
 * organization plugin performs on the request's own session, which a token does not carry
 * (`SessionOnly()` in `WorkspaceController`). Listed rather than discovered for the same
 * reason as `PUBLIC_PATHS`, and checked by `assertOperationsExist` for the same reason.
 */
const SESSION_ONLY_OPERATIONS: readonly string[] = [
  'POST /workspaces/{workspaceId}/tokens',
  'GET /workspaces/{workspaceId}/tokens',
  'DELETE /workspaces/{workspaceId}/tokens/{tokenId}',
  'PATCH /workspaces/{workspaceId}',
  'DELETE /workspaces/{workspaceId}',
  'POST /workspaces/{workspaceId}/members/me/leave',
  'DELETE /workspaces/{workspaceId}/members/{userId}',
  'PATCH /workspaces/{workspaceId}/members/{userId}/role',
  'POST /workspaces/{workspaceId}/invitations',
  'DELETE /workspaces/{workspaceId}/invitations/{invitationId}',
  'POST /workspaces/{workspaceId}/invitations/{invitationId}/accept',
];

function acceptsToken(method: string, path: string): boolean {
  return (
    path.startsWith('/workspaces/{workspaceId}') &&
    !SESSION_ONLY_OPERATIONS.includes(`${method.toUpperCase()} ${path}`)
  );
}

/**
 * The complete set of operations that need **no** session.
 *
 * `SessionAuthGuard` is a global `APP_GUARD`, so every route in the API is authenticated unless
 * it carries `@Public()` — and `@Public()` appears on exactly one controller. Listed by path
 * rather than discovered because a document is a flat map of paths by the time it exists, and
 * `assertPathsExist` below turns a stale entry into a failed generation rather than a silently
 * ineffective exemption.
 */
const PUBLIC_PATHS: readonly string[] = ['/health', '/health/ready'];

/**
 * The complete set of operations the throttler never sees (`@SkipRateLimit()`).
 *
 * Same controller, same reason: a throttled probe reports a healthy API as unhealthy. These
 * operations therefore carry neither the rate-limit headers nor the `429`.
 */
const RATE_LIMIT_EXEMPT_PATHS: readonly string[] = ['/health', '/health/ready'];

/**
 * Every path-parameter name this API uses, all of which are UUIDv7 values.
 *
 * `UuidParam` binds `ParseUuidV7Pipe` to every path parameter in the API, but it is a
 * `ParameterDecorator` and `ApiParam` is a method decorator, so the format cannot travel with
 * the pipe. It is applied here instead — and the pass **throws** on a path parameter that is
 * not on this list, so the first route that takes a slug or a locale in its path fails
 * generation loudly rather than being published as a UUID it is not.
 */
const UUID_PATH_PARAMS: ReadonlySet<string> = new Set([
  'workspaceId',
  'boardId',
  'columnId',
  'taskId',
  'labelId',
  'commentId',
  'attachmentId',
  'checklistId',
  'itemId',
  'invitationId',
  'notificationId',
  'userId',
  'tokenId',
]);

const DESCRIPTION = `
The REST contract of one Kurul instance, generated from the running application: every path,
parameter, request body and response below is what the NestJS router and the DTO classes
actually declare, not a hand-maintained copy of them.

The prose contract is [\`docs/api-conventions.md\`](https://github.com/dravcore/kurul/blob/develop/docs/api-conventions.md).
Where this document and that one disagree, one of them is wrong and neither wins by default.

### What is not in here

**\`/auth/*\`.** Better Auth is mounted on raw Express below the Nest router
([ADR 0004](https://github.com/dravcore/kurul/blob/develop/docs/decisions/0004-auth-better-auth.md)),
so it has no controller to scan and no route this document can discover. Sign-in, sign-up,
sign-out and session refresh live there. **The Socket.io contract** is likewise absent: it is
not HTTP, and it is defined in \`@kurul/shared-types\`.

### Authentication

Two credentials, and every operation except the two health probes requires one of them.

A **session cookie**, issued by \`POST /auth/sign-in/email\`. A browser on the allowed origin
sends it automatically; any other client must store and replay it.

A **personal access token**, sent as \`Authorization: Bearer kurul_pat_...\`, minted by
\`POST /workspaces/{workspaceId}/tokens\` and shown once. A token acts as its owner in the one
workspace it was created in, with whatever role the owner holds at the time of each request;
there are no scopes beyond that. It is accepted on every operation whose path carries that
\`{workspaceId}\` and refused everywhere else: another workspace is \`404\`, exactly as for a
non-member; an operation with no workspace in its path (\`/me\`, \`GET /workspaces\`,
\`/instance/*\`) is \`403\`. A request that carries a Bearer header is decided by that header
alone and never falls back to a cookie. Revocation is immediate, expiry is checked on every
request, and the server stores only a SHA-256 of the secret.

An operation whose \`security\` lists only the \`session\` scheme is **session-only** and
answers \`403\` to a token: the three token-management operations, because a credential must
not mint or enumerate credentials, and the workspace-administration writes that Better Auth's
organization plugin performs on the caller's own session (rename and delete the workspace,
invite, revoke and accept invitations, remove a member, change a role, leave). Boards, columns,
tasks, labels, comments, checklists, attachments, imports, activity, notifications, the
dashboard and every read under the workspace accept either credential. See
[\`docs/api-conventions.md\`](https://github.com/dravcore/kurul/blob/develop/docs/api-conventions.md#authentication).

Writes (\`POST\`/\`PUT\`/\`PATCH\`/\`DELETE\`) are additionally checked server-side against an
origin allowlist. A request that announces an \`Origin\` other than \`WEB_URL\` is refused with
\`403\` before it reaches a handler; a request that announces none — \`curl\`, a CI script, a
native client — is allowed, because no cross-site request shape carries a victim's cookie *and*
omits the header.

### Errors

One shape, everywhere, including failures nobody wrote a handler for: \`ErrorEnvelopeSchema\`.
There is no second error format. Clients branch on \`statusCode\` and \`error\`, never on
\`message\` text. The single documented exception is \`GET /health/ready\`, whose \`503\` carries
the probe document instead — its caller is a healthcheck, not a client.

**\`404\`, not \`403\`, across the tenant boundary.** A resource in another workspace, a
workspace the caller is not a member of, and a workspace that does not exist are all \`404\`.
\`403\` means "a member, whose role is too low", and nothing else.

### Pagination

Cursor pagination is the default, and **the cursor key is always \`id\`, never \`position\`**.
That is a correctness rule: fractional indexing rewrites \`position\` on every drag, so a row
someone moves past the client's window would never be returned again. \`limit\` defaults to 50
(100 on the member and invitation rosters) and is **clamped** at 100 rather than rejected.
\`nextCursor\` is opaque — it is the \`id\` of the last item, and clients must not parse it.

### Rate limiting

Per client IP **and** per route, over a rolling ${RATE_LIMIT_WINDOW_SECONDS}-second window, so
one endpoint running hot never spends another's allowance. Responses under budget carry
\`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\` and \`X-RateLimit-Reset\`; a \`429\` carries
\`Retry-After\`. All four are absent when \`RATE_LIMIT_ENABLED=false\` — supported for the
integration suite and for nothing else, since a deployment that sets it has no brute-force
ceiling at all.

| Route | Budget |
| --- | --- |
| Anything not listed below | ${DEFAULT_RATE_LIMIT} / min |
| \`POST /workspaces/{workspaceId}/invitations\` | ${INVITATION_RATE_LIMIT} / min |
| \`GET /workspaces/{workspaceId}/boards/{boardId}/tasks?q=\` | ${TASK_SEARCH_RATE_LIMIT} / min |
| \`POST /workspaces/{workspaceId}/tasks/{taskId}/attachments\` | ${ATTACHMENT_UPLOAD_RATE_LIMIT} / min |
| \`POST /workspaces/{workspaceId}/imports/trello\` | ${IMPORT_RATE_LIMIT} / min |
| \`GET /workspaces/{workspaceId}/attachments/{attachmentId}/content\` | ${ATTACHMENT_DOWNLOAD_RATE_LIMIT} / min |
| \`GET /health\`, \`GET /health/ready\` | exempt |

\`/auth/*\` is governed by a second, independent limiter inside Better Auth and is not covered
by the headers above.

### Correlation

Every response carries \`X-Request-Id\`. A client may supply its own if it is URL-safe and 8-128
characters; anything else is replaced with a generated UUIDv7. The same value appears in the
error envelope's \`requestId\` and in the server's log lines, so one id selects one request.
`.trim();

/** Tags, declared once here and applied to controllers with `@ApiTags`. */
const TAGS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: 'Instance',
    description:
      'Liveness, readiness, deployment capabilities and the activation funnel. The only ' +
      'unauthenticated routes in the API are the two probes.',
  },
  { name: 'Account', description: "The caller's own profile." },
  {
    name: 'Workspaces',
    description: 'Workspaces, the member roster and invitations — the tenant root.',
  },
  { name: 'Boards', description: 'Boards and their columns.' },
  { name: 'Tasks', description: 'Tasks, ordering, assignees, task labels and checklists.' },
  { name: 'Labels', description: 'Board-scoped labels.' },
  { name: 'Comments', description: 'Task comments.' },
  {
    name: 'Attachments',
    description:
      'Files and links on a task, and the one endpoint in this API that answers with ' +
      'something other than JSON.',
  },
  { name: 'Import', description: "The API's only bulk write: a Trello board export." },
  { name: 'Activity', description: 'Workspace and task activity feeds.' },
  { name: 'Notifications', description: 'In-app notifications.' },
  { name: 'Dashboard', description: 'Read-only aggregations over a workspace.' },
  {
    name: 'Tokens',
    description:
      "A member's own personal access tokens for one workspace: minted once, listed by " +
      'prefix, revoked immediately. Session-only routes.',
  },
];

const RATE_LIMIT_HEADERS: ResponseHeaders = {
  'X-RateLimit-Limit': {
    description: 'Requests allowed for this route, in the current window.',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'Requests left in the current window. Never negative.',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the current window expires.',
    schema: { type: 'integer' },
  },
};

const REQUEST_ID_HEADER: ResponseHeaders = {
  'X-Request-Id': {
    description:
      'Correlation id for this request — the same value as the error envelope `requestId` ' +
      'and the server log lines. Echoed from the request when the client supplied a URL-safe ' +
      'value of 8-128 characters, generated otherwise.',
    schema: { type: 'string' },
  },
};

function errorContent(): Record<string, { schema: { $ref: string } }> {
  return {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorEnvelopeSchema' },
    },
  };
}

function isReference(value: object): boolean {
  return '$ref' in value;
}

/** Every `(method, path, operation)` triple in the document. */
function* operations(
  document: OpenAPIObject,
): Generator<{ method: string; path: string; operation: Operation }> {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, candidate] of Object.entries(item)) {
      // A path item also carries `parameters`, `$ref`, `summary`, `description` and `servers`,
      // none of which are operations. Only the verbs have `responses`.
      if (typeof candidate === 'object' && candidate !== null && 'responses' in candidate) {
        yield { method, path, operation: candidate as Operation };
      }
    }
  }
}

/**
 * The `assertPathsExist` of `SESSION_ONLY_OPERATIONS`: an entry naming an operation the
 * document does not contain would be a token exemption that exempts nothing, and an operation
 * quietly documented as accepting a credential it refuses.
 */
function assertOperationsExist(document: OpenAPIObject, entries: readonly string[]): void {
  const present = new Set<string>();
  for (const { method, path } of operations(document)) {
    present.add(`${method.toUpperCase()} ${path}`);
  }
  // A document with no workspace-addressed operation at all (the probe-only app the serving
  // spec builds) has nothing a token could be exempted from, so there is nothing to check.
  if (![...present].some((entry) => entry.includes(' /workspaces/{workspaceId}'))) {
    return;
  }
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length > 0) {
    throw new Error(
      `openapi: SESSION_ONLY_OPERATIONS names ${missing.length} operation(s) the document ` +
        `does not contain: ${missing.join(', ')}. Update the list in openapi.document.ts.`,
    );
  }
}

/**
 * Fails generation when a hard-coded path list has gone stale.
 *
 * The two exemption lists above are the only place in this file where a fact about the routing
 * is restated rather than read, so they are the only place that can quietly stop being true.
 * Renaming `/health/ready` would otherwise leave an exemption that exempts nothing and a probe
 * documented as requiring a session it does not require.
 */
function assertPathsExist(document: OpenAPIObject, paths: readonly string[], label: string): void {
  const missing = paths.filter((path) => document.paths[path] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `openapi: ${label} names ${missing.length} path(s) the document does not contain: ` +
        `${missing.join(', ')}. Update the list in openapi.document.ts.`,
    );
  }
}

/**
 * Applies the facts that are true of the whole API rather than of one handler.
 *
 * Everything here is a consequence of a **global** provider — the session guard, the throttler,
 * the exception filter, the request-id middleware — and writing it per handler would be 49
 * copies of one decision, 49 chances to forget it on the fiftieth route.
 */
function applyGlobalContract(document: OpenAPIObject): void {
  assertPathsExist(document, PUBLIC_PATHS, 'PUBLIC_PATHS');
  assertPathsExist(document, RATE_LIMIT_EXEMPT_PATHS, 'RATE_LIMIT_EXEMPT_PATHS');
  assertOperationsExist(document, SESSION_ONLY_OPERATIONS);

  for (const { method, path, operation } of operations(document)) {
    const isPublic = PUBLIC_PATHS.includes(path);
    const isThrottled = !RATE_LIMIT_EXEMPT_PATHS.includes(path);

    // `security: []` is how OpenAPI spells "this one overrides the document-level requirement",
    // and an empty array is meaningfully different from an absent key. Two entries in the
    // array mean "either one": a workspace-addressed operation takes a session or a token.
    operation.security = isPublic
      ? []
      : acceptsToken(method, path)
        ? [{ [SESSION_SECURITY_SCHEME]: [] }, { [TOKEN_SECURITY_SCHEME]: [] }]
        : [{ [SESSION_SECURITY_SCHEME]: [] }];

    for (const parameter of operation.parameters ?? []) {
      if (isReference(parameter)) {
        continue;
      }
      const typed = parameter as Extract<Parameter, { in: string }>;
      if (typed.in !== 'path') {
        continue;
      }
      if (!UUID_PATH_PARAMS.has(typed.name)) {
        throw new Error(
          `openapi: path parameter "${typed.name}" on ${path} is not in UUID_PATH_PARAMS. ` +
            'Every path parameter in this API is bound with UuidParam; add it to the set, or ' +
            'if it genuinely is not a UUIDv7, teach this pass how to describe it.',
        );
      }
      typed.schema = { ...(typed.schema ?? {}), type: 'string', format: 'uuid' };
      typed.description ??= 'UUIDv7. Opaque — never parsed, sorted or generated client-side.';
    }

    for (const [status, response] of Object.entries(operation.responses)) {
      if (typeof response !== 'object' || response === null || isReference(response)) {
        continue;
      }
      const typed = response as Extract<ResponseOrRef, { description: string }>;
      // `description` is required by the specification and `@nestjs/swagger` leaves it empty
      // when the decorator did not supply one. The reason phrase is a truthful default; a
      // response that deserves a sentence gets one at the decorator instead.
      typed.description ||= STATUS_CODES[Number(status)] ?? '';
      typed.headers = {
        ...REQUEST_ID_HEADER,
        ...(isThrottled ? RATE_LIMIT_HEADERS : {}),
        ...(typed.headers ?? {}),
      };
    }

    if (!isPublic) {
      operation.responses['401'] ??= {
        description: acceptsToken(method, path)
          ? 'No session cookie and no Bearer token, or a credential the server no longer ' +
            'recognises: a revoked or expired token reads the same as one that never existed.'
          : 'No session cookie, or one the server no longer recognises.',
        content: errorContent(),
      };
    }

    if (isThrottled) {
      operation.responses['429'] ??= {
        description:
          "Over this route's per-IP budget. Carries `Retry-After` with the seconds to wait.",
        headers: {
          'Retry-After': {
            description: 'Seconds to wait before retrying.',
            schema: { type: 'integer' },
          },
        },
        content: errorContent(),
      };
    }

    operation.responses['500'] ??= {
      description:
        'Unhandled failure. Never carries a stack trace, and never the raw exception message ' +
        'under `NODE_ENV=production`.',
      content: errorContent(),
    };
  }
}

/**
 * Builds the OpenAPI document for an already-created Nest application.
 *
 * Called from the two places that must agree byte for byte: `serveOpenApi` (what a running
 * instance publishes at `/docs`) and `generate-openapi.ts` (the snapshot CI diffs against).
 * Nothing here reads the clock, the network or the environment — a document that varied
 * between those two calls would make the drift gate fail on a clean tree, which is the one
 * failure mode that would get the gate switched off.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Kurul API')
    .setDescription(DESCRIPTION)
    .setVersion(OPENAPI_VERSION)
    .setLicense('AGPL-3.0-only', 'https://www.gnu.org/licenses/agpl-3.0.en.html')
    .addCookieAuth(
      'better-auth.session_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description:
          'Session cookie issued by `POST /auth/sign-in/email`, which is served below the ' +
          'Nest router and is therefore not described in this document.',
      },
      SESSION_SECURITY_SCHEME,
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'kurul_pat_...',
        description:
          'Personal access token from `POST /workspaces/{workspaceId}/tokens`. Bound to that ' +
          'workspace; acts as its owner with the role the owner holds at request time.',
      },
      TOKEN_SECURITY_SCHEME,
    )
    // A **relative** server URL. An absolute one would bake one deployment's hostname into a
    // document that ships in the repository and is served by every self-hosted instance under
    // a different name.
    .addServer('/', 'This instance');

  for (const tag of TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  const document = SwaggerModule.createDocument(app, builder.build(), {
    extraModels: [ErrorEnvelopeSchema],
  });

  applyGlobalContract(document);

  return document;
}
