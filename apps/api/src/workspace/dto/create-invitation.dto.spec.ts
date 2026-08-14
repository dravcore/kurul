import { MemberRole } from '@kurultay/shared-types';
import { acceptedDto, dtoFields, rejectedDto } from '../../common/validation/dto-test-helpers';
import { CreateInvitationDto } from './create-invitation.dto';

/**
 * `WorkspaceInvitationService.createInvitation` also refuses `role: OWNER` at the service layer
 * (`if (dto.role === MemberRole.OWNER) throw new BadRequestException(...)`), so the DTO-level
 * `@IsNotIn` here looks redundant — it is defense in depth on purpose: `@Body()` binding runs
 * before any service code, so a bug that ever bypassed or reordered the service check would
 * still have this layer refusing the request before an OWNER-granting invitation was created.
 */
describe('CreateInvitationDto', () => {
  it('accepts a valid email and a non-OWNER role', async () => {
    const dto = await acceptedDto<CreateInvitationDto>(CreateInvitationDto, {
      email: 'invitee@example.com',
      role: MemberRole.MEMBER,
    });

    expect(dto).toMatchObject({ email: 'invitee@example.com', role: MemberRole.MEMBER });
  });

  it('rejects role: OWNER before the request ever reaches the service layer', async () => {
    const { details } = await rejectedDto(CreateInvitationDto, {
      email: 'invitee@example.com',
      role: MemberRole.OWNER,
    });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'role', constraint: 'isNotIn' }),
    );
  });

  it('rejects a malformed email', async () => {
    const { statusCode, details } = await rejectedDto(CreateInvitationDto, {
      email: 'not-an-email',
      role: MemberRole.MEMBER,
    });

    expect(statusCode).toBe(400);
    expect(dtoFields(details)).toContain('email');
  });

  it('rejects an empty email', async () => {
    const { details } = await rejectedDto(CreateInvitationDto, {
      email: '',
      role: MemberRole.MEMBER,
    });

    expect(dtoFields(details)).toContain('email');
  });

  it('rejects a role outside the MemberRole enum', async () => {
    const { details } = await rejectedDto(CreateInvitationDto, {
      email: 'invitee@example.com',
      role: 'SUPERADMIN',
    });

    expect(details).toContainEqual(
      expect.objectContaining({ field: 'role', constraint: 'isEnum' }),
    );
  });

  it.each([MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.GUEST])(
    'accepts %s, the roles an OWNER may actually grant by invitation',
    async (role) => {
      const dto = await acceptedDto<CreateInvitationDto>(CreateInvitationDto, {
        email: 'invitee@example.com',
        role,
      });

      expect(dto.role).toBe(role);
    },
  );
});
