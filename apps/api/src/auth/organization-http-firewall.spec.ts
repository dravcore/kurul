import { isBlockedOrganizationMutation } from './organization-http-firewall';

describe('isBlockedOrganizationMutation', () => {
  it('blocks organization create/invite/delete HTTP paths', () => {
    expect(isBlockedOrganizationMutation('/auth/organization/create')).toBe(true);
    expect(isBlockedOrganizationMutation('/auth/organization/invite-member')).toBe(true);
    expect(isBlockedOrganizationMutation('/auth/organization/delete')).toBe(true);
    expect(isBlockedOrganizationMutation('/auth/organization/accept-invitation')).toBe(true);
  });

  it('allows set-active and read paths used by the web client', () => {
    expect(isBlockedOrganizationMutation('/auth/organization/set-active')).toBe(false);
    expect(isBlockedOrganizationMutation('/auth/organization/get-invitation')).toBe(false);
    expect(isBlockedOrganizationMutation('/auth/organization/list')).toBe(false);
    expect(isBlockedOrganizationMutation('/auth/sign-in/email')).toBe(false);
  });

  it('leaves the email verification endpoints reachable', () => {
    // An invitation cannot be accepted from an unverified address, so blocking either of
    // these would make invitations permanently unacceptable rather than merely inconvenient.
    expect(isBlockedOrganizationMutation('/auth/send-verification-email')).toBe(false);
    expect(isBlockedOrganizationMutation('/auth/verify-email')).toBe(false);
  });
});
