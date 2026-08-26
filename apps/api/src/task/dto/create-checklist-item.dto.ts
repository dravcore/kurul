import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_CHECKLIST_ITEM_CONTENT_LENGTH } from './checklist-item-limits';

export class CreateChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHECKLIST_ITEM_CONTENT_LENGTH)
  content!: string;
}
