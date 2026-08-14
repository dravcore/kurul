import { ActivityQueryDto } from '../../activity/dto/activity-query.dto';
import { WorkspaceInvitationQueryDto } from '../../workspace/dto/workspace-invitation-query.dto';
import { WorkspaceMemberQueryDto } from '../../workspace/dto/workspace-member-query.dto';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './page-limit';
import { acceptedDto, dtoFields, rejectedDto } from '../validation/dto-test-helpers';

const VALID_CURSOR = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d4f';

/**
 * Three unrelated cursor-page query DTOs (`ActivityQueryDto`, `WorkspaceInvitationQueryDto`,
 * `WorkspaceMemberQueryDto`) all resolve to the same `@PageLimit()` + optional `@IsUuidV7()
 * cursor` shape, and none of them was reachable from a unit test before this file — the audit's
 * `src/*\/dto` 0% finding covers all three, and `PageLimit()` itself (`page-limit.ts:37-40`) was
 * likewise never invoked outside `pnpm --filter @kurultay/api test:e2e`. One table drives all
 * three instead of copy-pasting the same cases per file, since a drift between them (e.g. one
 * DTO's default silently changing to something other than its documented ceiling/floor) is
 * exactly the kind of thing that is easy to miss when each file's tests are separate.
 */
describe.each([
  { name: 'ActivityQueryDto', metatype: ActivityQueryDto, defaultLimit: DEFAULT_PAGE_LIMIT },
  {
    name: 'WorkspaceInvitationQueryDto',
    metatype: WorkspaceInvitationQueryDto,
    defaultLimit: MAX_PAGE_LIMIT,
  },
  {
    name: 'WorkspaceMemberQueryDto',
    metatype: WorkspaceMemberQueryDto,
    defaultLimit: MAX_PAGE_LIMIT,
  },
])('$name', ({ metatype, defaultLimit }) => {
  it(`defaults limit to ${defaultLimit === MAX_PAGE_LIMIT ? 'MAX_PAGE_LIMIT' : 'DEFAULT_PAGE_LIMIT'} when omitted`, async () => {
    const dto = await acceptedDto<{ limit: number }>(metatype, {});

    expect(dto.limit).toBe(defaultLimit);
  });

  it('accepts a cursor that is a genuine UUIDv7', async () => {
    const dto = await acceptedDto<{ cursor?: string }>(metatype, { cursor: VALID_CURSOR });

    expect(dto.cursor).toBe(VALID_CURSOR);
  });

  it('rejects a cursor that is not a UUIDv7', async () => {
    const { statusCode, details } = await rejectedDto(metatype, { cursor: 'not-a-uuid' });

    expect(statusCode).toBe(400);
    expect(dtoFields(details)).toContain('cursor');
  });

  it('clamps an oversized limit to MAX_PAGE_LIMIT rather than rejecting it', async () => {
    const dto = await acceptedDto<{ limit: number }>(metatype, { limit: MAX_PAGE_LIMIT + 500 });

    expect(dto.limit).toBe(MAX_PAGE_LIMIT);
  });

  it('falls back to the default instead of 400ing on a junk limit', async () => {
    const dto = await acceptedDto<{ limit: number }>(metatype, { limit: 'not-a-number' });

    expect(dto.limit).toBe(defaultLimit);
  });

  it('rejects an unlisted field', async () => {
    const { statusCode } = await rejectedDto(metatype, { extra: 'field' });

    expect(statusCode).toBe(400);
  });
});
