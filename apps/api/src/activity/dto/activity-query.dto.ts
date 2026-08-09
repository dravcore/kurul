import { IsOptional, IsUUID } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';

/** Cursor page query for activity feeds (newest-first via id desc). */
export class ActivityQueryDto {
  @PageLimit()
  limit: number = DEFAULT_PAGE_LIMIT;

  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}
