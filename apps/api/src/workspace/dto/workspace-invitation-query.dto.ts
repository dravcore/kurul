import { IsOptional } from 'class-validator';
import { MAX_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';
import { IsUuidV7 } from '../../common/uuid';

/** Cursor page query for a workspace's pending invitations. */
export class WorkspaceInvitationQueryDto {
  /**
   * Ceiling-as-default, for the same reason as `WorkspaceMemberQueryDto`: the outstanding
   * invitations of a workspace are bounded by the roster they are trying to grow, so the
   * settings screen that reads both should not pay for a second round trip on the smaller of
   * the two lists. The cursor still exists because "few" is an expectation, not a constraint
   * (docs/api-conventions.md#pagination).
   */
  @PageLimit(MAX_PAGE_LIMIT)
  limit: number = MAX_PAGE_LIMIT;

  @IsOptional()
  @IsUuidV7()
  cursor?: string;
}
