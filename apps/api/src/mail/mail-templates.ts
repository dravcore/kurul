import type { MailMessage } from './mail-sender';

const PRODUCT_NAME = 'Kurultay';

/**
 * Escapes the five characters that can break out of HTML text or an attribute value.
 *
 * Workspace names, display names and URLs are attacker-controllable (anyone can name a
 * workspace), and an invitation email is read in the recipient's mail client — the one place
 * where injected markup is rendered for someone who never chose to trust the sender.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Collapses anything that could split a header (CR, LF) or pad a subject line.
 *
 * nodemailer encodes headers itself, so this is belt-and-braces rather than the only
 * defence — but the value reaching `subject` here comes straight from user input.
 */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Wraps a body in the one shared HTML shell, so both emails look like the same product. */
function htmlDocument(heading: string, bodyHtml: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `<p style="font-size:12px;color:#666;margin-top:24px">${escapeHtml(PRODUCT_NAME)}</p>`,
    '</div>',
  ].join('');
}

/** A primary action rendered as a link plus the raw URL, for clients that strip anchors. */
function actionHtml(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return (
    `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;` +
    `background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>` +
    `<p style="font-size:12px;color:#666">If the button does not work, paste this link into your browser:<br>${safeUrl}</p>`
  );
}

export interface VerificationEmailParams {
  to: string;
  /** The recipient's display name; may be blank for accounts created without one. */
  name: string;
  /** The Better Auth `/auth/verify-email?token=…&callbackURL=…` link. */
  verificationUrl: string;
}

export function buildVerificationEmail(params: VerificationEmailParams): MailMessage {
  const greeting = params.name.trim() === '' ? 'Hi,' : `Hi ${singleLine(params.name)},`;
  const lead = `Confirm this address to finish setting up your ${PRODUCT_NAME} account. You need a confirmed address before you can accept a workspace invitation.`;
  const closing = 'If you did not create this account, you can ignore this email.';

  return {
    to: params.to,
    subject: `Confirm your email address for ${PRODUCT_NAME}`,
    text: [greeting, '', lead, '', params.verificationUrl, '', closing].join('\n'),
    html: htmlDocument(
      'Confirm your email address',
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(lead)}</p>` +
        actionHtml('Confirm email address', params.verificationUrl) +
        `<p>${escapeHtml(closing)}</p>`,
    ),
  };
}

export interface InvitationEmailParams {
  to: string;
  /** Display name of the member who sent the invitation. */
  inviterName: string;
  workspaceName: string;
  /** The web app's invitation page for this invitation. */
  acceptUrl: string;
}

export function buildInvitationEmail(params: InvitationEmailParams): MailMessage {
  const workspaceName = singleLine(params.workspaceName);
  const inviterName = singleLine(params.inviterName);
  const lead =
    inviterName === ''
      ? `You have been invited to join the workspace "${workspaceName}" on ${PRODUCT_NAME}.`
      : `${inviterName} invited you to join the workspace "${workspaceName}" on ${PRODUCT_NAME}.`;
  // Stated up front because it is the step that will otherwise look like a broken invitation:
  // the accept endpoint refuses an unconfirmed address.
  const note =
    'Sign in with this email address and confirm it first — an invitation can only be accepted from a confirmed address.';
  const closing = 'If you were not expecting this invitation, you can ignore this email.';

  return {
    to: params.to,
    subject: `You have been invited to join ${workspaceName} on ${PRODUCT_NAME}`,
    text: [lead, '', params.acceptUrl, '', note, '', closing].join('\n'),
    html: htmlDocument(
      `Join ${workspaceName}`,
      `<p>${escapeHtml(lead)}</p>` +
        actionHtml('View invitation', params.acceptUrl) +
        `<p>${escapeHtml(note)}</p><p>${escapeHtml(closing)}</p>`,
    ),
  };
}
