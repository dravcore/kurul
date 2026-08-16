import { MemberRole } from '@kurul/shared-types';
import { IsEmail, IsEnum, IsNotEmpty, IsNotIn } from 'class-validator';

export class CreateInvitationDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsEnum(MemberRole)
  @IsNotIn([MemberRole.OWNER], {
    message: 'OWNER cannot be invited; transfer ownership instead',
  })
  role!: MemberRole;
}
