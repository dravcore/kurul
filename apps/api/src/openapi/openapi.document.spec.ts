import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  buildOpenApiDocument,
  SESSION_SECURITY_SCHEME,
  TOKEN_SECURITY_SCHEME,
} from './openapi.document';

/**
 * `applyGlobalContract` is the half of this module that is behaviour rather than prose, and it
 * is tested here because the instrument that exercises everything else cannot reach it.
 *
 * `pnpm openapi:check` regenerates the whole document on every CI run and byte-compares it
 * against the committed copy, which is a stronger check than any assertion below — for the
 * paths it walks. It walks the *successful* ones only. The two guards this file exists to pin
 * (`assertPathsExist` and the `UUID_PATH_PARAMS` membership test) throw, so a green run never
 * executes them, and they are exactly the code that makes it safe to restate a routing fact as
 * a hard-coded list. The gate proves the lists are currently right; only these tests prove that
 * the thing which is supposed to notice when they stop being right actually notices.
 *
 * The applications below are stubs rather than `AppModule`. That is deliberate: a test that
 * scanned the real container would assert the shape of today's routing table, which is what the
 * committed snapshot already does, and would fail every time somebody added an endpoint.
 */

/** Stands in for `HealthController` — the only `@Public()` `@SkipRateLimit()` routes there are. */
@Controller('health')
class StubHealthController {
  @Get()
  check(): string {
    return 'ok';
  }

  @Get('ready')
  ready(): string {
    return 'ok';
  }
}

/**
 * Every handler below returns a constant and none of them reads the parameter it declares.
 *
 * The declarations are the whole point — they are what `SwaggerModule` scans to produce the
 * parameter list this file makes assertions about — but echoing one back into the response is
 * reflected XSS, which CodeQL flagged on the first version of this file and was right to. A stub
 * that reflects user input is a bad pattern to leave lying around as an example even where
 * nothing serves it, and none of these applications is ever `init()`ed, let alone listening.
 */
