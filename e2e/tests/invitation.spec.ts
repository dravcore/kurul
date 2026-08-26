import { expect, test } from '../support/fixtures';
import { extractLink } from '../support/mailpit';

/**
 * Scenario 3 — invite someone from the settings page, read the mail, accept from the link.
 *
 * Every other test here creates its memberships over HTTP; this one clicks through the
 * dialog, because the part with no other coverage is the *mail*. `POST /invitations` is
 * covered by the integration suite, and it returns an `acceptUrl` in its response — a test
 * that takes the link from there passes on a server whose SMTP is misconfigured, whose
 * `WEB_URL` points at the wrong host, or whose invitation template lost its link entirely.
 * None of those are hypothetical: `acceptUrl` is built from `WEB_URL`, which is also the CORS
 * origin, so it is the one setting a deployment is most likely to get half-right.
 *
 * So the link this test follows comes out of Mailpit, from the body of the message the
 * application actually sent. Everything before the click is the real product: a dialog, an
 * SMTP delivery, an inbox.
 */
test('an invitation sent from settings arrives by email and can be accepted', async ({
  stack,
  openAs,
}) => {
  const owner = await stack.createUser();
  // The invited account confirms its address the same way a real one does — the accept
  // endpoint refuses an unconfirmed address (ADR 0013), so skipping this would not be a
  // shortcut, it would be a different test.
  const invitee = await stack.createUser({ confirmEmail: true });
  const workspace = await stack.createWorkspace(owner);

  const ownerPage = await openAs(owner);
  await ownerPage.goto('/settings/members');

  await ownerPage.getByRole('button', { name: 'Invite member' }).click();
  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email address').fill(invitee.email);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  // The application's own confirmation that it believes the mail went out. Asserting on it
  // separates "the invitation was never created" from "the invitation was created but no
  // mail arrived" — two very different bugs that a single Mailpit timeout would blur.
  await expect(ownerPage.getByText(`Invitation sent to ${invitee.email}`)).toBeVisible();
  await expect(
    ownerPage.getByText('Waiting to be accepted'),
    'the pending invitation should be listed for the inviter',
  ).toBeVisible();

  const mailbox = await stack.mail();
  const body = await mailbox.waitForMessage(invitee.email, 'You have been invited to join');
  const acceptUrl = extractLink(body, '/invite/');

  // The link has to point at the web app the invitee can actually reach. A `WEB_URL` left at
  // its default while the app runs elsewhere produces a mail that looks perfect and is
  // useless, and this is the assertion that catches it.
  expect(acceptUrl, 'the invitation link must point at the web app').toContain(
    `${new URL(ownerPage.url()).origin}/invite/`,
  );

  const inviteePage = await openAs(invitee);
  await inviteePage.goto(acceptUrl);

  await expect(inviteePage.getByRole('heading', { name: 'Accept invitation' })).toBeVisible();
  await expect(
    inviteePage.getByText(`You've been invited to join ${workspace.name}.`),
  ).toBeVisible();
  await inviteePage.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(inviteePage).toHaveURL('/dashboard');

  // Accepted for real, not just navigated: the workspace the invitee could not see a moment
  // ago now answers to their session.
  const members = await invitee.api.get(`/workspaces/${workspace.id}/members`);
  expect(
    members.ok(),
    `the invitee should now be able to read the workspace's members, got ${members.status()}`,
  ).toBe(true);
});
