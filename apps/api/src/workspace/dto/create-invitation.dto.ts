import { MemberRole } from '@kurultay/shared-types';
import { IsEmail, IsEnum, IsNotEmpty } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsEnum(MemberRole)
  role!: MemberRole;
}