@Controller('workspaces/:workspaceId')
class StubWorkspaceController {
  @Get()
  read(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Get('tasks/:taskId')
  get(@Param('workspaceId') _workspaceId: string, @Param('taskId') _taskId: string): string {
    return 'ok';
  }

  @Post('tasks')
  create(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  /** Carries a query parameter, which the UUID pass must leave alone. */
  @Get('tasks')
  list(@Param('workspaceId') _workspaceId: string, @Query('cursor') _cursor: string): string {
    return 'ok';
  }
}

/**
 * Every operation `SESSION_ONLY_OPERATIONS` names, plus one route with no workspace at all.
 *
 * The list is checked against the document the way `PUBLIC_PATHS` is, so a stub that declared
 * only some of them would fail generation; the handlers are as empty as the ones above.
 */
@Controller()
class StubSessionOnlyController {
  @Post('workspaces/:workspaceId/tokens')
  createToken(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Get('workspaces/:workspaceId/tokens')
  tokens(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Delete('workspaces/:workspaceId/tokens/:tokenId')
  revokeToken(@Param('workspaceId') _w: string, @Param('tokenId') _t: string): string {
    return 'ok';
  }

  @Patch('workspaces/:workspaceId')
  rename(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Delete('workspaces/:workspaceId')
  remove(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Post('workspaces/:workspaceId/members/me/leave')
  leave(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  removeMember(@Param('workspaceId') _w: string, @Param('userId') _u: string): string {
    return 'ok';
  }

  @Patch('workspaces/:workspaceId/members/:userId/role')
  changeRole(@Param('workspaceId') _w: string, @Param('userId') _u: string): string {
    return 'ok';
  }

  @Post('workspaces/:workspaceId/invitations')
  invite(@Param('workspaceId') _workspaceId: string): string {
    return 'ok';
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  revokeInvitation(@Param('workspaceId') _w: string, @Param('invitationId') _i: string): string {
    return 'ok';
  }

  @Post('workspaces/:workspaceId/invitations/:invitationId/accept')
  accept(@Param('workspaceId') _w: string, @Param('invitationId') _i: string): string {
    return 'ok';
  }

  @Get('me')
  me(): string {
    return 'ok';
  }
}

/** A path parameter that is not a UUIDv7 — the case the guard exists to refuse. */
@Controller('workspaces/:workspaceId')
class StubSlugController {
  @Get('boards/by-slug/:slug')
  bySlug(@Param('slug') _slug: string): string {
    return 'ok';
  }
}

/**
 * A container to scan, deliberately never `init()`ed.
 *
 * `SwaggerModule.createDocument` reads the module container's controller metadata, which
 * `compile()` has already populated; `init()` would additionally instantiate every provider and
 * stand up an HTTP adapter, and this file needs neither. It is not only about speed. `pnpm test`
 * runs the API and web suites concurrently, and the web suite's Recharts tests measure layout in
 * jsdom — they fail when the machine is busy enough that a `ResizeObserver` callback lands late.
 * Booting seven applications to read metadata off three was enough to make that happen, measured
 * over repeated runs of the full suite.
 */
async function buildFrom(controllers: unknown[]): Promise<{
  app: INestApplication;
  build: () => OpenAPIObject;
}> {
  const moduleRef = await Test.createTestingModule({
    controllers: controllers as never[],
  }).compile();
  const app = moduleRef.createNestApplication();

  return { app, build: () => buildOpenApiDocument(app) };
}

describe('buildOpenApiDocument', () => {
  describe('the global contract', () => {
    let document: OpenAPIObject;
    let app: INestApplication;

    beforeAll(async () => {
      const built = await buildFrom([
        StubHealthController,
        StubWorkspaceController,
        StubSessionOnlyController,
      ]);
      app = built.app;
      document = built.build();
    });

    afterAll(async () => {
      await app.close();
    });

    it('accepts a session cookie or a personal access token on a workspace operation', () => {
      const operation = document.paths['/workspaces/{workspaceId}/tasks/{taskId}']?.get;

      expect(operation?.security).toEqual([
        { [SESSION_SECURITY_SCHEME]: [] },
        { [TOKEN_SECURITY_SCHEME]: [] },
      ]);
      expect(operation?.responses['401']).toBeDefined();
    });

    it('declares both security schemes once, at the document level', () => {
      const schemes = document.components?.securitySchemes ?? {};

      expect(schemes[SESSION_SECURITY_SCHEME]).toMatchObject({ type: 'apiKey', in: 'cookie' });
      expect(schemes[TOKEN_SECURITY_SCHEME]).toMatchObject({ type: 'http', scheme: 'bearer' });
    });

    /**
     * The two shapes a token is refused on. Token management, because a credential must not
     * mint or enumerate credentials; a path with no workspace, because there is no scope to
     * compare a workspace-bound token against.
     */
    it.each([
      ['get', '/workspaces/{workspaceId}/tokens', 'token management'],
      ['post', '/workspaces/{workspaceId}/invitations', 'a Better Auth write'],
      ['get', '/me', 'an account route with no workspace in its path'],
    ])('requires the session cookie alone on %s %s (%s)', (method, path) => {
      const operation = document.paths[path]?.[method as 'get' | 'post'];

      expect(operation?.security).toEqual([{ [SESSION_SECURITY_SCHEME]: [] }]);
    });

    it('keeps the token on the same path under a method the list does not name', () => {
      // `PATCH /workspaces/{workspaceId}` is session-only; `GET` of the same path is not. The
      // list is keyed by method and path together, or the read would lose its token by mistake.
      const operation = document.paths['/workspaces/{workspaceId}']?.get;
      expect(operation?.security).toEqual([
        { [SESSION_SECURITY_SCHEME]: [] },
        { [TOKEN_SECURITY_SCHEME]: [] },
      ]);
    });

    it('spells the health probes as public with an empty array, not an absent key', () => {
      const operation = document.paths['/health']?.get;

      // `security: []` overrides the document-level requirement. Deleting the key would inherit
      // it instead, which is the opposite of what these routes do.
      expect(operation?.security).toEqual([]);
      expect(operation?.responses['401']).toBeUndefined();
    });

    it('gives a throttled operation the rate-limit headers and a 429', () => {
      const operation = document.paths['/workspaces/{workspaceId}/tasks']?.post;
      const created = operation?.responses['201'];

      expect(operation?.responses['429']).toBeDefined();
      expect(Object.keys(created && 'headers' in created ? (created.headers ?? {}) : {})).toEqual(
        expect.arrayContaining([
          'X-Request-Id',
          'X-RateLimit-Limit',
          'X-RateLimit-Remaining',
          'X-RateLimit-Reset',
        ]),
      );
    });

    it('exempts the health probes from the throttler headers and the 429', () => {
      const operation = document.paths['/health/ready']?.get;
      const ok = operation?.responses['200'];
      const headers = ok && 'headers' in ok ? (ok.headers ?? {}) : {};

      expect(operation?.responses['429']).toBeUndefined();
      // The correlation id is written by middleware that runs for every request, probes
      // included, so it stays even where the rate-limit trio is dropped.
      expect(Object.keys(headers)).toEqual(['X-Request-Id']);
    });

    it('gives every operation a 500, including the public ones', () => {
      for (const item of Object.values(document.paths)) {
        for (const operation of Object.values(item)) {
          if (typeof operation === 'object' && operation !== null && 'responses' in operation) {
            expect(operation.responses['500']).toBeDefined();
          }
        }
      }
    });

    it('marks every path parameter as a UUID and says it is opaque', () => {
      const parameters =
        document.paths['/workspaces/{workspaceId}/tasks/{taskId}']?.get?.parameters;

      expect(parameters).toHaveLength(2);
      for (const parameter of parameters ?? []) {
        expect(parameter).toMatchObject({
          in: 'path',
          schema: { type: 'string', format: 'uuid' },
          description: expect.stringContaining('UUIDv7'),
        });
      }
    });

    it('leaves query parameters alone', () => {
      // `cursor` is opaque and is an `id`, but the pass must key on `in: 'path'` rather than on
      // the name: a query parameter that acquired `format: uuid` would be a spec claiming the
      // server validates something it does not.
      const cursor = document.paths['/workspaces/{workspaceId}/tasks']?.get?.parameters?.find(
        (parameter) => 'name' in parameter && parameter.name === 'cursor',
      );

      expect(cursor).toMatchObject({ in: 'query' });
      expect(cursor).not.toMatchObject({ schema: { format: 'uuid' } });
    });

    it('fills an empty response description with the reason phrase', () => {
      // `@nestjs/swagger` leaves `description` empty when no decorator supplied one, and the
      // specification requires the field. These stubs carry no `@ApiResponse`, so every success
      // response here is that case.
      expect(document.paths['/health']?.get?.responses['200']?.description).toBe('OK');
    });
  });

  describe('the guards that a passing CI run never reaches', () => {
    it('refuses a document whose health paths have been renamed away', async () => {
      const { app, build } = await buildFrom([StubWorkspaceController]);

      try {
        expect(build).toThrow(/PUBLIC_PATHS names 2 path\(s\)/);
        expect(build).toThrow(/\/health, \/health\/ready/);
      } finally {
        await app.close();
      }
    });

    it('refuses a document missing an operation SESSION_ONLY_OPERATIONS names', async () => {
      const { app, build } = await buildFrom([StubHealthController, StubWorkspaceController]);

      try {
        expect(build).toThrow(/SESSION_ONLY_OPERATIONS names 11 operation\(s\)/);
      } finally {
        await app.close();
      }
    });

    it('refuses a path parameter it cannot vouch for as a UUIDv7', async () => {
      const { app, build } = await buildFrom([
        StubHealthController,
        StubSessionOnlyController,
        StubSlugController,
      ]);

      try {
        expect(build).toThrow(/path parameter "slug"/);
        expect(build).toThrow(/UUID_PATH_PARAMS/);
      } finally {
        await app.close();
      }
    });
  });

  describe('determinism', () => {
    let build: () => OpenAPIObject;
    let app: INestApplication;

    beforeAll(async () => {
      const built = await buildFrom([
        StubHealthController,
        StubWorkspaceController,
        StubSessionOnlyController,
      ]);
      app = built.app;
      build = built.build;
    });

    afterAll(async () => {
      await app.close();
    });

    it('produces the same document twice, because the drift gate depends on it', () => {
      // Nothing in the builder may read the clock, the network or the environment. A document
      // that varied between two calls would fail `openapi:check` on a clean tree, which is the
      // one failure mode that would get the gate switched off rather than fixed.
      expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
    });

    it('names a relative server, so no deployment hostname is baked into the document', () => {
      // An absolute one would bake a single deployment's hostname into a document that ships in
      // the repository and is served by every self-hosted instance under a different name.
      expect(build().servers).toEqual([{ url: '/', description: 'This instance' }]);
    });
  });
});
