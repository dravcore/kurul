import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { MemberRole } from '@kurultay/shared-types';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { ADMIN_ROLES, CONTENT_ROLES } from '../common/decorators/workspace-roles.decorator';
import {
  DEFAULT_RATE_LIMIT,
  IMPORT_RATE_LIMIT,
  RATE_LIMIT_WINDOW_SECONDS,
} from '../common/rate-limit/rate-limit';
import type { AuthenticatedUser } from '../common/types/request-context';
import { ImportController } from './import.controller';
import { TrelloImportService } from './trello-import.service';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d50';
const USER = { id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d54' } as AuthenticatedUser;

function build() {
  const imports = {
    importBoard: jest.fn().mockResolvedValue({
      boardId: 'board',
      boardName: 'Board',
      imported: {
        columns: 0,
        tasks: 0,
        labels: 0,
        checklists: 0,
        checklistItems: 0,
        attachments: 0,
      },
      skipped: [],
    }),
  } as unknown as TrelloImportService;
  return { controller: new ImportController(imports), imports };
}

describe('ImportController.trello', () => {
  it('hands the uploaded bytes to the service, with the caller as the actor', async () => {
    const { controller, imports } = build();
    const buffer = Buffer.from('{"name":"x","lists":[]}');

    await controller.trello(WORKSPACE_ID, USER, {
      originalname: 'trello.json',
      mimetype: 'application/json',
      size: buffer.length,
      buffer,
    });

    expect(imports.importBoard).toHaveBeenCalledWith(WORKSPACE_ID, USER.id, buffer);
  });

  it('names the missing part rather than guessing what the caller meant', () => {
    const { controller, imports } = build();

    // `FileInterceptor` is a no-op on a request that is not multipart
    // (`multer/lib/make-middleware.js`: `if (!is(req, ['multipart'])) return next()`), so a JSON
    // POST reaches this handler with no file at all rather than being rejected earlier.
    expect(() => controller.trello(WORKSPACE_ID, USER, undefined)).toThrow(BadRequestException);
    expect(() => controller.trello(WORKSPACE_ID, USER, undefined)).toThrow(/file part named/);
    expect(imports.importBoard).not.toHaveBeenCalled();
  });
});

describe('ImportController route metadata', () => {
  const handler = ImportController.prototype.trello;

  it('is mounted under the workspace, at imports/trello', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ImportController)).toBe(
      'workspaces/:workspaceId/imports',
    );
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('trello');
  });

  it('is admin-only, because it creates columns', () => {
    // Permission arithmetic, not analogy: `POST .../boards/:boardId/columns` is admin-only, so an
    // endpoint that creates columns must be too. If this ever relaxed to CONTENT_ROLES, a member
    // could create columns in one request that they cannot create in several.
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([...ADMIN_ROLES]);
    // The negative half: the roles are not the *content* set. Without it, the assertion above
    // would still pass if ADMIN_ROLES itself were widened to include MEMBER.
    expect(Reflect.getMetadata(ROLES_KEY, handler)).not.toContain(MemberRole.MEMBER);
    expect(CONTENT_ROLES).toContain(MemberRole.MEMBER);
  });

  it('caps imports well below the API default', () => {
    /** The metadata `Throttle()` writes; see `@nestjs/throttler/dist/throttler.decorator.js`. */
    const limit: unknown = Reflect.getMetadata('THROTTLER:LIMIT' + 'default', handler);
    const ttl: unknown = Reflect.getMetadata('THROTTLER:TTL' + 'default', handler);

    // A dropped decorator leaves the route on the global 100/min, which is 100 × 20 MiB of
    // buffered, parsed body a minute from one IP. Nothing else in the build would notice.
    expect(limit).toBe(IMPORT_RATE_LIMIT);
    expect(IMPORT_RATE_LIMIT).toBeLessThan(DEFAULT_RATE_LIMIT);
    expect(ttl).toBe(RATE_LIMIT_WINDOW_SECONDS * 1000);
  });
});
