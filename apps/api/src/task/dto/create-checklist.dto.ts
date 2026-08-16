import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateChecklistDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
