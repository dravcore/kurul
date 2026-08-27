import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_CHECKLIST_TITLE_LENGTH } from './task-limits';

export class UpdateChecklistDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHECKLIST_TITLE_LENGTH)
  title!: string;
}
