import { IsOptional } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';
import { IsUuidV7 } from '../../common/uuid';

/** Cursor page query for activity feeds (newest-first via id desc). */
export class ActivityQueryDto {
  @PageLimit()
  limit: number = DEFAULT_PAGE_LIMIT;

  @IsOptional()
  @IsUuidV7()
  cursor?: string;
}
