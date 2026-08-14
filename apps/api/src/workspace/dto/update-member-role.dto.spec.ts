import { MemberRole } from '@kurultay/shared-types';
import { acceptedDto, rejectedDto } from '../../common/validation/dto-test-helpers';
import { UpdateMemberRoleDto } from './update-member-role.dto';

/**
 * Unlike `CreateInvitationDto`, `OWNER` is deliberately *not* excluded here — see the class doc
 * comment. `WorkspaceMemberService.updateMemberRole` is where that role-hierarchy question is
 * actually answered (only an OWNER may mint one); this DTO's only job is the shape, so this
 * spec asserts OWNER is accepted at the DTO layer rather than assuming it, which would be the
 * wrong assumption if someone "fixed" this DTO to mirror the invitation one.
 */
describe('UpdateMemberRoleDto', () => {
  it.each(Object.values(MemberRole))('accepts %s', async (role) => {
    const dto = await acceptedDto<UpdateMemberRoleDto>(UpdateMemberRoleDto, { role });

    expect(dto.role).toBe(role);
  });

  it('rejects a role outside the MemberRole enum', async () => {
    const { details } = await rejectedDto(UpdateMemberRoleDto, { role: 'SUPERADMIN' });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'role', constraint: 'isEnum' }),
    );
  });

  it('rejects a missing role', async () => {
    const { statusCode } = await rejectedDto(UpdateMemberRoleDto, {});

    expect(statusCode).toBe(400);
  });
});
