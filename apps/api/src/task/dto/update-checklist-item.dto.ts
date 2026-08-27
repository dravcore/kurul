import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_CHECKLIST_ITEM_CONTENT_LENGTH } from './checklist-item-limits';

export class UpdateChecklistItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHECKLIST_ITEM_CONTENT_LENGTH)
  content?: string;

  @IsOptional()
  @IsBoolean()
  isDone?: boolean;
}
