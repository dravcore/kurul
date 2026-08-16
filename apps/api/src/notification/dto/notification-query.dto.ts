import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { NotificationType } from '@kurul/shared-types';
import { DEFAULT_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';
import { IsUuidV7 } from '../../common/uuid';

function toBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const s = String(value).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return undefined;
}

const NOTIFICATION_TYPES = Object.values(NotificationType);

/** Cursor page query for the current user's notifications. */
export class NotificationQueryDto {
  @PageLimit()
  limit: number = DEFAULT_PAGE_LIMIT;

  @IsOptional()
  @IsUuidV7()
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];
}
