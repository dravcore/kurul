/**
 * Better Auth organization HTTP paths that mutate tenancy.
 * Nest `/workspaces/*` is the sole public mutation API; these stay blocked at the mount.
 *
 * Allowed (used by the web client / session UX): set-active, get-invitation, list,
 * get-full-organization, get-active-member, get-active-member-role, list-members,
 * list-invitations, list-user-invitations, check-slug.
 */
const BLOCKED_ORGANIZATION_PATHS = new Set([
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/accept-invitation',
  '/organization/reject-invitation',
  '/organization/add-member',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/organization/create-team',
  '/organization/remove-team',
  '/organization/update-team',
  '/organization/set-active-team',
  '/organization/add-team-member',
  '/organization/remove-team-member',
]);

/**
 * Returns true when the request targets a blocked Better Auth organization mutation.
 * `pathname` is the Express path (e.g. `/auth/organization/create`).
 */
export function isBlockedOrganizationMutation(pathname: string): boolean {
  const authRelative = pathname.startsWith('/auth')
    ? pathname.slice('/auth'.length) || '/'
    : pathname;
  const normalized = authRelative.split('?')[0] ?? authRelative;
  return BLOCKED_ORGANIZATION_PATHS.has(normalized);
}
