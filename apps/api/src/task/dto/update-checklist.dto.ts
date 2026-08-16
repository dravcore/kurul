import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateChecklistDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
