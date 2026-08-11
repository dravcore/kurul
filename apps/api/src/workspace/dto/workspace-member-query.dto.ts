import { IsOptional, IsUUID } from 'class-validator';
import { MAX_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';

/** Cursor page query for a workspace's members. */
export class WorkspaceMemberQueryDto {
  /**
   * A workspace roster is small next to a task list, so the default is the ceiling: every
   * ordinary workspace is one round trip, and only the rare huge one pays for a second page.
   */
  @PageLimit(MAX_PAGE_LIMIT)
  limit: number = MAX_PAGE_LIMIT;

  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}
