import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateChecklistItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}
