import { IsOptional } from 'class-validator';
import { MAX_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';
import { IsUuidV7 } from '../../common/uuid';

/** Cursor page query for a task's comments. */
export class CommentQueryDto {
  /** A task's comment thread is short, so the default is the ceiling — one round trip. */
  @PageLimit(MAX_PAGE_LIMIT)
  limit: number = MAX_PAGE_LIMIT;

  @IsOptional()
  @IsUuidV7()
  cursor?: string;
}
