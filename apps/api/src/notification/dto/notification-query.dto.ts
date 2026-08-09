import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { NotificationType } from '@kurultay/shared-types';
import { DEFAULT_PAGE_LIMIT, PageLimit } from '../../common/pagination/page-limit';

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
  @IsUUID('7')
  cursor?: string;

  @IsOptional()
  @Transform(({ value }) => toBoolean(value))
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_TYPES)
  type?: (typeof NOTIFICATION_TYPES)[number];
}
